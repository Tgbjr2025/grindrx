import z from "zod";

/**
 * `GET /v1/tags` — the profile-tag reference data the tag picker is built from.
 * Transcribed from `docs/content/grindr-api/users/profiles.md` § "Profile tags".
 *
 * Two shape facts that are easy to get wrong, so they are asserted in
 * `$lib/api/tags`'s tests rather than left to memory:
 *
 *   1. The payload is a TOP-LEVEL ARRAY of per-language groups. There is NO
 *      envelope key — no `{ tags: … }`, unlike most endpoints in this client.
 *   2. The nesting is three deep: language → `categoryCollection` → `tags`.
 *
 * These schemas are deliberately STRICT. The drop-and-log tolerance the rest of
 * this client uses for lists is applied at the call site in `$lib/api/tags`,
 * where the `console.warn` belongs — the same split `$lib/api/album` makes
 * between `$lib/model/album` and its own tolerant call-site shapes.
 */
export const profileTagSchema = z.object({
	tagId: z.number().int(),
	text: z.string(),
	key: z.string(),
});

/**
 * A named group of tags ("Body type", "Looking for", …).
 *
 * `possessiveText` is documented as "string or null". Accepted as absent too:
 * nothing in the client renders it, and a category must not be dropped from the
 * picker over a possessive string we never display.
 */
export const profileTagCategorySchema = z.object({
	text: z.string(),
	possessiveText: z.string().nullish(),
	tags: z.array(profileTagSchema),
});

/** One language's worth of tag categories. */
export const profileTagLanguageSchema = z.object({
	language: z.string(),
	categoryCollection: z.array(profileTagCategorySchema),
});

export type ProfileTag = z.infer<typeof profileTagSchema>;
export type ProfileTagCategory = z.infer<typeof profileTagCategorySchema>;
export type ProfileTagLanguage = z.infer<typeof profileTagLanguageSchema>;
