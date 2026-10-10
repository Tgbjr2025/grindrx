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

/**
 * Marker recording that the last sign-out purge could NOT take `preferences.data`
 * away, so whatever is still on disk belongs to a PURGED ACCOUNT.
 *
 * WHY THIS IS NOT A CONSOLE LOG — the P2-001 defect this key exists to close:
 * `purgePreferencesFile` can fail TWICE. The delete is refused (the `fs:allow-remove`
 * capability or its scope), and the compensating overwrite then cannot allocate a
 * byte either (storage quota, full disk). The previous user's geohash — a ~2 m x 4 m
 * cell — survives on disk. The purge recorded that in a local array and printed it,
 * and then RETURNED: by contract it never throws, because a rejection would strand
 * the user mid-sign-out. So the sign-out flow continued and the next account signed
 * in. `readPreferences` found the file, decoded it cleanly (it is not corrupt — it
 * is a perfectly valid preferences file belonging to someone who is no longer
 * signed in) and returned it as `status: "ok"`. The half-purged state was mistaken
 * for clean precisely because nothing on the read path could tell it apart from a
 * normal file. The geohash was the sharpest symptom; `incognito` and the two
 * `reveal*` toggles — private choices by the previous account — came back too.
 *
 * WHY localStorage AND NOT A SIBLING APP-DATA FILE: a marker written next to the
 * file it describes would have to go through the same filesystem that just refused
 * to write the file, so in exactly the scenario the marker exists for, the marker
 * would fail too. WebView localStorage is a different store from the Tauri app-data
 * fs, so it survives an app-data write failure. That is the whole reason the
 * cross-store hop is taken.
 *
 * SCOPE: device-scoped, not per-account, and deliberately NOT in
 * `PER_ACCOUNT_LOCALSTORAGE_KEYS` in `purge.ts`. It describes the trustworthiness of
 * a FILE, not account data, and it must not be swept away by the localStorage pass
 * that runs before the file purge — it is the thing that pass is supposed to leave
 * behind if the file purge then fails.
 */
const PREFERENCES_UNTRUSTED_KEY = "grindrx-preferences-untrusted";

/**
 * Is the surviving `preferences.data` known to belong to a purged account?
 *
 * TWO FAILURE MODES, AND THEY ARE NOT SYMMETRIC ON PURPOSE:
 *
 *  - No localStorage at all (SSR, the node test environment): returns FALSE.
 *    `markPreferencesUntrusted` is a no-op under the same condition, so
 *    "untrusted" is literally unrepresentable here — a marker could never have
 *    been written, so there is nothing to distrust. Returning true instead would
 *    make every device without a localStorage treat its own perfectly good
 *    preferences file as another account's, permanently discarding the user's
 *    saved toggles and location.
 *  - localStorage present but `getItem` throws: returns TRUE, i.e. fails closed.
 *    Here the store exists and may well already hold a marker written by an
 *    earlier failed purge, so absence cannot be proven — and a previous
 *    account's ~2 m x 4 m geohash is the thing being protected.
 */
export function isPreferencesUntrusted(): boolean {
	if (typeof localStorage === "undefined") return false;
	try {
		return localStorage.getItem(PREFERENCES_UNTRUSTED_KEY) !== null;
	} catch (error) {
		console.error(
			"[GrindrX] could not read the preferences trust marker; treating preferences.data as untrusted:",
			error,
		);
		return true;
	}
}

/** Record that `preferences.data` on disk is a purged account's leftovers. */
export function markPreferencesUntrusted(): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(PREFERENCES_UNTRUSTED_KEY, "1");
	} catch (error) {
		// A full quota here means the marker cannot be persisted, so the next
		// account's read cannot be protected. Surfaced rather than swallowed:
		// this is the one branch where the fallback chain has run out.
		console.error("[GrindrX] could not record the preferences trust marker:", error);
	}
}

/** Clear the marker — the file is gone, or was legitimately rewritten. */
export function clearPreferencesUntrusted(): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(PREFERENCES_UNTRUSTED_KEY);
	} catch (error) {
		console.warn("[GrindrX] could not clear the preferences trust marker:", error);
	}
}

// Distinguishes "no file yet" (safe to treat as defaults, safe to write over)
// from "file present but unreadable" (must NOT be treated as ground truth for
// a write — see readPreferences below), and from "file present but known to
// belong to a purged account" (must not be SERVED, but is safe — indeed
// desirable — to write over; see setPreferences). Reads that only need a value
// (not the distinction) should use `getPreferences`.
type PreferencesReadResult =
	| { status: "missing"; value: z.infer<typeof preferencesSchema> }
	| { status: "ok"; value: z.infer<typeof preferencesSchema> }
	| { status: "unreadable"; value: z.infer<typeof preferencesSchema> }
	| { status: "stale"; value: z.infer<typeof preferencesSchema> };

async function readPreferences(): Promise<PreferencesReadResult> {
	if (!(await existsAppDataFile("preferences.data"))) {
		return { status: "missing", value: defaultPreferences() };
	}
	// A sign-out purge tried and failed to take this file away, so its contents
	// are a PURGED ACCOUNT's: their geohash, their incognito state, their reveal
	// toggles. The file decodes fine — it is not corrupt, it is just not ours —
	// so without this check it is indistinguishable from a normal read and the
	// next account inherits all of it. Degrade to defaults rather than reject,
	// for the same reason as the catch below: the home route's `{#await
	// preferences}` has no catch and a rejection hard-crashes the app.
	if (isPreferencesUntrusted()) {
		console.error(
			"[GrindrX] preferences.data survived a failed sign-out purge — treating it as another account's data",
		);
		return { status: "stale", value: defaultPreferences() };
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
		// `status: "stale"` deliberately FALLS THROUGH to the write rather than
		// raising, which is the opposite of the branch above and is the whole
		// point of distinguishing them. An unreadable file might hold THIS
		// account's unsaved data, so clobbering it can lose data for good. A
		// stale file holds a PURGED ACCOUNT's data, which is exactly what the
		// purge tried to destroy and failed to; overwriting it here destroys it
		// for real, and it is the recovery path out of the double failure —
		// the quota that blocked the purge's neutralising write is the same
		// quota this write needs, so by the time it succeeds both have cleared.
		// Refusing here would instead leave the previous account's geohash on
		// disk indefinitely and lock the new account out of saving anything.
		const preferences = {
			...current.value,
			...newValues,
		};
		preferencesSchema.parse(preferences);
		await writeAppDataFile("preferences.data", encode(preferences));
		// The write just replaced the file wholesale, so whatever it held is
		// gone and it now belongs to whoever is signed in. Clearing the marker
		// here is what makes the next read take the normal `status: "ok"` path
		// instead of degrading to defaults forever.
		clearPreferencesUntrusted();
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
