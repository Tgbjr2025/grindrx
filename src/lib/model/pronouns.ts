import z from "zod";

const pronounItemSchema = z.object({
	pronounId: z.number().int().nonnegative(),
	pronoun: z.string().min(1),
});

// `/v1/pronouns` returns a bare array of pronoun items; an older shape wrapped it
// in `{ pronouns: [...] }`. Accept either, and drop any malformed item instead of
// throwing an uncaught ZodError that rejects the whole request.
export const pronounsSchema = z
	.union([
		z.array(z.unknown()),
		z.object({ pronouns: z.array(z.unknown()) }).transform((o) => o.pronouns),
	])
	.transform((arr) =>
		arr.flatMap((p) => {
			const r = pronounItemSchema.safeParse(p);
			return r.success ? [r.data] : [];
		}),
	);
