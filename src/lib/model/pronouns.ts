import z from "zod";

export const pronounsSchema = z.array(
	z.object({
		pronounId: z.number().int().nonnegative(),
		pronoun: z.string().min(1),
	}),
);
