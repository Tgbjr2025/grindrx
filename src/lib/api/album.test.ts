import { describe, expect, it, vi } from "vitest";

// Importing $lib/api/album pulls in the $lib/api bridge (which references the
// Tauri `invoke`). These tests only exercise PURE helpers that never hit the
// network, but mock the core module so the import graph is inert — matching the
// sibling api tests (index.test.ts / profile.test.ts).
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import {
	ALBUM_NAME_MAX_BYTES,
	buildAddContentBody,
	buildAlbumNameBody,
	buildRemoveViewerBody,
	parseAlbumViewerIds,
	truncateToUtf8Bytes,
} from "$lib/api/album";

const byteLength = (s: string) => new TextEncoder().encode(s).length;

describe("truncateToUtf8Bytes", () => {
	it("leaves short strings untouched", () => {
		expect(truncateToUtf8Bytes("hello", 255)).toBe("hello");
	});

	it("clamps ASCII to the byte budget", () => {
		expect(truncateToUtf8Bytes("aaaaa", 3)).toBe("aaa");
	});

	it("never splits a multi-byte codepoint", () => {
		// "😀" is 4 UTF-8 bytes. With a 5-byte budget only one fits, and the
		// second must be dropped whole — never cut into an invalid half.
		const result = truncateToUtf8Bytes("😀😀", 5);
		expect(result).toBe("😀");
		expect(byteLength(result)).toBeLessThanOrEqual(5);
	});

	it("returns empty when even the first codepoint overflows", () => {
		expect(truncateToUtf8Bytes("😀", 2)).toBe("");
	});
});

describe("buildAlbumNameBody", () => {
	it("wraps the name under albumName", () => {
		expect(buildAlbumNameBody("Beach trip")).toEqual({ albumName: "Beach trip" });
	});

	it("coerces non-string input to a string", () => {
		// The runtime can hand us a non-string (the API coerces too); guard it.
		expect(buildAlbumNameBody(42 as unknown as string)).toEqual({ albumName: "42" });
	});

	it("clamps to the documented 255-byte maximum", () => {
		const body = buildAlbumNameBody("x".repeat(300));
		expect(byteLength(body.albumName)).toBe(ALBUM_NAME_MAX_BYTES);
		expect(byteLength(body.albumName)).toBeLessThanOrEqual(ALBUM_NAME_MAX_BYTES);
	});

	it("allows an empty name", () => {
		expect(buildAlbumNameBody("")).toEqual({ albumName: "" });
	});
});

describe("buildAddContentBody", () => {
	it("carries both the numeric mediaId and the mediaHash", () => {
		expect(
			buildAddContentBody({ mediaId: 12345, mediaHash: "abc123" }),
		).toEqual({ mediaId: 12345, mediaHash: "abc123" });
	});
});

describe("buildRemoveViewerBody", () => {
	it("wraps the profile in the profiles array with shareId 0", () => {
		expect(buildRemoveViewerBody(999)).toEqual({
			profiles: [{ profileId: 999, shareId: 0 }],
		});
	});
});

describe("parseAlbumViewerIds", () => {
	it("extracts a clean list of ids", () => {
		expect(parseAlbumViewerIds({ profileIds: [1, 2, 3] })).toEqual([1, 2, 3]);
	});

	it("coerces stringified ids (Grindr sometimes sends longs as strings)", () => {
		expect(parseAlbumViewerIds({ profileIds: ["10", 20] })).toEqual([10, 20]);
	});

	it("drops entries that aren't coercible to an int, keeping the rest", () => {
		expect(
			parseAlbumViewerIds({ profileIds: [1, "nope", null, 2] }),
		).toEqual([1, 2]);
	});

	it("returns an empty array for a missing/blank profileIds field", () => {
		expect(parseAlbumViewerIds({})).toEqual([]);
		expect(parseAlbumViewerIds({ profileIds: [] })).toEqual([]);
	});

	it("returns an empty array for an unexpected/null payload", () => {
		expect(parseAlbumViewerIds(null)).toEqual([]);
		expect(parseAlbumViewerIds("garbage")).toEqual([]);
		expect(parseAlbumViewerIds({ profileIds: "not-an-array" })).toEqual([]);
	});
});
