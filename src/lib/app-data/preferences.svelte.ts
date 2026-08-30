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
	// Local notification toggles (Grindr has no server-side equivalent). Default
	// on, matching prior behaviour. Enforced in Rust: the values are pushed into
	// AppState via `set_notification_prefs` and read by the WS notifier.
	notifyMessages: z.boolean().default(true),
	notifyTaps: z.boolean().default(true),
});

function defaultPreferences(): z.infer<typeof preferencesSchema> {
	return {
		geohash: null,
		revealMessageRead: false,
		revealProfileViews: false,
		incognito: false,
		notifyMessages: true,
		notifyTaps: true,
	};
}

// Distinguishes "no file yet" (safe to treat as defaults, safe to write over)
// from "file present but unreadable" (must NOT be treated as ground truth for
// a write — see readPreferences below). Reads that only need a value (not the
// distinction) should use `getPreferences`.
type PreferencesReadResult =
	| { status: "missing"; value: z.infer<typeof preferencesSchema> }
	| { status: "ok"; value: z.infer<typeof preferencesSchema> }
	| { status: "unreadable"; value: z.infer<typeof preferencesSchema> };

async function readPreferences(): Promise<PreferencesReadResult> {
	if (!(await existsAppDataFile("preferences.data"))) {
		return { status: "missing", value: defaultPreferences() };
	}
	// The preferences file is written non-atomically (truncate + write), so a read
	// that overlaps an in-flight write — or a file left half-written by an app kill
	// — can decode/parse to garbage. Previously this rejected, and the home route's
	// `{#await preferences}` had no catch, so a filter/location change (which
	// re-reads preferences) hard-crashed the app until relaunch. Degrade to
	// defaults for READS on any read/decode/parse failure instead. Callers that
	// persist a write (setPreferences) must check `status` — an 'unreadable' file
	// is NOT the same as 'missing': merging new values onto the degraded defaults
	// and writing them back would silently wipe whatever is actually on disk
	// (saved geohash/filters) for what may just be a transient race.
	try {
		const raw = await readAppDataFile("preferences.data");
		return { status: "ok", value: preferencesSchema.parse(decode(raw)) };
	} catch (err) {
		console.error("[GrindrX] preferences read failed, using defaults:", err);
		return { status: "unreadable", value: defaultPreferences() };
	}
}

export async function getPreferences(): Promise<
	z.infer<typeof preferencesSchema>
> {
	return (await readPreferences()).value;
}

let writeQueue = Promise.resolve();

export async function setPreferences(
	newValues: Partial<z.infer<typeof preferencesSchema>>,
): Promise<void> {
	writeQueue = writeQueue
		.then(async () => {
			const current = await readPreferences();
			if (current.status === "unreadable") {
				// Don't persist defaults + newValues over a file that exists but
				// failed to decode/parse — that would clobber saved geohash/filters
				// for what may be a transient read/write race rather than real
				// corruption. Skip this write; the next read after the underlying
				// condition clears (e.g. the in-flight write that produced this
				// finishes) will see the real file again.
				console.error(
					"[GrindrX] preferences file present but unreadable — skipping write to avoid clobbering saved settings",
				);
				return;
			}
			const preferences = {
				...current.value,
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
