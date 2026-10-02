import z from "zod";

import { fetchRest } from "$lib/api";
import { ApiHttpError, throwForStatus } from "$lib/api/http";

// Documented Grindr hide endpoints (docs/content/grindr-api/browse/hides):
//
//   POST   /v1/me/hides/{profileId}  -> hide a user      `{ updateTime: 0 }`
//   DELETE /v1/hides/{profileId}     -> unhide a user    empty
//   DELETE /v1/hides                 -> unhide everyone  empty
//   GET    /v1/hides                 -> `{ hides: [...] }`
//
// ⚠️ READ THIS BEFORE ADDING A FUNCTION HERE — TWO OF THE FOUR ARE ALREADY
// IMPLEMENTED, and a scan of `src/lib/api/**` for `/v…` literals CANNOT SEE THEM:
//
//   GET  /v1/hides         → src/routes/(protected)/(navbar)/settings/(subpage)/account/hidden/+page.svelte:45
//   DELETE /v1/hides/{id}  → src/routes/(protected)/(navbar)/settings/(subpage)/account/hidden/+page.svelte:59
//
// The `docs/ENDPOINT_GAP_SPEC.md` WP-2 inventory reported hides as wholly absent
// because it only looked in `src/lib/api`. The spec warns that a second copy of an
// existing endpoint is a regression this project has shipped three times — this
// module is deliberately NOT that: it implements exactly the one documented path
// that exists nowhere in the app (`POST`), and the file duplicates nothing.
//
// The spec's fourth path, `DELETE /v1/me/hides/{profileId}`, is deliberately NOT
// implemented. `hides.md` does not document it — the spec's table is the only
// source for it — and the documented unhide above already exists. Adding a second
// unhide route on an unverified path is the duplicate this comment exists to
// prevent. See the probe list in the WP-2 report.
//
// WHY HIDES IS NOT BLOCKS (same file, two concepts):
// `hides.md` says outright: "Unknown how it's different from blocks, WIP. Blocks
// API is preferred until this is figured out." A block removes someone from the
// grid AND deletes the conversation for both people; a hide is the softer action.
// Do not merge these modules, and do not assume one call satisfies the other.
//
// ERROR REPORTING: same discipline as `block.ts`, and for the same reason. The
// target is ANOTHER PERSON, so `ApiHttpError.message` — which interpolates the
// path it is handed and reaches a user-facing toast — must never receive the
// id-bearing path. `throwForStatus` gets the BASE path; the real path goes to
// `logRealPath`, which is console-only.
const ME_HIDES_PATH = "/v1/me/hides";

/**
 * `hides.md` documents `{ updateTime: integer, appears to be 0 }`. Because the
 * value is a documented constant, it carries no information a caller can act on,
 * so `hideProfile` returns `void` like `blockProfile`. The body is still parsed
 * through a schema — the parse is the assertion, not the return value.
 */
const hideAckSchema = z.object({
	updateTime: z.number().int().nullish(),
});

function logRealPath(action: string, path: string, status: number): void {
	console.error(`[GrindrX] Failed to ${action} profile (HTTP ${status}).`, path);
}

/**
 * Parse an acknowledgement that is allowed to be empty.
 *
 * `fetchRest`'s `json()` classifies a 2xx with a non-JSON body as
 * `"parse-error"` and then re-runs `JSON.parse`, which THROWS on an empty body —
 * so the empty success body this endpoint may return would be reported to the
 * user as a failure even though the hide landed. A completed hide must never be
 * shown as a failed one, so an unreadable ack is logged and swallowed; only a
 * non-2xx escapes, and `throwForStatus` has already raised that.
 */
function parseAck(response: { jsonParsed(schema: z.ZodType): unknown }): void {
	try {
		response.jsonParsed(hideAckSchema);
	} catch (error) {
		// A 3xx classifies as an error payload and is a genuine failure. A
		// >=400 was already thrown by `throwForStatus` before this ran.
		if (error instanceof ApiHttpError) throw error;
		console.warn("[GrindrX] hide acknowledged with an unreadable body", {
			issue: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Hide a profile. `POST /v1/me/hides/{profileId}`.
 *
 * Repeated requests are completed without error per the docs, so this is safe to
 * call on an already-hidden profile. Throws `ApiHttpError` on a non-2xx; the
 * thrown message deliberately contains only `ME_HIDES_PATH`, never the profile id.
 */
export async function hideProfile(profileId: number): Promise<void> {
	const path = `${ME_HIDES_PATH}/${profileId}`;
	const response = await fetchRest(path, {
		method: "POST",
	});
	if (response.status >= 400) logRealPath("hide", path, response.status);
	throwForStatus(response, ME_HIDES_PATH);
	parseAck(response);
}
