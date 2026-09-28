// Sign-out must take the PREVIOUS USER's data with it, not just the session.
//
// Signing out used to clear three in-memory profile/gender/pronoun caches and
// hard-navigate. Everything persisted survived: the user's own saved message
// text, a geohash, per-conversation read cursors, minted-mediaId records pairing
// their photo hashes with signed CloudFront URLs (bearer-equivalent for ~15 min),
// the install id, per-version dismissals, the app-lock verifier, onboarding
// state, the distance-unit preference, and the AppData `preferences.data` msgpack
// file (their geohash to ~±4 m, incognito, and the reveal-read/reveal-views
// toggles). Sign in as someone else and all of it is theirs.
//
// This module is the single place that enumerates it, so the list is reviewable
// and testable rather than scattered across call sites.

import { encode } from "@msgpack/msgpack";
import { BaseDirectory, remove } from "@tauri-apps/plugin-fs";
import z from "zod";

import { clearAllProfileCaches, clearMediaIdCache } from "$lib/api/profile";
import { disablePin, setBiometricUnlock } from "$lib/app-data/app-lock.svelte";
import { writeAppDataFile } from ".";

/**
 * Per-account localStorage keys, removed verbatim.
 *
 * The app-lock keys are listed even though `disablePin()` +
 * `setBiometricUnlock(false)` already remove them: the UI must never be able to
 * leave the previous user's PIN gate in place just because an earlier step threw.
 */
export const PER_ACCOUNT_LOCALSTORAGE_KEYS = [
	// The user's own saved message text.
	"grindrx-saved-phrases",
	// The location the user was browsing from.
	"grindrx-explore-location",
	// Minted mediaId -> signed CDN URL + the user's photo mediaHashes. Also
	// dropped (with its in-memory twin) by `clearMediaIdCache`.
	"grindrx-mediaid-cache",
	// Install-wide pseudonymous id; not PII, but it is a cross-account link.
	"grindrx-install-id",
	"grindrx-tour-done",
	"pref:distanceUnit",
	"grindrx-pinlock-enabled",
	"grindrx-pinlock-salt",
	"grindrx-pinlock-hash",
	"grindrx-pinlock-iterations",
	"grindrx-pinlock-biometric",
	"grindrx-pinlock-failures",
	"grindrx-pinlock-lockout-until",
	"grindrx-pinlock-last-clock",
] as const;

/**
 * Per-account localStorage key PREFIXES. localStorage has no way to delete a
 * prefix, so these are matched against the enumerated key set.
 */
export const PER_ACCOUNT_LOCALSTORAGE_PREFIXES = [
	// `chat:read:{conversationId}` read cursors — one per conversation the
	// previous user ever opened, i.e. a list of who they talk to.
	"chat:read:",
	// `grindrx-update-dismissed-{version}`.
	"grindrx-update-dismissed-",
] as const;

const PREFERENCES_FILE = "preferences.data";

/**
 * A PII-free `preferences.data` payload, used when the file cannot be deleted.
 *
 * Mirrors `defaultPreferences()` in `./preferences.svelte` (which isn't
 * exported) so the written file stays VALID: an unparseable file is not
 * harmless, because `setPreferences` treats "present but unreadable" as
 * un-recoverable and then refuses every future write — the next account could
 * never save their own location. Every field the schema gives a default is left
 * at that default, so a PII field added to the schema later lands as
 * null/false rather than inheriting the previous user's value. The shape is
 * re-validated on write so a careless edit here fails loudly.
 */
const purgedPreferencesSchema = z.object({
	geohash: z.string().nullable(),
	revealMessageRead: z.boolean(),
	revealProfileViews: z.boolean(),
	incognito: z.boolean(),
	notifyMessages: z.boolean(),
	notifyTaps: z.boolean(),
});

const PURGED_PREFERENCES = {
	geohash: null,
	revealMessageRead: false,
	revealProfileViews: false,
	incognito: false,
	notifyMessages: true,
	notifyTaps: true,
} as const;

/**
 * Delete the previous user's preferences file, or neutralise it if the file
 * system refuses the delete.
 *
 * The app-data fs wrapper (`./index.ts`) exposes read/write/exists/rename only,
 * so the delete goes through the raw plugin.
 *
 * The doc comment this replaces claimed the delete was REJECTED at runtime
 * because the capability granted no `fs:allow-remove`. That was wrong in a way
 * that mattered: `fs:allow-app-write` is the permission SET
 * `["write-all", "scope-app"]`, and `write-all` DOES allow `remove` — so the
 * delete was succeeding, the whole overwrite fallback below was dead code, and
 * the comment documented a security posture that did not exist for a future
 * reviewer to trust. The capability has been narrowed to the six bare command
 * permissions it actually needs and now grants `fs:allow-remove` explicitly,
 * scoped to the preferences files only — so the delete works AND the scope is
 * the one this function assumes.
 *
 * The overwrite stays as a genuine fallback (a filesystem that refuses `remove`
 * is possible), and the failure is now recorded in `failures` — the bare
 * `catch {}` this replaced swallowed the error, so the purge's own completion
 * log could claim success while the previous user's `preferences.data` was
 * still on disk.
 */
async function purgePreferencesFile(failures: string[]): Promise<void> {
	try {
		await remove(PREFERENCES_FILE, { baseDir: BaseDirectory.AppData });
		return;
	} catch (removeErr) {
		console.warn(
			"[GrindrX] Could not delete the preferences file; overwriting it instead:",
			removeErr,
		);
	}
	try {
		await writeAppDataFile(
			PREFERENCES_FILE,
			encode(purgedPreferencesSchema.parse(PURGED_PREFERENCES)),
		);
	} catch (err) {
		failures.push("preferences.data");
		console.error("[GrindrX] Failed to purge preferences file:", err);
	}
}

/** Every stored key that must not survive the sign-out, prefixes included. */
export function perAccountLocalStorageKeys(storage: Storage): string[] {
	const keys = new Set<string>(PER_ACCOUNT_LOCALSTORAGE_KEYS);
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i);
		if (key === null) continue;
		if (
			PER_ACCOUNT_LOCALSTORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
		) {
			keys.add(key);
		}
	}
	return [...keys];
}

/**
 * Erase everything the signed-out account left on this device.
 *
 * Idempotent, and never throws: each step is isolated and the failures are
 * collected and logged. A partial purge is still strictly better than none, and
 * a thrown rejection here would strand the user mid-sign-out.
 */
export async function purgeAccountLocalData(): Promise<void> {
	const failures: string[] = [];
	const step = (name: string, run: () => void) => {
		try {
			run();
		} catch (err) {
			failures.push(name);
			console.error(`[GrindrX] Failed to purge ${name}:`, err);
		}
	};

	// In-memory API state plus the one persisted profile cache.
	step("profile caches", () => {
		clearAllProfileCaches();
		clearMediaIdCache();
	});
	// In-memory app-lock state, so the previous user's gate cannot outlive the
	// sign-out even if the hard navigation below is slow or blocked.
	step("app lock", () => {
		disablePin();
		setBiometricUnlock(false);
	});
	step("localStorage", () => {
		if (typeof localStorage === "undefined") return;
		for (const key of perAccountLocalStorageKeys(localStorage)) {
			localStorage.removeItem(key);
		}
	});
	await purgePreferencesFile(failures);

	if (failures.length > 0) {
		console.error(
			`[GrindrX] Sign-out purge completed with failures: ${failures.join(", ")}`,
		);
	}
}
