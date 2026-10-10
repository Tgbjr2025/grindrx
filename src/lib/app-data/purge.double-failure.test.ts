// P2-001 — the `preferences.data` DOUBLE-FAILURE purge path.
//
// WHAT THIS FILE IS FOR
// ---------------------
// `purge.ts` purges the previous account's preferences file in two steps: delete
// it, and if the delete is refused, overwrite it with a PII-free payload. Both
// steps can fail, and when BOTH fail the previous user's bytes are still on disk
// while the sign-out flow moves on to the next account. That is the path the
// remediation register flags as untested, and it is the one that decides whether
// a failed purge leaves a file the NEXT account reads as its own.
//
// WHY A FAKE FILESYSTEM RATHER THAN TWO `vi.fn()`s
// --------------------------------------------------
// The existing `purge.test.ts` mocks `writeAppDataFile` wholesale, which is the
// right call when the question is "which keys does the purge enumerate". It is
// the wrong call here: the questions in this file are about what survives ON
// DISK and what the next account's READ path then returns, so the bytes have to
// survive the purge for real and be decoded by the real `readPreferences`.
//
// So this file mocks only the outermost layer — `@tauri-apps/plugin-fs` and
// `@tauri-apps/api/path` — over an in-memory filesystem. `writeAppDataFile`
// (`./index.ts`) therefore runs for real, including its temp-sibling + atomic
// rename, and `purgePreferencesFile` runs its genuine two-step fallback. That is
// what makes "the file is still on disk after a double failure" a MEASUREMENT
// rather than a restatement of a mock's return value.

import { decode } from "@msgpack/msgpack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$app/environment", () => ({
	browser: true,
	building: false,
	dev: false,
	version: "test",
}));

vi.mock("$lib/api/profile", () => ({
	clearAllProfileCaches: vi.fn(),
	clearMediaIdCache: vi.fn(),
}));

// The app-lock module is a `.svelte.ts` rune module; the real behaviour it
// provides is covered by `app-lock.svelte.test.ts`. This suite only asserts the
// purge calls it, and stubbing it keeps the failure injection focused on the
// filesystem rather than on PIN/PBKDF2 state.
vi.mock("$lib/app-data/app-lock.svelte", () => ({
	disablePin: vi.fn(),
	setBiometricUnlock: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
	appDataDir: () => Promise.resolve("/app-data"),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(() => Promise.reject(new Error("no bridge in this test"))),
}));

/**
 * The in-memory AppData filesystem, and the two independent switches that make
 * the purge fail.
 *
 * INDEPENDENT ON PURPOSE: the finding is specifically about BOTH steps failing
 * at once. One shared "fs is broken" flag would let a test pass with only the
 * delete failing while the overwrite silently succeeded — which is the healthy
 * path and the one `purge.test.ts` already covers. The delete and the write are
 * separate capabilities (`fs:allow-remove` vs `fs:allow-app-write` + scope), and
 * they fail for separate real reasons: a capability/scope rejection kills the
 * delete, while a full disk or a storage quota kills the write. Both together is
 * a device that will not give the bytes up at all.
 */
const fsState = vi.hoisted(() => ({
	files: new Map<string, Uint8Array>(),
	/** When set, `remove()` throws this instead of unlinking. */
	removeError: null as Error | null,
	/** When set, `writeFile()` throws this, failing the whole atomic write. */
	writeError: null as Error | null,
	/** Set once `remove()` actually succeeded, to prove the fast path ran. */
	removed: [] as string[],
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
	BaseDirectory: { AppData: 7 },
	exists: (path: string) =>
		Promise.resolve(fsState.files.has(normalize(path))),
	readFile: (path: string) => {
		const bytes = fsState.files.get(normalize(path));
		if (!bytes) return Promise.reject(new Error(`no such file: ${path}`));
		return Promise.resolve(bytes);
	},
	writeFile: (path: string, content: Uint8Array) => {
		if (fsState.writeError) return Promise.reject(fsState.writeError);
		// Copy: `writeAppDataFile` hands over a buffer it may reuse, and a test
		// that aliased it would mutate the file it is asserting on.
		fsState.files.set(normalize(path), new Uint8Array(content));
		return Promise.resolve();
	},
	rename: (from: string, to: string) => {
		const bytes = fsState.files.get(normalize(from));
		if (!bytes) return Promise.reject(new Error(`no such file: ${from}`));
		fsState.files.delete(normalize(from));
		fsState.files.set(normalize(to), bytes);
		return Promise.resolve();
	},
	mkdir: () => Promise.resolve(),
	remove: (path: string) => {
		if (fsState.removeError) return Promise.reject(fsState.removeError);
		// Tauri rejects a `remove` of a path that does not exist. Modelling that
		// matters: on a device where the user never saved a preference the delete
		// is expected to fail, and the purge is supposed to absorb it.
		if (!fsState.files.has(normalize(path))) {
			return Promise.reject(new Error(`ENOENT: ${path}`));
		}
		fsState.removed.push(normalize(path));
		fsState.files.delete(normalize(path));
		return Promise.resolve();
	},
}));

import { existsAppDataFile, readAppDataFile } from "$lib/app-data";
import {
	getPreferences,
	isPreferencesUntrusted,
	setPreferences,
} from "$lib/app-data/preferences.svelte";
import { purgeAccountLocalData } from "$lib/app-data/purge";
import { clearStoredViewers } from "$lib/app-data/viewers.svelte";

const PREFERENCES_FILE = "preferences.data";

/** Strip a `.tmp` suffix so a test can assert on the logical path. */
function normalize(path: string): string {
	return path.endsWith(".tmp") ? path.slice(0, -".tmp".length) : path;
}

// The previous account's saved state, as it exists on disk at sign-out. Every
// field here is account-scoped: `geohash` resolves to roughly a 2 m x 4 m cell,
// `incognito` and the two `reveal*` toggles are choices only this account made.
const PREVIOUS_ACCOUNT = {
	geohash: "9q8yyk8ytpxr",
	incognito: true,
	revealMessageRead: true,
	revealProfileViews: true,
	notifyMessages: false,
	notifyTaps: false,
} as const;

/** Bytes still on disk for `preferences.data`, or undefined if it is gone. */
async function preferencesOnDisk(): Promise<Record<string, unknown> | undefined> {
	if (!(await existsAppDataFile(PREFERENCES_FILE))) return undefined;
	return decode(await readAppDataFile(PREFERENCES_FILE)) as Record<
		string,
		unknown
	>;
}

function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) =>
			store.has(key) ? (store.get(key) as string) : null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	};
}

/**
 * Capture every console line the purge emits, tagged by severity.
 *
 * Collected as a structured list rather than asserted one call at a time because
 * the property under test is "NEITHER failure was dropped": a test that only
 * checks `console.error` was called at least once passes even when the delete
 * error — which the implementation logs at WARN — never appeared.
 */
function captureConsole() {
	const lines: { level: "warn" | "error"; text: string }[] = [];
	const record =
		(level: "warn" | "error") =>
		(...args: unknown[]) => {
			lines.push({
				level,
				text: args.map((a) => String(a)).join(" "),
			});
		};
	const warn = vi.spyOn(console, "warn").mockImplementation(record("warn"));
	const error = vi.spyOn(console, "error").mockImplementation(record("error"));
	return {
		lines,
		restore: () => {
			warn.mockRestore();
			error.mockRestore();
		},
	};
}

/** Seed the previous account's preferences the way the app itself would. */
async function seedPreviousAccount(): Promise<void> {
	await setPreferences({ ...PREVIOUS_ACCOUNT });
	// Prove the seed actually reached the fake disk, so a later "the file is
	// gone" assertion can never be satisfied by a seeding failure.
	expect(await preferencesOnDisk()).toMatchObject({
		geohash: PREVIOUS_ACCOUNT.geohash,
	});
}

/** Put the device into the state the finding is about. */
function breakBothPurgeSteps() {
	fsState.removeError = new Error("IndexedDB unavailable: fs scope rejected");
	fsState.writeError = new Error("QuotaExceededError: disk full");
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("localStorage", createMemoryStorage());
	fsState.files.clear();
	fsState.removed.length = 0;
	fsState.removeError = null;
	fsState.writeError = null;
	clearStoredViewers();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/**
 * THE FINDING. Both purge steps refuse the file: the delete is rejected (the
 * `fs:allow-remove` capability or its scope) and the compensating overwrite
 * cannot allocate a byte (storage quota / full disk).
 *
 * Nothing here is hypothetical sequencing: `setPreferences` below is the real
 * one, writing through the real atomic `writeAppDataFile`, so the bytes this
 * test asserts on are bytes the app actually produced.
 */
describe("the double-failure purge path", () => {
	it("surfaces BOTH failures — the rejected delete and the failed overwrite", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();

		await purgeAccountLocalData();
		logs.restore();

		const deleteFailure = logs.lines.find(
			(l) =>
				l.level === "warn" &&
				l.text.includes("Could not delete the preferences file"),
		);
		const overwriteFailure = logs.lines.find(
			(l) =>
				l.level === "error" &&
				l.text.includes("Failed to purge preferences file"),
		);
		// The delete rejection is the FIRST failure. If it is not surfaced, the
		// log claims the overwrite was a routine precaution and the reader
		// concludes the file was merely slow to delete rather than unreachable.
		expect(
			deleteFailure,
			"the rejected delete was swallowed",
		).toBeDefined();
		expect(deleteFailure?.text).toContain("IndexedDB unavailable");
		// And the overwrite failure must be surfaced too, naming the file, so the
		// completion log cannot read as "preferences: done".
		expect(
			overwriteFailure,
			"the failed overwrite was swallowed",
		).toBeDefined();
		expect(overwriteFailure?.text).toContain("QuotaExceededError");
	});

	it("names preferences.data in the completion summary, so the log cannot claim a clean purge", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();

		await purgeAccountLocalData();
		logs.restore();

		const summary = logs.lines.find((l) =>
			l.text.includes("Sign-out purge completed with failures"),
		);
		expect(summary, "no completion summary was emitted at all").toBeDefined();
		expect(summary?.text).toContain(PREFERENCES_FILE);
	});

	// The purge is documented as never throwing — a rejection here would strand
	// the user mid-sign-out — so it is asserted explicitly rather than left
	// implicit, because a future refactor that propagates the fs error would
	// otherwise pass every other test in this file.
	it("does not throw, so a failed purge cannot strand the user mid-sign-out", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();

		await expect(purgeAccountLocalData()).resolves.toBeUndefined();

		logs.restore();
	});

	// Isolation: the preferences file is the step that failed, and its failure
	// must not abort the steps that run after it in the sequence or take the
	// other localStorage keys down with it.
	it("still purges the other storage when the preferences file alone fails", async () => {
		localStorage.setItem("grindrx-saved-phrases", '["meet me at the pier"]');
		localStorage.setItem("grindrx-explore-location", '{"geohash":"9q8yyk8ytpxr"}');
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();

		await purgeAccountLocalData();
		logs.restore();

		expect(localStorage.getItem("grindrx-saved-phrases")).toBeNull();
		expect(localStorage.getItem("grindrx-explore-location")).toBeNull();
	});
});

/**
 * THE CONSEQUENCE. This is the half of the finding that a log line cannot fix.
 *
 * After the double failure the previous user's bytes are still on disk, and the
 * purge has already returned. `SignOutButton` navigates to `/auth/sign-in`
 * unconditionally — it awaits `purgeAccountLocalData()`, which by contract never
 * rejects — so the next account signs in onto a device that still holds them.
 * The read path that hands them over is `readPreferences` behind `getPreferences`.
 */
describe("what the next account reads after a double failure", () => {
	it("does not read the previous account's preferences back as clean", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();

		await purgeAccountLocalData();
		logs.restore();

		// The bytes are demonstrably still there — this is a storage refusal, not
		// a half-finished write, so asserting their absence would be asserting a
		// filesystem capability the app does not have.
		expect(
			await preferencesOnDisk(),
			"the fixture did not actually leave the previous account on disk",
		).toMatchObject({ geohash: PREVIOUS_ACCOUNT.geohash });

		const prefs = await getPreferences();

		expect(prefs.geohash).toBeNull();
		expect(prefs.incognito).toBe(false);
		expect(prefs.revealMessageRead).toBe(false);
		expect(prefs.revealProfileViews).toBe(false);
	});

	it("does not leak the previous account's location into the next account's grid", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();
		await purgeAccountLocalData();
		logs.restore();

		const prefs = await getPreferences();

		// `getPreferences` is what the grid, search, right-now, map and favourites
		// routes all call for their `geohash`. A stale value here is not a stale
		// preference, it is the previous user's home location rendered for the
		// next account.
		expect(prefs.geohash).not.toBe(PREVIOUS_ACCOUNT.geohash);
		expect(prefs.geohash).toBeNull();
	});

	it("leaves no durable trace the next account can inherit as its own settings", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();
		await purgeAccountLocalData();
		logs.restore();

		// Every per-account localStorage key must be gone even though the
		// preferences file could not be. The file and the keys are the same leak.
		for (const key of Object.keys(localStorage)) {
			expect(key.startsWith("grindrx-")).toBe(false);
		}
	});
});

/**
 * RECOVERY. A purge failure is only acceptable if it is recoverable, so the
 * retry has to be pinned too: once the device is healthy again (quota freed,
 * scope granted) the next sign-out must fully clear the file.
 */
describe("retrying after the underlying failure clears", () => {
	it("completes the purge on the next attempt and leaves the next account clean", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const firstLogs = captureConsole();
		await purgeAccountLocalData();
		firstLogs.restore();

		expect(
			await preferencesOnDisk(),
			"precondition: the first purge must fail to make this a retry",
		).toMatchObject({ geohash: PREVIOUS_ACCOUNT.geohash });

		// The device recovers: quota freed / the fs scope granted.
		fsState.removeError = null;
		fsState.writeError = null;
		const retryLogs = captureConsole();

		await purgeAccountLocalData();
		retryLogs.restore();

		// The delete is tried FIRST and succeeds now, so the compensating
		// overwrite must not run — writing the file back would resurrect the
		// very artefact this purge exists to remove.
		expect(fsState.removed).toContain(PREFERENCES_FILE);
		expect(
			fsState.files.has(PREFERENCES_FILE),
			"the retry left preferences.data on disk",
		).toBe(false);
		expect(
			retryLogs.lines.find((l) =>
				l.text.includes("Sign-out purge completed with failures"),
			),
			"a healthy retry still reported failures",
		).toBeUndefined();

		const prefs = await getPreferences();
		expect(prefs.geohash).toBeNull();
		expect(prefs.incognito).toBe(false);
	});

	it("falls back to the neutralising overwrite when only the delete stays refused", async () => {
		// The realistic middle case: the capability granting `remove` is still
		// refused but the disk has room again. The file must then be left VALID and
		// PII-free, because `setPreferences` treats "present but unreadable" as
		// unrecoverable and refuses every later write.
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const firstLogs = captureConsole();
		await purgeAccountLocalData();
		firstLogs.restore();

		fsState.writeError = null;
		const retryLogs = captureConsole();

		await purgeAccountLocalData();
		retryLogs.restore();

		const onDisk = await preferencesOnDisk();
		expect(onDisk).toEqual({
			geohash: null,
			revealMessageRead: false,
			revealProfileViews: false,
			incognito: false,
			notifyMessages: true,
			notifyTaps: true,
		});
		const prefs = await getPreferences();
		expect(prefs.geohash).toBeNull();
		expect(prefs.incognito).toBe(false);
	});

	it("lets the next account save their own preferences again after recovery", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const firstLogs = captureConsole();
		await purgeAccountLocalData();
		firstLogs.restore();

		fsState.removeError = null;
		fsState.writeError = null;
		const retryLogs = captureConsole();
		await purgeAccountLocalData();
		retryLogs.restore();

		await setPreferences({ geohash: "9q8yykb7nxtz" });

		expect(await preferencesOnDisk()).toMatchObject({
			geohash: "9q8yykb7nxtz",
		});
		expect((await getPreferences()).geohash).toBe("9q8yykb7nxtz");
	});
});

/**
 * THE MARKER'S OWN LIFECYCLE.
 *
 * The fix for the leak is a durable record that the surviving file belongs to a
 * purged account. That record is only a fix if it has the right lifetime, and a
 * marker that outlives its cause is a new defect: the user would lose their
 * preferences forever on a device that recovered. Both directions are pinned here.
 */
describe("the purge-failure marker", () => {
	it("is set on the double failure and reports the file as untrusted", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();

		await purgeAccountLocalData();
		logs.restore();

		// The state is EXPLICIT, not ambiguous: a later code path can ask whether
		// the file is trustworthy instead of inferring it from a log line that no
		// reader ever sees.
		expect(isPreferencesUntrusted()).toBe(true);
	});

	it("is NOT set when the delete succeeds, so a healthy purge changes nothing", async () => {
		await seedPreviousAccount();
		const logs = captureConsole();

		await purgeAccountLocalData();
		logs.restore();

		expect(isPreferencesUntrusted()).toBe(false);
	});

	it("is NOT set when only the delete fails, because the overwrite did purge", async () => {
		await seedPreviousAccount();
		fsState.removeError = new Error("fs scope rejected");
		const logs = captureConsole();

		await purgeAccountLocalData();
		logs.restore();

		// The file on disk is a PII-free payload we wrote ourselves, so it is
		// readable. Marking it would needlessly discard a valid file's contents.
		expect(await preferencesOnDisk()).toMatchObject({ geohash: null });
		expect(isPreferencesUntrusted()).toBe(false);
	});

	it("is cleared by a successful retry, so recovery is not a permanent lockout", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const firstLogs = captureConsole();
		await purgeAccountLocalData();
		firstLogs.restore();
		expect(isPreferencesUntrusted()).toBe(true);

		fsState.removeError = null;
		fsState.writeError = null;
		const retryLogs = captureConsole();

		await purgeAccountLocalData();
		retryLogs.restore();

		expect(isPreferencesUntrusted()).toBe(false);
	});

	// The recovery path when the user never signs out again: their first settings
	// change overwrites the stale file, which both destroys the previous account's
	// data and re-validates the file. Asserted because the opposite behaviour —
	// refusing the write, as an unreadable file is refused — would leave the
	// previous account's geohash on disk indefinitely AND stop the new account
	// saving anything.
	it("is cleared by the next account's own write, which overwrites the stale file", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();
		await purgeAccountLocalData();
		logs.restore();
		expect(isPreferencesUntrusted()).toBe(true);

		fsState.writeError = null;
		await setPreferences({ geohash: "9q8yykb7nxtz" });

		// The previous account's geohash is gone from disk, not merely hidden.
		expect(await preferencesOnDisk()).toEqual({
			geohash: "9q8yykb7nxtz",
			revealMessageRead: false,
			revealProfileViews: false,
			incognito: false,
			notifyMessages: true,
			notifyTaps: true,
		});
		expect(isPreferencesUntrusted()).toBe(false);
	});

	it("does not resurrect on a read — reads must not clear the marker", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();
		await purgeAccountLocalData();
		logs.restore();

		await getPreferences();
		await getPreferences();

		// If a plain read cleared it, the file would become trusted while still
		// holding the previous account's bytes, and the SECOND account to sign
		// in would read them. The protection has to survive reads.
		expect(isPreferencesUntrusted()).toBe(true);
		expect((await getPreferences()).geohash).toBeNull();
	});

	it("survives a relaunch — it is persisted, not module state", async () => {
		await seedPreviousAccount();
		breakBothPurgeSteps();
		const logs = captureConsole();
		await purgeAccountLocalData();
		logs.restore();

		// A WebView reload is the sign-out's `window.location.href` navigation.
		// Module state would be gone by the time the next account signs in, which
		// is exactly why the marker lives in localStorage.
		expect(localStorage.getItem("grindrx-preferences-untrusted")).toBe("1");
		expect(localStorage.length).toBe(1);
	});
});
