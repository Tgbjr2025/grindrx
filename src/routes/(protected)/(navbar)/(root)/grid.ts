import { browser } from "$app/environment";

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

// --- Is the current nearby geohash a USER PIN, or a GPS fix? ---------------
//
// "Browse from here" (LocationChange) moves our own `nearbyGeoHash` reference
// point to a place the user picked, because the `exploreGeoHash` param is
// paywalled. That geohash lands in the same `preferences.geohash` slot GPS
// writes to, so the two are indistinguishable once persisted — and on the next
// cold start the root page's GPS updater compares its fix against `prefs.geohash`
// and, finding them ~1 km apart, OVERWRITES the remote hash. The chosen area
// silently reverted to the device's real location, with no error and no toast.
//
// The only way out is to record the distinction. This flag is set when a location
// is chosen by hand and cleared when a real GPS fix is accepted, and the GPS
// updater consults it before writing.
//
// NOTE ON PLACEMENT: the natural home for this is
// `$lib/stores/explore-location.svelte.ts` (same localStorage pattern, same
// "where is the grid looking" concern), but that module belongs to another
// partition and was not editable. Both consumers of this flag live in
// `(root)/`, so it sits in this module until it can be moved.
const PINNED_KEY = "grindrx-geohash-user-pinned";

/** True when `preferences.geohash` was chosen by the user, not read from GPS. */
export function isGeohashPinned(): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(PINNED_KEY) === "1";
	} catch {
		return false;
	}
}

/** Mark (or clear) `preferences.geohash` as a user-pinned browsing location. */
export function setGeohashPinned(pinned: boolean): void {
	if (!browser) return;
	try {
		if (pinned) localStorage.setItem(PINNED_KEY, "1");
		else localStorage.removeItem(PINNED_KEY);
	} catch (err) {
		console.error("[GrindrX] Failed to persist the pinned-location flag:", err);
	}
}

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
				// The cascade DOES return `age`; the v3 response schema used to
				// strip it, which is why this was hardcoded `null` and page 1 of
				// the grid had no age badges while every later page did (those go
				// through resolvePartialBatch -> the v4 profile schema). See
				// `cascadeV3ResponseProfileSchema.age`.
				age: profile.age ?? null,
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

/**
 * Full profiles resolved from partial batches, keyed by profile id.
 *
 * BOUNDED: this is a plain module-level `Map` that was previously unbounded and
 * never invalidated, so a long infinite-scroll session accumulated one entry per
 * profile seen (~200 bytes each, plus a retained photo-hash array) for the
 * process lifetime, and it survived logout. It is now capped and, crucially,
 * cleared whenever the grid is reset — a stale cached profile is worse than a
 * missing one, because it silently pins an old display name/avatar after a save
 * or a location change.
 */
export const profileCache = new Map<number, FullGridProfile>();
export const MAX_PROFILE_CACHE = 1000;

export function clearProfileCache(): void {
	profileCache.clear();
}

export function cacheProfile(profile: FullGridProfile): void {
	// Re-insert so Map iteration order stays LRU (oldest first) for eviction.
	profileCache.delete(profile.id);
	profileCache.set(profile.id, profile);
	while (profileCache.size > MAX_PROFILE_CACHE) {
		const oldest = profileCache.keys().next().value;
		if (oldest === undefined) break;
		profileCache.delete(oldest);
	}
}

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
