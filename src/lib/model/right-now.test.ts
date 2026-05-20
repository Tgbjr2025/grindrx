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

	it("accepts unknown status values from API without crashing", () => {
		// Schema widened with .or(z.string()) so new Grindr values don't break parsing.
		const result = rightNowStatusSchema.safeParse("AWAY_FROM_APP");
		expect(result.success).toBe(true);
	});
});
