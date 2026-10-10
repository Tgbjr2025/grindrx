import { afterEach, describe, expect, it, vi } from "vitest";

import {
	abortReason,
	DEFAULT_RETRY_POLICY,
	isIdempotentMethod,
	isRetryableError,
	isRetryableStatus,
	nextRetryDelay,
	parseRetryAfter,
	resolveRetryPolicy,
	shouldRetryMethod,
	sleepWithSignal,
	throwIfAborted,
} from "$lib/net/retry";

/** Policy with retries on and no jitter, so every number below is exact. */
const POLICY = resolveRetryPolicy({ baseDelayMs: 100, maxDelayMs: 1000 });

afterEach(() => {
	vi.useRealTimers();
});

describe("isIdempotentMethod", () => {
	it.each(["GET", "get", "Get", "HEAD", "OPTIONS", " options "])(
		"treats %s as idempotent",
		(method) => {
			expect(isIdempotentMethod(method)).toBe(true);
		},
	);

	// The whole point: a retried POST can double-charge or double-send.
	it.each(["POST", "PUT", "PATCH", "DELETE"])(
		"does NOT treat %s as idempotent by default",
		(method) => {
			expect(isIdempotentMethod(method)).toBe(false);
		},
	);
});

describe("shouldRetryMethod", () => {
	it("allows the idempotent verbs with no policy at all", () => {
		expect(shouldRetryMethod("GET")).toBe(true);
	});

it.each(["POST", "PUT", "PATCH", "DELETE"])(
		"refuses to replay %s without an explicit assertion",
		(method) => {
			expect(shouldRetryMethod(method)).toBe(false);
			expect(shouldRetryMethod(method, {})).toBe(false);
		},
	);

	it("honours an explicit idempotent assertion for a non-idempotent verb", () => {
		expect(shouldRetryMethod("POST", { idempotent: true })).toBe(true);
	});

	it("still refuses an explicit false assertion on an idempotent verb", () => {
		expect(shouldRetryMethod("GET", false)).toBe(false);
		expect(shouldRetryMethod("GET", { idempotent: false })).toBe(true);
	});

	it("lets `retry: false` override an idempotent assertion (it is an off switch)", () => {
		expect(shouldRetryMethod("POST", false)).toBe(false);
	});
});

describe("isRetryableStatus", () => {
	it.each([429, 500, 502, 503, 504])("retries %s", (status) => {
		expect(isRetryableStatus(status)).toBe(true);
	});

	// 501 is permanent, and a 4xx is a definite answer — re-sending only delays
	// the error the user needed to see.
	it.each([200, 400, 401, 403, 404, 408, 409, 422, 501, 505])(
		"does NOT retry %s",
		(status) => {
			expect(isRetryableStatus(status)).toBe(false);
		},
	);
});

describe("isRetryableError", () => {
	// `AppError` derives `From<reqwest::Error>`, so Http is where connection
	// resets, DNS failures and the 30s client timeout all arrive.
	it("treats a bridge Http error as transient", () => {
		expect(isRetryableError({ kind: "Http", message: "connection reset" })).toBe(
			true,
		);
	});

	it.each(["Auth", "CredentialStore", "Api", "NotInitialized"])(
		"does NOT retry the deterministic %s error",
		(kind) => {
			expect(isRetryableError({ kind, message: "nope" })).toBe(false);
		},
	);

	it("does not retry an untyped error (a local bug is not a transient network failure)", () => {
		expect(isRetryableError(new Error("boom"))).toBe(false);
		expect(isRetryableError("reset")).toBe(false);
		expect(isRetryableError(null)).toBe(false);
	});
});

describe("parseRetryAfter", () => {
	it("reads delta-seconds", () => {
		expect(parseRetryAfter("120")).toBe(120_000);
		expect(parseRetryAfter("  30  ")).toBe(30_000);
		expect(parseRetryAfter("0")).toBe(0);
	});

	it("reads an HTTP-date into a delay relative to now", () => {
		const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
		expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:30 GMT", now)).toBe(30_000);
	});

	it("clamps a past HTTP-date to zero rather than rejecting it", () => {
		const now = Date.parse("Wed, 21 Oct 2015 07:28:30 GMT");
		// A server whose clock is behind ours still meant "retry"; treating the
		// instruction as absent would fall back to a longer random backoff.
		expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", now)).toBe(0);
	});

	// A plain loop rather than `it.each`: an inline mixed array makes `it.each`
	// infer `any` for the callback parameter, which the type-checked lint rules
	// reject.
	const UNUSABLE_RETRY_AFTER: (string | null | undefined)[] = [
		null,
		undefined,
		"",
		"   ",
		"soon",
		"12s",
		"-5",
	];
	for (const value of UNUSABLE_RETRY_AFTER) {
		it(`returns null for the unusable value ${JSON.stringify(value)} so the caller falls back to backoff`, () => {
			expect(parseRetryAfter(value)).toBeNull();
		});
	}

	it("does not clamp an absurd delta-seconds (the budget check must reject it)", () => {
		expect(parseRetryAfter("3600")).toBe(3_600_000);
	});
});

describe("nextRetryDelay", () => {
	it("returns null once maxAttempts is reached", () => {
		expect(
			nextRetryDelay({
				attempt: 3,
				policy: POLICY,
				elapsedMs: 0,
				sleptMs: 0,
			}),
		).toBeNull();
		expect(
			nextRetryDelay({
				attempt: 1,
				policy: POLICY,
				elapsedMs: 0,
				sleptMs: 0,
			}),
		).not.toBeNull();
	});

	it("grows the backoff exponentially, bounded by maxDelayMs", () => {
		const growth = resolveRetryPolicy({
			baseDelayMs: 100,
			maxDelayMs: 1000,
			maxAttempts: 8,
		});
		const delays = [1, 2, 3, 4].map((attempt) =>
			nextRetryDelay({
				attempt,
				policy: growth,
				elapsedMs: 0,
				sleptMs: 0,
				// Jitter floor is ceiling/2, so this is the minimum for each.
				random: () => 0,
			}),
		);
		expect(delays).toEqual([50, 100, 200, 400]);
	});

	it("caps a single sleep at maxDelayMs however many attempts have failed", () => {
		const growth = resolveRetryPolicy({
			baseDelayMs: 100,
			maxDelayMs: 1000,
			maxAttempts: 30,
		});
		expect(
			nextRetryDelay({
				attempt: 20,
				policy: growth,
				elapsedMs: 0,
				sleptMs: 0,
				random: () => 1,
			}),
		).toBe(1000);
	});

	it("stays within the jitter window for a fixed random source", () => {
		const base = { policy: POLICY, elapsedMs: 0, sleptMs: 0 };
		expect(nextRetryDelay({ ...base, attempt: 2, random: () => 0 })).toBe(100);
		expect(nextRetryDelay({ ...base, attempt: 2, random: () => 1 })).toBe(200);
	});

	// The reason a 429 exists in this module at all.
	it("honours Retry-After instead of the computed backoff", () => {
		expect(
			nextRetryDelay({
				attempt: 1,
				policy: POLICY,
				retryAfterMs: 1500,
				elapsedMs: 0,
				sleptMs: 0,
				random: () => 0,
			}),
		).toBe(1500);
	});

	// Retry-After is an instruction, not a suggestion: shortening it to fit
	// maxDelayMs would just earn another 429.
	it("never clamps Retry-After down to maxDelayMs", () => {
		expect(
			nextRetryDelay({
				attempt: 1,
				policy: POLICY,
				retryAfterMs: 5000,
				elapsedMs: 0,
				sleptMs: 0,
			}),
		).toBe(5000);
	});

	it("gives up rather than sleeping past the total elapsed budget", () => {
		// A user-perceived request must never be held for a server's hour-long
		// Retry-After; the 429 goes back to the caller instead.
		expect(
			nextRetryDelay({
				attempt: 1,
				policy: POLICY,
				retryAfterMs: 3_600_000,
				elapsedMs: 0,
				sleptMs: 0,
			}),
		).toBeNull();
	});

	it("gives up once the elapsed budget is already spent", () => {
		expect(
			nextRetryDelay({
				attempt: 1,
				policy: POLICY,
				elapsedMs: POLICY.maxElapsedMs,
				sleptMs: 0,
			}),
		).toBeNull();
	});

	it("gives up once the cumulative sleep budget is spent", () => {
		expect(
			nextRetryDelay({
				attempt: 1,
				policy: POLICY,
				elapsedMs: 0,
				sleptMs: POLICY.maxSleepMs,
			}),
		).toBeNull();
	});
});

describe("resolveRetryPolicy", () => {
	it("fills in the defaults", () => {
		expect(resolveRetryPolicy()).toEqual(DEFAULT_RETRY_POLICY);
	});

	it("collapses `false` to a single attempt", () => {
		expect(resolveRetryPolicy(false).maxAttempts).toBe(1);
	});

	it("lets a caller override an individual knob", () => {
		expect(resolveRetryPolicy({ maxAttempts: 7 }).maxAttempts).toBe(7);
		expect(resolveRetryPolicy({ maxAttempts: 7 }).baseDelayMs).toBe(
			DEFAULT_RETRY_POLICY.baseDelayMs,
		);
	});
});

describe("sleepWithSignal", () => {
	it("resolves after the requested delay", async () => {
		vi.useFakeTimers();
		const started = Date.now();
		const sleep = sleepWithSignal(250);
		await vi.advanceTimersByTimeAsync(250);
		await expect(sleep).resolves.toBeUndefined();
		expect(Date.now() - started).toBe(250);
	});

	it("resolves immediately for a zero delay", async () => {
		vi.useFakeTimers();
		await expect(sleepWithSignal(0)).resolves.toBeUndefined();
	});

	it("rejects with the caller's own abort reason instead of waiting out the timer", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const sleep = sleepWithSignal(60_000, controller.signal);
		controller.abort(new Error("caller navigated away"));
		await expect(sleep).rejects.toThrow("caller navigated away");
		// The point: no real time passed and the timer never fired.
		expect(vi.getTimerCount()).toBe(0);
	});

	it("rejects with an AbortError when the caller aborted without a reason", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const sleep = sleepWithSignal(60_000, controller.signal);
		controller.abort();
		await expect(sleep).rejects.toMatchObject({ name: "AbortError" });
	});

	it("rejects straight away when the signal is already aborted", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		controller.abort(new Error("already gone"));
		await expect(
			sleepWithSignal(60_000, controller.signal),
		).rejects.toThrow("already gone");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("cleans up its abort listener once the sleep completes", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const sleep = sleepWithSignal(100, controller.signal);
		await vi.advanceTimersByTimeAsync(100);
		await sleep;
		// A later abort must not reject an already-settled sleep.
		controller.abort();
		await expect(sleep).resolves.toBeUndefined();
	});
});

describe("abortReason / throwIfAborted", () => {
	it("prefers the signal's own reason", () => {
		const controller = new AbortController();
		const reason = new Error("mine");
		controller.abort(reason);
		expect(abortReason(controller.signal)).toBe(reason);
	});

	it("falls back to a DOMException AbortError", () => {
		const controller = new AbortController();
		controller.abort();
		expect(abortReason(controller.signal)).toMatchObject({
			name: "AbortError",
		});
	});

	it("throws only when a signal is present and aborted", () => {
		const controller = new AbortController();
		expect(() => throwIfAborted(undefined)).not.toThrow();
		expect(() => throwIfAborted(controller.signal)).not.toThrow();
		controller.abort(new Error("stop"));
		expect(() => throwIfAborted(controller.signal)).toThrow("stop");
	});
});