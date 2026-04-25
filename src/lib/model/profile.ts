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

export const sexualPositionSchema = z.enum(SexualPosition);

export type SexualPositionId = keyof typeof sexualPositions;

export const lookingForOptions = {
	2: "Chat",
	3: "Dates",
	4: "Friends",
	5: "Networking",
	6: "Relationship",
	7: "Hookups",
} as const;

export const lookingForOptionSchema = z.union(
	Object.keys(lookingForOptions).map((key) =>
		z.literal(Number(key) as keyof typeof lookingForOptions),
	),
);

export type LookingForOptionId = keyof typeof lookingForOptions;

export const acceptNSFWPicsOptions = {
	1: "Never",
	2: "Not At First",
	3: "Yes Please",
} as const;

export const acceptNSFWPicsOptionSchema = z.union(
	Object.keys(acceptNSFWPicsOptions).map((key) =>
		z.literal(Number(key) as keyof typeof acceptNSFWPicsOptions),
	),
);

export type AcceptNSFWPicsOptionId = keyof typeof acceptNSFWPicsOptions;

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

export const relationshipStatusSchema = z.union(
	Object.keys(relationshipStatuses).map((key) =>
		z.literal(Number(key) as keyof typeof relationshipStatuses),
	),
);

export type RelationshipStatusId = keyof typeof relationshipStatuses;

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

export type BodyTypeId = keyof typeof bodyTypes;

export const bodyTypeSchema = z.union(
	Object.keys(bodyTypes).map((key) =>
		z.literal(Number(key) as keyof typeof bodyTypes),
	),
);

export const Tribes = {
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
	Sober: 11,
	Trans: 12,
	Twink: 13,
} as const;

export const tribes = {
	[Tribes.Bear]: "Bear",
	[Tribes.CleanCut]: "Clean-Cut",
	[Tribes.Daddy]: "Daddy",
	[Tribes.Discreet]: "Discreet",
	[Tribes.Geek]: "Geek",
	[Tribes.Jock]: "Jock",
	[Tribes.Leather]: "Leather",
	[Tribes.Otter]: "Otter",
	[Tribes.Poz]: "Poz",
	[Tribes.Rugged]: "Rugged",
	[Tribes.Sober]: "Sober",
	[Tribes.Trans]: "Trans",
	[Tribes.Twink]: "Twink",
} as const;

export const tribeSchema = z.union(
	Object.keys(tribes).map((key) =>
		z.literal(Number(key) as keyof typeof tribes),
	),
);

export type TribeId = keyof typeof tribes;

export const meetAtOptions = {
	1: "My Place",
	2: "Your Place",
	3: "Bar",
	4: "Coffee Shop",
	5: "Restaurant",
} as const;

export const meetAtOptionsSchema = z.union(
	Object.keys(meetAtOptions).map((key) =>
		z.literal(Number(key) as keyof typeof meetAtOptions),
	),
);

export type MeetAtOptionId = keyof typeof meetAtOptions;

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

export const ethnicitySchema = z.union(
	Object.keys(ethnicities).map((key) =>
		z.literal(Number(key) as keyof typeof ethnicities),
	),
);

export type EthnicityId = keyof typeof ethnicities;

export const hivStatuses = {
	1: "Negative",
	2: "Negative, on PrEP",
	3: "Positive",
	4: "Positive, undetectable",
} as const;

export const hivStatusSchema = z.union(
	Object.keys(hivStatuses).map((key) =>
		z.literal(Number(key) as keyof typeof hivStatuses),
	),
);

export type HivStatusId = keyof typeof hivStatuses;

export const healthPracticesOptions = {
	1: "Condoms",
	2: "I'm on doxyPEP",
	3: "I'm on PrEP",
	4: "I'm HIV undetectable",
	5: "Prefer to discuss",
} as const;

export const healthPracticesOptionsSchema = z.union(
	Object.keys(healthPracticesOptions).map((key) =>
		z.literal(Number(key) as keyof typeof healthPracticesOptions),
	),
);

export type HealthPracticeOptionId = keyof typeof healthPracticesOptions;

export const vaccinesOptions = {
	1: "COVID-19",
	2: "Monkeypox",
	3: "Meningitis",
} as const;

export const vaccinesOptionsSchema = z.union(
	Object.keys(vaccinesOptions).map((key) =>
		z.literal(Number(key) as keyof typeof vaccinesOptions),
	),
);

export type VaccineOptionId = keyof typeof vaccinesOptions;

export const socialNetworksSchema = z.object({
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
});

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
	seen: z.number().int().nonnegative().nullable(),
	sexualPosition: sexualPositionSchema.nullable(),
	foundVia: viewSourceEnumSchema.nullable(),
	rightNow: rightNowStatusSchema,
});

export const profileMinSchema = z.object({
	profileId: z.coerce.number().int().nonnegative(),
	displayName: z.string().nullable(),
	onlineUntil: z.number().nullable(),
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

export const profileFieldsSchema = z.object({
	meetAt: z.array(meetAtOptionsSchema),
	vaccines: z.array(vaccinesOptionsSchema),
	genders: z.array(z.number().int().nonnegative()),
	pronouns: z.array(z.number().int().nonnegative()),
});

export const profileSchema = profileShortSchema
	.extend(profileFieldsSchema.shape)
	.extend({
		aboutMe: z.string().nullable(),
		ethnicity: ethnicitySchema.nullable(),
		relationshipStatus: relationshipStatusSchema.nullable(),
		grindrTribes: z.array(tribeSchema),
		lookingFor: z.array(lookingForOptionSchema),
		bodyType: bodyTypeSchema.nullable(),
		hivStatus: hivStatusSchema.nullable(),
		lastTestedDate: z.number().nullable(),
		height: z.number().nullable(),
		weight: z.number().nullable(),
		socialNetworks: socialNetworksSchema,
		identity: z.unknown().nullable(),
		nsfw: acceptNSFWPicsOptionSchema.nullable(),
		hashtags: z.array(z.unknown()),
		profileTags: z.array(z.string()),
		tapped: z.boolean(),
		tapType: z.boolean().nullable(),
		lastReceivedTapTimestamp: z.number().nullable(),
		isTeleporting: z.boolean(),
		isRoaming: z.boolean(),
		arrivalDays: z.number().nullable(),
		unreadCount: z.number(),
		rightNowText: z.string().nullable(),
		rightNowPosted: z.number().nullable(),
		rightNowDistance: z.number().nullable(),
		rightNowThumbnailUrl: z.string().nullable(),
		rightNowFullImageUrl: z.string().nullable(),
		rightNowShareLocation: z.null(),
		rightNowMedias: z.array(rightNowMediaSchema),
		verifiedInstagramId: z.string().nullable(),
		lastThrobTimestamp: z.unknown(),
		isBlockable: z.boolean(),
		sexualHealth: z.array(healthPracticesOptionsSchema),
		isVisiting: z.boolean(),
		travelPlans: z.array(travelPlanSchema),
		isInAList: z.boolean(),
		showTribes: z.boolean(),
		showPosition: z.boolean(),
		tribesImInto: z.array(tribeSchema).nullable(),
		showVipBadge: z.boolean(),
	});

export type Profile = z.infer<typeof profileSchema>;
