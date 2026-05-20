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

	it("rejects socialNetworks as an array (API inconsistency guard)", () => {
		// Cascade v3 endpoint returns an empty array [] when no socials are set,
		// while the profile endpoint returns {}. This test documents the mismatch.
		const result = socialNetworksSchema.safeParse([]);
		expect(result.success).toBe(false);
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

	it("rejects unknown view source values from API", () => {
		// If Grindr adds a new view source this will fail — the schema needs
		// to be widened to z.string() with a fallback to avoid breaking the app.
		const result = viewSourceEnumSchema.safeParse("EXPLORE");
		expect(result.success).toBe(false);
	});
});
