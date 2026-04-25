import type z from "zod";
import { pronounsSchema } from "$lib/model/pronouns";
import { fetchRest } from "$lib/api";

let cachedPronouns: z.infer<typeof pronounsSchema> | null = null;
export async function fetchPronouns() {
	if (cachedPronouns) return cachedPronouns;
	const pronouns = await fetchRest("/v1/pronouns")
		.then((data) => data.json())
		.then((data) => pronounsSchema.parse(data));
	cachedPronouns = pronouns;
	return pronouns;
}
