import z from "zod";
import { fetchRest } from "$lib/api";
import { urlSearchParamsCodec } from "$lib/utils";
import { searchProfileSchema, searchQuerySchema } from "$lib/model/grid/search";
import {
	cascadeV3QuerySchema,
	cascadeV3ResponseItemSchema,
	cascadeV4ResponseItemSchema,
} from "$lib/model/grid/cascade";

export async function searchProfiles(query: z.infer<typeof searchQuerySchema>) {
	return await fetchRest(
		"/v7/search?" +
			new URLSearchParams(
				urlSearchParamsCodec(searchQuerySchema).encode(query),
			),
	)
		.then((res) => res.json())
		.then((data) =>
			z
				.object({
					profiles: z.array(searchProfileSchema),
				})
				.parse(data),
		);
}

export const cascadeV3ResponseSchema = z.object({
	items: z.array(cascadeV3ResponseItemSchema),
	nextPage: z.number().int().nonnegative(),
	shuffled: z.boolean(),
	hiddenProfiles: z.unknown(),
	hiddenProfileInfo: z.unknown(),
});

export const cascadeV4ResponseSchema = z.object({
	items: z.array(cascadeV4ResponseItemSchema),
	nextPage: z.number().int().nonnegative(),
	shuffled: z.boolean(),
	hiddenProfiles: z.unknown(),
	hiddenProfileInfo: z.unknown(),
});

/**
 * Main endpoint used in the source apk. /v4/cascade is currently feature-flagged, /v7/search is only for profile tags
 */
export async function getCascadeV3(
	query: z.infer<typeof cascadeV3QuerySchema>,
) {
	return await fetchRest(
		"/v3/cascade?" +
			new URLSearchParams(
				urlSearchParamsCodec(cascadeV3QuerySchema).encode(query),
			),
	).then((res) => res.jsonParsed(cascadeV3ResponseSchema));
}
