import { fetchRest } from "$lib/api";
import { throwForStatus } from "$lib/api/http";

// Documented Grindr block endpoints (grindr-api/browse/blocks):
//   POST   /v3/me/blocks/{profileId}       -> block
//   DELETE /v3/me/blocks/{targetProfileId} -> unblock
// The previous `/v4/blocks/{id}` path came from reverse-engineering and did not
// actually take effect (the block silently no-op'd). Per the docs, repeated
// requests complete without error.
//
// ERROR REPORTING: both used to throw
// `new Error(\`Failed to block profile ${profileId}: HTTP ${response.status}\`)`
// — a user-facing message that names ANOTHER PERSON's profile id, which the
// profile sheet toasts. `throwForStatus` raises `ApiHttpError` instead, and the
// id is deliberately left out of the path we hand it: `ApiHttpError.message`
// interpolates the path, so passing the real one would leak the id anyway. The
// real path is logged instead.
const BLOCKS_PATH = "/v3/me/blocks";

function logRealPath(action: string, profileId: number, status: number): void {
	console.error(
		`[GrindrX] Failed to ${action} profile (HTTP ${status}).`,
		`${BLOCKS_PATH}/${profileId}`,
	);
}

export async function blockProfile(profileId: number): Promise<void> {
	const response = await fetchRest(`${BLOCKS_PATH}/${profileId}`, {
		method: "POST",
	});
	if (response.status >= 400) logRealPath("block", profileId, response.status);
	throwForStatus(response, BLOCKS_PATH);
}

export async function unblockProfile(profileId: number): Promise<void> {
	const response = await fetchRest(`${BLOCKS_PATH}/${profileId}`, {
		method: "DELETE",
	});
	if (response.status >= 400) logRealPath("unblock", profileId, response.status);
	throwForStatus(response, BLOCKS_PATH);
}
