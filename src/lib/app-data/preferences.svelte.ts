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
	incognito: z.boolean().default(false),
});

function defaultPreferences(): z.infer<typeof preferencesSchema> {
	return {
		geohash: null,
		revealMessageRead: false,
		revealProfileViews: false,
		incognito: false,
	};
}

export async function getPreferences(): Promise<
	z.infer<typeof preferencesSchema>
> {
	if (!(await existsAppDataFile("preferences.data"))) {
		return defaultPreferences();
	}
	// The preferences file is written non-atomically (truncate + write), so a read
	// that overlaps an in-flight write — or a file left half-written by an app kill
	// — can decode/parse to garbage. Previously this rejected, and the home route's
	// `{#await preferences}` had no catch, so a filter/location change (which
	// re-reads preferences) hard-crashed the app until relaunch. Degrade to
	// defaults on any read/decode/parse failure instead; the next setPreferences
	// rewrites a clean file.
	try {
		const raw = await readAppDataFile("preferences.data");
		return preferencesSchema.parse(decode(raw));
	} catch (err) {
		console.error("[GrindrX] preferences read failed, using defaults:", err);
		return defaultPreferences();
	}
}

let writeQueue = Promise.resolve();

export async function setPreferences(
	newValues: Partial<z.infer<typeof preferencesSchema>>,
): Promise<void> {
	writeQueue = writeQueue
		.then(async () => {
			const oldValues = await getPreferences();
			const preferences = {
				...oldValues,
				...newValues,
			};
			preferencesSchema.parse(preferences);
			await writeAppDataFile("preferences.data", encode(preferences));
		})
		.catch((err) => {
			console.error("[GrindrX] Failed to persist preferences:", err);
			// Swallow — allows next write to proceed
		});
	await writeQueue;
}
