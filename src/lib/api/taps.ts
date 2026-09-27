import { fetchRest } from "$lib/api";
import { assertOk } from "$lib/api/http";

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
