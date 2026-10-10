import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("$app/navigation", () => ({
	goto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("svelte-sonner", () => ({
	toast: vi.fn(),
}));

const { goto } = await import("$app/navigation");
const { toast } = await import("svelte-sonner");
const { isLocked } = await import("$lib/app-data/app-lock.svelte");
vi.mock("$lib/app-data/app-lock.svelte", () => ({
	isLocked: vi.fn().mockReturnValue(false),
}));

import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { ApiHttpError, fetchRest, resetAuthRedirectLatch } from "$lib/api";
import { requestBlockedAlertState } from "$lib/api/request-blocked/request-blocked-state.svelte";
import { fromBase64, toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);
const mockedGoto = vi.mocked(goto);
const mockedToast = vi.mocked(toast);
const mockedIsLocked = vi.mocked(isLocked);

/**
 * Retry policy for the timing tests: no jitter, so every delay is exactly
 * `baseDelayMs / 2 * 2^(attempt-1)` and can be asserted to the millisecond.
 * First backoff is 50ms, second 100ms.
 */
const FAST = { baseDelayMs: 100, maxDelayMs: 1000, random: () => 0 };

/** A base64'd msgpack `{ status, body }` envelope, as the bridge returns it. */
function bridgeResponse(
	status: number,
	bodyText: string,
	headers?: Record<string, string>,
): string {
	return toBase64(
		encode({
			status,
			body: new TextEncoder().encode(bodyText),
			...(headers ? { headers } : {}),
		}),
	);
}

/**
 * How many times the REST request itself was issued.
 *
 * Not `mockedInvoke` call count: `handleSessionLost` fires its own
 * `invoke("logout")` to clear the rejected session, so a session-lost test
 * would otherwise read two invocations where there was exactly one request.
 */
function requestCount(): number {
	return mockedInvoke.mock.calls.filter(
		(call) => call[0] === "request" || call[0] === "request_public",
	).length;
}

/**
 * Drive a pending `fetchRest` to completion under fake timers.
 *
 * A default 10s budget covers every delay the default policy can ask for, while
 * individual tests that need to observe the EXACT delay advance by hand.
 */
async function settle<T>(pending: Promise<T>, budgetMs = 10_000): Promise<T> {
	// Attach a handler BEFORE advancing. A rejection that lands during the timer
	// advance would otherwise reach the loop with no handler attached yet and be
	// reported as an unhandled rejection; the caller still sees it below.
	pending.catch(() => {});
	await vi.advanceTimersByTimeAsync(budgetMs);
	return await pending;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	resetAuthRedirectLatch();
	mockedIsLocked.mockReturnValue(false);
	requestBlockedAlertState.open = false;
	requestBlockedAlertState.disable = false;
});

afterEach(() => {
	vi.useRealTimers();
});

describe("fetchRest retry — happy path", () => {
	it("does not retry a success (exactly one invoke)", async () => {
		mockedInvoke.mockResolvedValue(
			bridgeResponse(200, JSON.stringify({ ok: true })),
		);

		const res = await settle(fetchRest("/v3/cascade", { retry: FAST }));

		expect(requestCount()).toBe(1);
		expect(res.status).toBe(200);
		expect(res.json()).toEqual({ ok: true });
	});

	it("re-sends the identical method, path and body on a retry", async () => {
		mockedInvoke
			.mockResolvedValueOnce(bridgeResponse(503, JSON.stringify({ code: 503 })))
			.mockResolvedValueOnce(
				bridgeResponse(200, JSON.stringify({ ok: true })),
			);

		await settle(
			fetchRest("/v5/chat/send", {
				method: "POST",
				retry: { ...FAST, idempotent: true },
				body: { text: "hi" },
			}),
		);

		expect(requestCount()).toBe(2);
		// Same narrowing `assignment.test.ts` uses for the bridge payload.
		const envelopes = mockedInvoke.mock.calls.map(
			(call) =>
				decode(
					fromBase64((call as [string, { payload: string }])[1].payload),
				) as Record<string, unknown>,
		);
		// A retry that silently dropped the body or the verb would be a data bug
		// far worse than the failure it was meant to ride out.
		for (const envelope of envelopes) {
			expect(envelope.method).toBe("POST");
			expect(envelope.path).toBe("/v5/chat/send");
			expect(envelope.body).not.toBeNull();
		}
	});
});

describe("fetchRest retry — transient failures", () => {
	it.each([500, 502, 503, 504])(
		"retries an idempotent GET after %s and succeeds",
		async (status) => {
			mockedInvoke
				.mockResolvedValueOnce(bridgeResponse(status, JSON.stringify({ code: status })))
				.mockResolvedValueOnce(
					bridgeResponse(200, JSON.stringify({ ok: true })),
				);

			const res = await settle(fetchRest("/v3/cascade", { retry: FAST }));

			expect(requestCount()).toBe(2);
			expect(res.status).toBe(200);
		},
	);

	it("retries HEAD like GET", async () => {
		mockedInvoke
			.mockResolvedValueOnce(bridgeResponse(503, ""))
			.mockResolvedValueOnce(bridgeResponse(200, ""));

		await settle(fetchRest("/v3/cascade", { method: "HEAD", retry: FAST }));

		expect(requestCount()).toBe(2);
	});

	it("retries a transient bridge (Http) failure — resets, DNS, timeout", async () => {
		mockedInvoke
			// `AppError` derives `From<reqwest::Error>`, so this is where a
			// connection reset / DNS failure / 30s timeout all arrive.
			.mockRejectedValueOnce({ kind: "Http", message: "connection reset by peer" })
			.mockResolvedValueOnce(
				bridgeResponse(200, JSON.stringify({ ok: true })),
			);

		const res = await settle(fetchRest("/v3/cascade", { retry: FAST }));

		expect(requestCount()).toBe(2);
		expect(res.status).toBe(200);
	});

	it("gives up after maxAttempts and surfaces the last response", async () => {
		mockedInvoke.mockResolvedValue(
			bridgeResponse(503, JSON.stringify({ code: 503 })),
		);

		const res = await settle(fetchRest("/v3/cascade", { retry: FAST }));

		expect(requestCount()).toBe(3);
		expect(() => res.json()).toThrow(ApiHttpError);
	});

	it("rethrows the original transport error once attempts run out", async () => {
		const failure = { kind: "Http", message: "dns error" };
		mockedInvoke.mockRejectedValue(failure);

		await expect(settle(fetchRest("/v3/cascade", { retry: FAST }))).rejects.toEqual(
			failure,
		);
		expect(requestCount()).toBe(3);
	});

	it("stops retrying once the total elapsed budget is spent", async () => {
		mockedInvoke.mockResolvedValue(
			bridgeResponse(503, JSON.stringify({ code: 503 })),
		);

		// First backoff (50ms) fits inside 60ms; the second (100ms) cannot.
		await settle(
			fetchRest("/v3/cascade", {
				retry: { ...FAST, maxAttempts: 9, maxElapsedMs: 60 },
			}),
		);

		expect(requestCount()).toBe(2);
	});
});

describe("fetchRest retry — non-idempotent verbs are never replayed", () => {
	it.each(["POST", "PUT", "PATCH", "DELETE"])(
		"does NOT retry %s on a 503 by default",
		async (method) => {
			mockedInvoke.mockResolvedValue(
				bridgeResponse(503, JSON.stringify({ code: 503 })),
			);

			const res = await settle(
				fetchRest("/v5/thing", { method, retry: FAST }),
			);

			expect(requestCount()).toBe(1);
			expect(() => res.json()).toThrow(ApiHttpError);
		},
	);

	it("does NOT retry a POST on a transport failure by default", async () => {
		mockedInvoke.mockRejectedValue({ kind: "Http", message: "reset" });

		await expect(
			settle(fetchRest("/v5/charge", { method: "POST", retry: FAST })),
		).rejects.toEqual({ kind: "Http", message: "reset" });
		expect(requestCount()).toBe(1);
	});

	it("retries a POST only when the caller asserts it is safe", async () => {
		mockedInvoke
			.mockResolvedValueOnce(bridgeResponse(503, JSON.stringify({ code: 503 })))
			.mockResolvedValueOnce(
				bridgeResponse(200, JSON.stringify({ ok: true })),
			);

		const res = await settle(
			fetchRest("/v5/upsert", {
				method: "POST",
				retry: { ...FAST, idempotent: true },
			}),
		);

		expect(requestCount()).toBe(2);
		expect(res.status).toBe(200);
	});

	it("honours `retry: false` as an off switch, even for a GET", async () => {
		mockedInvoke.mockResolvedValue(
			bridgeResponse(503, JSON.stringify({ code: 503 })),
		);

		await settle(fetchRest("/v3/cascade", { retry: false }));

		expect(requestCount()).toBe(1);
	});
});

describe("fetchRest retry — 429 and Retry-After", () => {
	it("waits exactly the Retry-After delta-seconds before retrying", async () => {
		mockedInvoke
			.mockResolvedValueOnce(
				bridgeResponse(429, JSON.stringify({ code: 429 }), {
					"retry-after": "1",
				}),
			)
			.mockResolvedValueOnce(
				bridgeResponse(200, JSON.stringify({ ok: true })),
			);

		const pending = fetchRest("/v3/cascade", { retry: FAST });

		// The default backoff here is 50ms, so reaching 999ms without a second
		// attempt proves the SERVER's 1000ms instruction won.
		await vi.advanceTimersByTimeAsync(999);
		expect(requestCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		await vi.advanceTimersByTimeAsync(0);

		const res = await pending;
		expect(requestCount()).toBe(2);
		expect(res.status).toBe(200);
	});

	it("waits exactly the Retry-After HTTP-date before retrying", async () => {
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		mockedInvoke
			.mockResolvedValueOnce(
				bridgeResponse(429, JSON.stringify({ code: 429 }), {
					"retry-after": "Thu, 01 Jan 2026 00:00:02 GMT",
				}),
			)
			.mockResolvedValueOnce(
				bridgeResponse(200, JSON.stringify({ ok: true })),
			);

		const pending = fetchRest("/v3/cascade", { retry: FAST });

		await vi.advanceTimersByTimeAsync(1999);
		expect(requestCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		await vi.advanceTimersByTimeAsync(0);

		await pending;
		expect(requestCount()).toBe(2);
	});

	it("retries a 429 with no Retry-After header using jittered backoff", async () => {
		// This is the shape every response has TODAY: the bridge sends only
		// `{ status, body }`, so headers are absent and backoff is the fallback.
		mockedInvoke
			.mockResolvedValueOnce(bridgeResponse(429, JSON.stringify({ code: 429 })))
			.mockResolvedValueOnce(
				bridgeResponse(200, JSON.stringify({ ok: true })),
			);

		const pending = fetchRest("/v3/cascade", { retry: FAST });

		await vi.advanceTimersByTimeAsync(49);
		expect(requestCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		await vi.advanceTimersByTimeAsync(0);

		await pending;
		expect(requestCount()).toBe(2);
	});

	it("refuses to honour a Retry-After larger than the whole budget", async () => {
		// Never hold a user-perceived request for an hour; hand the 429 back.
		mockedInvoke.mockResolvedValue(
			bridgeResponse(429, JSON.stringify({ code: 429 }), {
				"retry-after": "3600",
			}),
		);

		const res = await settle(fetchRest("/v3/cascade", { retry: FAST }));

		expect(requestCount()).toBe(1);
		expect(() => res.json()).toThrow(ApiHttpError);
	});

	// Requirement: a 429 must not be assumed to be a rate limit. This is the
	// pre-existing Cloudflare-interstitial decision point, and a retry loop in
	// front of it would hammer Cloudflare AND delay the "request blocked"
	// dialog that exists for exactly this case.
	it("does NOT retry a 429 that is a Cloudflare interstitial", async () => {
		const html =
			"<html><head><title>Attention Required! | Cloudflare</title></head>" +
			"<body>Slow down</body></html>";
		mockedInvoke.mockResolvedValue(bridgeResponse(429, html));

		const res = await settle(fetchRest("/v3/cascade", { retry: FAST }));

		expect(requestCount()).toBe(1);
		expect(() => res.json()).toThrow("Request blocked");
		expect(requestBlockedAlertState.open).toBe(true);
	});

	it("still retries a 429 that is the server's own JSON envelope", async () => {
		// The mirror image: a JSON 429 is a rate limit, not a refusal.
		mockedInvoke
			.mockResolvedValueOnce(
				bridgeResponse(429, '{"type":"urn:gr:err:rate_limited"}'),
			)
			.mockResolvedValueOnce(
				bridgeResponse(200, JSON.stringify({ ok: true })),
			);

		const res = await settle(fetchRest("/v3/cascade", { retry: FAST }));

		expect(requestCount()).toBe(2);
		expect(res.status).toBe(200);
	});
});

describe("fetchRest retry — nothing else is retried", () => {
	it.each([400, 401, 403, 404, 409, 422])(
		"does NOT retry a %s (a definite answer, repeated verbatim)",
		async (status) => {
			mockedInvoke.mockResolvedValue(
				bridgeResponse(status, JSON.stringify({ code: status })),
			);

			await settle(fetchRest("/v3/cascade", { retry: FAST }));

			expect(requestCount()).toBe(1);
		},
	);

	it.each(["Auth", "CredentialStore", "Api", "NotInitialized"])(
		"does NOT retry the deterministic %s rejection",
		async (kind) => {
			mockedInvoke.mockRejectedValue({ kind, message: "nope" });

			await expect(
				settle(fetchRest("/v3/cascade", { retry: FAST })),
			).rejects.toBeTruthy();

			expect(requestCount()).toBe(1);
		},
	);

	it("does not retry a local bug (an untyped throw)", async () => {
		mockedInvoke.mockRejectedValue(new Error("boom"));

		await expect(
			settle(fetchRest("/v3/cascade", { retry: FAST })),
		).rejects.toThrow("boom");
		expect(requestCount()).toBe(1);
	});
});

describe("fetchRest retry — AbortSignal", () => {
	it("interrupts the backoff sleep and rejects with the caller's reason", async () => {
		const controller = new AbortController();
		mockedInvoke.mockResolvedValue(
			bridgeResponse(503, JSON.stringify({ code: 503 })),
		);

		const pending = fetchRest("/v3/cascade", {
			retry: { ...FAST, signal: controller.signal },
		});

		// Let the first attempt fail and the backoff timer be armed.
		await vi.advanceTimersByTimeAsync(0);
		expect(requestCount()).toBe(1);

		controller.abort(new Error("screen closed"));
		await expect(pending).rejects.toThrow("screen closed");

		// The retry timer was cleared and no second request was issued.
		expect(requestCount()).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("never issues a request when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new Error("already gone"));

		await expect(
			fetchRest("/v3/cascade", {
				retry: { ...FAST, signal: controller.signal },
			}),
		).rejects.toThrow("already gone");

		expect(requestCount()).toBe(0);
	});

	it("stops before the next attempt when aborted during the last backoff", async () => {
		const controller = new AbortController();
		mockedInvoke.mockResolvedValue(
			bridgeResponse(503, JSON.stringify({ code: 503 })),
		);

		const pending = fetchRest("/v3/cascade", {
			retry: { ...FAST, signal: controller.signal },
		});

		await vi.advanceTimersByTimeAsync(50);
		expect(requestCount()).toBe(2);
		controller.abort(new Error("stop"));
		await expect(pending).rejects.toThrow("stop");
		expect(requestCount()).toBe(2);
	});
});

describe("fetchRest retry — session handling is unchanged", () => {
	it("still handles a 401 exactly once and never retries it", async () => {
		mockedInvoke.mockResolvedValue(
			bridgeResponse(401, JSON.stringify({ code: 401 })),
		);

		const res = await settle(fetchRest("/v3/cascade", { retry: FAST }));

		expect(requestCount()).toBe(1);
		expect(res.status).toBe(401);
		expect(mockedGoto).toHaveBeenCalledTimes(1);
		expect(mockedToast).toHaveBeenCalledTimes(1);
	});

	it("does not turn an Auth rejection into retries, even for a GET", async () => {
		mockedInvoke.mockRejectedValue({ kind: "Auth", message: "Not logged in" });

		await expect(
			settle(fetchRest("/v3/cascade", { retry: FAST })),
		).rejects.toBeTruthy();

		expect(requestCount()).toBe(1);
		expect(mockedGoto).toHaveBeenCalledTimes(1);
	});

	it("keeps a public pre-session POST un-retried and un-redirected", async () => {
		mockedInvoke.mockRejectedValue({ kind: "Auth", message: "Not logged in" });

		await expect(
			settle(
				fetchRest("/v8/accounts", { method: "POST", public: true, retry: FAST }),
			),
		).rejects.toBeTruthy();

		expect(requestCount()).toBe(1);
		expect(mockedGoto).not.toHaveBeenCalled();
	});
});