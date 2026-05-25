import { fetchRest } from "$lib/api";

export async function blockProfile(profileId: number): Promise<void> {
	const response = await fetchRest(`/v4/blocks/${profileId}`, {
		method: "POST",
	});
	if (response.status >= 400) {
		throw new Error(`Failed to block profile ${profileId}: HTTP ${response.status}`);
	}
}

export async function unblockProfile(profileId: number): Promise<void> {
	const response = await fetchRest(`/v4/blocks/${profileId}`, {
		method: "DELETE",
	});
	if (response.status >= 400) {
		throw new Error(`Failed to unblock profile ${profileId}: HTTP ${response.status}`);
	}
}
