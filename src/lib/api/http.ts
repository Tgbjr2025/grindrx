// Shared HTTP-status guard + error predicate for the API client layer.
//
// This is the ONE place that decides "a `fetchRest` response is a server-side
// failure" and how that failure is represented. It exists because that decision
// was previously re-implemented four different ways:
//
//   - `$lib/api/prefs` + `$lib/api/favorites-notes` — threw `ApiHttpError`.
//   - `$lib/api/album` + `$lib/api/messages` — `throw new Error(\`HTTP ${res.status}:
//     ${res.text().slice(0,200)}\`)`, i.e. a raw server body concatenated into a
//     user-facing `Error.message` (and, in `block.ts`, the *target profile's id*
//     on top).
//   - `$lib/api/taps` — exported a bare `assertOk` that threw `HTTP ${status}`,
//     a generic guard that happened to live in the taps module.
//
// Consumers then had to string-match those messages (`/^HTTP 400\b/.test(err.message)`
// in `AlbumPicker.svelte`), which is why this module also exports a type-safe
// predicate: branch on `err instanceof ApiHttpError && err.status === 400`, never
// on the message text.

import { ApiHttpError } from "$lib/api";

export { ApiHttpError };

/** The subset of a `fetchRest` response these guards need. */
type ResponseLike = {
	status: number;
	/** Present on every real `fetchRest` response; absent in unit-test doubles. */
	text?: () => string;
};

/**
 * Build the `ApiHttpError` for a failed response, or `null` when the response is
 * 2xx. The raw body is captured in `.body` for LOGS ONLY — `.message` is the
 * user-facing string and carries at most the server's own `message`/`code`
 * field, never a verbatim response body.
 *
 * `path` is used in `.message`; pass a path WITHOUT user identifiers (e.g.
 * `/v3/me/blocks`, not `/v3/me/blocks/12345`) so a failure toast never echoes
 * another person's profile id back to the reader.
 */
export function apiErrorFor(
	response: ResponseLike,
	path: string,
): ApiHttpError | null {
	if (response.status < 400) return null;
	return new ApiHttpError(response.status, readBody(response), path);
}

function readBody(response: ResponseLike): string {
	try {
		return response.text?.() ?? "";
	} catch {
		// A body we cannot even decode is still a failure; report it with the
		// status alone rather than masking it with a decoder error.
		return "";
	}
}

/**
 * Throw `ApiHttpError` when `response` is a non-2xx. No-op for 2xx.
 *
 * Use this for endpoints whose success body is empty or that never call
 * `.json()`. Endpoints that DO parse a body should just let `.json()` /
 * `.jsonParsed()` raise — `classifyResponseBody` already routes a non-2xx body
 * to `ApiHttpError`, so a pre-check there only duplicates (and, if it string-
 * concatenates the body, leaks) the failure.
 */
export function throwForStatus(response: ResponseLike, path: string): void {
	const error = apiErrorFor(response, path);
	if (error) throw error;
}

/**
 * Type-safe replacement for the old message-regex guards.
 *
 * `isApiHttpError(err)`          — "was this a server-side HTTP failure?"
 * `isApiHttpError(err, 400)`     — "…specifically a 400?"
 */
export function isApiHttpError(
	error: unknown,
	status?: number,
): error is ApiHttpError {
	if (!(error instanceof ApiHttpError)) return false;
	return status === undefined || error.status === status;
}

/**
 * `fetchRest` RESOLVES on a non-2xx status — it only rejects on an IPC/bridge
 * failure. Mutating calls that want their existing catch/revert path to fire on
 * a server-side rejection call this.
 *
 * Was declared in `$lib/api/taps` and imported from there by three unrelated
 * route modules; re-exported from `taps` for compatibility, but new code should
 * import it from here.
 */
export function assertOk(response: ResponseLike, path?: string): void {
	throwForStatus(response, path ?? "request");
}
