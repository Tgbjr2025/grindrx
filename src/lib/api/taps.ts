import { fetchRest } from "$lib/api";
import { assertOk } from "$lib/api/http";
import {
	engagementListSchema,
	type EngagementProfile,
	engagementProfileSchema,
} from "$lib/model/engagement";

/**
 * Documented Grindr tap IDs (grindr-api/interest/taps#tap-id). `3` ("NONE")
 * also exists per the docs but is not a user-selectable option in this UI.
 */
export const TAP_TYPES = {
	FRIENDLY: 0,
	HOT: 1,
	LOOKING: 2,
} as const;

export type TapType = (typeof TAP_TYPES)[keyof typeof TAP_TYPES];

// `assertOk` USED TO BE DEFINED HERE — a generic HTTP guard exported from the
// taps module and imported from there by three unrelated route modules. It now
// lives in `$lib/api/http` next to the other status guards and raises the shared
// `ApiHttpError`. Re-exported so those importers keep working; new code must
// import it from `$lib/api/http`.
export { assertOk };

// Send a tap to a profile.
//
// Documented endpoint (grindr-api/interest/taps#send-a-tap):
//   POST /v2/taps/add   Body: { recipientId, tapType }
//
// The body must be passed as a plain object, NOT JSON.stringify()'d. `fetchRest`
// msgpack-encodes `options.body` and the Rust bridge decodes it into a
// serde_json::Value before re-serializing as the outgoing JSON body
// (rest.rs). A pre-stringified body becomes a JSON *string literal* on the wire
// instead of an object, so `tapType`/`recipientId` are never parsed. The
// authoritative copy of this note is now the `fetchRest` JSDoc in `$lib/api`.
export async function sendTapWithType(profileId: number, tapType: TapType): Promise<void> {
	const response = await fetchRest("/v2/taps/add", {
		method: "POST",
		body: { recipientId: profileId, tapType },
	});
	assertOk(response, "/v2/taps/add");
}

// ---------------------------------------------------------------------------
// Received taps — "who tapped me" (WP-3).
//
//   GET /v2/taps/received
//
// ⚠️ **UNPROBED.** No signed-in session was available, so the path is
// transcribed from the spec's endpoint table and the row shape is assumed to
// match the "who viewed me" list (`$lib/model/engagement`), which documents
// every assumption. If a probe shows the two lists differ, `engagement.ts` is
// the one place to split them.
//
// The row deliberately does NOT carry a `tapType`: the server is not known to
// send one, and a guessed required field would drop every row. Add it there as
// `.optional().catch(null)` if a probe shows it present.
// ---------------------------------------------------------------------------

const TAPS_RECEIVED_PATH = "/v2/taps/received";

/** One "who tapped me" row. See `$lib/model/engagement` for the unverified-shape
 * warning that applies to this type. */
export type ReceivedTap = EngagementProfile;

const receivedTapsSchema = engagementListSchema(
	engagementProfileSchema,
	"received tap",
);

/**
 * List the profiles that have tapped the user. `GET /v2/taps/received`.
 *
 * Same open pagination question as `$lib/api/view`'s `getViews`: this accepts a
 * bare array, a wrapper object under any key, or `null`, reports which one it
 * saw via the returned `shape`, and sends no pagination parameter — none has
 * been observed to exist.
 */
export async function getReceivedTaps() {
	// The parsed path is safe to hand to `jsonParsed`: no identifier in it, so
	// the `ApiHttpError` raised on a non-2xx interpolates nothing private.
	return await fetchRest(TAPS_RECEIVED_PATH).then((res) =>
		res.jsonParsed(receivedTapsSchema),
	);
}
