import z from "zod";

import {
	filterAcceptNSFWPicsSchema,
	filterBodyTypeSchema,
	filterLookingForSchema,
	filterMeetAtSchema,
	filterPositionSchema,
	filterRelationshipStatusSchema,
	filterTribesSchema,
} from "$lib/components/filters/filters";
import { gridQuerySchema } from "$lib/model/grid";
import { mediaHashPublicSchema } from "$lib/model/media";

export const searchQuerySchema = gridQuerySchema.extend({
	online: z.boolean().optional(),
	ageMinimum: z.int().nonnegative().optional(),
	ageMaximum: z.int().nonnegative().optional(),
	heightMinimum: z.number().nonnegative().optional(),
	heightMaximum: z.number().nonnegative().optional(),
	weightMinimum: z.number().nonnegative().optional(),
	weightMaximum: z.number().nonnegative().optional(),
	grindrTribesIds: filterTribesSchema.optional(),
	lookingForIds: filterLookingForSchema.optional(),
	relationshipStatusIds: filterRelationshipStatusSchema.optional(),
	bodyTypeIds: filterBodyTypeSchema.optional(),
	sexualPositionIds: filterPositionSchema.optional(),
	meetAtIds: filterMeetAtSchema.optional(),
	nsfwIds: filterAcceptNSFWPicsSchema.optional(),
	profileTags: z.string().optional(),
	searchAfterDistance: z.string().optional(),
	searchAfterProfileId: z.string().optional(),
	freeFilter: z.boolean().optional(),
});

export const searchProfileSchema = z.object({
	// Not `z.coerce.number().int().nonnegative()`: coercion runs first, and
	// `Number(null) === Number("") === 0` passes `.nonnegative()`, so a missing
	// or blank id MANUFACTURED profile 0 — the `/profile/0` bug that was fixed
	// downstream in v0.1.33, re-created here at the parse layer. Reject the two
	// coercible-to-zero inputs by name, then coerce, then require positive.
	profileId: z.preprocess(
		(val) => {
			if (val === null || val === undefined) return val;
			if (typeof val === "string" && val.trim() === "") return Number.NaN;
			return val;
		},
		z.coerce.number().int().positive(),
	),
	displayName: z.string().nullable(),
	age: z.int().nonnegative().nullable(),
	distance: z.number().nullable(),
	// The `/v7/search` response documents this field
	// (docs/content/grindr-api/browse/grid.md, Search response), but the schema
	// never declared it, so Zod stripped it from every parsed search result.
	// It is what the masked-viewer resolution matches on — see
	// `$lib/app-data/profile-identity-cache.svelte` — so a profile the user found
	// by searching could not be linked back from a masked viewer row.
	//
	// Deliberately `z.string()` rather than `mediaHashPublicSchema`: this field is
	// only ever an index key (the cache validates the 40-hex shape itself), so a
	// private/signed hash must degrade to a usable string rather than fail the
	// whole profile's parse and drop it from the search results.
	profileImageMediaHash: z.string().nullable().optional().catch(null),
	medias: z.array(z.object({ mediaHash: mediaHashPublicSchema })).nullable(),
});
