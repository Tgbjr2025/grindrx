import z from "zod";

import { mediaHashPublicSchema } from "$lib/model/media";
import {
	lookingForSchema,
	sexualPositionSchema,
	socialNetworksSchema,
	tribeSchema,
} from "$lib/model/profile";
import { unixTimestampMsSchema } from "$lib/model/types";
import {
	cascadeResponseAdvertV1Schema,
	cascadeResponseBoostUpsellV1Schema,
	cascadeResponseExploreAggregationV1Schema,
	cascadeResponseFavHeaderV1Schema,
	cascadeResponseFullProfileV1Schema,
	cascadeResponsePartialProfileV1Schema,
	cascadeResponseProfileSchema,
	cascadeResponseSchema,
	cascadeResponseTopPicksV1Schema,
	cascadeResponseUnlimitedMpuV1Schema,
	cascadeResponseXtraMpuV1Schema,
} from ".";

const cascadeV3ResponseProfileSchema = z.object({
	...cascadeResponseProfileSchema.shape,
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
	isBlockable: z.boolean().optional(),
	isBoostingSomewhereElse: z.boolean(),
});

export const cascadeV3ResponseFullProfileV1Schema = z.object({
	...cascadeResponseFullProfileV1Schema.shape,
	data: z.object({
		...cascadeResponseFullProfileV1Schema.shape.data.shape,
		...cascadeV3ResponseProfileSchema.shape,
		"@type": z.literal("CascadeItemData$FullProfileV1"),
		tribes: z.array(tribeSchema),
		socialNetworks: socialNetworksSchema,
		takenOnGrindrMetadata: z
			.record(
				mediaHashPublicSchema,
				z.object({
					takenOnGrindr: z.boolean(),
					createdAt: unixTimestampMsSchema.nullable(),
				}),
			)
			.optional(),
	}),
});

export const cascadeV3ResponseAdvertV1Schema = z.object({
	...cascadeResponseAdvertV1Schema.shape,
	data: z.object({
		"@type": z.literal("CascadeItemData$Advert"),
		...cascadeResponseAdvertV1Schema.shape.data.shape,
	}),
});

export const cascadeV3ResponseTopPicksV1Schema = z.object({
	...cascadeResponseTopPicksV1Schema.shape,
	data: z.object({
		"@type": z.literal("CascadeItemData$TopPicksV1"),
		...cascadeResponseTopPicksV1Schema.shape.data.shape,
	}),
});

export const cascadeV3ResponsePartialProfileV1Schema = z.object({
	...cascadeResponsePartialProfileV1Schema.shape,
	data: z.object({
		...cascadeResponsePartialProfileV1Schema.shape.data.shape,
		...cascadeV3ResponseProfileSchema.shape,
		"@type": z.literal("CascadeItemData$PartialProfileV1"),
	}),
});
export const cascadeV3ResponseExploreAggregationV1Schema = z.object({
	...cascadeResponseExploreAggregationV1Schema.shape,
	data: z.object({
		...cascadeResponseExploreAggregationV1Schema.shape.data.shape,
		"@type": z.literal("CascadeItemData$ExploreAggregationV1"),
	}),
});

export const cascadeV3ResponseBoostUpsellV1Schema = z.object({
	...cascadeResponseBoostUpsellV1Schema.shape,
	data: z.object({
		...cascadeResponseBoostUpsellV1Schema.shape.data.shape,
		"@type": z.literal("CascadeItemData$BoostUpsellV1"),
	}),
});

export const cascadeV3ResponseUnlimitedMpuV1Schema = z.object({
	...cascadeResponseUnlimitedMpuV1Schema.shape,
	data: z.object({
		...cascadeResponseUnlimitedMpuV1Schema.shape.data.shape,
		"@type": z.literal("CascadeItemData$UnlimitedMpuV1"),
	}),
});

export const cascadeV3ResponseXtraMpuV1Schema = z.object({
	...cascadeResponseXtraMpuV1Schema.shape,
	data: z.object({
		...cascadeResponseXtraMpuV1Schema.shape.data.shape,
		"@type": z.literal("CascadeItemData$XtraMpuV1"),
	}),
});

export const cascadeV3ResponseFavHeaderV1Schema = z.object({
	...cascadeResponseFavHeaderV1Schema.shape,
	data: z.object({
		...cascadeResponseFavHeaderV1Schema.shape.data.shape,
		"@type": z.literal("CascadeItemData$FavHeaderV1"),
	}),
});

export const cascadeV3ResponseItemSchema = z.discriminatedUnion("type", [
	cascadeV3ResponseFullProfileV1Schema,
	cascadeV3ResponsePartialProfileV1Schema,
	cascadeV3ResponseAdvertV1Schema,
	cascadeV3ResponseTopPicksV1Schema,
	cascadeV3ResponseExploreAggregationV1Schema,
	cascadeV3ResponseBoostUpsellV1Schema,
	cascadeV3ResponseUnlimitedMpuV1Schema,
	cascadeV3ResponseXtraMpuV1Schema,
	cascadeV3ResponseFavHeaderV1Schema,
]);

export const cascadeV3ResponseSchema = z.object({
	...cascadeResponseSchema.shape,
	items: z.array(cascadeV3ResponseItemSchema),
});
