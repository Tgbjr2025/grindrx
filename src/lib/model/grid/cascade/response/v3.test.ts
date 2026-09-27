import { describe, expect, it, vi } from "vitest";

import { cascadeV3ResponseSchema } from "./v3";

function fullProfileItem(overrides: Record<string, unknown> = {}) {
	return {
		type: "full_profile_v1",
		data: {
			"@type": "CascadeItemData$FullProfileV1",
			profileId: 123,
			onlineUntil: null,
			photoMediaHashes: ["a".repeat(40)],
			...overrides,
		},
	};
}

function baseResponse(items: unknown[]) {
	return {
		items,
		nextPage: 1,
		shuffled: false,
		hiddenProfiles: null,
		hiddenProfileInfo: null,
	};
}

describe("cascadeV3ResponseSchema", () => {
	it("parses a minimal full profile (only the fields the grid needs)", () => {
		const result = cascadeV3ResponseSchema.safeParse(
			baseResponse([fullProfileItem()]),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.items).toHaveLength(1);
			expect(result.data.items[0].type).toBe("full_profile_v1");
		}
	});

	it("keeps a full profile even when the cosmetic booleans are absent", () => {
		// Previously every one of these was required, so a missing field threw out
		// the whole response and blanked the grid.
		const result = cascadeV3ResponseSchema.safeParse(
			baseResponse([fullProfileItem()]),
		);
		expect(result.success).toBe(true);
	});

	it("drops an unrecognised item type instead of failing the whole response", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = cascadeV3ResponseSchema.safeParse(
			baseResponse([
				fullProfileItem({ profileId: 1 }),
				{ type: "some_future_item_v9", data: { foo: "bar" } },
				fullProfileItem({ profileId: 2 }),
			]),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			// Both valid profiles survive; the unknown item is dropped.
			expect(result.data.items).toHaveLength(2);
		}
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("drops a single malformed profile but keeps the valid ones", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = cascadeV3ResponseSchema.safeParse(
			baseResponse([
				fullProfileItem({ profileId: 1 }),
				// missing the required profileId -> only this item is dropped
				fullProfileItem({ profileId: undefined }),
				fullProfileItem({ profileId: 3 }),
			]),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.items).toHaveLength(2);
		}
		warn.mockRestore();
	});

	it("tolerates a missing top-level `shuffled` field", () => {
		const response = baseResponse([fullProfileItem()]) as Record<
			string,
			unknown
		>;
		delete response.shuffled;
		const result = cascadeV3ResponseSchema.safeParse(response);
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.shuffled).toBe(false);
	});
});

describe("cascadeV3ResponseSchema — `age` survives (D8)", () => {
	// The v3 profile schema omitted `age`, and zod STRIPS unknown keys, so the
	// field never reached the grid. `getGrid` then hardcoded `age: null` with a
	// comment claiming the API doesn't return it — contradicted by
	// `cascade/response/v4.ts`, which parses it. Net effect: page 1 of the grid
	// had no age badges while every later page (resolvePartialBatch -> v4) did.

	it("keeps a numeric age on a full profile instead of stripping it", () => {
		const result = cascadeV3ResponseSchema.safeParse(
			baseResponse([fullProfileItem({ age: 34 })]),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			const item = result.data.items[0];
			expect(item?.type).toBe("full_profile_v1");
			if (item?.type === "full_profile_v1") expect(item.data.age).toBe(34);
		}
	});

	it("keeps a null age as null (an age the profile hides)", () => {
		const result = cascadeV3ResponseSchema.safeParse(
			baseResponse([fullProfileItem({ age: null })]),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			const item = result.data.items[0];
			if (item?.type === "full_profile_v1") expect(item.data.age).toBeNull();
		}
	});

	it("keeps the whole profile when `age` is absent entirely", () => {
		// Absent must stay absent, not become 0: a 0-year-old tile is a lie, and
		// the tile renders `age === null` by omitting the badge entirely.
		const result = cascadeV3ResponseSchema.safeParse(
			baseResponse([fullProfileItem()]),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			const item = result.data.items[0];
			if (item?.type === "full_profile_v1") {
				expect(item.data.age).toBeUndefined();
			}
		}
	});

	it("does NOT let a malformed age through as a number", () => {
		// `.optional()`, not `.catch()`: a wrong age is worse than a missing one,
		// so the whole item is dropped rather than the field silently mangled.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = cascadeV3ResponseSchema.safeParse(
			baseResponse([
				fullProfileItem({ profileId: 1, age: "thirty-four" }),
				fullProfileItem({ profileId: 2, age: 44 }),
			]),
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.items).toHaveLength(1);
			const kept = result.data.items[0];
			if (kept?.type === "full_profile_v1") {
				expect(kept.data.profileId).toBe(2);
				expect(kept.data.age).toBe(44);
			}
		}
		warn.mockRestore();
	});

	it("rejects a negative or fractional age rather than rendering it", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		for (const bad of [-1, 34.5]) {
			const result = cascadeV3ResponseSchema.safeParse(
				baseResponse([fullProfileItem({ age: bad })]),
			);
			expect(result.success).toBe(true);
			if (result.success) expect(result.data.items).toHaveLength(0);
		}
		warn.mockRestore();
	});
});
