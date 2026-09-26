import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `authed-image.ts` had NO test coverage at all, despite being the module every
 * image, album slide and (now) voice message in the app depends on — and despite
 * two real bugs living in it: a 96-entry FULL-RESOLUTION LRU that revoked blob
 * URLs mounted `<img>` elements still held, and an `ftyp`-only MP4 sniff that
 * mislabelled HEIC/AVIF images as video.
 *
 * `invoke` is mocked because every authenticated fetch goes through the Tauri
 * `fetch_authed_bytes` command.
 */
const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
	invoke: (cmd: string, args?: unknown): Promise<unknown> =>
		invoke(cmd, args),
}));

import { isAuthedHost, resolveAuthedImage } from "$lib/utils/authed-image";

/** Blobs handed to `URL.createObjectURL`, so tests can assert on the MIME type. */
let createdBlobs: Blob[] = [];
/** Object URLs and whether they are still live. */
let urlLive: Map<string, boolean> = null as unknown as Map<string, boolean>;

function isoBmff(majorBrand: string): Uint8Array {
	// `ftyp` at 4..8 and the major brand at 8..12, as in a real ISO-BMFF header.
	const b = new Uint8Array(16);
	b[4] = 0x66; // f
	b[5] = 0x74; // t
	b[6] = 0x79; // y
	b[7] = 0x70; // p
	for (let i = 0; i < 4; i++) b[8 + i] = majorBrand.charCodeAt(i);
	return b;
}

function jpeg(): Uint8Array {
	return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

/**
 * Serve these bytes for any authenticated fetch. `fetch_authed_bytes` resolves to
 * a RAW ArrayBuffer and sniffs the MIME itself, so the mock must return exactly
 * that — not a `{ buffer, mime }` object.
 */
function serveBytes(bytes: Uint8Array): void {
	invoke.mockResolvedValue(bufferOf(bytes));
}

const SIGNED_URL = "https://d1234.cloudfront.net/signed/album-photo.jpg?sig=abc";

beforeEach(() => {
	invoke.mockReset();
	createdBlobs = [];
	urlLive = new Map();
	let n = 0;
	// Subclass rather than replace: `classifyHost` does `new URL(...)`, so a plain
	// object stub silently broke host classification.
	class StubUrl extends URL {
		static override createObjectURL(blob: Blob): string {
			createdBlobs.push(blob);
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

function liveUrlCount(): number {
	return [...urlLive.values()].filter(Boolean).length;
}

describe("isAuthedHost", () => {
	it("treats grindr CDN hosts as needing the bearer token", () => {
		expect(isAuthedHost("https://cdns.grindr.com/images/full/hash")).toBe(true);
	});

	it("treats signed CloudFront URLs as directly loadable", () => {
		expect(isAuthedHost(SIGNED_URL)).toBe(false);
	});

	it("does not throw on a malformed URL", () => {
		expect(() => isAuthedHost("not a url")).not.toThrow();
	});
});

describe("resolveAuthedImage", () => {
	it("returns a signed URL unchanged, with no IPC round-trip", async () => {
		serveBytes(jpeg());
		await expect(resolveAuthedImage(SIGNED_URL)).resolves.toBe(SIGNED_URL);
		expect(invoke).not.toHaveBeenCalled();
	});

	it("fetches an authed host once and reuses the object URL", async () => {
		serveBytes(jpeg());
		const url = "https://cdns.grindr.com/images/full/dedupe";
		const first = await resolveAuthedImage(url);
		const second = await resolveAuthedImage(url);
		expect(first).toBe(second);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("dedups concurrent resolves of the same URL into a single fetch", async () => {
		serveBytes(jpeg());
		const url = "https://cdns.grindr.com/images/full/concurrent";
		const [a, b, c] = await Promise.all([
			resolveAuthedImage(url),
			resolveAuthedImage(url),
			resolveAuthedImage(url),
		]);
		expect(a).toBe(b);
		expect(b).toBe(c);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("returns null when the fetch fails rather than throwing", async () => {
		invoke.mockRejectedValue(new Error("boom"));
		await expect(
			resolveAuthedImage("https://cdns.grindr.com/images/full/fails"),
		).resolves.toBeNull();
	});

	it("keeps the number of live object URLs bounded", async () => {
		// The cap was 96 FULL-RESOLUTION entries — multi-MB each, so a hard OOM on
		// a mid-range WebView. Drive well past the cap.
		serveBytes(jpeg());
		for (let i = 0; i < 60; i++) {
			await resolveAuthedImage(`https://cdns.grindr.com/images/full/bulk-${i}`);
		}
		// Cache cap is 32, so live URLs must stay at or below that.
		expect(liveUrlCount()).toBeLessThanOrEqual(32);
	});

	it("revokes the oldest entry when the cap is exceeded", async () => {
		serveBytes(jpeg());
		for (let i = 0; i < 40; i++) {
			await resolveAuthedImage(`https://cdns.grindr.com/images/full/evict-${i}`);
		}
		// Some URLs must have been freed, otherwise the cache is not evicting.
		expect(liveUrlCount()).toBeLessThan(40);
	});
});

describe("MIME sniffing", () => {
	// A HEIC/AVIF photo is an ISO-BMFF container, so it carries `ftyp` at bytes
	// 4..8 exactly like an MP4. The old check matched on `ftyp` alone, so a photo
	// was wrapped in a `video/mp4` blob and an <img> could refuse to decode it.
	it("does not mislabel a HEIC photo as video", async () => {
		serveBytes(isoBmff("heic"));
		await resolveAuthedImage("https://cdns.grindr.com/images/full/heic");
		expect(createdBlobs).toHaveLength(1);
		expect(createdBlobs[0].type).toBe("image/heic");
	});

	it("does not mislabel an AVIF photo as video", async () => {
		serveBytes(isoBmff("avif"));
		await resolveAuthedImage("https://cdns.grindr.com/images/full/avif");
		expect(createdBlobs[0].type).toBe("image/avif");
	});

	it("still recognises a real MP4", async () => {
		serveBytes(isoBmff("isom"));
		await resolveAuthedImage("https://cdns.grindr.com/images/full/mp4");
		expect(createdBlobs[0].type).toBe("video/mp4");
	});

	it("recognises JPEG and PNG", async () => {
		serveBytes(jpeg());
		await resolveAuthedImage("https://cdns.grindr.com/images/full/jpeg");
		expect(createdBlobs[0].type).toBe("image/jpeg");

		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
		serveBytes(png);
		await resolveAuthedImage("https://cdns.grindr.com/images/full/png");
		expect(createdBlobs[1].type).toBe("image/png");
	});
});
