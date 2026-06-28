import z from "zod";

import { bodyTypeSchema } from "$lib/model/profile";
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

const cascadeV4ResponseProfileSchema = z.object({
	...cascadeResponseProfileSchema.shape,
	// Grindr sends relative paths / empty strings here; don't reject a profile
	// over a non-absolute image URL.
	primaryImageUrl: z.url().nullable().catch(null),
	favorite: z.boolean().optional(),
	viewed: z.boolean().optional(),
	chatted: z.boolean().optional(),
	roaming: z.boolean().optional(),
});

export const cascadeV4ResponseFullProfileV1Schema = z.object({
	...cascadeResponseFullProfileV1Schema.shape,
	data: z.object({
		...cascadeResponseFullProfileV1Schema.shape.data.shape,
		...cascadeV4ResponseProfileSchema.shape,
		age: z.number().int().nonnegative().optional(),
		heightCm: z.number().nonnegative().optional(),
		weightGrams: z.number().nonnegative().optional(),
		// Tolerate an unrecognised body-type id rather than dropping the profile.
		bodyType: bodyTypeSchema.nullable().catch(null),
	}),
});

export const cascadeV4ResponseAdvertV1Schema = z.object({
	...cascadeResponseAdvertV1Schema.shape,
});

export const cascadeV4ResponseTopPicksV1Schema = z.object({
	...cascadeResponseTopPicksV1Schema.shape,
});

export const cascadeV4ResponsePartialProfileV1Schema = z.object({
	...cascadeResponsePartialProfileV1Schema.shape,
	data: z.object({
		...cascadeResponsePartialProfileV1Schema.shape.data.shape,
		...cascadeV4ResponseProfileSchema.shape,
	}),
});

export const cascadeV4ResponseExploreAggregationV1Schema = z.object({
	...cascadeResponseExploreAggregationV1Schema.shape,
});

export const cascadeV4ResponseBoostUpsellV1Schema = z.object({
	...cascadeResponseBoostUpsellV1Schema.shape,
});

export const cascadeV4ResponseUnlimitedMpuV1Schema = z.object({
	...cascadeResponseUnlimitedMpuV1Schema.shape,
});

export const cascadeV4ResponseXtraMpuV1Schema = z.object({
	...cascadeResponseXtraMpuV1Schema.shape,
});

export const cascadeV4ResponseFavHeaderV1Schema = z.object({
	...cascadeResponseFavHeaderV1Schema.shape,
});

export const cascadeV4ResponseItemSchema = z.discriminatedUnion("type", [
	cascadeV4ResponseFullProfileV1Schema,
	cascadeV4ResponsePartialProfileV1Schema,
	cascadeV4ResponseAdvertV1Schema,
	cascadeV4ResponseTopPicksV1Schema,
	cascadeV4ResponseExploreAggregationV1Schema,
	cascadeV4ResponseBoostUpsellV1Schema,
	cascadeV4ResponseUnlimitedMpuV1Schema,
	cascadeV4ResponseXtraMpuV1Schema,
	cascadeV4ResponseFavHeaderV1Schema,
]);

export const cascadeV4ResponseSchema = z.object({
	...cascadeResponseSchema.shape,
	// Tolerate top-level shape drift so the grid still renders.
	nextPage: z.number().int().nonnegative().nullable().catch(null),
	shuffled: z.boolean().catch(false),
	// Parse each cascade item independently: an unrecognised item `type` or a
	// single malformed profile must not throw out the entire response and blank
	// the grid. Unparseable items are dropped + logged (mirrors the v3 cascade).
	items: z.array(z.unknown()).transform((rawItems) =>
		rawItems.flatMap((raw) => {
			const result = cascadeV4ResponseItemSchema.safeParse(raw);
			if (result.success) return [result.data];
			console.warn("[GrindrX] dropping unparseable cascade item", {
				type: (raw as { type?: unknown } | null)?.type,
				issue: result.error.issues[0],
			});
			return [];
		}),
	),
});
