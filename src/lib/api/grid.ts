import z from "zod";

import { fetchRest } from "$lib/api";
import { rememberProfileIdentities } from "$lib/app-data/profile-identity-cache.svelte";
import { cascadeV3QuerySchema } from "$lib/model/grid/cascade/query/v3";
import { cascadeV3ResponseSchema } from "$lib/model/grid/cascade/response/v3";
import { searchProfileSchema, searchQuerySchema } from "$lib/model/grid/search";
import { urlSearchParamsCodec } from "$lib/utils";

/**
 * The sign-out surface for the grid's resolved-profile cache.
 *
 * Re-exported here, and NOT called here, on purpose. `purgeAccountLocalData()`
 * (in `$lib/app-data/`) enumerates the caches sign-out has to erase, and this is
 * the grid entry in that list; it imports it from the grid API module so the
 * purge has ONE grid import to reach, the same way it reaches the authenticated
 * media cache. The cache itself lives in `$lib/model/grid/profile-cache.ts`
 * because a cache that lives in a route leaf (`(root)/grid.ts` did) is
 * unreachable from the purge by construction — see that file's header for the
 * measured leak this re-export exists to close.
 *
 * Exported as a named re-export rather than `export *` so that what the purge
 * can reach is a visible, reviewable list, not whatever the module happens to
 * grow next month.
 */
export {
	cacheProfile,
	clearProfileCache,
	currentGridCacheEpoch,
	isGridCacheEpochCurrent,
	MAX_PROFILE_CACHE,
	purgeGridProfileCache,
	profileCache,
	resolveAndCacheGridProfiles,
	type FullGridProfile,
	type GridProfile,
	type PartialGridProfile,
} from "$lib/model/grid/profile-cache";

export async function searchProfiles(query: z.infer<typeof searchQuerySchema>) {
	// Feed the hash -> profileId index from the parsed results. Search is one of
	// the places the user legitimately discovers a profile, and the response's
	// `profileImageMediaHash` is the same field masked viewer rows carry — so a
	// profile found this way can be linked back from a masked viewer later.
	// Done at the parse boundary so it is recorded once per response rather than
	// per component that happens to render a search result.
	const result = await fetchRest(
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
	rememberProfileIdentities(result.profiles);
	return result;
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
