import { decode } from "@msgpack/msgpack";
import { BaseDirectory, remove } from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeAppDataFile } from "$lib/app-data";
import {
	rememberProfileIdentity,
	storedIdentityCount,
} from "$lib/app-data/profile-identity-cache.svelte";
import {
	DEVICE_SCOPED_KEYS_KEPT_ON_SIGNOUT,
	PER_ACCOUNT_LOCALSTORAGE_KEYS,
	PER_ACCOUNT_LOCALSTORAGE_PREFIXES,
	perAccountLocalStorageKeys,
	purgeAccountLocalData,
} from "$lib/app-data/purge";

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

// The app-lock module is a `.svelte.ts` rune module, so importing it for real
// here would need the svelte compiler pipeline; the real behaviour it provides
// (removing the pinlock keys, clearing in-memory state) is covered by
// `app-lock.svelte.test.ts`. This suite asserts the purge calls it.
vi.mock("$lib/app-data/app-lock.svelte", () => ({
	disablePin: vi.fn(),
	setBiometricUnlock: vi.fn(),
}));

// The authenticated media cache and the viewers store are deliberately NOT
// mocked here. They are the two in-memory leaks this purge exists to close, and
// a mock would only prove the purge calls a function — not that the previous
// account's photo bytes are actually unrecoverable. Both are exercised for real.
const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
	invoke: (cmd: string, args?: unknown): Promise<unknown> =>
		invoke(cmd, args),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
	BaseDirectory: { AppData: 7 },
	remove: vi.fn(),
}));

vi.mock("$lib/app-data", () => ({
	writeAppDataFile: vi.fn(),
}));

import { clearAllProfileCaches, clearMediaIdCache } from "$lib/api/profile";
import { disablePin, setBiometricUnlock } from "$lib/app-data/app-lock.svelte";
import {
	clearStoredViewers,
	getStoredViewers,
	recordViewers,
} from "$lib/app-data/viewers.svelte";
import {
	__cachedAuthedImageCount,
	__resetAuthedImageCacheForTests,
	resolveAuthedImage,
} from "$lib/utils/authed-image";

const mockedRemove = vi.mocked(remove);
const mockedWrite = vi.mocked(writeAppDataFile);
const mockedClearProfiles = vi.mocked(clearAllProfileCaches);
const mockedClearMediaIds = vi.mocked(clearMediaIdCache);
const mockedDisablePin = vi.mocked(disablePin);
const mockedSetBiometric = vi.mocked(setBiometricUnlock);

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

/** Blobs handed to `URL.createObjectURL`, and whether their object URL is live. */
let urlLive: Map<string, boolean> = null as unknown as Map<string, boolean>;

/** Serve these bytes for any authenticated fetch, as the Rust bridge does. */
function serveJpeg(): void {
	const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
	invoke.mockResolvedValue(
		b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
	);
}

function liveUrlCount(): number {
	return [...urlLive.values()].filter(Boolean).length;
}

// Every key the audit found surviving a sign-out, seeded with recognisable PII.
const SEEDED_PII: Record<string, string> = {
	"grindrx-saved-phrases": '["meet me at the pier"]',
	"grindrx-explore-location": '{"geohash":"9q8yyk8ytpxr"}',
	"grindrx-mediaid-cache":
		'{"abc":{"mediaId":42,"signedUrl":"https://x.cloudfront.net/a?sig=secret"}}',
	"grindrx-stored-viewers":
		'[{"key":"p1","displayName":"Alex","profileImageMediaHash":"hash1","distance":120}]',
	// The hash -> profileId identity index used to resolve masked viewers. It maps
	// photo hashes to real profile ids, so it is a social graph in its own right.
	"grindrx-profile-identities": JSON.stringify({
		v: 1,
		identities: [["a".repeat(40), 1]],
		conflicts: [],
	}),
	"grindrx-geohash-user-pinned": "1",
	"grindrx-install-id": "install-abc",
	"grindrx-tour-done": "1",
	"pref:distanceUnit": '"mi"',
	"grindrx-pinlock-enabled": "1",
	"grindrx-pinlock-salt": "aabb",
	"grindrx-pinlock-hash": "deadbeef",
	"grindrx-pinlock-iterations": "200000",
	"grindrx-pinlock-biometric": "1",
	"grindrx-pinlock-failures": "3",
	"grindrx-pinlock-lockout-until": "99999999999999",
	"grindrx-pinlock-last-clock": "1",
	"chat:read:12345": '{"ts":1}',
	"chat:read:98765": '{"ts":2}',
	"grindrx-update-dismissed-0.1.33": "1",
	// Device-scoped, NOT per-account. Kept on purpose — see the decision comment
	// on `DEVICE_SCOPED_KEYS_KEPT_ON_SIGNOUT` in `purge.ts` and the dedicated test
	// at the bottom of this file, which is where that call is argued.
	"grindrx-last-seen-version": "0.1.33",
	"some-unrelated-key": "keep me",
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("localStorage", createMemoryStorage());
	mockedRemove.mockResolvedValue(undefined);
	mockedWrite.mockResolvedValue(undefined);
	for (const [key, value] of Object.entries(SEEDED_PII)) {
		localStorage.setItem(key, value);
	}

	// Module-level state shared across tests in this file: the media blob cache
	// and the viewers rune store. Both must start empty or a leak assertion is
	// satisfied by bookkeeping a previous test left behind.
	__resetAuthedImageCacheForTests();
	clearStoredViewers();
	invoke.mockReset();
	invoke.mockRejectedValue(new Error("no bridge in this test"));
	urlLive = new Map();
	let n = 0;
	// Subclass rather than replace, so `new URL(...)` still parses.
	class StubUrl extends URL {
		static override createObjectURL(): string {
			const u = `blob:mock/${n++}`;
			urlLive.set(u, true);
			return u;
		}
		static override revokeObjectURL(u: string): void {
			urlLive.set(u, false);
		}
	}
	vi.stubGlobal("URL", StubUrl);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("purgeAccountLocalData", () => {
	it("removes every per-account localStorage key", async () => {
		await purgeAccountLocalData();

		for (const key of Object.keys(SEEDED_PII)) {
			// `grindrx-last-seen-version` is kept ON PURPOSE (device-scoped; the
			// argument is on `DEVICE_SCOPED_KEYS_KEPT_ON_SIGNOUT` in `purge.ts`
			// and in its own test below). `some-unrelated-key` is not ours.
			if (key === "some-unrelated-key") continue;
			if ([...DEVICE_SCOPED_KEYS_KEPT_ON_SIGNOUT].includes(key as never)) {
				expect(localStorage.getItem(key), `${key} must survive`).not.toBeNull();
				continue;
			}
			expect(
				localStorage.getItem(key),
				`${key} survived the sign-out`,
			).toBeNull();
		}
	});

	it("enumerates prefix-matched keys (per-conversation read cursors, dismissed updates)", async () => {
		expect(perAccountLocalStorageKeys(localStorage)).toEqual(
			expect.arrayContaining([
				"chat:read:12345",
				"chat:read:98765",
				"grindrx-update-dismissed-0.1.33",
			]),
		);
		// A non-matching key with a similar name is left alone.
		expect(perAccountLocalStorageKeys(localStorage)).not.toContain(
			"some-unrelated-key",
		);

		await purgeAccountLocalData();
		expect(localStorage.getItem("chat:read:12345")).toBeNull();
		expect(localStorage.getItem("chat:read:98765")).toBeNull();
		expect(localStorage.getItem("grindrx-update-dismissed-0.1.33")).toBeNull();
	});

	it("leaves unrelated storage alone", async () => {
		await purgeAccountLocalData();

		expect(localStorage.getItem("some-unrelated-key")).toBe("keep me");
	});

	it("clears the in-memory API caches, including the persisted mediaId cache", async () => {
		await purgeAccountLocalData();

		expect(mockedClearProfiles).toHaveBeenCalledTimes(1);
		expect(mockedClearMediaIds).toHaveBeenCalledTimes(1);
	});

	it("clears the app-lock gates in memory as well as in storage", async () => {
		await purgeAccountLocalData();

		expect(mockedDisablePin).toHaveBeenCalledTimes(1);
		expect(mockedSetBiometric).toHaveBeenCalledWith(false);
	});

	/**
	 * THE P0 DEFECT. `objectUrlCache` is module state holding `blob:` object URLs
	 * for up to 32 FULL-RESOLUTION photos, and `resolveAuthedImage` returns a
	 * cache hit WITHOUT re-checking the session. `clearMediaIdCache()` — the only
	 * media-adjacent call the purge used to make — clears a localStorage key of
	 * minted media ids and cannot reach a single one of those bytes.
	 */
	it("empties the authenticated media cache and revokes every object URL", async () => {
		serveJpeg();
		for (let i = 0; i < 3; i++) {
			await resolveAuthedImage(
				`https://cdns.grindr.com/images/full/previous-${i}.jpg`,
			);
		}
		expect(__cachedAuthedImageCount()).toBe(3);
		expect(liveUrlCount()).toBe(3);

		await purgeAccountLocalData();

		expect(__cachedAuthedImageCount()).toBe(0);
		expect(liveUrlCount()).toBe(0);
	});

	it("does not let a second account resolve the first account's cached media", async () => {
		serveJpeg();
		const photo = "https://cdns.grindr.com/images/full/shared-album-photo.jpg";

		// Account A opens a full-resolution photo. It is served from the cache
		// with no further IPC, which is precisely why the leak was not visible as
		// a network request.
		const accountA = (await resolveAuthedImage(photo)) as string;
		expect(await resolveAuthedImage(photo)).toBe(accountA);
		expect(invoke).toHaveBeenCalledTimes(1);

		// Sign out. Account A's bytes must be unrecoverable from here on.
		await purgeAccountLocalData();
		expect(urlLive.get(accountA)).toBe(false);

		// Account B signs in and opens the same photo. The purge forces a real
		// fetch under B's session and mints a fresh object URL; there is no code
		// path that returns A's blob to B.
		const accountB = (await resolveAuthedImage(photo)) as string;
		expect(accountB).not.toBe(accountA);
		expect(invoke).toHaveBeenCalledTimes(2);
		expect(urlLive.get(accountB)).toBe(true);
	});

	// `clearStoredViewers()` existed with zero callers, and the key was not in
	// the purge list, so the previous account's last-50 viewer list survived both
	// in localStorage AND in the rune store that rehydrates from it.
	it("clears the stored viewer list in memory and in storage", async () => {
		recordViewers(
			[
				{
					profileId: 1,
					displayName: "Alex",
					profileImageMediaHash: "hash1",
					seen: 1_700_000_000_000,
					distance: 120,
					viewCount: 3,
				},
			],
			1_700_000_000_000,
		);
		expect(getStoredViewers()).toHaveLength(1);

		await purgeAccountLocalData();

		expect(getStoredViewers()).toHaveLength(0);
		expect(localStorage.getItem("grindrx-stored-viewers")).toBeNull();
	});

	it("erases the profile identity index on sign-out", async () => {
		// The index resolves masked viewers against profile ids the PREVIOUS
		// account fetched. Leaving it behind would let the next account resolve
		// their masked viewers against the previous account's people — wrong, and
		// cross-account.
		rememberProfileIdentity({
			profileId: 1,
			profileImageMediaHash: "a".repeat(40),
		});
		expect(storedIdentityCount()).toBe(1);

		await purgeAccountLocalData();

		expect(localStorage.getItem("grindrx-profile-identities")).toBeNull();
		// Cleared in memory too, not just on disk: the module rehydrates from
		// localStorage, so a memory-only clear would be undone on next use.
		expect(storedIdentityCount()).toBe(0);
	});

	it("drops the geohash-pinned flag along with the geohash it describes", async () => {
		// Both are purged. Leaving the flag behind would be a dangling reference:
		// `isGeohashPinned()` would keep reporting "chosen by hand" for a geohash
		// that no longer exists, suppressing the next account's first GPS write.
		await purgeAccountLocalData();

		expect(localStorage.getItem("grindrx-geohash-user-pinned")).toBeNull();
		expect(localStorage.getItem("grindrx-explore-location")).toBeNull();
	});

	it("deletes preferences.data when the fs plugin allows it", async () => {
		mockedRemove.mockResolvedValue(undefined);

		await purgeAccountLocalData();

		expect(mockedRemove).toHaveBeenCalledWith("preferences.data", {
			baseDir: BaseDirectory.AppData,
		});
		// No compensating overwrite needed when the delete succeeded.
		expect(mockedWrite).not.toHaveBeenCalled();
	});

	// `fs:allow-remove` is not in the capability set, so the delete above is
	// rejected in the shipped app. The PII must still go.
	it("overwrites preferences.data with a PII-free default payload when delete is rejected", async () => {
		mockedRemove.mockRejectedValue(new Error("fs scope not allowed"));

		await purgeAccountLocalData();

		expect(mockedWrite).toHaveBeenCalledTimes(1);
		const [path, bytes] = mockedWrite.mock.calls[0];
		expect(path).toBe("preferences.data");
		const written = decode(bytes) as Record<string, unknown>;
		expect(written).toEqual({
			geohash: null,
			revealMessageRead: false,
			revealProfileViews: false,
			incognito: false,
			notifyMessages: true,
			notifyTaps: true,
		});
	});

	it("is idempotent, and does not throw when a key is already absent", async () => {
		await expect(purgeAccountLocalData()).resolves.toBeUndefined();
		localStorage.clear();
		mockedRemove.mockRejectedValue(new Error("fs scope not allowed"));

		await expect(purgeAccountLocalData()).resolves.toBeUndefined();
		expect(localStorage.length).toBe(0);
	});

	it("never throws when a step fails, and still purges the rest", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockedRemove.mockRejectedValue(new Error("fs scope not allowed"));
		mockedWrite.mockRejectedValue(new Error("disk full"));
		mockedClearProfiles.mockImplementation(() => {
			throw new Error("cache boom");
		});

		await expect(purgeAccountLocalData()).resolves.toBeUndefined();

		// The localStorage pass ran despite the earlier failure.
		expect(localStorage.getItem("grindrx-saved-phrases")).toBeNull();
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});

describe("the purge list", () => {
	it("covers every key the audit found surviving a sign-out", () => {
		expect([...PER_ACCOUNT_LOCALSTORAGE_KEYS]).toEqual(
			expect.arrayContaining([
				"grindrx-saved-phrases",
				"grindrx-explore-location",
				"grindrx-mediaid-cache",
				// Added: the previous account's last-50 viewer history.
				"grindrx-stored-viewers",
				// Added: the flag describing the geohash purged above.
				"grindrx-geohash-user-pinned",
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
			]),
		);
		expect([...PER_ACCOUNT_LOCALSTORAGE_PREFIXES]).toEqual([
			"chat:read:",
			"grindrx-update-dismissed-",
		]);
	});

	/**
	 * DECISION (2026-10-09): `grindrx-last-seen-version` is NOT purged, and this
	 * assertion is deliberate rather than inherited.
	 *
	 * The review that prompted this fix flagged the pre-existing
	 * `expect(...).toBe("0.1.33")` as "encoding the bug". It does not:
	 *
	 *  - It is DEVICE-SCOPED and self-contained. The value is the running app
	 *    VERSION string. No profile id, no location, no conversation, no media,
	 *    no user-activity timestamp — nothing that ties it to an account or lets
	 *    one account be told apart from another. The leak class here is "the
	 *    previous account's data reaches the next account"; a version string is
	 *    not the previous account's data.
	 *  - It references nothing account-specific that is being purged. By
	 *    contrast `grindrx-geohash-user-pinned` DOES, which is exactly why it
	 *    was added to the purge list: leaving a flag that describes a deleted
	 *    geohash suppresses the next account's first GPS write and can leave the
	 *    grid showing the previous account's location.
	 *  - PURGING IT WOULD REGRESS SIGN-OUT. `isFirstRun()` is
	 *    `SEEN_VERSION_KEY === null && TOUR_DONE_KEY === null`, and
	 *    `grindrx-tour-done` IS purged. Deleting the version marker makes both
	 *    null, so `(protected)/+layout.svelte` auto-opens the feature-tour drawer
	 *    for whoever signs in next. The surviving marker is the only thing vetoing
	 *    that today.
	 *
	 * Net: a UX regression bought with zero privacy gain. Kept. (The mirror
	 * inconsistency — `grindrx-tour-done` being device-scoped yet purged — is
	 * documented in `purge.ts` and deliberately left out of scope.)
	 */
	it("keeps the device-scoped last-seen-version marker, and says so on purpose", async () => {
		expect([...DEVICE_SCOPED_KEYS_KEPT_ON_SIGNOUT]).toEqual([
			"grindrx-last-seen-version",
		]);
		expect([...PER_ACCOUNT_LOCALSTORAGE_KEYS]).not.toContain(
			"grindrx-last-seen-version",
		);

		await purgeAccountLocalData();

		expect(localStorage.getItem("grindrx-last-seen-version")).toBe("0.1.33");
		// Its own onboarding sibling is purged, so this surviving key is the only
		// thing keeping `isFirstRun()` false for the next account.
		expect(localStorage.getItem("grindrx-tour-done")).toBeNull();
	});
});
