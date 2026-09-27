import { describe, expect, it } from "vitest";

import { defaultFilters } from "$lib/components/filters/filters";
import {
	buildCascadeQuery,
	KG_TO_GRAMS,
	weightKgRangeToGrams,
} from "./grid-state.svelte";

const GEOHASH = "9q8yyk8ytpxr";

/**
 * These tests exist because the filter->query mapper was previously inlined in
 * `#fetchProfiles` with zero tests, and it fed the KILOGRAM slider array
 * straight into `weightGramsMin`/`weightGramsMax` — a 1000x unit error that
 * made the weight filter return nobody, silently.
 */
describe("weightKgRangeToGrams", () => {
	it("converts the kg slider range to the API's gram unit", () => {
		expect(weightKgRangeToGrams([40, 273])).toEqual({
			min: 40 * KG_TO_GRAMS,
			max: 273 * KG_TO_GRAMS,
		});
	});

	it("returns null for a missing or malformed range", () => {
		expect(weightKgRangeToGrams(undefined)).toBeNull();
		expect(weightKgRangeToGrams([40])).toBeNull();
	});
});

describe("buildCascadeQuery — weight units", () => {
	it("REGRESSION: sends 40-273 kg as 40000-273000 grams, not 40-273 grams", () => {
		const query = buildCascadeQuery(GEOHASH, null, {
			...defaultFilters,
			weightEnabled: true,
		});

		expect(query.weightGramsMin).toBe(40_000);
		expect(query.weightGramsMax).toBe(273_000);
		// The bug's signature: a sub-kilogram minimum is impossible for a human.
		expect(query.weightGramsMin).toBeGreaterThan(1_000);
	});

	it("honours a narrowed range", () => {
		const query = buildCascadeQuery(GEOHASH, null, {
			...defaultFilters,
			weightEnabled: true,
			weight: [60, 80],
		});

		expect(query.weightGramsMin).toBe(60_000);
		expect(query.weightGramsMax).toBe(80_000);
	});

	it("omits the weight params entirely when the filter is disabled", () => {
		const query = buildCascadeQuery(GEOHASH, null, {
			...defaultFilters,
			weightEnabled: false,
		});

		expect(query).not.toHaveProperty("weightGramsMin");
		expect(query).not.toHaveProperty("weightGramsMax");
	});
});

describe("buildCascadeQuery — the other unit-bearing filters", () => {
	it("passes height through unscaled, because the slider is already cm", () => {
		const query = buildCascadeQuery(GEOHASH, null, {
			...defaultFilters,
			heightEnabled: true,
			height: [150, 200],
		});

		expect(query.heightCmMin).toBe(150);
		expect(query.heightCmMax).toBe(200);
	});

	it("passes age through unscaled", () => {
		const query = buildCascadeQuery(GEOHASH, null, {
			...defaultFilters,
			ageEnabled: true,
			age: [24, 35],
		});

		expect(query.ageMin).toBe(24);
		expect(query.ageMax).toBe(35);
	});
});

describe("buildCascadeQuery — geohash routing", () => {
	it("always sends the real location as nearbyGeoHash", () => {
		const query = buildCascadeQuery(GEOHASH, null, defaultFilters);
		expect(query.nearbyGeoHash).toBe(GEOHASH);
		expect(query).not.toHaveProperty("exploreGeoHash");
	});

	it("routes a browsed remote area through exploreGeoHash, never nearbyGeoHash", () => {
		const query = buildCascadeQuery(GEOHASH, "u4pruy", defaultFilters);
		expect(query.nearbyGeoHash).toBe(GEOHASH);
		expect(query.exploreGeoHash).toBe("u4pruy");
	});
});

describe("buildCascadeQuery — no filters", () => {
	it("tolerates undefined filters and still produces a valid query", () => {
		const query = buildCascadeQuery(GEOHASH, null, undefined);
		expect(query.nearbyGeoHash).toBe(GEOHASH);
		expect(query).not.toHaveProperty("weightGramsMin");
		expect(query).not.toHaveProperty("ageMin");
	});
});
