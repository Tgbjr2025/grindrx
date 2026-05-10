import z from "zod";
import {
	filterAcceptNSFWPicsSchema,
	filterBodyTypeSchema,
	filterHealthPracticesSchema,
	filterLookingForSchema,
	filterMeetAtSchema,
	filterPositionSchema,
	filterRelationshipStatusSchema,
	filterTribesSchema,
} from "$lib/components/filters/filters";
import { gridQuerySchema } from "$lib/model/grid";
import { unixTimestampMsSchema } from "$lib/model/types";
import {
	bodyTypeSchema,
	lookingForSchema,
	profileFieldsSchema,
	sexualPositionSchema,
	socialNetworksSchema,
	tribeSchema,
} from "$lib/model/profile";
import { mediaHashPublicSchema } from "$lib/model/media";

export const cascadeQuerySchema = gridQuerySchema.extend({
	onlineOnly: z.boolean().optional(),
	ageMin: z.int().nonnegative().optional(),
	ageMax: z.int().nonnegative().optional(),
	heightCmMin: z.number().nonnegative().optional(),
	heightCmMax: z.number().nonnegative().optional(),
	weightGramsMin: z.number().nonnegative().optional(),
	weightGramsMax: z.number().nonnegative().optional(),
	tribes: filterTribesSchema.optional(),
	lookingFor: filterLookingForSchema.optional(),
	relationshipStatuses: filterRelationshipStatusSchema.optional(),
	bodyTypes: filterBodyTypeSchema.optional(),
	sexualPositions: filterPositionSchema.optional(),
	meetAt: filterMeetAtSchema.optional(),
	nsfwPics: filterAcceptNSFWPicsSchema.optional(),
	tags: z.string().optional(),
	rightNow: z.boolean().optional(),
	favorites: z.boolean().optional(),
	showSponsoredProfiles: z.boolean().optional(),
	shuffle: z.boolean().optional(),
	hot: z.boolean().optional(),
});

export const cascadeV3QuerySchema = cascadeQuerySchema.extend({
	exploreUuid: z.unknown().optional(),
	sexualHealth: filterHealthPracticesSchema.optional(),
});

export const cascadeResponseProfileSchema = z.object({
	profileId: z.number().int().nonnegative(),
	onlineUntil: unixTimestampMsSchema.nullable(),
	displayName: z.string().nullable().optional(),
	distanceMeters: z.number().int().nonnegative().optional(),
	rightNow: z.string(),
	unreadCount: z.number().int().nonnegative(),
	isVisiting: z.boolean(),
	isPopular: z.boolean(),
});

export const cascadeV3ResponseProfileSchema =
	cascadeResponseProfileSchema.extend({
		lastOnline: unixTimestampMsSchema,
		photoMediaHashes: z.array(mediaHashPublicSchema).nullable(),
		lookingFor: z.array(lookingForSchema).nullable(),
		sexualPosition: sexualPositionSchema.optional(),
		approximateDistance: z.boolean().optional(),
		isFavorite: z.boolean(),
		isBoosting: z.boolean(),
		hasChattedInLast24Hrs: z.boolean(),
		hasUnviewedSpark: z.boolean(),
		isTeleporting: z.boolean(),
		isRoaming: z.boolean(),
		isRightNow: z.boolean(),
		hasUnreadThrob: z.boolean(),
		isBlockable: z.boolean(),
		isBoostingSomewhereElse: z.boolean(),
	});

export const cascadeV4ResponseProfileSchema = cascadeResponseProfileSchema.extend({
	primaryImageUrl: z.url(),
	favorite: z.boolean().optional(),
	viewed: z.boolean().optional(),
	chatted: z.boolean().optional(),
	roaming: z.boolean().optional(),
});

export const cascadeV3ResponseProfileFullProfileV1Schema = z.object({
	type: z.literal("full_profile_v1"),
	data: cascadeV3ResponseProfileSchema.extend({
		...profileFieldsSchema.shape,
		"@type": z.literal("CascadeItemData$FullProfileV1"),
		tribes: z.array(tribeSchema),
		socialNetworks: z.array(socialNetworksSchema),
		takenOnGrindrMetadata: z.record(
			mediaHashPublicSchema,
			z.object({
				takenOnGrindr: z.boolean(),
				createdAt: unixTimestampMsSchema.nullable(),
			}),
		).optional(),
	}),
});

export const cascadeV4ResponseProfileFullProfileV1Schema = z.object({
	type: z.literal("full_profile_v1"),
	data: cascadeV3ResponseProfileSchema.extend({
		...profileFieldsSchema.shape,
		age: z.number().int().nonnegative().optional(),
		heightCm: z.number().nonnegative().optional(),
		weightGrams: z.number().nonnegative().optional(),
		bodyType: bodyTypeSchema,
	}),
});

export const cascadeV3ResponsePartialProfileV1Schema = z.object({
	type: z.literal("partial_profile_v1"),
	data: cascadeResponseProfileSchema.extend({
		"@type": z.literal("CascadeItemData$PartialProfileV1"),
		upsellItemType: z.string(),
	}),
});

export const cascadeV4ResponsePartialProfileV1Schema = z.object({
	type: z.literal("partial_profile_v1"),
	data: cascadeV4ResponseProfileSchema.extend({
		upsellItemType: z.string(),
	}),
});

export const cascadeV3ResponseAdvertV1Schema = z.object({
	type: z.literal("advert_v1"),
	data: z.object({
		"@type": z.literal("CascadeItemData$Advert"),
		cascadePlacementName: z.string(),
	}),
});

export const cascadeV4ResponseAdvertV1Schema = z.object({
	type: z.literal("advert_v1"),
	data: z.object({
		cascadePlacementName: z.string(),
	}),
});

export const cascadeV3ResponseTopPicksV1Schema = z.object({
	type: z.literal("top_picks_v1"),
	data: z.object({}),
});

export const cascadeV4ResponseTopPicksV1Schema = z.object({
	type: z.literal("top_picks_v1"),
	data: z.object({}),
});

const exploreAggregationLocationItemSchema = z.object({
	"@type": z.literal("ExploreAggregationItem$Location"),
	data: z.object({
		onlineCount: z.number().int().nonnegative(),
		uuid: z.string(),
		location: z.object({
			id: z.number().int(),
			name: z.string(),
			suffix: z.string(),
			lat: z.number(),
			lon: z.number(),
		}),
		profiles: z.array(z.object({ profileImageUrl: z.url() })),
	}),
});

const exploreAggregationCtaItemSchema = z.object({
	"@type": z.literal("ExploreAggregationItem$Cta"),
});

export const cascadeV3ResponseExploreAggregationV1Schema = z.object({
	type: z.literal("explore_aggregation_v1"),
	data: z.object({
		"@type": z.literal("CascadeItemData$ExploreAggregationV1"),
		uuid: z.string(),
		headerName: z.string(),
		source: z.string(),
		items: z.array(
			z.discriminatedUnion("@type", [
				exploreAggregationLocationItemSchema,
				exploreAggregationCtaItemSchema,
			]),
		),
	}),
});

export const cascadeV4ResponseExploreAggregationV1Schema = z.object({
	type: z.literal("explore_aggregation_v1"),
	data: z.object({
		uuid: z.string(),
		headerName: z.string(),
		source: z.string(),
		items: z.array(
			z.discriminatedUnion("@type", [
				exploreAggregationLocationItemSchema,
				exploreAggregationCtaItemSchema,
			]),
		),
	}),
});

export const cascadeV3ResponseBoostUpsellV1Schema = z.object({
	type: z.literal("boost_upsell_v1"),
	data: z.object({
		"@type": z.literal("CascadeItemData$BoostUpsellV1"),
	}),
});

export const cascadeV4ResponseBoostUpsellV1Schema = z.object({
	type: z.literal("boost_upsell_v1"),
	data: z.object({}),
});

export const cascadeV3ResponseUnlimitedMpuV1Schema = z.object({
	type: z.literal("unlimited_mpu_v1"),
	data: z.object({
		"@type": z.literal("CascadeItemData$UnlimitedMpuV1"),
	}),
});

export const cascadeV4ResponseUnlimitedMpuV1Schema = z.object({
	type: z.literal("unlimited_mpu_v1"),
	data: z.object({}),
});

export const cascadeV3ResponseXtraMpuV1Schema = z.object({
	type: z.literal("xtra_mpu_v1"),
	data: z.object({
		"@type": z.literal("CascadeItemData$XtraMpuV1"),
	}),
});

export const cascadeV4ResponseXtraMpuV1Schema = z.object({
	type: z.literal("xtra_mpu_v1"),
	data: z.object({}),
});

export const cascadeV3ResponseItemSchema = z.discriminatedUnion("type", [
	cascadeV3ResponseProfileFullProfileV1Schema,
	cascadeV3ResponsePartialProfileV1Schema,
	cascadeV3ResponseAdvertV1Schema,
	cascadeV3ResponseTopPicksV1Schema,
	cascadeV3ResponseExploreAggregationV1Schema,
	cascadeV3ResponseBoostUpsellV1Schema,
	cascadeV3ResponseUnlimitedMpuV1Schema,
	cascadeV3ResponseXtraMpuV1Schema,
]);

export const cascadeV4ResponseItemSchema = z.discriminatedUnion("type", [
	cascadeV4ResponseProfileFullProfileV1Schema,
	cascadeV4ResponsePartialProfileV1Schema,
	cascadeV4ResponseAdvertV1Schema,
	cascadeV4ResponseTopPicksV1Schema,
	cascadeV4ResponseExploreAggregationV1Schema,
	cascadeV4ResponseBoostUpsellV1Schema,
	cascadeV4ResponseUnlimitedMpuV1Schema,
	cascadeV4ResponseXtraMpuV1Schema,
]);

