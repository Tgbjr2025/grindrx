import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("$lib/utils/authed-image", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/utils/authed-image")>();
	return {
		...actual,
		fetchAuthedBytes: vi.fn(),
		fetchMediaBytes: vi.fn(),
	};
});

import { invoke } from "@tauri-apps/api/core";

import { fetchAuthedBytes, fetchMediaBytes } from "$lib/utils/authed-image";

import {
	bytesToBase64,
	invalidateCachedMediaId,
	prepareAuthedUrlForSend,
	prepareSavedPhotoForSend,
} from "$lib/api/profile";

const mockedInvoke = vi.mocked(invoke);
const mockedFetchAuthedBytes = vi.mocked(fetchAuthedBytes);
const mockedFetchMediaBytes = vi.mocked(fetchMediaBytes);

function uploadResult(mediaId: number, mediaHash: string, url: string) {
	return {
		status: 201,
		body: JSON.stringify({ mediaId, mediaHash, url }),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("prepareSavedPhotoForSend", () => {
	it("fetches the 1024x1024 profile CDN URL (authed) and returns the minted media", async () => {
		const hash = "a".repeat(40);
		mockedFetchAuthedBytes.mockResolvedValueOnce({
			buffer: new Uint8Array([1, 2, 3]).buffer,
			mime: "image/jpeg",
		});
		mockedInvoke.mockResolvedValueOnce(uploadResult(111, "b".repeat(64), "https://cdns.grindr.com/x"));

		const result = await prepareSavedPhotoForSend(hash);

		expect(mockedFetchAuthedBytes).toHaveBeenCalledWith(
			`https://cdns.grindr.com/images/profile/1024x1024/${hash}`,
		);
		expect(mockedFetchMediaBytes).not.toHaveBeenCalled();
		expect(result).toEqual({
			mediaId: 111,
			mediaHash: "b".repeat(64),
			url: "https://cdns.grindr.com/x",
		});
	});

	// REGRESSION (Tom issue 1b): sending the same saved photo twice must reuse
	// the minted mediaId instead of re-fetching + re-uploading every time.
	it("REGRESSION: sending the same saved photo twice mints the mediaId only once", async () => {
		const hash = "e".repeat(40);
		mockedFetchAuthedBytes.mockResolvedValueOnce({
			buffer: new Uint8Array([7, 7, 7]).buffer,
			mime: "image/jpeg",
		});
		mockedInvoke.mockResolvedValueOnce(uploadResult(333, "f".repeat(64), "https://cdns.grindr.com/z"));

		const first = await prepareSavedPhotoForSend(hash);
		const second = await prepareSavedPhotoForSend(hash);

		expect(second).toEqual(first);
		expect(mockedFetchAuthedBytes).toHaveBeenCalledTimes(1);
		expect(mockedInvoke).toHaveBeenCalledTimes(1);
	});

	it("invalidateCachedMediaId evicts the cache so the next send re-mints", async () => {
		const hash = "1".repeat(40);
		mockedFetchAuthedBytes
			.mockResolvedValueOnce({ buffer: new Uint8Array([1]).buffer, mime: "image/jpeg" })
			.mockResolvedValueOnce({ buffer: new Uint8Array([2]).buffer, mime: "image/jpeg" });
		mockedInvoke
			.mockResolvedValueOnce(uploadResult(1, "2".repeat(64), "https://cdns.grindr.com/a"))
			.mockResolvedValueOnce(uploadResult(2, "3".repeat(64), "https://cdns.grindr.com/b"));

		const first = await prepareSavedPhotoForSend(hash);
		invalidateCachedMediaId(hash);
		const second = await prepareSavedPhotoForSend(hash);

		expect(first.mediaId).toBe(1);
		expect(second.mediaId).toBe(2);
		expect(mockedInvoke).toHaveBeenCalledTimes(2);
	});
});

describe("prepareAuthedUrlForSend", () => {
	it("throws a friendly message when fetchAuthedBytes returns null for a grindr host", async () => {
		mockedFetchAuthedBytes.mockResolvedValueOnce(null);

		await expect(
			prepareAuthedUrlForSend("https://cdns.grindr.com/images/does-not-load", "private photo"),
		).rejects.toThrow("Could not fetch the private photo to re-send it.");
		expect(mockedFetchMediaBytes).not.toHaveBeenCalled();
	});

	// Issue 1a (HIGH): signed CloudFront album URLs are NOT a grindr host, so
	// they must go through fetchMediaBytes (no bearer), not fetchAuthedBytes
	// (which returns null for non-grindr hosts and used to throw here).
	it("uses fetchMediaBytes (no bearer) for a signed CloudFront host and mints media", async () => {
		const url = "https://d2wxe7lth7kp8g.cloudfront.net/abc?sig=xyz";
		mockedFetchMediaBytes.mockResolvedValueOnce({
			buffer: new Uint8Array([9, 9, 9]).buffer,
			mime: "image/jpeg",
		});
		mockedInvoke.mockResolvedValueOnce(uploadResult(222, "c".repeat(64), "https://cdns.grindr.com/y"));

		const result = await prepareAuthedUrlForSend(url, "private photo");

		expect(mockedFetchMediaBytes).toHaveBeenCalledWith(url);
		expect(mockedFetchAuthedBytes).not.toHaveBeenCalled();
		expect(result).not.toBeNull();
		expect(result.mediaId).toBe(222);
	});

	it("throws when the upload responds with an error status (uploadImageBytes)", async () => {
		mockedFetchAuthedBytes.mockResolvedValueOnce({
			buffer: new Uint8Array([1]).buffer,
			mime: "image/jpeg",
		});
		mockedInvoke.mockResolvedValueOnce({ status: 400, body: "urn:gr:err:internal_error" });

		await expect(
			prepareAuthedUrlForSend("https://cdns.grindr.com/images/bad-status", "photo"),
		).rejects.toThrow(/Upload failed \(400\)/);
	});

	it("throws when the upload response is missing mediaId (uploadImageBytes)", async () => {
		mockedFetchAuthedBytes.mockResolvedValueOnce({
			buffer: new Uint8Array([1]).buffer,
			mime: "image/jpeg",
		});
		mockedInvoke.mockResolvedValueOnce({
			status: 200,
			body: JSON.stringify({ mediaHash: "d".repeat(64), url: "https://cdns.grindr.com/no-id" }),
		});

		await expect(
			prepareAuthedUrlForSend("https://cdns.grindr.com/images/missing-id", "photo"),
		).rejects.toThrow(/missing mediaId/);
	});

	it("caches by the given cacheKey (e.g. album contentId) across repeat sends", async () => {
		const url = "https://d2wxe7lth7kp8g.cloudfront.net/album-photo?sig=abc";
		mockedFetchMediaBytes.mockResolvedValueOnce({
			buffer: new Uint8Array([4, 5, 6]).buffer,
			mime: "image/jpeg",
		});
		mockedInvoke.mockResolvedValueOnce(uploadResult(444, "9".repeat(64), "https://cdns.grindr.com/album"));

		const first = await prepareAuthedUrlForSend(url, "private photo", "content-9001");
		const second = await prepareAuthedUrlForSend(url, "private photo", "content-9001");

		expect(second).toEqual(first);
		expect(mockedFetchMediaBytes).toHaveBeenCalledTimes(1);
		expect(mockedInvoke).toHaveBeenCalledTimes(1);
	});
});

describe("bytesToBase64", () => {
	const sizes = [0, 1, 255, 0x7fff, 0x8000, 0x8001, 3 * 0x8000 + 7];

	it.each(sizes)("round-trips a buffer of length %i without corruption at the chunk boundary", (length) => {
		const bytes = Uint8Array.from({ length }, (_, i) => i % 256);

		const encoded = bytesToBase64(bytes);
		const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));

		expect(decoded).toEqual(bytes);
	});

	it("round-trips every byte value 0..255", () => {
		const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);

		const encoded = bytesToBase64(bytes);
		const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));

		expect(decoded).toEqual(bytes);
	});
});
