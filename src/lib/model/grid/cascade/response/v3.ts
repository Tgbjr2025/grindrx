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
	// Only the fields the grid actually consumes (profileId, displayName,
	// distanceMeters, photoMediaHashes, unreadCount, onlineUntil) need to be
	// dependable. Everything else is made tolerant so a single server-side
	// shape change can't fail the profile's parse and blank the grid — the
	// strict schema was an all-or-nothing trap (see parseApiResponse, which
	// throws on any mismatch).
	onlineUntil: unixTimestampMsSchema.nullable().optional(),
	rightNow: z.string().nullable().optional(),
	unreadCount: z.number().int().nonnegative().catch(0),
	isVisiting: z.boolean().optional(),
	isPopular: z.boolean().optional(),
	lastOnline: unixTimestampMsSchema.nullable().optional(),
	photoMediaHashes: z.array(mediaHashPublicSchema).nullable().optional(),
	lookingFor: z.array(lookingForSchema).nullable().optional(),
	sexualPosition: sexualPositionSchema.optional(),
	approximateDistance: z.boolean().optional(),
	isFavorite: z.boolean().optional(),
	isBoosting: z.boolean().optional(),
	hasChattedInLast24Hrs: z.boolean().optional(),
	hasUnviewedSpark: z.boolean().optional(),
	isTeleporting: z.boolean().optional(),
	isRoaming: z.boolean().optional(),
	isRightNow: z.boolean().optional(),
	hasUnreadThrob: z.boolean().optional(),
	isBlockable: z.boolean().optional(),
	isBoostingSomewhereElse: z.boolean().optional(),
});

export const cascadeV3ResponseFullProfileV1Schema = z.object({
	...cascadeResponseFullProfileV1Schema.shape,
	data: z.object({
		...cascadeResponseFullProfileV1Schema.shape.data.shape,
		...cascadeV3ResponseProfileSchema.shape,
		"@type": z.literal("CascadeItemData$FullProfileV1"),
		tribes: z.array(tribeSchema).optional(),
		socialNetworks: socialNetworksSchema.optional(),
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
	// Tolerate top-level shape drift so the grid still renders.
	nextPage: z.number().int().nonnegative().nullable().catch(null),
	shuffled: z.boolean().catch(false),
	// Parse each cascade item independently: an unrecognised item `type` (Grindr
	// adds these regularly) or a single malformed profile must not throw out the
	// entire response and blank the grid. Unparseable items are dropped + logged.
	items: z.array(z.unknown()).transform((rawItems) =>
		rawItems.flatMap((raw) => {
			const result = cascadeV3ResponseItemSchema.safeParse(raw);
			if (result.success) return [result.data];
			console.warn("[GrindrX] dropping unparseable cascade item", {
				type: (raw as { type?: unknown } | null)?.type,
				issue: result.error.issues[0],
			});
			return [];
		}),
	),
});
