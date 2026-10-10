import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	prepareImageForUpload,
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

// --- EXIF / metadata sanitization --------------------------------------------
//
// `downscaleImage` used to re-encode ONLY images larger than MAX_UPLOAD_EDGE.
// The canvas encode is what strips EXIF/IPTC/XMP, so every photo at 1920px or
// under — i.e. most of them — was uploaded with its GPS coordinates, camera
// model and capture timestamp intact. Four exits returned the raw file: the
// GIF early-return, the under-threshold branch, the `!ctx` fallback and the
// `catch`. These cover all four.

function ascii(text: string): number[] {
	return Array.from(text, (c) => c.charCodeAt(0));
}

/** Index of `needle` inside `haystack`, or -1. */
function indexOfSeq(haystack: Uint8Array, needle: number[]): number {
	outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) continue outer;
		}
		return i;
	}
	return -1;
}

function decode(base64: string): Uint8Array {
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** A JPEG segment: marker + 2-byte big-endian length (inclusive) + payload. */
function jpegSegment(marker: number, payload: number[]): number[] {
	return [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
}

const EXIF_PAYLOAD = "Exif  GPS:48.8584,2.2945 CAM:iPhone15,2 2026:10:05 11:22:33";
const IPTC_PAYLOAD = "Photoshop 3.0 8BIM ";
const COM_PAYLOAD = "shot on my phone at home";

/**
 * A JPEG carrying every metadata flavour: EXIF (APP1), IPTC (APP13), a comment
 * (COM), plus JFIF (APP0), ICC (APP2) and Adobe (APP14) which MUST survive.
 */
function jpegWithMetadata(): Uint8Array {
	return Uint8Array.from([
		0xff, 0xd8, // SOI
		...jpegSegment(0xe0, ascii("JFIF    ")),
		...jpegSegment(0xe1, ascii(EXIF_PAYLOAD)), // DROP
		...jpegSegment(0xe2, ascii("ICCPROF  fake-profile")), // KEEP
		...jpegSegment(0xed, ascii(IPTC_PAYLOAD)), // DROP
		...jpegSegment(0xee, ascii("Adobe@dct@0")), // KEEP
		...jpegSegment(0xfe, ascii(COM_PAYLOAD)), // DROP
		...jpegSegment(0xda, [0x01, 0x01, 0x00]), // SOS
		0xde, 0xad, 0xbe, 0xef, // entropy-coded scan payload
		0xff, 0xd9, // EOI
	]);
}

/** One GIF image descriptor (2x2, no local colour table) + its LZW data. */
function gifFrame(pixel: number): number[] {
	return [
		0x2c, // image separator
		0x02, 0x00, 0x02, 0x00, // left, top
		0x02, 0x00, 0x02, 0x00, // width, height
		0x00, // packed: no LCT, not interlaced
		0x02, // LZW minimum code size
		0x03, pixel, pixel, pixel, // one data sub-block
		0x00, // sub-block terminator
	];
}

/**
 * An animated 2-frame GIF whose metadata lives in a Comment extension and in an
 * XMP Application extension, alongside a NETSCAPE2.0 loop directive.
 */
function gifWithMetadata(): Uint8Array {
	return Uint8Array.from([
		...ascii("GIF89a"),
		0x02, 0x00, 0x02, 0x00, // logical screen width
		0x02, 0x00, 0x02, 0x00, // logical screen height
		0x00, 0x00, 0x00, // packed, background colour index, aspect
		// Graphic Control extension — frame delay + transparency. KEEP.
		0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00,
		// Comment extension (0x0d = 13 payload bytes, then a terminator). DROP.
		0x21, 0xfe, 0x0d, ...ascii("GPS 48.8584 N"), 0x00,
		// Application extension carrying XMP. DROP. The identifier is a fixed
		// 11 bytes (no length prefix) followed by a 3-byte auth code.
		0x21, 0xff, ...ascii("XMP DataXMP"), 0x03, 0x00, 0x00,
		0x04, ...ascii("GPS!"), 0x00,
		// Application extension carrying the loop count. KEEP.
		0x21, 0xff, ...ascii("NETSCAPE2.0"), 0x03, 0x00, 0x00,
		0x03, 0x01, 0x00, 0x00, 0x00,
		...gifFrame(0xaa),
		...gifFrame(0xbb),
		0x3b, // trailer
	]);
}

function fakeFile(bytes: Uint8Array, type: string): File {
	return {
		type,
		arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
	} as unknown as File;
}

/** Bytes a canvas encode "produces" — a fresh file, so with no metadata in it. */
function canvasEncodedBytes(): Uint8Array {
	return Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xd9]);
}

interface FakeCanvas {
	width: number;
	height: number;
	getContext: () => { drawImage: (...args: unknown[]) => void } | null;
	toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => void;
}

interface BrowserStubOptions {
	bitmap?: { width: number; height: number };
	decodeThrows?: boolean;
	noContext?: boolean;
	encoded?: Uint8Array | null;
}

interface CanvasSpy {
	toBlobCalls: { type: string; quality: number | undefined }[];
	encodedSize: { width: number; height: number } | null;
	drawn: unknown[] | null;
}

/** Stub the two browser globals `downscaleImage` touches. */
function installBrowser(opts: BrowserStubOptions = {}): CanvasSpy {
	const spy: CanvasSpy = { toBlobCalls: [], encodedSize: null, drawn: null };

	vi.stubGlobal("createImageBitmap", () => {
		if (opts.decodeThrows) return Promise.reject(new Error("decode failed"));
		return Promise.resolve({
			width: opts.bitmap?.width ?? 0,
			height: opts.bitmap?.height ?? 0,
			close: () => {},
		});
	});

	const canvas: FakeCanvas = {
		width: 0,
		height: 0,
		getContext: () =>
			opts.noContext
				? null
				: {
						drawImage: (...args: unknown[]) => {
							spy.drawn = args;
						},
					},
		toBlob: (cb, type, quality) => {
			spy.encodedSize = { width: canvas.width, height: canvas.height };
			spy.toBlobCalls.push({ type: type ?? "", quality });
			if (opts.encoded === null) {
				cb(null);
				return;
			}
			const encoded = (opts.encoded ?? canvasEncodedBytes()).slice();
			cb(new Blob([encoded.buffer], { type }));
		},
	};

	vi.stubGlobal("document", { createElement: () => canvas });
	return spy;
}

describe("prepareImageForUpload — EXIF sanitization (P0)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// THE DEFECT: an image at or below MAX_UPLOAD_EDGE took the
	// `if (longest <= MAX_UPLOAD_EDGE) return original()` exit and was uploaded
	// byte-for-byte, EXIF and all.
	it("REGRESSION: an image at/below the threshold is re-encoded, not uploaded raw", async () => {
		const original = jpegWithMetadata();
		const spy = installBrowser({ bitmap: { width: 1024, height: 768 } });

		const result = await prepareImageForUpload(fakeFile(original, "image/jpeg"));

		// It went through the canvas instead of short-circuiting to the file.
		expect(spy.drawn).not.toBeNull();
		expect(result.base64).not.toBe(bytesToBase64(original));
		// ...and what came back is the canvas encode, not the EXIF-bearing file.
		expect(decode(result.base64)).toEqual(canvasEncodedBytes());
		expect(indexOfSeq(decode(result.base64), ascii("Exif"))).toBe(-1);
	});

	it("REGRESSION: an image exactly AT the 1920px threshold is still sanitized", async () => {
		const original = jpegWithMetadata();
		installBrowser({ bitmap: { width: 1920, height: 1440 } });

		const result = await prepareImageForUpload(fakeFile(original, "image/jpeg"));

		expect(result.base64).not.toBe(bytesToBase64(original));
		expect(indexOfSeq(decode(result.base64), ascii("Exif"))).toBe(-1);
	});

	it("keeps the 1920px downscale and JPEG 0.85 quality for oversized images", async () => {
		const spy = installBrowser({ bitmap: { width: 4000, height: 3000 } });

		const result = await prepareImageForUpload(
			fakeFile(jpegWithMetadata(), "image/jpeg"),
		);

		expect(spy.encodedSize).toEqual({ width: 1920, height: 1440 });
		expect(spy.toBlobCalls).toEqual([{ type: "image/jpeg", quality: 0.85 }]);
		expect(result.width).toBe(1920);
		expect(result.height).toBe(1440);
		expect(result.mimeType).toBe("image/jpeg");
	});

	// Rust rejects a zero crop, so width/height must describe the bytes we are
	// actually returning — not 0, and not the un-resampled original.
	it("reports correct width/height for both the under-threshold and oversize paths", async () => {
		installBrowser({ bitmap: { width: 1024, height: 768 } });
		const small = await prepareImageForUpload(
			fakeFile(jpegWithMetadata(), "image/jpeg"),
		);
		expect(small.width).toBe(1024);
		expect(small.height).toBe(768);

		installBrowser({ bitmap: { width: 4000, height: 3000 } });
		const large = await prepareImageForUpload(
			fakeFile(jpegWithMetadata(), "image/jpeg"),
		);
		expect(large.width).toBe(1920);
		expect(large.height).toBe(1440);
	});

	it("keeps PNG as PNG so transparency survives the strip", async () => {
		const spy = installBrowser({ bitmap: { width: 800, height: 600 } });

		const result = await prepareImageForUpload(
			fakeFile(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), "image/png"),
		);

		expect(spy.toBlobCalls).toEqual([{ type: "image/png", quality: 0.85 }]);
		expect(result.mimeType).toBe("image/png");
	});
});

describe("prepareImageForUpload — canvas-failure fallbacks", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// The `!ctx` exit used to return the raw file. It must now strip bytes
	// instead: a WebView that cannot give us a 2d context is exactly the
	// moment a GPS tag must not slip through.
	it("REGRESSION: no 2d context falls back to a byte-level strip, not the raw file", async () => {
		const original = jpegWithMetadata();
		installBrowser({ noContext: true, bitmap: { width: 1024, height: 768 } });

		const result = await prepareImageForUpload(fakeFile(original, "image/jpeg"));

		const out = decode(result.base64);
		expect(result.base64).not.toBe(bytesToBase64(original));
		expect(indexOfSeq(out, ascii("Exif"))).toBe(-1);
		expect(indexOfSeq(out, ascii(COM_PAYLOAD))).toBe(-1);
	});

	it("REGRESSION: a null toBlob falls back to a byte-level strip, not the raw file", async () => {
		const original = jpegWithMetadata();
		installBrowser({
			encoded: null,
			bitmap: { width: 1024, height: 768 },
		});

		const result = await prepareImageForUpload(fakeFile(original, "image/jpeg"));

		expect(result.base64).not.toBe(bytesToBase64(original));
		expect(indexOfSeq(decode(result.base64), ascii("Exif"))).toBe(-1);
	});

	// A metadata failure must degrade, not throw — the catch stays defensive.
	it("REGRESSION: a decode failure strips without throwing", async () => {
		const original = jpegWithMetadata();
		installBrowser({ decodeThrows: true });

		const result = await prepareImageForUpload(fakeFile(original, "image/jpeg"));

		expect(result.base64).not.toBe(bytesToBase64(original));
		expect(indexOfSeq(decode(result.base64), ascii("Exif"))).toBe(-1);
	});

	it("keeps JFIF, ICC and Adobe segments while dropping EXIF/IPTC/COM and the scan data", async () => {
		installBrowser({ noContext: true, bitmap: { width: 1024, height: 768 } });

		const out = decode(
			(await prepareImageForUpload(fakeFile(jpegWithMetadata(), "image/jpeg")))
				.base64,
		);

		// Metadata containers gone.
		expect(indexOfSeq(out, ascii("Exif"))).toBe(-1);
		expect(indexOfSeq(out, ascii(IPTC_PAYLOAD))).toBe(-1);
		expect(indexOfSeq(out, ascii(COM_PAYLOAD))).toBe(-1);
		expect(out[3] === 0xe0 && out[4] === 0xe1).toBe(false); // APP1 segment gone
		// Colour/decoding segments kept — dropping these would break rendering.
		expect(indexOfSeq(out, ascii("JFIF"))).toBeGreaterThan(-1);
		expect(indexOfSeq(out, ascii("ICCPROF"))).toBeGreaterThan(-1);
		expect(indexOfSeq(out, ascii("Adobe@dct@0"))).toBeGreaterThan(-1);
		// Entropy-coded scan data copied through verbatim.
		expect(indexOfSeq(out, [0xde, 0xad, 0xbe, 0xef])).toBeGreaterThan(-1);
		// Still a valid JPEG: SOI first, EOI last.
		expect(Array.from(out.subarray(0, 2))).toEqual([0xff, 0xd8]);
		expect(Array.from(out.subarray(out.length - 2))).toEqual([0xff, 0xd9]);
	});
});

describe("prepareImageForUpload — animated GIF", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// GIF DECISION: re-encoding a GIF through a canvas captures a single frame
	// and would silently flatten the animation, so GIFs skip the canvas. They
	// are NOT exempt from sanitization — the comment and XMP Application
	// extensions are stripped in place instead.
	it("REGRESSION: strips the GIF comment and XMP extensions", async () => {
		installBrowser({ bitmap: { width: 2, height: 2 } });

		const out = decode(
			(await prepareImageForUpload(fakeFile(gifWithMetadata(), "image/gif")))
				.base64,
		);

		expect(indexOfSeq(out, ascii("GPS 48.8584"))).toBe(-1);
		expect(indexOfSeq(out, ascii("XMP DataXMP"))).toBe(-1);	});

	it("keeps both frames, the Graphic Control extension and the NETSCAPE2.0 loop", async () => {
		installBrowser({ bitmap: { width: 2, height: 2 } });

		const out = decode(
			(await prepareImageForUpload(fakeFile(gifWithMetadata(), "image/gif")))
				.base64,
		);

		// Both frame byte-sequences survive intact — a flatten-to-still or a
		// dropped frame would show up here.
		expect(indexOfSeq(out, gifFrame(0xaa))).toBeGreaterThan(-1);
		expect(indexOfSeq(out, gifFrame(0xbb))).toBeGreaterThan(-1);
		// Frame delay / transparency, and the infinite-loop directive.
		expect(indexOfSeq(out, [0x21, 0xf9])).toBeGreaterThan(-1);
		expect(indexOfSeq(out, ascii("NETSCAPE2.0"))).toBeGreaterThan(-1);
		expect(indexOfSeq(out, [0x03, 0x01, 0x00, 0x00, 0x00])).toBeGreaterThan(-1);
		// Header and trailer survive.
		expect(indexOfSeq(out, ascii("GIF89a"))).toBe(0);
		expect(out[out.length - 1]).toBe(0x3b);
	});

	it("never touches the canvas and keeps image/gif", async () => {
		const spy = installBrowser({ bitmap: { width: 2, height: 2 } });

		const result = await prepareImageForUpload(
			fakeFile(gifWithMetadata(), "image/gif"),
		);

		expect(spy.drawn).toBeNull();
		expect(spy.toBlobCalls).toHaveLength(0);
		expect(result.mimeType).toBe("image/gif");
	});

	it("still reports the GIF's true width/height", async () => {
		installBrowser({ bitmap: { width: 480, height: 270 } });

		const result = await prepareImageForUpload(
			fakeFile(gifWithMetadata(), "image/gif"),
		);

		expect(result.width).toBe(480);
		expect(result.height).toBe(270);
	});

	// The stripper returns null on anything it cannot walk safely; the caller
	// must then upload the file untouched rather than a corrupted GIF.
	it("passes a malformed GIF through untouched instead of corrupting it", async () => {
		const truncated = gifWithMetadata().subarray(0, 40);
		installBrowser({ bitmap: { width: 2, height: 2 } });

		const result = await prepareImageForUpload(fakeFile(truncated, "image/gif"));

		expect(result.base64).toBe(bytesToBase64(truncated));
	});
});
