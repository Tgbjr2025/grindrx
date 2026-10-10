// P1-006 — "Image upload: double base64 round-trip (33% x 2)".
//
// This file exists to MEASURE that finding against the current tree and to pin
// the result so it cannot silently regress. Both halves matter: the finding was
// filed from a stale snapshot, and the obvious "fix" it asks for is a measured
// regression on Android.
//
// ## What was measured
//
// The whole upload path, end to end, on every image entry point:
//
//   File ──> downscaleImage()  (canvas re-encode; ALSO the EXIF strip)
//        ──> bytesToBase64()   ← THE ONLY ENCODE ON THE PATH
//        ──> invoke("upload_image" | "upload_profile_image")
//             ──> STANDARD.decode(&image_base64)  ← THE ONLY DECODE ON THE PATH
//                  ──> .body(bytes)   (raw bytes to Grindr; no re-encode)
//
// So the +33% is paid exactly once, on the IPC hop, and NEVER on the wire to
// Grindr. There is no second encode anywhere: `rest.rs` calls `STANDARD.decode`
// and hands the result straight to reqwest. The "33% x 2" that really existed
// was the DOWNLOAD direction — the old `fetch_authed_bytes` returned a
// `data:` URL, so raw bytes were base64-encoded in Rust and then base64-encoded
// a second time inside the URL — and it was fixed before this finding was
// filed (see the comment on `fetch_authed_bytes` in `rest.rs`).
//
// ## Why the one remaining encode must stay
//
// The register's remedy was "send raw bytes across the IPC boundary (Tauri
// commands accept Vec<u8>)". Measured, that is worse on this app's primary
// target:
//
//  - `tauri` 2.11.1, `src/ipc/mod.rs:54-56`: "On Android, InvokeBody::Raw is
//    not supported. The enum will always contain InvokeBody::Json. When
//    targeting Android Devices, consider passing raw bytes as a base64 String,
//    which is still more efficient than passing them as a number array in
//    InvokeBody::Json."
//  - `tauri` 2.11.1, `src/ipc/mod.rs:85-94`: `InvokeBody::into_json` is
//    `#[cfg(mobile)]` and widens raw bytes into `JsonValue::Array` of numbers.
//    JSON number arrays cost ~3 bytes/byte ("255,") versus base64's 1.33.
//  - There is no raw channel to use even on desktop: `invoke()` forwards the
//    whole args object to `window.__TAURI_INTERNALS__.invoke` as JSON
//    (`@tauri-apps/api/core.js`), and `JSON.stringify(new Uint8Array([1]))` is
//    `{"0":1}`, which serde cannot deserialize into a `Vec<u8>` at all.
//
// The tests below therefore assert the invariant that actually matters: EXACTLY
// ONE bytes->base64 conversion per upload, and the payload handed to `invoke`
// is the canonical base64 of the exact bytes the user is about to send.

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

import {
	prepareAuthedUrlForSend,
	prepareImageForUpload,
	uploadProfilePhoto,
} from "$lib/api/profile";
import { fetchAuthedBytes, fetchMediaBytes } from "$lib/utils/authed-image";

const mockedInvoke = vi.mocked(invoke);
const mockedFetchAuthedBytes = vi.mocked(fetchAuthedBytes);
const mockedFetchMediaBytes = vi.mocked(fetchMediaBytes);

// --- Counting the conversions ------------------------------------------------
//
// The encoder has two spellings (`Uint8Array.prototype.toBase64` where the
// WebView has it, `btoa` otherwise) and which one runs depends on the engine,
// not on this codebase. Counting only one of them would make the assertion
// pass vacuously on the other engine, so count BOTH and demand the sum is 1.
// A regression that decodes and re-encodes shows up as 2.

type EncodeSpy = {
	mock: { calls: unknown[][] };
	mockRestore: () => void;
};

let encodes: () => number = () => {
	throw new Error("installEncodeCounters() has not run");
};
let restoreSpies: () => void = () => {};

function installEncodeCounters() {
	const spies: EncodeSpy[] = [];
	if (typeof (Uint8Array.prototype as { toBase64?: unknown }).toBase64 === "function") {
		spies.push(vi.spyOn(Uint8Array.prototype, "toBase64"));
	}
	spies.push(vi.spyOn(globalThis, "btoa"));
	encodes = () => spies.reduce((n, s) => n + s.mock.calls.length, 0);
	restoreSpies = () => {
		for (const s of spies) s.mockRestore();
	};
}

// --- A strict port of the Rust side ------------------------------------------
//
// `base64::engine::general_purpose::STANDARD` is the alphabet WITH padding and
// rejects bad characters and bad lengths. Node's `Buffer.from(s, "base64")` is
// lenient (it skips junk and tolerates missing padding), so it cannot tell a
// well-formed payload from a double-encoded one. This decoder is deliberately
// strict for the same reason.

const B64_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode exactly what `STANDARD.decode` accepts; throw on anything else. */
function standardDecode(input: string): Uint8Array {
	if (input.length % 4 !== 0) {
		throw new Error(`invalid base64 length ${input.length} (STANDARD requires padding)`);
	}
	// A padded quad carries 3 bytes; `==` drops the last one and `=` drops the
	// last two. Sizing from the padding (rather than allocating the full 3/4
	// and truncating) keeps the result exactly as long as the real payload.
	const padCount = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
	const out = new Uint8Array((input.length / 4) * 3 - padCount);
	let o = 0;
	for (let i = 0; i < input.length; i += 4) {
		const quad = [input[i], input[i + 1], input[i + 2], input[i + 3]];
		const padStart = quad.findIndex((c) => c === "=");
		if (padStart > 0 && quad.slice(padStart).some((c) => c !== "=")) {
			throw new Error("base64 padding is not right-aligned");
		}
		// Padding chars carry no data: `quad.padEnd` is what makes "XY==" emit
		// one byte and "XYZ=" emit two. Indexing off `padStart` instead
		// silently drops the low bits of the second byte.
		const quadPad = padStart < 0 ? 0 : 4 - padStart;
		const n = quad.map((c) => {
			if (c === "=") return 0;
			const v = B64_ALPHABET.indexOf(c);
			if (v < 0) throw new Error(`invalid base64 character ${JSON.stringify(c)}`);
			return v;
		});
		const bits = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3];
		out[o++] = (bits >> 16) & 0xff;
		if (quadPad < 2) out[o++] = (bits >> 8) & 0xff;
		if (quadPad < 1) out[o++] = bits & 0xff;
	}
	return out;
}

function ascii(text: string): number[] {
	return Array.from(text, (c) => c.charCodeAt(0));
}

function uploadResult(mediaId: number, mediaHash: string, url: string) {
	return {
		status: 201,
		body: JSON.stringify({ mediaId, mediaHash, url }),
	};
}

/**
 * The args object of an upload's single `invoke` call. Typed here because
 * `invoke` is declared `args?: InvokeArgs` (a record of `JsonValue`), so
 * reaching into `.mock.calls[n][1]` is `unknown`-shaped and untyped property
 * access on it fails `svelte-check`.
 */
type UploadArgs = {
	imageBase64: string;
	mimeType: string;
	/** `upload_profile_image` only — `upload_image` never sends these. */
	width?: number;
	height?: number;
};

function uploadArgs(callIndex = 0): UploadArgs {
	const call = mockedInvoke.mock.calls[callIndex];
	if (!call) throw new Error(`no invoke() call recorded at index ${callIndex}`);
	return call[1] as UploadArgs;
}

function fakeFile(bytes: Uint8Array, type: string): File {
	return {
		type,
		arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
	} as unknown as File;
}

/** A JPEG carrying an EXIF APP1 (GPS) segment the stripper must drop. */
function jpegWithExif(): Uint8Array {
	const exif = ascii("ExifGPS:48.8584,2.2945 CAM:iPhone15,2");
	const jfif = ascii("JFIF");
	const seg = (marker: number, payload: number[]) => [
		0xff,
		marker,
		(payload.length + 2) >> 8,
		(payload.length + 2) & 0xff,
		...payload,
	];
	return Uint8Array.from([
		0xff,
		0xd8, // SOI
		...seg(0xe0, jfif), // APP0 — must survive
		...seg(0xe1, exif), // APP1 — must be dropped
		...seg(0xda, [0x01, 0x01, 0x00]), // SOS
		0xde,
		0xad,
		0xbe,
		0xef,
		0xff,
		0xd9, // EOI
	]);
}

function contains(haystack: Uint8Array, needle: number[]): boolean {
	outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) continue outer;
		}
		return true;
	}
	return false;
}

/** Stub the two browser globals `downscaleImage` touches. */
function installBrowser(opts: {
	bitmap?: { width: number; height: number };
	noContext?: boolean;
	encoded?: Uint8Array | null;
}) {
	const canvas = {
		width: 0,
		height: 0,
		getContext: () =>
			opts.noContext ? null : { drawImage: () => {} },
		toBlob: (cb: (b: Blob | null) => void, type?: string) => {
			if (opts.encoded === null) {
				cb(null);
				return;
			}
			const bytes = (opts.encoded ?? new Uint8Array([0xff, 0xd8, 0xff, 0xd9])).slice();
			cb(new Blob([bytes.buffer], { type }));
		},
	};
	vi.stubGlobal("createImageBitmap", () =>
		Promise.resolve({
			width: opts.bitmap?.width ?? 0,
			height: opts.bitmap?.height ?? 0,
			close: () => {},
		}),
	);
	vi.stubGlobal("document", { createElement: () => canvas });
}

beforeEach(() => {
	vi.clearAllMocks();
	installEncodeCounters();
});

afterEach(() => {
	restoreSpies();
	vi.unstubAllGlobals();
});

// --- The measurement ---------------------------------------------------------

describe("P1-006: image upload performs exactly ONE base64 encode", () => {
	// The path the register describes as "double": fetch the bytes, encode them,
	// hand them to `upload_image`. If a decode+re-encode round trip were ever
	// reintroduced anywhere along here, this counter reads 2.
	it("the saved-photo re-upload encodes the fetched bytes exactly once", async () => {
		const raw = new Uint8Array(4096).map((_, i) => i % 256);
		mockedFetchAuthedBytes.mockResolvedValueOnce({
			buffer: raw.slice().buffer,
			mime: "image/jpeg",
		});
		mockedInvoke.mockResolvedValueOnce(
			uploadResult(7, "a".repeat(64), "https://d2wxe7lth7kp8g.cloudfront.net/x"),
		);

		await prepareAuthedUrlForSend(
			"https://cdns.grindr.com/images/profile/1024x1024/abc",
			"saved photo",
		);

		expect(encodes()).toBe(1);
		expect(mockedInvoke).toHaveBeenCalledTimes(1);
		expect(mockedInvoke.mock.calls[0][0]).toBe("upload_image");
	});

	// Same for a signed-CDN source, which takes the other fetcher.
	it("the signed-CDN album re-upload encodes exactly once", async () => {
		const raw = new Uint8Array(1000).map((_, i) => (i * 7) % 256);
		mockedFetchMediaBytes.mockResolvedValueOnce({
			buffer: raw.slice().buffer,
			mime: "image/jpeg",
		});
		mockedInvoke.mockResolvedValueOnce(
			uploadResult(8, "b".repeat(64), "https://d2wxe7lth7kp8g.cloudfront.net/y"),
		);

		await prepareAuthedUrlForSend("https://d2wxe7lth7kp8g.cloudfront.net/p/photo.jpg");

		expect(encodes()).toBe(1);
		expect(mockedFetchMediaBytes).toHaveBeenCalledTimes(1);
	});

	// The canvas re-encode is the EXIF sanitiser (P0-009) and is a JPEG ENCODE,
	// not a base64 conversion — it must not be conflated with one.
	it("the canvas (EXIF-stripping) path adds no base64 conversion of its own", async () => {
		installBrowser({ bitmap: { width: 1024, height: 768 } });

		await prepareImageForUpload(fakeFile(jpegWithExif(), "image/jpeg"));

		expect(encodes()).toBe(1);
	});

	// The defensive fallback: no 2d context, so the bytes go through the
	// byte-level stripper instead of a canvas. Stripping rewrites the buffer —
	// it must still cost exactly one encode, not one before and one after.
	it("the byte-level strip fallback encodes exactly once", async () => {
		installBrowser({ bitmap: { width: 1024, height: 768 }, noContext: true });

		await prepareImageForUpload(fakeFile(jpegWithExif(), "image/jpeg"));

		expect(encodes()).toBe(1);
	});

	it("the profile-photo upload encodes exactly once", async () => {
		installBrowser({ bitmap: { width: 1024, height: 768 } });
		mockedInvoke.mockResolvedValueOnce({
			status: 200,
			body: JSON.stringify({ hash: "c".repeat(40) }),
		});

		await uploadProfilePhoto(fakeFile(jpegWithExif(), "image/jpeg"));

		expect(encodes()).toBe(1);
		expect(mockedInvoke.mock.calls[0][0]).toBe("upload_profile_image");
	});
});

// --- The proof that the payload is not base64-of-base64 ----------------------

describe("P1-006: the IPC payload is one encode, not a round trip", () => {
	it("Rust's single decode recovers the exact bytes that were fetched", async () => {
		const raw = new Uint8Array(2048).map((_, i) => (i * 31) % 256);
		mockedFetchAuthedBytes.mockResolvedValueOnce({
			buffer: raw.slice().buffer,
			mime: "image/jpeg",
		});
		mockedInvoke.mockResolvedValueOnce(
			uploadResult(9, "c".repeat(64), "https://d2wxe7lth7kp8g.cloudfront.net/z"),
		);

		await prepareAuthedUrlForSend("https://cdns.grindr.com/images/profile/1024x1024/abc");

		const payload = uploadArgs().imageBase64;
		// One `STANDARD.decode` in `rest.rs` is enough to get the original
		// bytes back. If the payload had been encoded twice, this would need a
		// second decode and would not match.
		expect(standardDecode(payload)).toEqual(raw);
	});

	it("the payload is canonical base64 — re-encoding it changes the string", async () => {
		mockedFetchAuthedBytes.mockResolvedValueOnce({
			buffer: new Uint8Array([1, 2, 3, 4, 5]).buffer,
			mime: "image/jpeg",
		});
		mockedInvoke.mockResolvedValueOnce(
			uploadResult(10, "d".repeat(64), "https://d2wxe7lth7kp8g.cloudfront.net/z"),
		);

		await prepareAuthedUrlForSend("https://cdns.grindr.com/images/profile/1024x1024/abc");

		const payload = uploadArgs().imageBase64;
		expect(payload).toBe("AQIDBAU=");
		// base64(base64(x)) is a different, ~1.78x longer string. Asserting the
		// payload is NOT that is the direct statement of "one conversion".
		expect(btoa(payload)).not.toBe(payload);
		expect(btoa(payload).length).toBeGreaterThan(payload.length);
	});

	// The size assertion is the finding's own arithmetic: one expansion is
	// exactly 4*ceil(n/3); two would be ~1.78x that.
	it("the IPC hop costs exactly one +33% expansion, not two", async () => {
		for (const size of [0, 1, 2, 3, 1024, 1024 * 1024 + 2]) {
			vi.clearAllMocks();
			const raw = new Uint8Array(size).map((_, i) => i % 256);
			mockedFetchAuthedBytes.mockResolvedValueOnce({
				buffer: raw.slice().buffer,
				mime: "image/jpeg",
			});
			mockedInvoke.mockResolvedValueOnce(
				uploadResult(11, "e".repeat(64), "https://d2wxe7lth7kp8g.cloudfront.net/z"),
			);

			await prepareAuthedUrlForSend("https://cdns.grindr.com/images/profile/1024x1024/abc");

			const payload = uploadArgs().imageBase64;
			expect(payload.length).toBe(4 * Math.ceil(size / 3));
			// ...and the bytes survive the one decode that Rust performs.
			expect(standardDecode(payload)).toEqual(raw);
		}
	});

	// `upload_profile_image` carries the same payload plus the crop dimensions.
	it("upload_profile_image receives the same single-encode payload", async () => {
		installBrowser({ bitmap: { width: 1000, height: 500 } });
		mockedInvoke.mockResolvedValueOnce({
			status: 200,
			body: JSON.stringify({ hash: "f".repeat(40) }),
		});

		await uploadProfilePhoto(fakeFile(jpegWithExif(), "image/jpeg"));

		// Count BEFORE this test's own `btoa` below, which would pollute the
		// tally it is checking.
		expect(encodes()).toBe(1);
		const args = uploadArgs();
		expect(args.width).toBe(1000);
		expect(args.height).toBe(500);
		expect(args.imageBase64).toBe(
			btoa(String.fromCharCode(...standardDecode(args.imageBase64))),
		);
	});
});

// --- The P0-009 sanitisation must survive all of the above --------------------
//
// The single encode is only worth keeping if the bytes being encoded are the
// SANITISED ones. This pins both halves together: stripped content AND one
// encode, so nobody can "fix" P1-006 by encoding the raw file instead.

describe("P1-006 must not regress the P0-009 EXIF strip", () => {
	it("the bytes handed to the IPC hop are stripped, not the picked file", async () => {
		const original = jpegWithExif();
		installBrowser({ bitmap: { width: 1024, height: 768 }, noContext: true });

		const { base64 } = await prepareImageForUpload(
			fakeFile(original, "image/jpeg"),
		);

		const decoded = standardDecode(base64);
		expect(contains(decoded, ascii("Exif"))).toBe(false);
		expect(contains(decoded, ascii("JFIF"))).toBe(true);
		// The strip is a rewrite: the result is genuinely different bytes, and
		// they are SHORTER because the APP1 segment was removed.
		expect(decoded).not.toEqual(original);
		expect(decoded.length).toBeLessThan(original.length);
	});

	it("a GIF is byte-stripped in place and still costs one encode", async () => {
		// Animated GIFs skip the canvas (it would flatten them) but must not
		// skip sanitization. The exact stripped output is covered in
		// `profile.test.ts`; what matters here is only that the in-place path
		// costs ONE base64 conversion and keeps its MIME.
		const gif = Uint8Array.from([
			...ascii("GIF89a"),
			0x02,
			0x00,
			0x02,
			0x00,
			0x00,
			0x00,
			0x00,
			0x3b,
		]);
		const result = await prepareImageForUpload(fakeFile(gif, "image/gif"));

		expect(encodes()).toBe(1);
		expect(result.mimeType).toBe("image/gif");
		// Whatever the stripper returned, it is still a GIF — one encode must not
		// have corrupted the bytes on the way through.
		expect(contains(standardDecode(result.base64), ascii("GIF89a"))).toBe(true);
	});
});
