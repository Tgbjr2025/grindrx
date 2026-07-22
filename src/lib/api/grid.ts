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
	).then((res) =>
		res.jsonParsed(
			z.object({
				// Drop + log a single drifted profile instead of throwing the whole
				// search (same tolerance as the v3 cascade and getProfiles).
				profiles: z.array(z.unknown()).transform((raw) =>
					raw.flatMap((p) => {
						const r = searchProfileSchema.safeParse(p);
						if (r.success) return [r.data];
						console.warn("[GrindrX] dropping unparseable search profile", {
							issue: r.error.issues[0],
						});
						return [];
					}),
				),
			}),
		),
	);
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
