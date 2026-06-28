import { getCascadeV3 } from "$lib/api/grid";
import { getProfiles } from "$lib/api/profile";

export type FullGridProfile = {
	type: "full";
	id: number;
	displayName: string | null;
	age: number | null;
	distance: number | null;
	profilePhotosHashes: string[] | null;
	unread: number | null;
	onlineUntil: number | null;
};

export type PartialGridProfile = {
	type: "partial";
	id: number;
	batchIndex: number;
};

export type GridProfile = FullGridProfile | PartialGridProfile;

export async function getGrid(query: Parameters<typeof getCascadeV3>[0]) {
	const response = await getCascadeV3(query);
	const items: GridProfile[] = [];
	const partialBatches: { batch: { profileId: number }[] }[] = [];
	let currentBatch: { profileId: number }[] = [];

	for (const item of response.items) {
		if (item.type === "full_profile_v1") {
			const profile = item.data;
			items.push({
				type: "full",
				id: profile.profileId,
				displayName: profile.displayName ?? null,
				age: null, // Grindr cascade API doesn't return age for full profiles; only resolvePartialBatch populates this
				distance: profile.distanceMeters ?? null,
				profilePhotosHashes: profile.photoMediaHashes ?? null,
				unread: profile.unreadCount ?? null,
				onlineUntil: profile.onlineUntil ?? null,
			});
		} else if (item.type === "partial_profile_v1") {
			if (currentBatch.length === 150) {
				partialBatches.push({ batch: currentBatch });
				currentBatch = [];
			}
			const batchIndex = partialBatches.length;
			currentBatch.push({ profileId: item.data.profileId });
			items.push({
				type: "partial",
				id: item.data.profileId,
				batchIndex,
			});
		}
	}
	if (currentBatch.length > 0) {
		partialBatches.push({ batch: currentBatch });
	}

	return {
		items,
		partialBatches,
		nextPage: response.nextPage,
		shuffled: response.shuffled,
	};
}

export const profileCache = new Map<number, FullGridProfile>();

export async function resolvePartialBatch(
	profileIds: number[],
): Promise<FullGridProfile[]> {
	const profiles = await getProfiles(profileIds);
	// Map id -> request order once, instead of an indexOf scan per comparison
	// (O(n^2 log n) sort) and an includes scan per filtered profile.
	const order = new Map(profileIds.map((id, i): [number, number] => [id, i]));
	return profiles
		.filter(({ profileId }) => order.has(profileId))
		.sort(
			(a, b) => (order.get(a.profileId) ?? 0) - (order.get(b.profileId) ?? 0),
		)
		.map((profile) => ({
			type: "full" as const,
			id: profile.profileId,
			displayName: profile.displayName ?? null,
			age: profile.age ?? null,
			distance: profile.distance ?? null,
			profilePhotosHashes: profile.medias?.map((m) => m.mediaHash) ?? null,
			unread: null,
			onlineUntil: profile.onlineUntil ?? null,
		}));
}
