import type z from "zod";

import { fetchRest } from "$lib/api";
import { gendersSchema } from "$lib/model/genders";

let cachedGenders: z.infer<typeof gendersSchema> | null = null;
export async function getGenders() {
	if (cachedGenders) return cachedGenders;
	const genders = await fetchRest("/public/v2/genders").then((res) =>
		res.jsonParsed(gendersSchema),
	);
	cachedGenders = genders;
	return genders;
}

export function clearGendersCache() {
	cachedGenders = null;
}
