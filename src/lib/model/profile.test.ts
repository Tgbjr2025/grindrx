import { describe, expect, it } from "vitest";

import { socialNetworksSchema } from "$lib/model/profile";
import { viewSourceEnumSchema } from "$lib/model/interest";

describe("socialNetworksSchema", () => {
	it("accepts an empty social networks object", () => {
		expect(socialNetworksSchema.parse({})).toEqual({});
	});

	it("accepts all three social networks with null userIds", () => {
		const result = socialNetworksSchema.safeParse({
			twitter: { userId: null },
			facebook: { userId: null },
			instagram: { userId: null },
		});
		expect(result.success).toBe(true);
	});

	it("accepts partial social networks", () => {
		const result = socialNetworksSchema.safeParse({
			instagram: { userId: "opengrind_app" },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.instagram?.userId).toBe("opengrind_app");
			expect(result.data.twitter).toBeUndefined();
		}
	});

	it("accepts socialNetworks as an array and normalises to empty object", () => {
		// Cascade v3 returns [] when no socials are set; z.preprocess converts it to {}.
		const result = socialNetworksSchema.safeParse([]);
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toEqual({});
	});
});

describe("viewSourceEnumSchema", () => {
	it("accepts DISCOVER", () => {
		expect(viewSourceEnumSchema.parse("DISCOVER")).toBe("DISCOVER");
	});

	it("accepts FOR_YOU", () => {
		expect(viewSourceEnumSchema.parse("FOR_YOU")).toBe("FOR_YOU");
	});

	it("accepts UNKNOWN", () => {
		expect(viewSourceEnumSchema.parse("UNKNOWN")).toBe("UNKNOWN");
	});

	it("accepts unknown view source values from API without crashing", () => {
		// Schema widened with .or(z.string()) so new Grindr values don't break parsing.
		const result = viewSourceEnumSchema.safeParse("EXPLORE");
		expect(result.success).toBe(true);
	});
});
