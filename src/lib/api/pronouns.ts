import z from "zod";

import { fetchRest } from "$lib/api";
import { pronounsSchema } from "$lib/model/pronouns";

type PronounsList = z.infer<typeof pronounsSchema>;

let cachedPronouns: PronounsList | null = null;
export async function fetchPronouns() {
	if (cachedPronouns) return cachedPronouns;
	const result = await fetchRest("/v1/pronouns").then((res) =>
		res.jsonParsed(pronounsSchema),
	);
	cachedPronouns = result;
	return cachedPronouns;
}

export function clearPronounsCache() {
	cachedPronouns = null;
}
