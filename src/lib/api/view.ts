import { fetchRest } from "$lib/api";
import { throwForStatus } from "$lib/api/http";
import {
	engagementListSchema,
	type EngagementProfile,
	engagementProfileSchema,
} from "$lib/model/engagement";

// ---------------------------------------------------------------------------
// Profile views — "who viewed me" (WP-3).
//
//   GET  /v7/views/list          the list
//   POST /v5/views/{profileId}   record that I opened someone's profile
//
// ⚠️ **NEITHER PATH NOR SHAPE HAS BEEN PROBED.** No signed-in session was
// available to this package, so both paths are transcribed verbatim from the
// spec's endpoint table and nothing here is a transcript of a real response. The
// row schema and the envelope tolerance live in `$lib/model/engagement`, which
// documents every assumption in one place.
//
// ⚠️ **DO NOT "UPGRADE" A VERSION NUMBER ON A GUESS** (the spec's Trap 2). This
// fork's own `$lib/api/grid` records that `/v7/search` was superseded upstream
// by `/v3/cascade`, so `/v7/views` being retired in favour of some other path is
// a live possibility. That is a probe question, not a code change: this file
// takes the documented paths and leaves the answer to an operator with a session.
// ---------------------------------------------------------------------------

const VIEWS_LIST_PATH = "/v7/views/list";
/** Base for the id'd POST. Also the path handed to `throwForStatus` — see below. */
const VIEWS_PATH = "/v5/views";

/** One "who viewed me" row. The shape is shared with received taps; see the
 * unverified-shape warning in `$lib/model/engagement`. */
export type ViewedProfile = EngagementProfile;

const viewsListSchema = engagementListSchema(
	engagementProfileSchema,
	"viewed profile",
);

/**
 * Log the REAL id'd path, which is the whole point of keeping it out of the
 * thrown error. Mirrors `blockProfile`'s `logRealPath`: `ApiHttpError.message`
 * interpolates the path it is given, so the id must reach the console and not
 * the error — a profile sheet toasts that message.
 */
function logRealPath(action: string, profileId: number, status: number): void {
	console.error(
		`[GrindrX] Failed to ${action} profile (HTTP ${status}).`,
		`${VIEWS_PATH}/${profileId}`,
	);
}

/**
 * List the profiles that have viewed the user. `GET /v7/views/list`.
 *
 * Returns the parsed rows plus the `shape` the server answered with, because the
 * pagination question is open: this reads a bare array, a wrapper object under
 * any key, or `null` alike, and reports which one it saw. **It sends no
 * pagination parameter and exposes no cursor**, because no probe has established
 * that the endpoint has either. The first real response settles it — log the
 * `shape`.
 */
export async function getViews() {
	// Safe to use the parsed path here: it carries no identifier, so the
	// `ApiHttpError` that `jsonParsed` raises on a non-2xx interpolates nothing
	// private. (That is NOT true of the POST below.)
	return await fetchRest(VIEWS_LIST_PATH).then((res) =>
		res.jsonParsed(viewsListSchema),
	);
}

/**
 * Record that the user opened a profile. `POST /v5/views/{profileId}`.
 *
 * **FIRE-AND-FORGET, BY CONTRACT.** The return type is `Promise<void>` — the
 * parsed body is deliberately NOT exposed, and this function never reads the
 * response body. A view is a background engagement signal, and its only caller
 * is a profile screen that is mid-navigation; gating a transition on a POST that
 * can 502 would turn a dropped analytics ping into a broken screen change.
 * Callers that want to avoid an unhandled rejection should do
 * `void recordProfileView(id).catch((e) => console.warn(e))` and MUST NOT await
 * it to decide whether to navigate.
 *
 * Whether the server itself wants to treat this as fire-and-forget is
 * unverified; what is certain is that this client never blocks on it.
 *
 * The success body is not parsed, which is the documented house behaviour for an
 * endpoint whose body is not consumed — `$lib/api/http`'s `throwForStatus` says
 * to use it for exactly that case, and `blockProfile`/`deleteAlbum` are the
 * precedents. Inventing a schema for an unread body would validate nothing.
 */
export async function recordProfileView(profileId: number): Promise<void> {
	const response = await fetchRest(`${VIEWS_PATH}/${profileId}`, {
		method: "POST",
	});
	// Base path, NEVER the id'd path: `ApiHttpError.message` interpolates it and
	// this error is surfaced to the user. The id goes to the log instead.
	if (response.status >= 400) logRealPath("record a view of", profileId, response.status);
	throwForStatus(response, VIEWS_PATH);
}
