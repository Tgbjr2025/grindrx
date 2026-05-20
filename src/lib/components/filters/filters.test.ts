import { describe, expect, it } from "vitest";

import { filterPhotosSchema } from "$lib/components/filters/filters";

describe("filterPhotosSchema", () => {
	it("accepts valid photo filter values", () => {
		const result = filterPhotosSchema.safeParse([
			"has-photos",
			"has-face-pics",
			"has-albums",
		]);
		expect(result.success).toBe(true);
	});

	it("accepts an empty array (no photo filters selected)", () => {
		expect(filterPhotosSchema.parse([])).toEqual([]);
	});

	it("accepts has-face-pics individually", () => {
		const result = filterPhotosSchema.safeParse(["has-face-pics"]);
		expect(result.success).toBe(true);
	});

	it("rejects has-profile-pic (not a valid filter value)", () => {
		// This was the string incorrectly used in grid-state.svelte.ts causing
		// faceOnly to always be false. The valid value is "has-face-pics".
		const result = filterPhotosSchema.safeParse(["has-profile-pic"]);
		expect(result.success).toBe(false);
	});
});
