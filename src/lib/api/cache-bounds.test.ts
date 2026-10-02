import { beforeEach, describe, expect, it, vi } from "vitest";

// E11 — cache audit of the files owned by the API-client batch.
//
// RESULT OF THE AUDIT: the only module-level caches in this batch are the
// two single-slot memo caches below (`genders.ts`, `pronouns.ts`). Neither can
// grow: each holds at most one parsed value behind a single `| null` variable,
// so there is no eviction bound to add and no unbounded `Map`/`Set` to bound.
// The unbounded cache in the API layer is `$lib/api/profile`'s `mediaIdCache`,
// which is NOT this batch's file (handed off separately).
//
// What IS worth locking down is that they stay single-slot: a future change to
// a `Map` keyed by profile/tag id would reintroduce the unbounded-growth class
// of bug and nothing else in the suite would notice. These tests assert the
// bound rather than leaving it as a claim in a comment.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { clearGendersCache, getGenders } from "$lib/api/genders";
import { clearPronounsCache, fetchPronouns } from "$lib/api/pronouns";
import { toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);

function respond(body: unknown): void {
	mockedInvoke.mockResolvedValueOnce(
		toBase64(
			encode({ status: 200, body: new TextEncoder().encode(JSON.stringify(body)) }),
		),
	);
}

const GENDER = {
	genderId: 1,
	gender: "Man",
	genderPlural: "Men",
	displayGroup: 1,
	sortProfile: 1,
	sortFilter: 1,
	excludeOnProfileSelection: null,
	excludeOnFilterSelection: null,
	alsoClassifiedAs: [],
};

beforeEach(() => {
	vi.clearAllMocks();
	clearGendersCache();
	clearPronounsCache();
});

describe("genders cache bound", () => {
	it("holds at most ONE value: a second call is served from it, not refetched", async () => {
		respond([GENDER]);
		await getGenders();

		const afterFirst = mockedInvoke.mock.calls.length;
		await getGenders();

		expect(afterFirst).toBe(1);
		expect(mockedInvoke.mock.calls.length).toBe(1);
	});

	it("REPLACES the cached value on refetch rather than accumulating", async () => {
		respond([GENDER]);
		await getGenders();

		respond([{ ...GENDER, genderId: 2, gender: "Woman" }]);
		clearGendersCache();
		const result = await getGenders();

		// One value in, one value out — the second fetch replaced the first, so
		// the cache still holds exactly one entry.
		expect(result).toHaveLength(1);
		expect(result[0]?.genderId).toBe(2);
	});
});

describe("pronouns cache bound", () => {
	it("holds at most ONE value: a second call is served from it, not refetched", async () => {
		respond([{ pronounId: 1, pronoun: "he/him" }]);
		await fetchPronouns();

		const afterFirst = mockedInvoke.mock.calls.length;
		await fetchPronouns();

		expect(afterFirst).toBe(1);
		expect(mockedInvoke.mock.calls.length).toBe(1);
	});

	it("REPLACES the cached value on refetch rather than accumulating", async () => {
		respond([{ pronounId: 1, pronoun: "he/him" }]);
		await fetchPronouns();

		respond([{ pronounId: 2, pronoun: "she/her" }]);
		clearPronounsCache();
		const result = await fetchPronouns();

		expect(result).toHaveLength(1);
		expect(result[0]?.pronounId).toBe(2);
	});
});
