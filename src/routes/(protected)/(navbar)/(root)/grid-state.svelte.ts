import { untrack } from "svelte";
import { toast } from "svelte-sonner";
import z from "zod";

import { ApiHttpError } from "$lib/api";
import { getPreferences } from "$lib/app-data/preferences.svelte";
import { defaultFilters } from "$lib/components/filters/filters";
import type { cascadeV3QuerySchema } from "$lib/model/grid/cascade/query/v3";
import {
	cacheProfile,
	clearProfileCache,
	getGrid,
	type GridProfile,
	profileCache,
	resolvePartialBatch,
} from "./grid";

type GridSearchFilters = typeof defaultFilters;
type CascadeQuery = z.infer<typeof cascadeV3QuerySchema>;

/**
 * Outcome of `loadBatch`, and what the caller should do with its observer.
 * See the method doc for why `"in-flight"` cannot be folded into `"resolved"`.
 */
export type BatchState = "resolved" | "in-flight" | "failed";

/**
 * The live Grindr API stores `weight` in GRAMS (e.g. 86182.65 ≈ 86.18 kg), but
 * the weight slider is specified and stored in KILOGRAMS (`filterWeightSchema`
 * / `defaultFilters.weight === [40, 273]`). This is the single conversion point.
 *
 * It used to be missing: `weightGramsMin`/`weightGramsMax` were fed the raw kg
 * slider array, so the request asked for profiles weighing 40-273 GRAMS and the
 * filter could never match anyone. Keep this as the ONLY kg->grams conversion
 * for the grid query — `WeightFilter.svelte`'s `KG_TO_GRAMS` is display-only.
 */
export const KG_TO_GRAMS = 1000;

export function weightKgRangeToGrams(
	range: readonly number[] | undefined,
): { min: number; max: number } | null {
	if (!range || range.length < 2) return null;
	const [min, max] = range;
	if (min === undefined || max === undefined) return null;
	return { min: min * KG_TO_GRAMS, max: max * KG_TO_GRAMS };
}

/**
 * Maps the persisted grid filters onto the `/v3/cascade` query.
 *
 * Extracted as a pure function (and unit-tested) because this mapper is where
 * unit/param mismatches hide: it is 60 lines of field-by-field translation with
 * no other observable behaviour, so a mistake in it is invisible until a filter
 * silently returns the wrong people.
 */
export function buildCascadeQuery(
	geohash: string,
	exploreGeohash: string | null,
	gridSearchFilters: GridSearchFilters | undefined,
): CascadeQuery {
	const weightGrams = gridSearchFilters?.weightEnabled
		? weightKgRangeToGrams(gridSearchFilters.weight)
		: null;

	return {
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
		...(weightGrams && {
			weightGramsMin: weightGrams.min,
			weightGramsMax: weightGrams.max,
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
	} satisfies CascadeQuery;
}

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
	/**
	 * Monotonic counter identifying the current "grid generation".
	 *
	 * Every load-bearing async path captures it before its first `await` and
	 * re-checks afterwards. Without it, picking a remote area and then tapping
	 * "back to my location" let the FIRST (slower) response land last and
	 * overwrite the second: `items` held profiles for the old area while
	 * `currentQuery` described the new one, and `loadMore()` then paginated the
	 * old area with the new query. Distances were referenced to the wrong
	 * origin. Same class of bug in `loadMore` (a page-2 result appended after
	 * `#reset()`) and in `loadBatch` (which filtered the NEW grid by the OLD
	 * area's unresolved ids).
	 */
	#generation = 0;

	/** The generation a fetch was started for; `null` once superseded. */
	#currentGeneration(): number {
		return this.#generation;
	}

	#isCurrent(generation: number): boolean {
		return generation === this.#generation;
	}

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
		void this.#fetchProfiles(geohash, exploreGeohash, this.#currentGeneration());
	}

	refresh(): void {
		if (!this.#geohash) return;
		this.#reset();
		this.scrollY = 0;
		void this.#fetchProfiles(
			this.#geohash,
			this.#exploreGeohash,
			this.#currentGeneration(),
		);
	}

	#reset(): void {
		// Invalidate every in-flight fetch. Anything that resumes from an await
		// now sees a stale generation and returns without writing.
		this.#generation += 1;
		this.items = [];
		// A cached full profile is only valid for the area/filters that produced
		// it. It was never invalidated, so after a location change or logout the
		// grid could paint a profile's old name/photo straight out of this map.
		clearProfileCache();
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
		const generation = this.#currentGeneration();
		this.loadingMore = true;
		try {
			const batchOffset = this.partialBatches.length;
			const result = await getGrid({
				...this.currentQuery,
				pageNumber: this.nextPage,
			});
			// A location change (or a refresh) reset the grid while this page was
			// in flight. Appending now would splice page-2-of-the-old-area into
			// page-1-of-the-new-area with a meaningless batch offset.
			if (!this.#isCurrent(generation)) return;
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
			if (!this.#isCurrent(generation)) return;
			console.error(error);
			toast.error("Failed to load more profiles");
		} finally {
			// Only the load that is still current owns the `loadingMore` flag;
			// `#reset()` has already cleared it otherwise.
			if (this.#isCurrent(generation)) this.loadingMore = false;
		}
	}

	/**
	 * Resolve one partial batch into full profiles.
	 *
	 * Returns the batch's state so the caller knows whether to stop observing:
	 *  - `"resolved"` — the batch is loaded; the caller may disconnect.
	 *  - `"in-flight"` — ANOTHER tile already started this batch; the caller must
	 *    KEEP observing so a failure is still noticed and retried.
	 *  - `"failed"` — this attempt failed; the caller must keep observing so a
	 *    scroll back into range re-arms the retry.
	 *
	 * The second value is the fix for a real defect: this used to return
	 * `boolean` and the dedup branch returned `true`. `getGrid` puts up to 150
	 * partial profiles in ONE batch and `Grid.svelte` attaches an observer per
	 * tile, so 150 tiles shared a `batchIndex`: tile #1 did the work and tiles
	 * #2-150 took the dedup branch, were told "resolved", and permanently
	 * disconnected — BEFORE the outcome was known. If #1 then failed, 149 tiles
	 * showed a permanent `animate-pulse` skeleton with no way back, which is
	 * exactly what the boolean was introduced to prevent.
	 */
	async loadBatch(batchIndex: number): Promise<BatchState> {
		if (this.#loadingBatches.has(batchIndex)) return "in-flight";
		this.#loadingBatches.add(batchIndex);
		const generation = this.#currentGeneration();
		try {
			const batch = this.partialBatches[batchIndex];
			if (!batch) return "resolved";
			const profileIds = batch.batch.map((p) => p.profileId);
			const uncachedIds: number[] = [];

			// Index items by id once. A findIndex per id scans the whole items
			// array, which grows with infinite scroll — O(n²) per batch of up to
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

			// The grid was reset (location change / refresh) while this was in
			// flight. Writing now would filter the NEW grid by the OLD area's
			// unresolved ids, removing profiles the user is actually looking at.
			if (!this.#isCurrent(generation)) return "failed";

			// Rebuild the index: items may have shifted during the await (a
			// concurrent loadMore append or another batch).
			indexById = new Map(
				this.items.map((item, i): [number, number] => [item.id, i]),
			);
			const resolvedIds = new Set<number>();
			for (const profile of resolved) {
				cacheProfile(profile);
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
			return "resolved";
		} catch (error) {
			if (!this.#isCurrent(generation)) return "failed";
			console.error(batchIndex, error);
			toast.error("Failed to load profiles");
			// Forget the in-flight mark so a retry is actually allowed.
			this.#loadingBatches.delete(batchIndex);
			return "failed";
		}
	}

	async #fetchProfiles(
		geohash: string,
		exploreGeohash: string | null = null,
		generation: number = this.#currentGeneration(),
	): Promise<void> {
		try {
			const { gridSearchFilters } = await getPreferences();
			if (!this.#isCurrent(generation)) return;
			const query = buildCascadeQuery(
				geohash,
				exploreGeohash,
				gridSearchFilters,
			);
			this.currentQuery = query;
			const result = await getGrid(query);
			// A newer load/refresh started while this was in flight: its response
			// is the one the user is waiting for. Do not clobber it, and do not
			// clear its `loading` flag.
			if (!this.#isCurrent(generation)) return;
			this.#loadingBatches.clear();
			this.items = result.items;
			this.partialBatches = result.partialBatches;
			this.nextPage = result.nextPage;
			this.loading = false;
		} catch (err) {
			if (!this.#isCurrent(generation)) return;
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
