import z from "zod";

import { fetchRest } from "$lib/api";
import {
	profileTagCategorySchema,
	profileTagLanguageSchema,
	profileTagSchema,
} from "$lib/model/tags";

/**
 * `GET /v1/tags` — the profile-tag reference list (WP-7).
 *
 * Documented at `docs/content/grindr-api/users/profiles.md` § "Profile tags".
 * The response is a TOP-LEVEL ARRAY of per-language groups (there is no
 * `{ tags: … }` envelope), each with a `categoryCollection`, each of which has a
 * `tags` array. Schema shapes live in `$lib/model/tags`; only the tolerance below
 * is endpoint behaviour, so it stays here.
 *
 * TOLERANCE, applied per entry at all three levels: this is a list endpoint, and
 * the house rule is that one drifted item costs one item, not the whole load —
 * see `conversationsSchema` in `$lib/api/conversation` and `tolerantArray` in
 * `$lib/api/album`. Tag data grows server-side without notice, so an unrecognised
 * field or a new item type must not blank the picker. This helper is a THIRD
 * local copy of that transform (after those two); consolidating them is a
 * follow-up, not something to do inside an endpoint package.
 *
 * The ROOT shape is NOT swallowed. If the payload stops being an array, that is a
 * contract change worth failing loudly on — an empty tag list is indistinguishable
 * from "this account has no tags", and a silent `[]` would hide the drift.
 */
function dropUnparseable<TItem extends z.ZodType>(item: TItem, label: string) {
	return z
		.array(z.unknown())
		.transform((raw) =>
			raw.flatMap((entry) => {
				const result = item.safeParse(entry);
				if (result.success) return [result.data];
				console.warn(`[GrindrX] dropping unparseable ${label}`, {
					issue: result.error.issues[0],
				});
				return [];
			}),
		);
}

const tolerantTagSchema = dropUnparseable(profileTagSchema, "profile tag");

const tolerantCategorySchema = profileTagCategorySchema.extend({
	tags: tolerantTagSchema,
});

const tolerantCategoryCollectionSchema = dropUnparseable(
	tolerantCategorySchema,
	"tag category",
);

const profileTagsResponseSchema = dropUnparseable(
	profileTagLanguageSchema.extend({
		categoryCollection: tolerantCategoryCollectionSchema,
	}),
	"tag language group",
);

/**
 * Load the profile-tag reference data.
 *
 * Returns one entry per language the server offers, each with its categories and
 * their tags, with any unparseable entry dropped and logged rather than thrown.
 *
 * Not cached: this module is deliberately minimal (WP-7 is the smallest package in
 * the set). `getGenders` in `$lib/api/genders` is the in-repo precedent if a cache
 * is ever wanted — reference data does not change within a session.
 */
export async function getProfileTags() {
	return await fetchRest("/v1/tags", { method: "GET" }).then((res) =>
		res.jsonParsed(profileTagsResponseSchema),
	);
}
