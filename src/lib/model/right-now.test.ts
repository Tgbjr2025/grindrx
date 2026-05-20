import { describe, expect, it } from "vitest";

import { rightNowStatusSchema } from "$lib/model/right-now";

describe("rightNowStatusSchema", () => {
	it("accepts NOT_ACTIVE", () => {
		expect(rightNowStatusSchema.parse("NOT_ACTIVE")).toBe("NOT_ACTIVE");
	});

	it("accepts HOSTING", () => {
		expect(rightNowStatusSchema.parse("HOSTING")).toBe("HOSTING");
	});

	it("accepts NOT_HOSTING", () => {
		expect(rightNowStatusSchema.parse("NOT_HOSTING")).toBe("NOT_HOSTING");
	});

	it("rejects unknown status values from API", () => {
		// If Grindr adds a new rightNow status this will fail — the schema needs
		// to be widened to z.string() with a fallback to avoid breaking the app.
		const result = rightNowStatusSchema.safeParse("AWAY_FROM_APP");
		expect(result.success).toBe(false);
	});
});
