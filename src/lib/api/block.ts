import { fetchRest } from "$lib/api";

// Documented Grindr block endpoints (grindr-api/browse/blocks):
//   POST   /v3/me/blocks/{profileId}       -> block
//   DELETE /v3/me/blocks/{targetProfileId} -> unblock
// The previous `/v4/blocks/{id}` path came from reverse-engineering and did not
// actually take effect (the block silently no-op'd). Per the docs, repeated
// requests complete without error.
export async function blockProfile(profileId: number): Promise<void> {
	const response = await fetchRest(`/v3/me/blocks/${profileId}`, {
		method: "POST",
	});
	if (response.status >= 400) {
		throw new Error(`Failed to block profile ${profileId}: HTTP ${response.status}`);
	}
}

export async function unblockProfile(profileId: number): Promise<void> {
	const response = await fetchRest(`/v3/me/blocks/${profileId}`, {
		method: "DELETE",
	});
	if (response.status >= 400) {
		throw new Error(`Failed to unblock profile ${profileId}: HTTP ${response.status}`);
	}
}
