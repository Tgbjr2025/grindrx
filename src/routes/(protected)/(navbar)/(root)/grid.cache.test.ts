import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The project's vitest environment is "node" (no jsdom installed), so pin
// `browser` explicitly rather than depend on SvelteKit's SSR build flag.
vi.mock("$app/environment", () => ({
	browser: true,
	building: false,
	dev: false,
	version: "test",
}));

vi.mock("$lib/api/grid", () => ({
	getCascadeV3: vi.fn(),
}));

vi.mock("$lib/api/profile", () => ({
	getProfiles: vi.fn(),
}));

import { getCascadeV3 } from "$lib/api/grid";
import { getProfiles } from "$lib/api/profile";
import {
	cacheProfile,
	clearProfileCache,
	type FullGridProfile,
	getGrid,
	isGeohashPinned,
	MAX_PROFILE_CACHE,
	profileCache,
	setGeohashPinned,
} from "./grid";

const mockedGetCascadeV3 = vi.mocked(getCascadeV3);
const mockedGetProfiles = vi.mocked(getProfiles);

const NEARBY = "9q8yyk8y";

function fullItem(profileId: number, overrides: Record<string, unknown> = {}) {
	return {
		type: "full_profile_v1",
		data: {
			profileId,
			displayName: `Profile ${profileId}`,
			distanceMeters: 100,
			photoMediaHashes: ["a".repeat(40)],
			unreadCount: 0,
			onlineUntil: null,
			...overrides,
		},
	};
}

function mockCascade(items: unknown[]) {
	mockedGetCascadeV3.mockResolvedValueOnce({
		items,
		nextPage: null,
		shuffled: false,
		hiddenProfiles: null,
		hiddenProfileInfo: null,
	} as unknown as Awaited<ReturnType<typeof getCascadeV3>>);
}

function cached(id: number, displayName = `P${id}`): FullGridProfile {
	return {
		type: "full",
		id,
		displayName,
		age: null,
		distance: 100,
		profilePhotosHashes: null,
		unread: null,
		onlineUntil: null,
	};
}

beforeEach(() => {
	clearProfileCache();
	mockedGetCascadeV3.mockReset();
	mockedGetProfiles.mockReset();
});

describe("getGrid — age mapping (D8)", () => {
	// `getGrid` hardcoded `age: null` for every full profile, with a comment
	// claiming "Grindr cascade API doesn't return age for full profiles". The
	// schema was the thing dropping it (zod strips unknown keys), so page 1 of
	// the grid had no age badges while later pages — resolved through
	// resolvePartialBatch -> the v4 profile schema, which does parse `age` — did.
	it("maps the cascade profile's age onto the grid tile", async () => {
		mockCascade([fullItem(1, { age: 34 })]);

		const result = await getGrid({ nearbyGeoHash: NEARBY });

		const first = result.items[0];
		expect(first?.type).toBe("full");
		if (first?.type === "full") expect(first.age).toBe(34);
	});

	it("passes a hidden (null) age through as null, not 0", async () => {
		mockCascade([fullItem(1, { age: null })]);

		const result = await getGrid({ nearbyGeoHash: NEARBY });

		const first = result.items[0];
		if (first?.type === "full") expect(first.age).toBeNull();
	});

	it("yields null when the cascade omits age entirely", async () => {
		// Absent must never become 0: the tile would then render a "0" age badge.
		mockCascade([fullItem(1)]);

		const result = await getGrid({ nearbyGeoHash: NEARBY });

		const first = result.items[0];
		if (first?.type === "full") expect(first.age).toBeNull();
	});

	it("gives the FIRST page an age where resolvePartialBatch already did", async () => {
		// Control case: the partial-batch path reads `profile.age` and always
		// worked, which is exactly why the two pages disagreed.
		mockedGetProfiles.mockResolvedValueOnce([
			{ profileId: 7, displayName: "Seven", age: 41, distance: 12, medias: [] },
		] as unknown as Awaited<ReturnType<typeof getProfiles>>);
		const { resolvePartialBatch } = await import("./grid");
		const [profile] = await resolvePartialBatch([7]);
		expect(profile?.age).toBe(41);
	});
});

describe("profileCache — bounded and clearable (D23)", () => {
	// This Map was module-level, unbounded, and never invalidated by #reset() /
	// refresh() / logout, so it grew one entry per profile seen for the process
	// lifetime and could serve a stale display name or photo hash after a save.
	it("evicts the oldest entries past the cap instead of growing forever", () => {
		for (let i = 1; i <= MAX_PROFILE_CACHE + 25; i++) cacheProfile(cached(i));

		expect(profileCache.size).toBe(MAX_PROFILE_CACHE);
		// Oldest evicted, newest retained.
		expect(profileCache.has(1)).toBe(false);
		expect(profileCache.has(MAX_PROFILE_CACHE + 25)).toBe(true);
	});

	it("is strictly LRU: re-caching an entry protects it from the next eviction", () => {
		for (let i = 1; i <= MAX_PROFILE_CACHE; i++) cacheProfile(cached(i));
		// Touch the oldest so it becomes the most recent.
		cacheProfile(cached(1));
		cacheProfile(cached(MAX_PROFILE_CACHE + 1));

		expect(profileCache.has(1)).toBe(true);
		expect(profileCache.has(2)).toBe(false);
	});

	it("does not grow when the same profile is cached repeatedly", () => {
		for (let i = 0; i < 100; i++) cacheProfile(cached(42, "Renamed"));
		expect(profileCache.size).toBe(1);
		expect(profileCache.get(42)?.displayName).toBe("Renamed");
	});

	it("clearProfileCache empties it (called from gridState.#reset)", () => {
		cacheProfile(cached(1));
		cacheProfile(cached(2));
		expect(profileCache.size).toBe(2);

		clearProfileCache();

		expect(profileCache.size).toBe(0);
		expect(profileCache.has(1)).toBe(false);
	});
});

// --- The user-pinned-location flag (D17) ------------------------------------
//
// "Browse from here" writes a hand-picked geohash into the same
// `preferences.geohash` slot the GPS updater writes, so the two were
// indistinguishable once persisted. On the next cold start the root page
// compared a real GPS fix against the remote hash, found them >1 km apart, and
// overwrote it — the chosen area silently reverting to the device's location.
// The flag is the only way to tell them apart.
describe("geohash pin flag", () => {
	const original = globalThis.localStorage;

	beforeEach(() => {
		const store = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			writable: true,
			value: {
				// `has` does not narrow a later `get` for the checker, and
				// `store.get(k)` is `string | undefined` — the Storage signature
				// requires `string | null`.
				getItem: (k: string) => (store.has(k) ? (store.get(k) ?? null) : null),
				setItem: (k: string, v: string) => void store.set(k, v),
				removeItem: (k: string) => void store.delete(k),
				clear: () => store.clear(),
				key: (i: number) => [...store.keys()][i] ?? null,
				get length() {
					return store.size;
				},
			} satisfies Storage,
		});
	});

	afterEach(() => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			writable: true,
			value: original,
		});
	});

	it("defaults to NOT pinned (a fresh install follows GPS)", () => {
		expect(isGeohashPinned()).toBe(false);
	});

	it("round-trips a pin", () => {
		setGeohashPinned(true);
		expect(isGeohashPinned()).toBe(true);
	});

	it("clears the pin", () => {
		setGeohashPinned(true);
		setGeohashPinned(false);
		expect(isGeohashPinned()).toBe(false);
	});

	it("is idempotent", () => {
		setGeohashPinned(true);
		setGeohashPinned(true);
		expect(isGeohashPinned()).toBe(true);
	});

	it("degrades to 'not pinned' when localStorage throws", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			writable: true,
			value: {
				getItem: () => {
					throw new Error("blocked");
				},
				setItem: () => {
					throw new Error("blocked");
				},
				removeItem: () => {
					throw new Error("blocked");
				},
			},
		});
		// Worst case is a spurious GPS refresh, not a crash on startup.
		expect(isGeohashPinned()).toBe(false);
		expect(() => setGeohashPinned(true)).not.toThrow();
	});
});
