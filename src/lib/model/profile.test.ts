import { describe, expect, it } from "vitest";

import { searchProfileSchema } from "$lib/model/grid/search";
import { viewSourceEnumSchema } from "$lib/model/interest";
import { socialNetworksSchema } from "$lib/model/profile";
import { profileMinSchema, profileSchema } from "$lib/model/profile";

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

// --- D11: `z.coerce.number()` resurrecting profile 0 -------------------------

describe("profile id schemas cannot manufacture profile 0 (D11)", () => {
	// `z.coerce.number().int().nonnegative()` coerced BEFORE validating, and
	// `Number(null) === Number("") === 0`, so a missing/blank id passed
	// `.nonnegative()` and produced profile 0 — the `/profile/0` bug that
	// v0.1.33 fixed downstream in the route, re-created at the parse layer.

	for (const [name, schema] of [
		["profileMinSchema", profileMinSchema],
		["searchProfileSchema", searchProfileSchema],
	] as const) {
		describe(name, () => {
			it("rejects null", () => {
				expect(
					schema.safeParse({ profileId: null, displayName: null }).success,
				).toBe(false);
			});

			it("REGRESSION: rejects an empty string, which used to coerce to 0", () => {
				expect(
					schema.safeParse({ profileId: "", displayName: null }).success,
				).toBe(false);
			});

			it("rejects a whitespace-only string", () => {
				expect(
					schema.safeParse({ profileId: "   ", displayName: null }).success,
				).toBe(false);
			});

			it("rejects an explicit 0", () => {
				expect(
					schema.safeParse({ profileId: 0, displayName: null }).success,
				).toBe(false);
			});

			it("rejects a negative id", () => {
				expect(
					schema.safeParse({ profileId: -5, displayName: null }).success,
				).toBe(false);
			});

			it("still accepts a real id, as a number and as a numeric string", () => {
				expect(
					profileMinSchema.safeParse({ profileId: 1234, displayName: null })
						.success,
				).toBe(true);
				const fromString = profileMinSchema.safeParse({
					profileId: "1234",
					displayName: null,
				});
				expect(fromString.success).toBe(true);
				if (fromString.success) expect(fromString.data.profileId).toBe(1234);
			});
		});
	}
});

// --- D7: the all-or-nothing profileSchema -----------------------------------

/**
 * The minimal profile the server can return: everything the grid/profile
 * screens actually need and nothing else. Every field below used to be
 * REQUIRED, so one missing cosmetic key meant "Failed to load profile".
 */
function minimalProfile(overrides: Record<string, unknown> = {}) {
	return {
		// profileMaskedMinSchema
		distance: 1200,
		profileImageMediaHash: null,
		isFavorite: false,
		// profileMaskedSchema
		lastViewed: null,
		seen: null,
		rightNow: "NONE",
		sexualPosition: null,
		foundVia: "DISCOVER",
		// profileMinSchema
		profileId: 4242,
		displayName: "Someone",
		onlineUntil: null,
		// profileShortSchema
		age: 30,
		showAge: true,
		showDistance: true,
		approximateDistance: false,
		lastChatTimestamp: null,
		isNew: false,
		lastUpdatedTime: 0,
		medias: [],
		...overrides,
	};
}

describe("profileSchema is no longer all-or-nothing (D7)", () => {
	it("parses a profile that omits every cosmetic/decoration field", () => {
		const result = profileSchema.safeParse(minimalProfile());
		expect(result.success).toBe(true);
	});

	it("REGRESSION: one missing cosmetic key no longer fails the whole profile", () => {
		// `tapped` was required. Grindr omitting a single unrelated badge turned
		// the entire profile screen into "Failed to load profile".
		const withoutTapped = minimalProfile();
		delete (withoutTapped as Record<string, unknown>).tapped;
		expect(profileSchema.safeParse(withoutTapped).success).toBe(true);
	});

	it("survives the loss of the whole unread/teleport/roam/VIP cluster", () => {
		for (const key of [
			"tapped",
			"lastThrobTimestamp",
			"isTeleporting",
			"isRoaming",
			"isInAList",
			"showVipBadge",
			"isVisiting",
		]) {
			const p = minimalProfile();
			delete (p as Record<string, unknown>)[key];
			expect(
				profileSchema.safeParse(p).success,
				`${key} should be optional`,
			).toBe(true);
		}
	});

	it("survives the loss of the array fields", () => {
		for (const key of [
			"rightNowMedias",
			"travelPlans",
			"hashtags",
			"profileTags",
		]) {
			const p = minimalProfile();
			delete (p as Record<string, unknown>)[key];
			expect(
				profileSchema.safeParse(p).success,
				`${key} should be optional`,
			).toBe(true);
		}
	});

	it("STILL requires `medias`, deliberately — see the note in profile.ts", () => {
		// `medias` lives in `profileShortSchema` and four consumers OUTSIDE this
		// partition dereference it unguarded (`api/profile.ts:129` does
		// `profile.medias.length`, and NavBar/ProfileLink/ViewersDrawer pass it
		// straight through). Making it optional is a type error in files this batch
		// does not own, so it stays required and is reported to the coordinator.
		const p = minimalProfile();
		delete (p as Record<string, unknown>).medias;
		expect(profileSchema.safeParse(p).success).toBe(false);
	});

	it("survives the loss of height/weight/lastTestedDate/aboutMe", () => {
		for (const key of [
			"height",
			"weight",
			"lastTestedDate",
			"aboutMe",
			"socialNetworks",
			"nsfw",
		]) {
			const p = minimalProfile();
			delete (p as Record<string, unknown>)[key];
			expect(
				profileSchema.safeParse(p).success,
				`${key} should be optional`,
			).toBe(true);
		}
	});

	it("coerces unreadCount to 0 rather than leaving it undefined", () => {
		// `.catch(0)` matches the cascade schema's representation of the same
		// value, and keeps `unread > 0` arithmetic safe in the grid tile.
		const result = profileSchema.safeParse(minimalProfile());
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.unreadCount).toBe(0);
	});

	it("coerces rightNowMedias to [] rather than failing the profile", () => {
		const result = profileSchema.safeParse(
			minimalProfile({ rightNowMedias: "not-an-array" }),
		);
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.rightNowMedias).toEqual([]);
	});

	it("STILL rejects a profile with no profileId — tolerance is not permissiveness", () => {
		const p = minimalProfile();
		delete (p as Record<string, unknown>).profileId;
		expect(profileSchema.safeParse(p).success).toBe(false);
	});

	it("caps profileTags so an unbounded array can't blow up the render", () => {
		// `ProfileTags.svelte` renders every tag in an unkeyed `{#each}`.
		const tooMany = minimalProfile({
			profileTags: Array.from({ length: 500 }, (_, i) => `tag-${i}`),
		});
		expect(profileSchema.safeParse(tooMany).success).toBe(false);
		const justUnder = minimalProfile({
			profileTags: Array.from({ length: 32 }, (_, i) => `tag-${i}`),
		});
		expect(profileSchema.safeParse(justUnder).success).toBe(true);
	});
});
