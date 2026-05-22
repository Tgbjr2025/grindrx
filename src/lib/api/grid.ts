import z from "zod";

import { fetchRest } from "$lib/api";
import { cascadeV3QuerySchema } from "$lib/model/grid/cascade/query/v3";
import { cascadeV3ResponseSchema } from "$lib/model/grid/cascade/response/v3";
import { searchProfileSchema, searchQuerySchema } from "$lib/model/grid/search";
import { urlSearchParamsCodec } from "$lib/utils";

export async function searchProfiles(query: z.infer<typeof searchQuerySchema>) {
	return await fetchRest(
		"/v7/search?" +
			new URLSearchParams(
				urlSearchParamsCodec(searchQuerySchema).encode(query),
			).toString(),
	).then((res) => res.jsonParsed(z.object({ profiles: z.array(searchProfileSchema) })));
}

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
			).toString(),
	).then((res) => res.jsonParsed(cascadeV3ResponseSchema));
}
