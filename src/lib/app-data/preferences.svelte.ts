import { decode, encode } from "@msgpack/msgpack";
import z from "zod";

import { gridSearchFiltersSchema } from "$lib/components/filters/filters";
import { geohashSchema } from "$lib/model/geohash";
import { existsAppDataFile, readAppDataFile, writeAppDataFile } from ".";

const preferencesSchema = z.object({
	geohash: geohashSchema.nullable().default(null),
	gridSearchFilters: gridSearchFiltersSchema.optional(),
	revealMessageRead: z.boolean().default(false),
	revealProfileViews: z.boolean().default(false),
});

export async function getPreferences(): Promise<
	z.infer<typeof preferencesSchema>
> {
	if (await existsAppDataFile("preferences.data")) {
		return await readAppDataFile("preferences.data")
			.then(decode)
			.then((data) => preferencesSchema.parse(data));
	} else {
		return {
			geohash: null,
			revealMessageRead: false,
			revealProfileViews: false,
		};
	}
}

let writeQueue = Promise.resolve();

export async function setPreferences(
	newValues: Partial<z.infer<typeof preferencesSchema>>,
): Promise<void> {
	writeQueue = writeQueue.then(async () => {
		const oldValues = await getPreferences();
		const preferences = {
			...oldValues,
			...newValues,
		};
		preferencesSchema.parse(preferences);
		await writeAppDataFile("preferences.data", encode(preferences));
	});
	await writeQueue;
}
