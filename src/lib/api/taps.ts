import { fetchRest } from "$lib/api";

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

/**
 * fetchRest resolves (never throws) on a non-2xx HTTP status -- callers must
 * inspect `response.status` themselves to detect a server-side rejection.
 * Shared guard for mutating calls that only want the existing catch/revert
 * path to fire on failure.
 */
export function assertOk(response: { status: number }): void {
	if (response.status >= 400) {
		throw new Error(`HTTP ${response.status}`);
	}
}

// Send a tap to a profile.
//
// Documented endpoint (grindr-api/interest/taps#send-a-tap):
//   POST /v2/taps/add   Body: { recipientId, tapType }
//
// The body must be passed as a plain object, NOT JSON.stringify()'d: fetchRest
// msgpack-encodes `options.body` and the Rust bridge decodes it into a
// serde_json::Value before re-serializing as the outgoing JSON body
// (rest.rs). A pre-stringified body becomes a JSON *string literal* on the
// wire instead of an object, so `tapType`/`recipientId` are never parsed.
export async function sendTapWithType(profileId: number, tapType: TapType): Promise<void> {
	const response = await fetchRest("/v2/taps/add", {
		method: "POST",
		body: { recipientId: profileId, tapType },
	});
	assertOk(response);
}
