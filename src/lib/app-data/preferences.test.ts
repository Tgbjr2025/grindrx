import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/app-data", () => ({
	existsAppDataFile: vi.fn(),
	readAppDataFile: vi.fn(),
	writeAppDataFile: vi.fn(),
}));

import { decode, encode } from "@msgpack/msgpack";

import {
	existsAppDataFile,
	readAppDataFile,
	writeAppDataFile,
} from "$lib/app-data";
import { getPreferences, setPreferences } from "$lib/app-data/preferences.svelte";

const mockedExists = vi.mocked(existsAppDataFile);
const mockedRead = vi.mocked(readAppDataFile);
const mockedWrite = vi.mocked(writeAppDataFile);

const DEFAULTS = {
	geohash: null,
	revealMessageRead: false,
	revealProfileViews: false,
	incognito: false,
	notifyMessages: true,
	notifyTaps: true,
};

function encodedPrefs(overrides: Record<string, unknown> = {}) {
	return encode({ ...DEFAULTS, ...overrides });
}

// Never used by msgpack (an explicitly reserved type byte) — guaranteed to
// throw on decode, regardless of msgpack implementation details, rather than
// relying on a "trailing bytes" heuristic.
const UNDECODABLE_BYTES = new Uint8Array([0xc1]);

beforeEach(() => {
	vi.clearAllMocks();
	mockedWrite.mockResolvedValue(undefined);
});

describe("getPreferences", () => {
	it("returns defaults when the file doesn't exist yet", async () => {
		mockedExists.mockResolvedValueOnce(false);

		const prefs = await getPreferences();

		expect(prefs).toEqual(DEFAULTS);
		expect(mockedRead).not.toHaveBeenCalled();
	});

	it("returns the decoded, parsed preferences when the file is readable", async () => {
		mockedExists.mockResolvedValueOnce(true);
		mockedRead.mockResolvedValueOnce(
			encodedPrefs({ geohash: "9q8yyk8ytpxr", incognito: true }),
		);

		const prefs = await getPreferences();

		expect(prefs.geohash).toBe("9q8yyk8ytpxr");
		expect(prefs.incognito).toBe(true);
	});

	// The home route's `{#await preferences}` has no catch — letting a
	// decode/parse failure reject here used to hard-crash the app on a
	// corrupt/half-written file until relaunch.
	it("degrades to defaults (does not reject) when the raw bytes fail to decode", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockedExists.mockResolvedValueOnce(true);
		mockedRead.mockResolvedValueOnce(UNDECODABLE_BYTES);

		const prefs = await getPreferences();

		expect(prefs).toEqual(DEFAULTS);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("degrades to defaults when the decoded value fails schema validation", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockedExists.mockResolvedValueOnce(true);
		// geohash must be a string|null per preferencesSchema — a number fails parse.
		mockedRead.mockResolvedValueOnce(encode({ geohash: 12345 }));

		const prefs = await getPreferences();

		expect(prefs).toEqual(DEFAULTS);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});

describe("setPreferences", () => {
	it("merges new values onto the existing preferences and writes them", async () => {
		mockedExists.mockResolvedValueOnce(true);
		mockedRead.mockResolvedValueOnce(
			encodedPrefs({ geohash: "9q8yyk8ytpxr" }),
		);

		await setPreferences({ incognito: true });

		expect(mockedWrite).toHaveBeenCalledTimes(1);
		const [path, bytes] = mockedWrite.mock.calls[0];
		expect(path).toBe("preferences.data");
		const written = decode(bytes) as Record<string, unknown>;
		expect(written.geohash).toBe("9q8yyk8ytpxr");
		expect(written.incognito).toBe(true);
	});

	it("writes fresh defaults + newValues when there was no file yet (missing, not unreadable)", async () => {
		mockedExists.mockResolvedValueOnce(false);

		await setPreferences({ incognito: true });

		expect(mockedWrite).toHaveBeenCalledTimes(1);
		const [, bytes] = mockedWrite.mock.calls[0];
		const written = decode(bytes) as Record<string, unknown>;
		expect(written).toEqual({ ...DEFAULTS, incognito: true });
	});

	// REGRESSION (preferences-degraded-read-clobbers-persisted-settings): a read
	// that degrades to defaults because the file is PRESENT but unreadable (e.g.
	// racing the non-atomic truncate+write, or a file left half-written by an
	// app kill) must NOT be persisted back — that would silently wipe the user's
	// saved geohash/filters. Distinct from the "missing" case above, which is
	// safe to write fresh defaults over.
	it("REGRESSION: does not clobber a present-but-unreadable file with defaults", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockedExists.mockResolvedValueOnce(true);
		mockedRead.mockResolvedValueOnce(UNDECODABLE_BYTES);

		await setPreferences({ incognito: true });

		expect(mockedWrite).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("swallows a write failure instead of rejecting", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockedExists.mockResolvedValueOnce(false);
		mockedWrite.mockRejectedValueOnce(new Error("disk full"));

		await expect(setPreferences({ incognito: true })).resolves.toBeUndefined();

		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});
