import z from "zod";

export const genderIdSchema = z.number().int().nonnegative();

export const gendersSchema = z.array(
	z.object({
		genderId: genderIdSchema,
		// `gender` is documented as a plain string, but the plural is explicitly
		// "string or null" (docs/content/grindr-api/users/profiles.md, GET
		// /public/v2/genders). The schema demanded a NON-EMPTY string for
		// `genderPlural`, so a single entry the API returns as null rejected the
		// WHOLE array.
		//
		// That failure is silent and total: getGenders() rejects, EditProfileSheet's
		// never-rejecting mirror sets gendersOk=false and never flips, and because
		// Save is gated on `listsPending` the user cannot save ANY profile change
		// at all. The gender list appeared to "never load" rather than to fail.
		gender: z.string().min(1),
		genderPlural: z.string().nullable().catch(null),
		displayGroup: z.number().int().nonnegative(),
		sortProfile: z.number().int().nonnegative().nullable().catch(null),
		sortFilter: z.number().int().nonnegative().nullable().catch(null),
		// Per-item `.catch()` so ONE drifted entry degrades to a usable row
		// instead of taking every gender with it. Identity fields (genderId,
		// gender) stay strict — a row without those is not a gender.
		excludeOnProfileSelection: z
			.array(genderIdSchema)
			.nullable()
			.catch(null),
		excludeOnFilterSelection: z.array(genderIdSchema).nullable().catch(null),
		alsoClassifiedAs: z.array(genderIdSchema).catch([]),
	}),
);
