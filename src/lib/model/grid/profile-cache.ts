// The grid's resolved-profile cache — the ONE place it lives, and the ONE
// function that erases it.
//
// WHY THIS FILE EXISTS (P2-002, "Grid profile cache not explicitly purged on
// sign-out"). The cache used to be declared inside the route module
// `src/routes/(protected)/(navbar)/(root)/grid.ts` as a bare module-level
// `Map`, with a `clear()` that only `gridState.#reset()` ever called. Sign-out
// never called it, so the leak was:
//
//	SignOutButton.svelte  -> clearAllProfileCaches()   ($lib/api/profile's OWN map)
//	                       -> clearGendersCache() / clearPronounsCache()
//	                       -> purgeAccountLocalData() -> step("profile caches")
//	                                                                -> clearAllProfileCaches()
//	                       -> window.location.href = "/auth/sign-in"
//
// i.e. the sign-out purge walked a GENERIC "clear the profile caches" path that
// enumerates `$lib/api/profile`'s private maps, and the grid's cache was not in
// that set. The map held up to `MAX_PROFILE_CACHE` (1000) `FullGridProfile`
// records — display name, age, distance, photo media hashes, unread count and
// online-until, per profile — in MODULE state, i.e. resident for the WebView
// process lifetime.
//
// MEASURED (vitest, this repo, driving the real `purgeAccountLocalData()` with
// the route module's cache seeded first): cache size 1 -> 1 across the whole
// sign-out purge, and the previous account's `displayName`/`age`/
// `profilePhotosHashes` were all still readable afterwards. The purge is real,
// it runs, and it does not reach this data.
//
// The `window.location.href` at the end of `onSignOut()` does tear the module
// state down in the nominal path, which is the ONLY reason this was not caught
// sooner. That is a mitigation, not a fix, and it is not load-bearing:
//	- the hard navigation is the LAST step, so for its whole duration the next
//	  account can be served from the previous account's map;
//	- it is a document load, so it is subject to everything that can delay or
//	  fail a WebView navigation — and a sign-out that stalls before it leaves the
//	  data resident and READABLE, exactly like the authenticated-media blob cache
//	  this same purge module had to be taught about (`authed-image.ts`);
//	- anything that reaches "no session" WITHOUT that navigation (a session
//	  dropped by the server, a second webview sharing the process) has no purge
//	  at all, and today no purge hook either.
// `purge.ts` documents its own rule: "Sign-out must take the PREVIOUS USER's
// data with it, not just the session." A cache that only goes away if a browser
// navigation happens to succeed is not that.
//
// WHY IT LIVES HERE AND NOT IN THE ROUTE MODULE. A cache the sign-out flow has
// to be able to reach cannot live in a route leaf: `purgeAccountLocalData()`
// (in `$lib/app-data/`) may not import from `src/routes/`, and nothing under
// `$lib/` could reach a route module's module state anyway without the route
// importing the purge hook itself. `$lib/model/grid/` is where grid data already
// lives, so this is the same move `$lib/api/profile.ts` and
// `$lib/utils/authed-image.ts` already made: keep the cache with the data, and
// export the purge next to it.
//
// THE EPOCH, AND WHY `clear()` ALONE IS NOT ENOUGH. Clearing the map is half
// the job. `gridState.loadBatch()` resolves up to 150 partial profiles at a time
// and writes the results back with `cacheProfile()` AFTER an `await`. If the
// purge lands while that fetch is in flight, the map is empty for a moment and
// then the previous account's profiles walk straight back in — so a naive
// "call `clear()` on sign-out" fix still leaks with a race window equal to the
// slowest batch fetch, and the window is exactly the one a user double
// sign-out/sign-in through. This is the same defect, and the same fix, as
// `cacheEpoch` in `$lib/utils/authed-image.ts`: the purge bumps a counter, a
// fetch pins the counter before its first `await`, and drops its result if the
// counter moved. See {@link currentGridCacheEpoch} /
// {@link isGridCacheEpochCurrent}.
//
// CALLERS THAT STILL HAVE TO BE UPDATED (out of this file's ownership):
//	1. `src/routes/(protected)/(navbar)/(root)/grid.ts` — replace the inline
//	   `profileCache` / `MAX_PROFILE_CACHE` / `cacheProfile` / `clearProfileCache`
//	   with a re-export of this module, and pass the pinned epoch into
//	   `loadBatch`.
//	2. `src/lib/app-data/purge.ts` — add a `step("grid profile cache", ...)`
//	   calling {@link purgeGridProfileCache}, next to the existing
//	   `step("profile caches", ...)`.
// Until BOTH are done this cache is not on the sign-out path; see
// `grid-cache.purge.test.ts`, which asserts the sign-out contract against the
// real `purgeAccountLocalData()` and arms itself once the wiring lands.

/**
 * A grid tile that has been fully resolved (no `partial` placeholder left).
 *
 * Moved here verbatim from the route module, unchanged, so that module can
 * re-export it and every `import type { GridProfile } from "./grid"` in the
 * components keeps compiling. The fields are the cross-account payload: a
 * display name, an age, a distance, and photo media hashes are all identifying,
 * and `unread`/`onlineUntil` describe the PREVIOUS account's conversations with
 * that person.
 */
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

/** A grid tile the cascade returned as an id only, awaiting a batch resolve. */
export type PartialGridProfile = {
	type: "partial";
	id: number;
	batchIndex: number;
};

export type GridProfile = FullGridProfile | PartialGridProfile;

/**
 * Ceiling on cached profiles.
 *
 * The bound caps MEMORY; it never capped LIFETIME. Lowering this number is not a
 * privacy control — a cache holding ONE previous account's profile leaks just
 * as surely as one holding a thousand, which is why the purge below empties it
 * unconditionally rather than trimming toward the bound.
 */
export const MAX_PROFILE_CACHE = 1000;

/**
 * Insertion-ordered (oldest first) resolved profiles, keyed by profile id.
 *
 * Exported as the live `Map` because the grid components read it directly
 * (`profileCache.get(id)` in `loadBatch`, `profileCache.set(...)` from the map
 * and right-now pages). Do not hand it to code that would insert without
 * {@link cacheProfile} — going through the setter is what keeps the LRU
 * ordering and the size bound intact.
 */
export const profileCache = new Map<number, FullGridProfile>();

/**
 * Bumped by {@link purgeGridProfileCache}; see the file header.
 *
 * Deliberately NOT exported as a mutable binding: readers must go through
 * {@link currentGridCacheEpoch} so the only way to move it is a purge.
 */
let cacheEpoch = 0;

/** The grid-cache generation in force right now. Pin before an `await`. */
export function currentGridCacheEpoch(): number {
	return cacheEpoch;
}

/**
 * False once a purge has landed since `epoch` was read — i.e. the caller's
 * in-flight result belongs to the account that has been signed out and must not
 * be written anywhere.
 */
export function isGridCacheEpochCurrent(epoch: number): boolean {
	return epoch === cacheEpoch;
}

/** Empty the cache. Idempotent, and safe on a cache that was never populated. */
export function clearProfileCache(): void {
	profileCache.clear();
}

/**
 * Erase every cached grid profile on sign-out.
 *
 * Empties the map AND bumps the epoch, in that order (bump first), so a batch
 * resolve that is already awaiting `getProfiles()` cannot repopulate the cache
 * with the signed-out account's profiles afterwards. See the file header for
 * why the second half is the part that is easy to miss.
 *
 * Returns how many profiles were evicted, so the caller can log a purge that
 * actually had something to free — a silent `0` is how broken wiring hides.
 * Idempotent: a second call returns 0 and still bumps the epoch, which is
 * correct (it must still invalidate an in-flight fetch from before it).
 */
export function purgeGridProfileCache(): number {
	// Bump FIRST: anything already awaiting the bridge is now provably stale and
	// will drop its own result instead of remembering it.
	cacheEpoch++;
	const evicted = profileCache.size;
	profileCache.clear();
	return evicted;
}

/**
 * Resolve-then-cache a batch of profiles, dropping the result if the grid cache
 * was purged while the fetch was in flight.
 *
 * This exists so the epoch check cannot be forgotten at the one call site that
 * needs it (`loadBatch`), and so the correct order — pin, await, verify, then
 * write — is the only order available. Writing `cacheProfile()` after a bare
 * `await resolvePartialBatch(ids)` has no way to express "…unless we were
 * purged", which is precisely how the leak would come back.
 */
export async function resolveAndCacheGridProfiles(
	resolve: () => Promise<FullGridProfile[]>,
): Promise<FullGridProfile[]> {
	// Pinned BEFORE the first await: anything resolved under a later epoch
	// belongs to a different (possibly signed-out) account.
	const epoch = cacheEpoch;
	const resolved = await resolve();
	if (epoch !== cacheEpoch) return [];
	for (const profile of resolved) cacheProfile(profile);
	return resolved;
}

/**
 * Remember a resolved profile, evicting the oldest entries past the bound.
 *
 * Re-inserts so `Map` iteration order stays LRU (oldest first) for eviction.
 */
export function cacheProfile(profile: FullGridProfile): void {
	profileCache.delete(profile.id);
	profileCache.set(profile.id, profile);
	while (profileCache.size > MAX_PROFILE_CACHE) {
		const oldest = profileCache.keys().next().value;
		if (oldest === undefined) break;
		profileCache.delete(oldest);
	}
}
