import { describe, expect, it } from "vitest";

import { gendersSchema } from "$lib/model/genders";

/**
 * Profile editing was unusable: gender options never loaded, and because Save is
 * gated on `listsPending` in EditProfileSheet, NO profile change could be saved.
 *
 * Root cause: `gendersSchema` required `genderPlural` to be a NON-EMPTY string.
 * The app's own vendored API doc (docs/content/grindr-api/users/profiles.md,
 * `GET /public/v2/genders`) says `genderPlural` is "string or **null**". One
 * entry returned as null rejected the ENTIRE array, and the rejection is
 * silent: the sheet's never-rejecting mirror just leaves `gendersOk` false
 * forever, so the list looks like it is still loading rather than failed.
 *
 * This is the same class of bug as the `medias[]` schema on the profile model —
 * an array schema with no per-item tolerance, where one drifted element takes
 * every sibling with it.
 */

describe("gendersSchema survives a drifted entry", () => {
	const good = {
		genderId: 1,
		gender: "Man",
		genderPlural: "Men",
		displayGroup: 0,
		sortProfile: 1,
		sortFilter: 1,
		excludeOnProfileSelection: null,
		excludeOnFilterSelection: null,
		alsoClassifiedAs: [],
	};

	it("accepts the documented shape", () => {
		const parsed = gendersSchema.parse([good]);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].gender).toBe("Man");
	});

	it("ACCEPTS genderPlural: null, which the endpoint documents and returns", () => {
		// The bug: this used to reject the whole array.
		const parsed = gendersSchema.parse([{ ...good, genderPlural: null }]);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].genderPlural).toBeNull();
	});

	it("accepts an empty-string plural rather than dropping the row", () => {
		const parsed = gendersSchema.parse([{ ...good, genderPlural: "" }]);
		expect(parsed[0].gender).toBe("Man");
	});

	it("keeps the OTHER genders when exactly one entry drifts", () => {
		const parsed = gendersSchema.parse([
			good,
			{ ...good, genderId: 2, gender: "Woman", genderPlural: null },
			{ ...good, genderId: 3, gender: "Non-binary", genderPlural: "Non-binaries" },
		]);
		expect(parsed).toHaveLength(3);
		expect(parsed.map((g) => g.genderId)).toEqual([1, 2, 3]);
	});

	it("degrades optional arrays to safe defaults rather than failing", () => {
		const parsed = gendersSchema.parse([
			{
				...good,
				alsoClassifiedAs: null,
				excludeOnProfileSelection: null,
			},
		]);
		expect(parsed[0].alsoClassifiedAs).toEqual([]);
		expect(parsed[0].excludeOnFilterSelection).toBeNull();
	});

	it("STILL rejects an entry with no identity — a row without these is not a gender", () => {
		// Tolerance must not become sloppiness: an entry missing genderId or
		// gender cannot be rendered or submitted meaningfully.
		expect(() => gendersSchema.parse([{ ...good, genderId: undefined }])).toThrow();
		expect(() => gendersSchema.parse([{ ...good, gender: "" }])).toThrow();
	});
});