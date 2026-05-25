import { fetchRest } from "$lib/api";

export async function sendTap(profileId: number): Promise<void> {
	const response = await fetchRest(`/v3/taps/${profileId}`, {
		method: "POST",
	});
	if (response.status >= 400) {
		throw new Error(`Failed to send tap to profile ${profileId}: HTTP ${response.status}`);
	}
}
