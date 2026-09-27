import z from "zod";

import { viewSourceEnumSchema } from "$lib/model/interest";
import { mediaHashPublicSchema } from "$lib/model/media";
import { rightNowStatusSchema } from "$lib/model/right-now";

export const SexualPosition = {
	Top: 1,
	Bottom: 2,
	Versatile: 3,
	VersBottom: 4,
	VersTop: 5,
	Side: 6,
} as const;

export const sexualPositions = {
	[SexualPosition.Top]: "Top",
	[SexualPosition.Bottom]: "Bottom",
	[SexualPosition.Versatile]: "Versatile",
	[SexualPosition.VersBottom]: "Vers Bottom",
	[SexualPosition.VersTop]: "Vers Top",
	[SexualPosition.Side]: "Side",
};

export const sexualPositionSchema = z.nativeEnum(SexualPosition);

export type SexualPositionId = z.infer<typeof sexualPositionSchema>;

export const LookingFor = {
	Chat: 2,
	Dates: 3,
	Friends: 4,
	Networking: 5,
	Relationship: 6,
	Hookups: 7,
} as const;

export const lookingFor = {
	[LookingFor.Chat]: "Chat",
	[LookingFor.Dates]: "Dates",
	[LookingFor.Friends]: "Friends",
	[LookingFor.Networking]: "Networking",
	[LookingFor.Relationship]: "Relationship",
	[LookingFor.Hookups]: "Hookups",
} as const;

export const lookingForSchema = z.nativeEnum(LookingFor);

export type LookingForId = z.infer<typeof lookingForSchema>;

export const AcceptNSFWPics = {
	Never: 1,
	NotAtFirst: 2,
	YesPlease: 3,
} as const;

export const acceptNSFWPics = {
	[AcceptNSFWPics.Never]: "Never",
	[AcceptNSFWPics.NotAtFirst]: "Not At First",
	[AcceptNSFWPics.YesPlease]: "Yes Please",
} as const;

export const acceptNSFWPicsSchema = z.nativeEnum(AcceptNSFWPics);

export type AcceptNSFWPicsId = z.infer<typeof acceptNSFWPicsSchema>;

export const RelationshipStatus = {
	Single: 1,
	Dating: 2,
	Exclusive: 3,
	Committed: 4,
	Partnered: 5,
	Engaged: 6,
	Married: 7,
	OpenRelationship: 8,
} as const;

export const relationshipStatuses = {
	[RelationshipStatus.Single]: "Single",
	[RelationshipStatus.Dating]: "Dating",
	[RelationshipStatus.Exclusive]: "Exclusive",
	[RelationshipStatus.Committed]: "Committed",
	[RelationshipStatus.Partnered]: "Partnered",
	[RelationshipStatus.Engaged]: "Engaged",
	[RelationshipStatus.Married]: "Married",
	[RelationshipStatus.OpenRelationship]: "Open Relationship",
} as const;

export const relationshipStatusSchema = z.nativeEnum(RelationshipStatus);

export type RelationshipStatusId = z.infer<typeof relationshipStatusSchema>;

export const BodyType = {
	Toned: 1,
	Average: 2,
	Large: 3,
	Muscular: 4,
	Slim: 5,
	Stocky: 6,
} as const;

export const bodyTypes = {
	[BodyType.Toned]: "Toned",
	[BodyType.Average]: "Average",
	[BodyType.Large]: "Large",
	[BodyType.Muscular]: "Muscular",
	[BodyType.Slim]: "Slim",
	[BodyType.Stocky]: "Stocky",
} as const;

export const bodyTypeSchema = z.nativeEnum(BodyType);

export type BodyTypeId = z.infer<typeof bodyTypeSchema>;

export const Tribe = {
	Bear: 1,
	CleanCut: 2,
	Daddy: 3,
	Discreet: 4,
	Geek: 5,
	Jock: 6,
	Leather: 7,
	Otter: 8,
	Poz: 9,
	Rugged: 10,
	Trans: 11,
	Twink: 12,
	Sober: 13,
} as const;

export const tribes = {
	[Tribe.Bear]: "Bear",
	[Tribe.CleanCut]: "Clean-Cut",
	[Tribe.Daddy]: "Daddy",
	[Tribe.Discreet]: "Discreet",
	[Tribe.Geek]: "Geek",
	[Tribe.Jock]: "Jock",
	[Tribe.Leather]: "Leather",
	[Tribe.Otter]: "Otter",
	[Tribe.Poz]: "Poz",
	[Tribe.Rugged]: "Rugged",
	[Tribe.Sober]: "Sober",
	[Tribe.Trans]: "Trans",
	[Tribe.Twink]: "Twink",
} as const;

export const tribeSchema = z.nativeEnum(Tribe);

export type TribeId = z.infer<typeof tribeSchema>;

export const MeetAt = {
	MyPlace: 1,
	YourPlace: 2,
	Bar: 3,
	CoffeeShop: 4,
	Restaurant: 5,
} as const;

export const meetAt = {
	[MeetAt.MyPlace]: "My Place",
	[MeetAt.YourPlace]: "Your Place",
	[MeetAt.Bar]: "Bar",
	[MeetAt.CoffeeShop]: "Coffee Shop",
	[MeetAt.Restaurant]: "Restaurant",
} as const;

export const meetAtSchema = z.nativeEnum(MeetAt);

export type MeetAtId = z.infer<typeof meetAtSchema>;

export const Ethnicity = {
	Asian: 1,
	Black: 2,
	Latino: 3,
	MiddleEastern: 4,
	Mixed: 5,
	NativeAmerican: 6,
	White: 7,
	Other: 8,
	SouthAsian: 9,
} as const;

export const ethnicities = {
	[Ethnicity.Asian]: "Asian",
	[Ethnicity.Black]: "Black",
	[Ethnicity.Latino]: "Latino",
	[Ethnicity.MiddleEastern]: "Middle Eastern",
	[Ethnicity.Mixed]: "Mixed",
	[Ethnicity.NativeAmerican]: "Native American",
	[Ethnicity.White]: "White",
	[Ethnicity.Other]: "Other",
	[Ethnicity.SouthAsian]: "South Asian",
} as const;

export const ethnicitySchema = z.nativeEnum(Ethnicity);

export type EthnicityId = z.infer<typeof ethnicitySchema>;

export const HivStatus = {
	Negative: 1,
	NegativeOnPrep: 2,
	Positive: 3,
	PositiveUndetectable: 4,
} as const;

export const hivStatuses = {
	[HivStatus.Negative]: "Negative",
	[HivStatus.NegativeOnPrep]: "Negative, on PrEP",
	[HivStatus.Positive]: "Positive",
	[HivStatus.PositiveUndetectable]: "Positive, undetectable",
} as const;

export const hivStatusSchema = z.nativeEnum(HivStatus);

export type HivStatusId = z.infer<typeof hivStatusSchema>;

export const HealthPractice = {
	Condoms: 1,
	DoxyPEP: 2,
	PrEP: 3,
	HIVUndetectable: 4,
	PreferToDiscuss: 5,
} as const;

export const healthPractices = {
	[HealthPractice.Condoms]: "Condoms",
	[HealthPractice.DoxyPEP]: "I'm on doxyPEP",
	[HealthPractice.PrEP]: "I'm on PrEP",
	[HealthPractice.HIVUndetectable]: "I'm HIV undetectable",
	[HealthPractice.PreferToDiscuss]: "Prefer to discuss",
} as const;

export const healthPracticesSchema = z.nativeEnum(HealthPractice);

export type HealthPracticeId = z.infer<typeof healthPracticesSchema>;

export const Vaccine = {
	COVID19: 1,
	Monkeypox: 2,
	Meningitis: 3,
} as const;

export const vaccines = {
	[Vaccine.COVID19]: "COVID-19",
	[Vaccine.Monkeypox]: "Monkeypox",
	[Vaccine.Meningitis]: "Meningitis",
} as const;

export const vaccinesSchema = z.nativeEnum(Vaccine);

export type VaccineId = z.infer<typeof vaccinesSchema>;

export const socialNetworksSchema = z.preprocess(
	(val) => (Array.isArray(val) ? {} : val),
	z.object({
		twitter: z
			.object({
				userId: z.string().nullable(),
			})
			.optional(),
		facebook: z
			.object({
				userId: z.string().nullable(),
			})
			.optional(),
		instagram: z
			.object({
				userId: z.string().nullable(),
			})
			.optional(),
	}),
);

export type SocialNetworks = z.infer<typeof socialNetworksSchema>;

export const rightNowMediaSchema = z.object({
	mediaId: z.number().int().nullable(),
	thumbnailUrl: z.string(),
	fullImageUrl: z.string(),
	contentType: z.string(),
	isNsfw: z.boolean().nullable(),
});

export type RightNowMedia = z.infer<typeof rightNowMediaSchema>;

export const travelPlanSchema = z.object({
	endDateUtc: z.number().nullable(),
	geohash: z.string(),
	id: z.number().int().nullable(),
	locationName: z.string(),
	showOnProfile: z.boolean().nullable(),
	startDateUtc: z.number().nullable(),
});

export type TravelPlan = z.infer<typeof travelPlanSchema>;

export const profileMaskedMinSchema = z.object({
	distance: z.number().nonnegative().nullable(),
	profileImageMediaHash: mediaHashPublicSchema.nullable(),
	isFavorite: z.boolean(),
});

export const profileMaskedSchema = profileMaskedMinSchema.extend({
	lastViewed: z.number().nullable(),
	seen: z.number().nonnegative().nullable(),
	rightNow: rightNowStatusSchema,
	sexualPosition: sexualPositionSchema.nullable().optional().catch(null),
	foundVia: viewSourceEnumSchema.nullable().optional().catch(null),
});

/**
 * A profile id that is a real, positive integer.
 *
 * `z.coerce.number().int().nonnegative()` is the trap this replaces: coercion
 * runs BEFORE the checks, and `Number(null) === 0` and `Number("") === 0`, so a
 * `null` or an empty string sailed through `.nonnegative()` and MANUFACTURED
 * profile 0 — the exact `/profile/0` bug that was fixed downstream in v0.1.33,
 * only to be able to reappear here at the parse layer. v0.1.33's link fix
 * guards the route; this guards the data.
 *
 * `.positive()` alone would reject a genuine 0 but NOT `null`, because
 * `Number(null)` is 0, which is still not positive... it is. Being explicit is
 * cheaper than reasoning about which single check happens to cover `null`:
 * reject the two coercible-to-zero inputs by name, then coerce, then require a
 * positive integer.
 */
const profileIdSchema = z.preprocess(
	(val) => {
		if (val === null || val === undefined) return val;
		if (typeof val === "string" && val.trim() === "") return Number.NaN;
		return val;
	},
	z.coerce.number().int().positive(),
);

export const profileMinSchema = z.object({
	profileId: profileIdSchema,
	displayName: z.string().nullable(),
	onlineUntil: z.number().nullable().optional(),
});

export const profileShortSchema = profileMaskedSchema
	.extend(profileMinSchema.shape)
	.extend({
		age: z.number().int().nonnegative().nullable(),
		showAge: z.boolean(),
		showDistance: z.boolean(),
		approximateDistance: z.boolean(),
		lastChatTimestamp: z.number().nullable(),
		isNew: z.boolean(),
		lastUpdatedTime: z.number().nonnegative(),
		medias: z.array(
			z.object({
				mediaHash: mediaHashPublicSchema,
				type: z.number().int().nonnegative(),
				state: z.number().int().nonnegative(),
				reason: z.string().nullable(),
				takenOnGrindr: z.boolean().nullable(),
				createdAt: z.number().nonnegative().nullable(),
			}),
		),
	});

// Filters an array to only values the enum accepts — silently drops unknown values.
function safeEnumArray<T extends z.ZodEnum<z.util.EnumLike>>(schema: T) {
	return z.array(z.unknown()).transform(
		(arr) => arr.filter((v) => schema.safeParse(v).success) as z.infer<T>[],
	);
}

// Render caps. `ProfileTags.svelte` renders `profileTags` in an unkeyed
// `{#each}` and the server is not obliged to keep these lists short, so an
// unbounded array is a render/perf hazard as well as a parse hazard.
const MAX_PROFILE_TAGS = 64;
const MAX_TRAVEL_PLANS = 16;
const MAX_RIGHT_NOW_MEDIAS = 16;

export const profileFieldsSchema = z.object({
	meetAt: safeEnumArray(meetAtSchema).optional(),
	vaccines: safeEnumArray(vaccinesSchema).optional(),
	genders: z.array(z.number().int().nonnegative()).optional(),
	pronouns: z.array(z.number().int().nonnegative()).optional(),
});

export const profileRightNowSchema = z.object({
	// Right-now status is a transient, opt-in field. A user who has not posted
	// one legitimately has none of these, so none of them may be required.
	rightNowText: z.string().nullable().optional(),
	rightNowPosted: z.number().nullable().optional(),
	rightNowDistance: z.number().nullable().optional(),
	rightNowThumbnailUrl: z.string().nullable().optional(),
	rightNowFullImageUrl: z.string().nullable().optional(),
});

export const profileExtraFields = z.object({
	// Same tolerance as `profileSchema`'s tail: none of these are load-bearing
	// for rendering, and a single missing one must not fail the whole profile.
	// `nsfw` IS rendered, so consumers branch on `!= null`.
	nsfw: acceptNSFWPicsSchema.nullable().optional(),
	verifiedInstagramId: z.string().nullable().optional(),
	isBlockable: z.boolean().nullable().optional(),
	showTribes: z.boolean().optional(),
	showPosition: z.boolean().optional(),
});

export const profileSchema = profileShortSchema
	.extend(profileFieldsSchema.shape)
	.extend(profileRightNowSchema.shape)
	.extend(profileExtraFields.shape)
	.extend({
		// `aboutMe` is a free-text field, not an enum: an empty profile genuinely
		// omits it. Optional so its absence can't fail the whole profile.
		aboutMe: z.string().nullable().optional(),
		ethnicity: ethnicitySchema.nullable().catch(null),
		relationshipStatus: relationshipStatusSchema.nullable().catch(null),
		// Multi-selects. `safeEnumArray` already drops values the enum rejects;
		// making them optional additionally means an account that has never set
		// them (the common case) can't fail the whole profile. Consumers read
		// them with `?? []` / `.length`, all inside this partition.
		grindrTribes: safeEnumArray(tribeSchema).optional(),
		lookingFor: safeEnumArray(lookingForSchema).optional(),
		bodyType: bodyTypeSchema.nullable().catch(null),
		hivStatus: hivStatusSchema.nullable().catch(null),
		// --- Optional / tolerant tail (D7) ---------------------------------
		//
		// Everything below used to be REQUIRED, which made the whole profile
		// all-or-nothing: one missing key anywhere and the entire profile fails
		// to parse, so the profile screen renders "Failed to load profile" for a
		// field the user never even looks at. This is exactly the trap
		// `cascadeV3ResponseProfileSchema` was explicitly fixed for ("a single
		// server-side shape change can't fail the profile's parse") — the fix was
		// applied to the cascade and never to the profile endpoint.
		//
		// Two levels of leniency are used, chosen PER FIELD by how wrong a
		// default can be:
		//
		//   `.optional()`   — the field is genuinely absent for many real
		//                     profiles (nothing set it) AND a wrong value is
		//                     harmless because consumers already handle
		//                     `undefined` (they render conditionally, or the
		//                     field is pure decoration). Keeps the property
		//                     genuinely absent, so `!== null` style checks in
		//                     templates keep working.
		//
		//   `.catch(<def>)` — the field is USED, and a missing value would put
		//                     `undefined` into a rendered string or an arithmetic
		//                     expression. Coerce to an explicit safe value so no
		//                     consumer can crash on it.
		//   `.optional()`   — the field is genuinely absent for many real
		//                     profiles (nothing set it) AND a wrong value is
		//                     harmless because consumers branch with `!= null`
		//                     (loose), which covers `undefined` and `null` alike.
		//                     Keeps the property genuinely absent rather than
		//                     inventing a value the server never sent.
		//
		//   `.catch(<def>)` — the field is USED, and a missing value would put
		//                     `undefined` into a rendered string or an arithmetic
		//                     expression. Coerce to an explicit safe value so no
		//                     consumer can crash on it.
		lastTestedDate: z.number().nullable().optional(),
		// A profile with no height/weight is a perfectly good profile. Both
		// consumers (`HeightWeightBodyType`, `EditProfileSheet`) branch on the
		// value, so absent is safe and honest.
		height: z.number().nullable().optional(),
		weight: z.number().nullable().optional(),
		socialNetworks: socialNetworksSchema.optional(),
		identity: z.unknown().nullable().optional(),
		// Unbounded arrays are a render hazard, not just a parse hazard:
		// `ProfileTags.svelte` renders every tag in an unkeyed `{#each}`. Cap
		// them, and drop entries that are not strings rather than rendering
		// "[object Object]".
		hashtags: z.array(z.unknown()).max(MAX_PROFILE_TAGS).optional(),
		profileTags: z.array(z.string()).max(MAX_PROFILE_TAGS).optional(),
		// Pure decoration (throb/tap/roam badges). Never read for anything but
		// "is it set", so absent is indistinguishable from false.
		tapped: z.boolean().optional(),
		tapType: z.union([z.boolean(), z.number()]).nullable().catch(null),
		lastReceivedTapTimestamp: z.number().nullable().optional(),
		isTeleporting: z.boolean().optional(),
		isRoaming: z.boolean().optional(),
		arrivalDays: z.number().nullable().optional(),
		// Read by the grid tile's unread badge, which does `unread !== null &&
		// unread > 0` — `undefined > 0` is false, so optional is safe. BUT the
		// grid's own cascade schema already uses `.catch(0)`, and matching it
		// keeps the two representations of "unread count" identical.
		unreadCount: z.number().catch(0),
		// Never read (the grid and profile both use `onlineUntil`), and its type
		// is `unknown` upstream, so it cannot be validated at all.
		lastThrobTimestamp: z.unknown().optional(),
		sexualHealth: safeEnumArray(healthPracticesSchema).optional(),
		isVisiting: z.boolean().optional(),
		travelPlans: z.array(travelPlanSchema).max(MAX_TRAVEL_PLANS).optional(),
		isInAList: z.boolean().optional(),
		tribesImInto: safeEnumArray(tribeSchema).nullable().catch(null),
		showVipBadge: z.boolean().optional(),
		rightNowShareLocation: z.literal("NONE").nullable().catch(null),
		// Rendered by the right-now strip; `.catch([])` so a shape change there
		// degrades to "no right-now media" rather than failing the profile.
		rightNowMedias: z.array(rightNowMediaSchema).max(MAX_RIGHT_NOW_MEDIAS).catch(
			[],
		),
	});

export type Profile = z.infer<typeof profileSchema>;
