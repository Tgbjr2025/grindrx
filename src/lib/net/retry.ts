/**
 * Bounded retry + `Retry-After` backoff for the REST bridge.
 *
 * This is POLICY ONLY: what counts as transient, whether a verb is safe to send
 * again, how long to wait, and when to give up. The actual re-issue lives in
 * `fetchRest` (`$lib/api`), which is the only place that knows how to talk to
 * the backend. Keeping the two apart is what lets the decision be unit-tested
 * without a Tauri IPC mock, and keeps `$lib/api/index.ts` from growing a second
 * HTTP abstraction.
 *
 * ## Why a retry policy exists at all
 *
 * The bridge is `reqwest` behind Tauri IPC. Before this module, a single dropped
 * TCP connection or one Cloudflare 502 failed the request outright: the grid
 * showed "Couldn't load profiles" and the user had to pull to refresh. That is
 * the failure this is for — TRANSIENT failures only.
 *
 * ## Why it is bounded so tightly
 *
 * Two hard limits are enforced on every decision, and both exist because a
 * retry loop that is merely "eventually bounded" is still a hang from the
 * user's point of view:
 *
 *   - `maxAttempts` — a hard cap on how many times a request is issued.
 *   - `maxElapsedMs` — wall-clock across ALL attempts, not per attempt.
 *
 * The Rust client already applies `timeout(30s).connect_timeout(10s)`
 * (`src-tauri/src/api/client.rs`), so one attempt can legitimately burn 30s.
 * With `maxAttempts: 3` and `maxElapsedMs: 45_000` the arithmetic is: a fast
 * failure (the common case — a reset or a 503 arrives in well under a second)
 * is retried cheaply and the whole thing completes in ~1s; a request that has
 * ALREADY burned 45s is never issued again, so the ceiling is one 30s attempt
 * plus one more, not three. That is the difference between "slow" and "hung".
 *
 * ## Non-idempotent verbs are never retried by default
 *
 * A retried POST can double-charge, double-send a message, or double-tap. The
 * method decides: GET/HEAD/OPTIONS are idempotent by definition (RFC 9110
 * §9.2.2) and are retried; everything else needs the caller to explicitly assert
 * `idempotent: true`. A caller asserting that is making a statement about its
 * OWN endpoint's semantics — this module cannot verify it and deliberately does
 * not infer it from the verb alone.
 *
 * NOTE: PUT and DELETE are idempotent per RFC 9110 but are NOT in the default
 * set here. That is a deliberate, more conservative choice than the RFC: the
 * Grindr REST surface is not documented for idempotent replay, and a wrong
 * retry here is a duplicated destructive request, whereas a missing retry is one
 * user-visible error the user can retry themselves. Callers that know better
 * opt in with `idempotent: true`.
 */

export type RetryPolicy = {
	/**
	 * Maximum number of TIMES THE REQUEST IS ISSUED, including the first.
	 * `1` disables retrying. Default 3 (the initial attempt + 2 retries).
	 */
	maxAttempts?: number;
	/** First backoff window, doubled each attempt. Default 250ms. */
	baseDelayMs?: number;
	/**
	 * Ceiling for a single jittered backoff sleep. Deliberately NOT applied to
	 * `Retry-After` — see `nextRetryDelay`. Default 4000ms.
	 */
	maxDelayMs?: number;
	/**
	 * Wall-clock budget for the whole call, every attempt plus every sleep.
	 * No further attempt is started once it is exhausted. Default 45000ms.
	 */
	maxElapsedMs?: number;
	/**
	 * Ceiling on the SUM of all sleeps, independent of `maxElapsedMs`, so a
	 * request that fails instantly (a refused connection on a captive network)
	 * still cannot spend its whole life sleeping. Default 6000ms.
	 */
	maxSleepMs?: number;
	/**
	 * Caller's explicit assertion that a non-idempotent verb is safe to replay
	 * (an upsert endpoint with a server-side idempotency key, say). Required
	 * before a POST/PUT/PATCH/DELETE is retried. Default false.
	 */
	idempotent?: boolean;
	/**
	 * Caller cancellation. Checked before every attempt and used to interrupt
	 * the backoff sleep, so a cancelled request does not stay alive waiting for
	 * a timer.
	 */
	signal?: AbortSignal;
	/** Injectable jitter source; tests pass a fixed `() => 0`. */
	random?: () => number;
};

/** `RetryPolicy` with every numeric knob resolved. */
export type ResolvedRetryPolicy = Required<
	Omit<RetryPolicy, "idempotent" | "signal" | "random">
>;

export const DEFAULT_RETRY_POLICY: ResolvedRetryPolicy = {
	maxAttempts: 3,
	baseDelayMs: 250,
	maxDelayMs: 4_000,
	maxElapsedMs: 45_000,
	maxSleepMs: 6_000,
};

/**
 * Verbs that may be re-sent without the caller asking. RFC 9110 §9.2.2 defines
 * these as idempotent; everything else is assumed NOT to be.
 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isIdempotentMethod(method: string): boolean {
	return IDEMPOTENT_METHODS.has(method.trim().toUpperCase());
}

/**
 * Whether this verb may be replayed. `policy === false` (retry disabled
 * entirely) wins over everything, including an `idempotent: true` assertion —
 * opting a POST in must not also be a way to opt out of the attempt cap.
 */
export function shouldRetryMethod(
	method: string,
	policy?: RetryPolicy | false,
): boolean {
	if (policy === false) return false;
	if (isIdempotentMethod(method)) return true;
	return policy?.idempotent === true;
}

/**
 * Transient server statuses worth re-sending an idempotent request for.
 *
 * 501 is deliberately absent: "Not Implemented" is a permanent answer, and
 * retrying it only delays the error the user needed to see. 500/502/503/504 are
 * the gateway/availability family; 429 is handled separately because it needs
 * `Retry-After`.
 */
export function isRetryableStatus(status: number): boolean {
	return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Whether a REJECTED bridge call is transient and worth re-sending.
 *
 * Only `AppError::Http` qualifies, and that is not a guess: `AppError` derives
 * `From<reqwest::Error>` (`src-tauri/src/error.rs`), so DNS failure, connection
 * reset, TLS failure and the client's own 30s timeout ALL arrive as `Http`. It
 * is also the only class where the server provably may never have seen the
 * request.
 *
 * `Auth` (session gone), `CredentialStore` (local keystore), `Api` (the server
 * answered with a definite rejection) and `NotInitialized` are all
 * deterministic — re-sending reproduces the same answer and, for `Auth`, would
 * race the sign-in redirect latch.
 *
 * Reads `error.kind` directly rather than importing `asAppError` from `$lib/api`:
 * `$lib/api` imports this module, and a static back-import would be the cycle
 * `$lib/api` already documents avoiding at its session-teardown call site.
 */
export function isRetryableError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	return (error as { kind?: unknown }).kind === "Http";
}

/**
 * Parse a `Retry-After` value into a delay in ms, or `null` if unusable.
 *
 * RFC 9110 §10.2.3 allows exactly two forms and both are handled:
 *
 *   - delta-seconds — `"120"` → 120000.
 *   - HTTP-date     — `"Wed, 21 Oct 2015 07:28:00 GMT"` → ms until that instant.
 *
 * A date already in the past yields `0` (retry immediately) rather than being
 * rejected: that is a server whose clock is behind ours, and treating a stale
 * instruction as "no instruction" is the safe reading. An unparseable value
 * yields `null` so the caller falls back to jittered backoff instead of
 * trusting garbage. `now` is injectable so the HTTP-date path is testable
 * without freezing the clock.
 */
export function parseRetryAfter(
	value: string | null | undefined,
	now: number = Date.now(),
): number | null {
	if (value == null) return null;
	const trimmed = value.trim();
	if (trimmed === "") return null;
	if (/^\d+$/.test(trimmed)) {
		return Number(trimmed) * 1000;
	}
	// `Date.parse` is lenient enough to accept bare numbers (`"-5"` parses as a
	// year), which are NOT valid Retry-After values. A malformed instruction
	// must fall back to backoff, never be misread as "retry immediately".
	if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return null;
	const at = Date.parse(trimmed);
	if (Number.isNaN(at)) return null;
	return Math.max(0, at - now);
}

/**
 * Jittered exponential backoff for `attempt`, as "full-ish jitter": uniform in
 * `[ceiling/2, ceiling]`.
 *
 * The jitter is load-bearing rather than cosmetic. The grid, the conversations
 * list and the 10s reconcile poll all fire at once and would otherwise all fail
 * at once and all retry at once, re-creating the thundering herd that produced
 * the original 429/503 in the first place.
 */
function backoffDelayMs(
	attempt: number,
	policy: ResolvedRetryPolicy,
	random: () => number,
): number {
	const ceiling = Math.min(
		policy.maxDelayMs,
		policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
	);
	return ceiling / 2 + random() * (ceiling / 2);
}

/**
 * How long to wait before attempt `attempt + 1`, or `null` to STOP.
 *
 * `null` is returned — never a shortened sleep — whenever the wait cannot be
 * honoured within budget. Shortening a delay we promised to wait would turn a
 * bounded retry into a hammer: a server asking for 60s must be answered by
 * giving up (the caller sees the 429 and surfaces it), not by knocking again
 * after 4s.
 *
 * `retryAfterMs` is treated as an instruction, so it is never clamped down to
 * `maxDelayMs`, but it is subject to the same budget as a backoff sleep.
 */
export function nextRetryDelay(input: {
	attempt: number;
	policy: ResolvedRetryPolicy;
	/** From `parseRetryAfter`, or `null` when the server sent nothing usable. */
	retryAfterMs?: number | null;
	elapsedMs: number;
	/** Total time already spent sleeping in this call. */
	sleptMs: number;
	random?: () => number;
}): number | null {
	const { attempt, policy, retryAfterMs, elapsedMs, sleptMs } = input;
	if (attempt >= policy.maxAttempts) return null;
	const backoff = backoffDelayMs(attempt, policy, input.random ?? Math.random);
	const requested =
		retryAfterMs == null ? backoff : Math.max(backoff, retryAfterMs);
	if (
		requested > policy.maxElapsedMs - elapsedMs ||
		requested > policy.maxSleepMs - sleptMs
	) {
		return null;
	}
	return Math.round(requested);
}

/**
 * The rejection value for an aborted signal.
 *
 * Returns an `Error` always, not just for the default `controller.abort()`
 * case: `signal.reason` is typed `any` and a caller is free to abort with a
 * string, and a promise that rejects with a non-Error loses its stack and
 * breaks `instanceof` for every consumer up the chain.
 */
export function abortReason(signal: AbortSignal): Error {
	const reason: unknown = signal.reason;
	if (reason instanceof Error) return reason;
	// Only a string reason is safe to surface verbatim: stringifying an unknown
	// object would paste "[object Object]" into a user-facing error.
	return new DOMException(
		typeof reason === "string" && reason !== ""
			? reason
			: "The operation was aborted.",
		"AbortError",
	);
}

/** Throw immediately if the caller has already cancelled. */
export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortReason(signal);
}

/**
 * A cancellable sleep.
 *
 * The existing cancellation note in `fetchRest` (there is deliberately no
 * JS-side `AbortController` around `invoke`) is not in tension with this. That
 * note is about cancelling an IN-FLIGHT request the backend keeps running no
 * matter what; a backoff sleep is the opposite — pure JS idle time with no
 * backend work to abandon — so interrupting it is exactly what the caller wants
 * and loses nothing.
 */
export function sleepWithSignal(
	ms: number,
	signal?: AbortSignal,
): Promise<void> {
	// Rejects rather than throwing synchronously, so a caller can always treat
	// this as an ordinary promise (`await`ed inside an async function or
	// `.catch`-chained) regardless of whether the signal was already aborted.
	if (signal?.aborted) {
		return Promise.reject(abortReason(signal));
	}
	return new Promise<void>((resolve, reject) => {
		if (ms <= 0) {
			resolve();
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortReason(signal as AbortSignal));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/** Fill in the numeric defaults, and collapse `false` to "one attempt only". */
export function resolveRetryPolicy(
	policy?: RetryPolicy | false,
): ResolvedRetryPolicy {
	if (policy === false) return { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 };
	return { ...DEFAULT_RETRY_POLICY, ...(policy ?? {}) };
}