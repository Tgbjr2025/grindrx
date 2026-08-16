import { untrack } from "svelte";
import { toast } from "svelte-sonner";
import z from "zod";

import { ApiHttpError } from "$lib/api";
import { getPreferences } from "$lib/app-data/preferences.svelte";
import type { cascadeV3QuerySchema } from "$lib/model/grid/cascade/query/v3";
import {
	getGrid,
	type GridProfile,
	profileCache,
	resolvePartialBatch,
} from "./grid";

class GridState {
	items = $state<GridProfile[]>([]);
	partialBatches: { batch: { profileId: number }[] }[] = [];
	nextPage = $state<number | null>(0);
	loadingMore = $state(false);
	loading = $state(false);
	error = $state<Error | null>(null);
	// True when `error` is a persistent "Explore other areas" entitlement/region
	// gate (e.g. CAS-4001) rather than a transient load failure. exploreGeoHash
	// IS sent correctly (see #fetchProfiles) — this only affects how the
	// resulting server error is framed. A caller can use this to offer "reset
	// to my location" instead of a plain retry (Tom issue #2).
	errorIsExploreGate = $state(false);

	get errorMessage(): string | null {
		return this.error?.message ?? null;
	}
	currentQuery: z.infer<typeof cascadeV3QuerySchema> | null = null;
	scrollY = 0;

	// `#geohash` is always the device's real location -> `nearbyGeoHash`, the
	// reference point the server uses for distances. `#exploreGeohash` is the
	// optional "Explore other areas" override and maps to the dedicated
	// `exploreGeoHash` cascade param — NOT `nearbyGeoHash`. Routing the remote
	// area through `nearbyGeoHash` used to make the server treat the remote
	// point as the user's own location (wrong distances, and it bypasses the
	// server's explore aggregation), so the two are kept distinct here. The
	// cache key combines both so toggling Explore (or switching areas) refetches.
	#geohash: string | null = null;
	#exploreGeohash: string | null = null;
	#loadingBatches = new Set<number>();

	load(geohash: string, exploreGeohash: string | null = null): void {
		if (
			untrack(
				() =>
					this.#geohash === geohash &&
					this.#exploreGeohash === exploreGeohash &&
					this.items.length > 0,
			)
		)
			return;
		this.#geohash = geohash;
		this.#exploreGeohash = exploreGeohash;
		this.#reset();
		void this.#fetchProfiles(geohash, exploreGeohash);
	}

	refresh(): void {
		if (!this.#geohash) return;
		this.#reset();
		this.scrollY = 0;
		void this.#fetchProfiles(this.#geohash, this.#exploreGeohash);
	}

	#reset(): void {
		this.items = [];
		this.partialBatches = [];
		this.nextPage = 0;
		this.loadingMore = false;
		this.loading = true;
		this.error = null;
		this.errorIsExploreGate = false;
		this.currentQuery = null;
		this.#loadingBatches.clear();
	}

	async loadMore(): Promise<void> {
		if (this.loadingMore || !this.nextPage || !this.currentQuery) return;
		this.loadingMore = true;
		try {
			const batchOffset = this.partialBatches.length;
			const result = await getGrid({
				...this.currentQuery,
				pageNumber: this.nextPage,
			});
			for (const item of result.items) {
				this.items.push(
					item.type === "partial"
						? { ...item, batchIndex: item.batchIndex + batchOffset }
						: item,
				);
			}
			this.partialBatches.push(...result.partialBatches);
			this.nextPage = result.nextPage;
		} catch (error) {
			console.error(error);
			toast.error("Failed to load more profiles");
		} finally {
			this.loadingMore = false;
		}
	}

	async loadBatch(batchIndex: number): Promise<void> {
		if (this.#loadingBatches.has(batchIndex)) return;
		this.#loadingBatches.add(batchIndex);
		try {
			const batch = this.partialBatches[batchIndex];
			if (!batch) return;
			const profileIds = batch.batch.map((p) => p.profileId);
			const uncachedIds: number[] = [];

			// Index items by id once. A findIndex per id scans the whole items
			// array, which grows with infinite scroll — O(n^2) per batch of up to
			// 150 ids.
			let indexById = new Map(
				this.items.map((item, i): [number, number] => [item.id, i]),
			);
			for (const id of profileIds) {
				const cached = profileCache.get(id);
				if (cached) {
					const idx = indexById.get(id);
					if (idx !== undefined) this.items[idx] = cached;
				} else {
					uncachedIds.push(id);
				}
			}

			const resolved = await resolvePartialBatch(uncachedIds);

			// Rebuild the index: items may have shifted during the await (a
			// concurrent loadMore append or another batch).
			indexById = new Map(
				this.items.map((item, i): [number, number] => [item.id, i]),
			);
			const resolvedIds = new Set<number>();
			for (const profile of resolved) {
				profileCache.set(profile.id, profile);
				resolvedIds.add(profile.id);
				const idx = indexById.get(profile.id);
				if (idx !== undefined) this.items[idx] = profile;
			}

			const unresolved = new Set(
				uncachedIds.filter((id) => !resolvedIds.has(id)),
			);
			if (unresolved.size > 0) {
				// Drop all unresolved ids in one pass instead of N array splices.
				this.items = this.items.filter((i) => !unresolved.has(i.id));
			}
		} catch (error) {
			console.error(batchIndex, error);
			toast.error("Failed to load profiles");
			this.#loadingBatches.delete(batchIndex);
		}
	}

	async #fetchProfiles(
		geohash: string,
		exploreGeohash: string | null = null,
	): Promise<void> {
		try {
			const { gridSearchFilters } = await getPreferences();
			const query = {
				nearbyGeoHash: geohash,
				...(exploreGeohash && { exploreGeoHash: exploreGeohash }),
				favorites: gridSearchFilters?.isFavorite || undefined,
				onlineOnly: gridSearchFilters?.isOnline || undefined,
				rightNow: gridSearchFilters?.isRightNow || undefined,
				...(gridSearchFilters?.ageEnabled && {
					ageMin: gridSearchFilters?.age[0],
					ageMax: gridSearchFilters?.age[1],
				}),
				...(gridSearchFilters?.genderEnabled && {
					genders: gridSearchFilters?.genders,
				}),
				...(gridSearchFilters?.positionEnabled && {
					sexualPositions: gridSearchFilters?.positions,
				}),
				...(gridSearchFilters?.photosEnabled &&
					gridSearchFilters?.photos.includes("has-photos") && {
						photoOnly: true,
					}),
				...(gridSearchFilters?.photosEnabled &&
					gridSearchFilters?.photos.includes("has-albums") && {
						hasAlbum: gridSearchFilters?.photos.includes("has-albums"),
					}),
				...(gridSearchFilters?.photosEnabled &&
					gridSearchFilters?.photos.includes("has-face-pics") && {
						faceOnly: true,
					}),
				...(gridSearchFilters?.tribesEnabled && {
					tribes: gridSearchFilters?.tribes,
				}),
				...(gridSearchFilters?.bodyTypesEnabled && {
					bodyTypes: gridSearchFilters?.bodyTypes,
				}),
				...(gridSearchFilters?.heightEnabled && {
					heightCmMin: gridSearchFilters?.height[0],
					heightCmMax: gridSearchFilters?.height[1],
				}),
				...(gridSearchFilters?.weightEnabled && {
					weightGramsMin: gridSearchFilters?.weight[0],
					weightGramsMax: gridSearchFilters?.weight[1],
				}),
				...(gridSearchFilters?.relationshipStatusesEnabled && {
					relationshipStatuses: gridSearchFilters?.relationshipStatuses,
				}),
				...(gridSearchFilters?.acceptNSFWPicsEnabled &&
					gridSearchFilters?.acceptNSFWPics !== undefined && {
						nsfwPics: gridSearchFilters?.acceptNSFWPics,
					}),
				...(gridSearchFilters?.lookingForEnabled && {
					lookingFor: gridSearchFilters?.lookingFor,
				}),
				...(gridSearchFilters?.meetAtEnabled && {
					meetAt: gridSearchFilters?.meetAt,
				}),
				notRecentlyChatted:
					gridSearchFilters?.haventChattedTodayEnabled || undefined,
				...(gridSearchFilters?.healthPracticesEnabled && {
					sexualHealth: gridSearchFilters?.healthPractices,
				}),
				fresh: gridSearchFilters?.isFresh || undefined,
			} satisfies z.infer<typeof cascadeV3QuerySchema>;
			this.currentQuery = query;
			const result = await getGrid(query);
			this.#loadingBatches.clear();
			this.items = result.items;
			this.partialBatches = result.partialBatches;
			this.nextPage = result.nextPage;
			this.loading = false;
		} catch (err) {
			console.error(err);
			this.error = toGridError(err, exploreGeohash);
			this.errorIsExploreGate =
				exploreGeohash != null &&
				err instanceof ApiHttpError &&
				isExploreGateCode(err.code);
			this.loading = false;
		}
	}
}

// Server codes that gate "Explore other areas" behind a paid Grindr
// XTRA/Unlimited tier or a region restriction. These are PERSISTENT for the
// account/session — retrying (or picking a different remote spot) will keep
// failing the same way, unlike a transient network/server error. See finding
// cas-4001-server-side-gate-not-client-bug: exploreGeoHash IS sent correctly
// on every request (#fetchProfiles below), so this is never a query-building
// bug — only the framing of the resulting error changes here.
function isExploreGateCode(code: string | number | null): boolean {
	return code === "CAS-4001";
}

// Turn a fetch failure into a message worth showing in the grid. A server HTTP
// error (e.g. the cascade `CAS-4001` returned when exploring a remote area) is
// surfaced with its code and an actionable hint instead of a raw parse error.
function toGridError(err: unknown, exploreGeohash: string | null): Error {
	if (err instanceof ApiHttpError) {
		const code = err.code != null ? ` (${err.code})` : "";
		if (exploreGeohash && isExploreGateCode(err.code)) {
			// A known entitlement/region gate, not a "this spot is temporarily
			// down" failure — don't invite a futile retry loop on the same area.
			return new Error(
				`Browsing other areas needs Grindr XTRA/Unlimited, or isn't available in your region${code}. Reset to your location to keep browsing nearby.`,
			);
		}
		if (exploreGeohash) {
			return new Error(
				`This area couldn't be loaded${code}. It may be unavailable right now — try another spot or reset to your location.`,
			);
		}
		return new Error(
			`Couldn't load profiles${code}. Pull to refresh to try again.`,
		);
	}
	return err instanceof Error
		? err
		: new Error("Failed to fetch profiles", { cause: err });
}

export const gridState = new GridState();
