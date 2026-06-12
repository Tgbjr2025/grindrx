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
