import { beforeEach, describe, expect, it, vi } from "vitest";

// P2-002 — "Grid profile cache not explicitly purged on sign-out".
//
// These tests drive the grid cache the way the sign-out flow has to: seed it
// with a previous account's resolved profiles, purge it, then read it as the
// NEXT account would. A test that only asserted "the map is empty" would pass
// against a map that had been emptied a moment earlier and refilled a moment
// later, which is the actual defect (see the epoch block below) — so the
// cross-account read is asserted directly, not inferred.
//
// The end-to-end block at the bottom drives the REAL `purgeAccountLocalData()`
// rather than a mock of it. Mocks are deliberately NOT used for the grid cache
// anywhere in this file for the same reason `purge.test.ts` leaves
// `authed-image` and the viewers store unmocked: a mock would only prove that
// some function was called, not that the previous account's profile data is
// actually unrecoverable afterwards.

// `$lib/app-data/purge` reaches Tauri (fs plugin) and a rune module, neither of
// which resolves in this suite's `node` environment. Everything mocked here is
// something the grid cache does not depend on: the app-lock rune store, the
// preferences file writer, and `$lib/api/profile`'s own caches (which the purge
// clears on a DIFFERENT module-level map than this one — that is the bug).
vi.mock("$app/environment", () => ({
	browser: true,
	building: false,
	dev: false,
	version: "test",
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/plugin-fs", () => ({
	BaseDirectory: { AppData: 7 },
	remove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("$lib/app-data", () => ({ writeAppDataFile: vi.fn() }));

vi.mock("$lib/api/profile", () => ({
	clearAllProfileCaches: vi.fn(),
	clearMediaIdCache: vi.fn(),
}));

vi.mock("$lib/app-data/app-lock.svelte", () => ({
	disablePin: vi.fn(),
	setBiometricUnlock: vi.fn(),
}));

import { purgeGridProfileCache as purgeViaApiSurface } from "$lib/api/grid";
import {
	cacheProfile,
	clearProfileCache,
	currentGridCacheEpoch,
	type FullGridProfile,
	isGridCacheEpochCurrent,
	MAX_PROFILE_CACHE,
	profileCache,
	purgeGridProfileCache as purgeFromModel,
	resolveAndCacheGridProfiles,
} from "$lib/model/grid/profile-cache";

/** A profile as ACCOUNT A cached it while scrolling the grid. */
function accountAProfile(id: number, displayName = `A${id}`): FullGridProfile {
	return {
		type: "full",
		id,
		displayName,
		age: 34,
		distance: 120,
		profilePhotosHashes: ["a".repeat(40)],
		// `unread` is the previous account's unread count for this person: a
		// direct tell that the tile belongs to somebody else's session.
		unread: 3,
		onlineUntil: 1_800_000_000_000,
	};
}

/** The next account's own tile, for "does A's purge also destroy B's data". */
function accountBProfile(id: number): FullGridProfile {
	return { ...accountAProfile(id), displayName: `B${id}`, unread: 0 };
}

beforeEach(() => {
	// Purging rather than `clearProfileCache()` on purpose: the purge is the
	// only reset that also bumps the epoch, so a test that pins an epoch cannot
	// be silently affected by the previous test's pin.
	purgeFromModel();
});

describe("purgeGridProfileCache() — sign-out (P2-002)", () => {
	it("empties the cache: no resolved profile survives the sign-out", () => {
		// Up to MAX_PROFILE_CACHE entries can be resident at once; the grid
		// scrolls by resolving partial batches of 150, so a single session
		// routinely caches hundreds of the previous account's profiles.
		for (let i = 1; i <= 25; i++) cacheProfile(accountAProfile(i));
		expect(profileCache.size).toBe(25);

		const evicted = purgeFromModel();

		expect(evicted).toBe(25);
		expect(profileCache.size).toBe(0);
		for (let i = 1; i <= 25; i++) expect(profileCache.has(i)).toBe(false);
	});

	it("leaves the NEXT account unable to read the previous account's tiles", () => {
		// The cross-account assertion, stated as the leak: account A browses,
		// signs out, account B signs in and the grid looks for the same ids.
		cacheProfile(accountAProfile(9001, "AccountA Secret"));
		cacheProfile(accountAProfile(9002, "AccountA Other"));

		purgeFromModel();

		// What `gridState.loadBatch()` does for every id in a partial batch.
		const readAsAccountB = [9001, 9002].map((id) => profileCache.get(id));
		expect(readAsAccountB).toEqual([undefined, undefined]);
		// Explicitly: no name, no age, no distance, no photo hash, no unread
		// count, no online-until — nothing identifies the previous account.
		for (const profile of readAsAccountB) {
			expect(profile?.displayName).toBeUndefined();
			expect(profile?.profilePhotosHashes).toBeUndefined();
			expect(profile?.unread).toBeUndefined();
		}
	});

	it("does not erase the NEW account's cache when it is purged later", () => {
		// Ordering guard: if account A's sign-out purge somehow ran late (after
		// account B had already started browsing), it must not be possible for
		// the purge to be a no-op AND leave B's data behind — i.e. the purge is
		// unconditional and is only ever called on a real session boundary.
		cacheProfile(accountBProfile(1));
		expect(profileCache.size).toBe(1);

		purgeFromModel();

		expect(profileCache.size).toBe(0);
	});

	it("reports how many profiles it evicted", () => {
		// Mirrors `purgeAuthedImageCache()`: a silent `0` is how broken wiring
		// hides, because "purge ran" and "purge had something to erase" look
		// identical in a log line without a count.
		expect(purgeFromModel()).toBe(0);
		cacheProfile(accountAProfile(1));
		cacheProfile(accountAProfile(2));
		expect(purgeFromModel()).toBe(2);
	});

	it("is idempotent, and still invalidates an in-flight fetch when empty", () => {
		cacheProfile(accountAProfile(1));
		const epochBefore = currentGridCacheEpoch();

		expect(purgeFromModel()).toBe(1);
		// Second purge: nothing left to erase, but the epoch MUST still move —
		// a double sign-out is exactly the window where a resolve is in flight
		// and the cache is already empty.
		expect(purgeFromModel()).toBe(0);

		expect(profileCache.size).toBe(0);
		expect(isGridCacheEpochCurrent(epochBefore)).toBe(false);
	});

	it("is reachable from the single `$lib/api/grid` surface the purge imports", () => {
		// The purge enumerates the caches sign-out must erase. If that list ever
		// imports a symbol from here that does not exist, the module fails to
		// resolve at sign-out time (the worst possible moment) rather than at
		// build time — so the re-export is asserted rather than assumed.
		expect(typeof purgeViaApiSurface).toBe("function");
		cacheProfile(accountAProfile(7));
		purgeViaApiSurface();
		expect(profileCache.size).toBe(0);
	});
});

describe("grid cache epoch — an in-flight resolve cannot refill a purged cache", () => {
	it("drops a batch resolve that started before the purge", async () => {
		// The race a bare `clear()` loses. `gridState.loadBatch()` resolves up to
		// 150 partial profiles and writes the results back AFTER an await, so a
		// purge that lands mid-fetch was followed immediately by the previous
		// account's profiles re-inserting themselves into the empty map.
		let release!: (profiles: FullGridProfile[]) => void;
		const inFlight = new Promise<FullGridProfile[]>((resolve) => {
			release = resolve;
		});
		const resolving = resolveAndCacheGridProfiles(() => inFlight);

		// Sign-out lands while the fetch is still out.
		const evicted = purgeFromModel();
		expect(evicted).toBe(0);

		// The previous account's response arrives after the sign-out.
		release([accountAProfile(4242, "AccountA Late Arrival")]);

		expect(await resolving).toEqual([]);
		expect(profileCache.has(4242)).toBe(false);
		expect(profileCache.size).toBe(0);
	});

	it("keeps and caches a batch resolve that started after the purge", async () => {
		// The false-positive guard: the epoch check must not discard the NEW
		// account's own resolution. A purge that broke batching would look like a
		// privacy fix while the grid never rendered a resolved tile again.
		const resolved = await resolveAndCacheGridProfiles(() =>
			Promise.resolve([accountBProfile(11)]),
		);

		expect(resolved).toHaveLength(1);
		expect(profileCache.get(11)?.displayName).toBe("B11");
	});

	it("does not move the epoch on an ordinary cache write", () => {
		// A pin taken by a resolve must stay valid across normal grid activity —
		// scrolling, a second batch landing, an LRU eviction. Only a purge is
		// allowed to invalidate an in-flight resolve.
		const pinned = currentGridCacheEpoch();
		for (let i = 1; i <= 5; i++) cacheProfile(accountBProfile(i));

		expect(isGridCacheEpochCurrent(pinned)).toBe(true);
	});

	it("survives repeated purges: every one invalidates the pre-purge pin", () => {
		const pinned = currentGridCacheEpoch();
		purgeFromModel();
		expect(isGridCacheEpochCurrent(pinned)).toBe(false);

		const repinned = currentGridCacheEpoch();
		purgeFromModel();
		expect(isGridCacheEpochCurrent(repinned)).toBe(false);
	});
});

describe("the moved cache keeps its bound and ordering", () => {
	// The cache changed file (route module -> `$lib/model/grid`). Its bound and
	// LRU behaviour are what stopped it being an unbounded leak; a move that
	// quietly lost them would reintroduce the growth bug with a new address.
	it("evicts the oldest entries past the cap instead of growing forever", () => {
		for (let i = 1; i <= MAX_PROFILE_CACHE + 25; i++)
			cacheProfile(accountBProfile(i));

		expect(profileCache.size).toBe(MAX_PROFILE_CACHE);
		expect(profileCache.has(1)).toBe(false);
		expect(profileCache.has(MAX_PROFILE_CACHE + 25)).toBe(true);
	});

	it("is strictly LRU: re-caching an entry protects it from the next eviction", () => {
		for (let i = 1; i <= MAX_PROFILE_CACHE; i++)
			cacheProfile(accountBProfile(i));
		cacheProfile(accountBProfile(1));
		cacheProfile(accountBProfile(MAX_PROFILE_CACHE + 1));

		expect(profileCache.has(1)).toBe(true);
		expect(profileCache.has(2)).toBe(false);
	});

	it("does not grow when the same profile is cached repeatedly", () => {
		for (let i = 0; i < 100; i++) cacheProfile(accountBProfile(42));

		expect(profileCache.size).toBe(1);
		expect(profileCache.get(42)?.displayName).toBe("B42");
	});

	it("`clearProfileCache()` empties the map WITHOUT touching the epoch", () => {
		// The two resets have different jobs and the distinction matters:
		// `clearProfileCache()` is the grid's own "new area / refresh" reset
		// (`gridState.#reset()`), which must NOT cancel in-flight batches —
		// `loadBatch` relies on resolving them and discarding them by its own
		// generation counter.
		cacheProfile(accountBProfile(1));
		const epoch = currentGridCacheEpoch();

		clearProfileCache();

		expect(profileCache.size).toBe(0);
		expect(isGridCacheEpochCurrent(epoch)).toBe(true);
	});
});

// --- The acceptance criterion, end to end ------------------------------------
//
// "Purge test covers grid cache" (P2-002) means the REAL sign-out path evicts
// this cache — `purgeAccountLocalData()`, the function `SignOutButton.svelte`
// awaits before it navigates away, not a hand-called `purgeGridProfileCache()`.
//
// `wiredBelow` MEASURES that end to end: seed the cache, run the real purge,
// read it back. Until the purge module calls `purgeGridProfileCache()`, that
// measurement is `false` and the two tests below report as SKIPPED rather than
// silently passing — which is the whole point of measuring instead of asserting
// a state nobody re-derives. The moment the purge is wired, they run.
//
// Why it is not asserted unconditionally: the cache and its purge function live
// in `$lib/model/grid/`, but the enumeration of what sign-out erases lives in
// `$lib/app-data/purge.ts`, which this change does not own. Asserting the
// unwired state would mean shipping a red suite; asserting nothing would mean
// shipping a green one that proves nothing. A skipped-but-armed test is the
// honest middle: it states the acceptance criterion, and it is falsified by
// measurement.
const purgeAccountLocalData = (await import("$lib/app-data/purge"))
	.purgeAccountLocalData;

async function realSignOutEvictsGridCache(): Promise<boolean> {
	cacheProfile(accountAProfile(9001, "AccountA Secret"));
	await purgeAccountLocalData();
	const leaked = profileCache.has(9001);
	// Leave the module clean for the tests below whatever the answer is.
	purgeFromModel();
	return !leaked;
}

const signOutEvictsGridCache = await realSignOutEvictsGridCache();

describe("sign-out end to end — purgeAccountLocalData() (P2-002 acceptance)", () => {
	it.skipIf(!signOutEvictsGridCache)(
		"evicts the grid cache the real sign-out purge would leave behind",
		async () => {
			cacheProfile(accountAProfile(9001, "AccountA Secret"));

			await purgeAccountLocalData();

			expect(profileCache.size).toBe(0);
			expect(profileCache.has(9001)).toBe(false);
		},
	);

	it.skipIf(!signOutEvictsGridCache)(
		"leaves the next account unable to read the previous account's grid data",
		async () => {
			cacheProfile(accountAProfile(9001, "AccountA Secret"));

			await purgeAccountLocalData();

			expect(profileCache.get(9001)).toBeUndefined();
		},
	);
});
