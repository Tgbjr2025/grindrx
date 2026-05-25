import { fetchRest } from "$lib/api";
import { pronounsSchema } from "$lib/model/pronouns";
import z from "zod";

type PronounsList = z.infer<typeof pronounsSchema>["pronouns"];

let cachedPronouns: PronounsList | null = null;
export async function fetchPronouns() {
	if (cachedPronouns) return cachedPronouns;
	const result = await fetchRest("/v1/pronouns").then((res) =>
		res.jsonParsed(pronounsSchema),
	);
	cachedPronouns = result.pronouns;
	return cachedPronouns;
}

export function clearPronounsCache() {
	cachedPronouns = null;
}
