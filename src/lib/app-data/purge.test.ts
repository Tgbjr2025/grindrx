import { decode } from "@msgpack/msgpack";
import { BaseDirectory, remove } from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeAppDataFile } from "$lib/app-data";
import {
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

vi.mock("@tauri-apps/plugin-fs", () => ({
	BaseDirectory: { AppData: 7 },
	remove: vi.fn(),
}));

vi.mock("$lib/app-data", () => ({
	writeAppDataFile: vi.fn(),
}));

import { clearAllProfileCaches, clearMediaIdCache } from "$lib/api/profile";
import { disablePin, setBiometricUnlock } from "$lib/app-data/app-lock.svelte";

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

// Every key the audit found surviving a sign-out, seeded with recognisable PII.
const SEEDED_PII: Record<string, string> = {
	"grindrx-saved-phrases": '["meet me at the pier"]',
	"grindrx-explore-location": '{"geohash":"9q8yyk8ytpxr"}',
	"grindrx-mediaid-cache":
		'{"abc":{"mediaId":42,"signedUrl":"https://x.cloudfront.net/a?sig=secret"}}',
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
	// Must SURVIVE: not per-account data.
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
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("purgeAccountLocalData", () => {
	it("removes every per-account localStorage key", async () => {
		await purgeAccountLocalData();

		for (const key of Object.keys(SEEDED_PII)) {
			if (key === "grindrx-last-seen-version" || key === "some-unrelated-key") {
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

	it("leaves non-account storage alone", async () => {
		await purgeAccountLocalData();

		expect(localStorage.getItem("grindrx-last-seen-version")).toBe("0.1.33");
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
});
