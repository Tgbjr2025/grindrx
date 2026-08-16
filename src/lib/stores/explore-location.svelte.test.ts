import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The project's vitest environment is "node" (no jsdom dependency installed),
// so `browser` from `$app/environment` would otherwise resolve to whatever
// SvelteKit's SSR build flag says — pin it explicitly rather than depend on
// that, matching SvelteKit's documented pattern for testing $app modules.
vi.mock("$app/environment", () => ({
	browser: true,
	building: false,
	dev: false,
	version: "test",
}));

const STORAGE_KEY = "grindrx-explore-location";
// Valid per geohashSchema: exactly 12 chars from [0-9b-hjkmnp-z] (no a/i/l/o).
const VALID_GEOHASH = "9q8yyk8ytpxr";
const OTHER_GEOHASH = "dr5regy3zpst";

function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	} as Storage;
}

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("localStorage", createMemoryStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("explore-location store", () => {
	it("starts with no override when nothing is persisted", async () => {
		const { getExploreLocation, isExploring } = await import(
			"$lib/stores/explore-location.svelte"
		);

		expect(getExploreLocation()).toBeNull();
		expect(isExploring()).toBe(false);
	});

	it("setExploreLocation updates state and persists to localStorage", async () => {
		const { getExploreLocation, isExploring, setExploreLocation } =
			await import("$lib/stores/explore-location.svelte");

		setExploreLocation({ geohash: VALID_GEOHASH, label: "Tokyo" });

		expect(isExploring()).toBe(true);
		expect(getExploreLocation()).toEqual({ geohash: VALID_GEOHASH, label: "Tokyo" });
		expect(
			JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
		).toEqual({ geohash: VALID_GEOHASH, label: "Tokyo" });
	});

	it("defaults label to null when omitted", async () => {
		const { getExploreLocation, setExploreLocation } = await import(
			"$lib/stores/explore-location.svelte"
		);

		setExploreLocation({ geohash: VALID_GEOHASH });

		expect(getExploreLocation()?.label).toBeNull();
	});

	it("replacing the override updates both state and storage", async () => {
		const { getExploreLocation, setExploreLocation } = await import(
			"$lib/stores/explore-location.svelte"
		);

		setExploreLocation({ geohash: VALID_GEOHASH, label: "Tokyo" });
		setExploreLocation({ geohash: OTHER_GEOHASH, label: "Berlin" });

		expect(getExploreLocation()).toEqual({ geohash: OTHER_GEOHASH, label: "Berlin" });
		expect(
			JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
		).toEqual({ geohash: OTHER_GEOHASH, label: "Berlin" });
	});

	it("clearExploreLocation resets state and removes the persisted key", async () => {
		const { clearExploreLocation, getExploreLocation, isExploring, setExploreLocation } =
			await import("$lib/stores/explore-location.svelte");
		setExploreLocation({ geohash: VALID_GEOHASH, label: "Tokyo" });

		clearExploreLocation();

		expect(getExploreLocation()).toBeNull();
		expect(isExploring()).toBe(false);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it("rejects an invalid geohash instead of persisting garbage", async () => {
		const { getExploreLocation, setExploreLocation } = await import(
			"$lib/stores/explore-location.svelte"
		);

		expect(() => setExploreLocation({ geohash: "not-a-geohash" })).toThrow();
		expect(getExploreLocation()).toBeNull();
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it("tolerant read: malformed JSON already in storage is treated as no override, not a crash", async () => {
		localStorage.setItem(STORAGE_KEY, "{not json");

		const { getExploreLocation, isExploring } = await import(
			"$lib/stores/explore-location.svelte"
		);

		expect(getExploreLocation()).toBeNull();
		expect(isExploring()).toBe(false);
	});

	it("tolerant read: a persisted value that fails schema validation is treated as no override", async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ geohash: "too-short" }),
		);

		const { getExploreLocation } = await import(
			"$lib/stores/explore-location.svelte"
		);

		expect(getExploreLocation()).toBeNull();
	});

	it("a previously persisted valid location is restored on load", async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ geohash: VALID_GEOHASH, label: "Berlin" }),
		);

		const { getExploreLocation, isExploring } = await import(
			"$lib/stores/explore-location.svelte"
		);

		expect(isExploring()).toBe(true);
		expect(getExploreLocation()).toEqual({ geohash: VALID_GEOHASH, label: "Berlin" });
	});
});
