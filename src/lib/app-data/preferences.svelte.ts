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
	// NOTE: this comment previously claimed the file was "written non-atomically
	// (truncate + write)". That stopped being true in v0.1.28 — `writeAppDataFile`
	// writes a `.tmp` sibling and renames over the target, so a reader now sees
	// either the old file or the complete new one, never a half-written one. A
	// read failure here is therefore NOT a transient race with an in-flight write;
	// it means the bytes on disk are genuinely undecodable (a file written by an
	// older build, a truncated file from before v0.1.28, a schema change, or an
	// IO/permission error).
	//
	// We still degrade to defaults on any read/decode/parse failure for READS:
	// the home route's `{#await preferences}` has no catch, so a rejection here
	// hard-crashes the app until relaunch. Callers that persist a write
	// (setPreferences) must check `status` — see the note there.
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

/**
 * Raised when a write could not be persisted.
 *
 * This exists because `setPreferences` used to swallow every failure, which made
 * it impossible for a caller to know its "saved" toast was untrue. The concrete
 * cost: `LocationChange` awaited a write, then toasted "Browsing near X" and
 * re-read the preferences — getting the OLD geohash, because the write never
 * happened. The user was told they were browsing an area they were not, and the
 * choice was gone on next launch. That is precisely the failure
 * `isGeohashPinned()` exists to prevent, reintroduced one layer down.
 */
export class PreferencesWriteError extends Error {
	constructor(
		message: string,
		/** "unreadable" = the file exists but will not decode, so we refused to clobber it. */
		readonly reason: "unreadable" | "write-failed",
		readonly cause?: unknown,
	) {
		super(message);
		this.name = "PreferencesWriteError";
	}
}

/**
 * Merge `newValues` into the stored preferences.
 *
 * REJECTS on failure. Callers that genuinely do not care should `.catch()`
 * explicitly; a silent failure here is indistinguishable from success, and five
 * call sites were relying on that ambiguity to show a success toast for a write
 * that never landed.
 */
export async function setPreferences(
	newValues: Partial<z.infer<typeof preferencesSchema>>,
): Promise<void> {
	// Chain the work, but keep the rejection separate: a failed write must not
	// poison the queue for every later write.
	const work = writeQueue.then(async () => {
		const current = await readPreferences();
		if (current.status === "unreadable") {
			// Don't persist defaults + newValues over a file that exists but
			// failed to decode/parse. Writes have been atomic since v0.1.28, so
			// this is NOT a transient race that will clear on the next read —
			// which also means this guard is sticky: while the file stays
			// undecodable, EVERY setPreferences call is dropped and the user's
			// geohash/filters/toggles never persist again. That is deliberate
			// (a decode failure may be a schema change, in which case the bytes
			// are still recoverable and clobbering them loses data for good),
			// but it is a real trade-off — see FIX_NOTES_v0.1.33 "Batch 8".
			console.error(
				"[GrindrX] preferences file present but unreadable — skipping write to avoid clobbering saved settings",
			);
			throw new PreferencesWriteError(
				"Your settings file could not be read, so nothing was changed.",
				"unreadable",
			);
		}
		const preferences = {
			...current.value,
			...newValues,
		};
		preferencesSchema.parse(preferences);
		await writeAppDataFile("preferences.data", encode(preferences));
	});
	// The queue itself must not reject, or every subsequent write is skipped.
	writeQueue = work.then(
		() => undefined,
		() => undefined,
	);
	try {
		await work;
	} catch (err) {
		if (err instanceof PreferencesWriteError) throw err;
		console.error("[GrindrX] Failed to persist preferences:", err);
		throw new PreferencesWriteError(
			"Couldn't save that setting.",
			"write-failed",
			err,
		);
	}
}
