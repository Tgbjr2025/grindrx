import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri bridge before importing the module under test.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => invokeMock(...args),
}));

// node test env has the URL constructor + Blob but not the object-URL statics.
// Attach them to the real URL so `new URL(...)` in classifyHost still works.
let objectUrlSeq = 0;
(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
	`blob:mock/${objectUrlSeq++}`;
(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};

const { resolveAuthedImage, fetchAuthedBytes } = await import("./authed-image");

// A minimal valid JPEG header so sniffMime returns image/jpeg.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).buffer;

const AUTH_URL = "https://cdns.grindr.com/images/abc123";
const DIRECT_URL = "https://d1234.cloudfront.net/signed/xyz?sig=1";

beforeEach(() => {
	invokeMock.mockReset();
	invokeMock.mockResolvedValue(JPEG_BYTES);
});

describe("resolveAuthedImage (Shared-photos lightbox fix)", () => {
	it("converts a bearer-gated grindr CDN url into a blob: url", async () => {
		// This is the exact defect: PhotoSwipe opened the raw grindr url and 403'd.
		// The fix depends on this returning a blob (which carries no auth need).
		const resolved = await resolveAuthedImage(AUTH_URL);
		expect(resolved).toMatch(/^blob:/);
		expect(resolved).not.toBe(AUTH_URL);
		expect(invokeMock).toHaveBeenCalledWith("fetch_authed_bytes", {
			url: AUTH_URL,
		});
	});

	it("passes non-grindr (signed CloudFront) urls through unchanged", async () => {
		const resolved = await resolveAuthedImage(DIRECT_URL);
		expect(resolved).toBe(DIRECT_URL);
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it("caches + dedups: the gallery href and thumbnail share one fetch", async () => {
		// Fresh url so the module-level cache from earlier tests doesn't interfere.
		const url = "https://cdns.grindr.com/images/dedup-unique";
		const first = await resolveAuthedImage(url);
		const second = await resolveAuthedImage(url);
		expect(second).toBe(first);
		// One network fetch for both the thumbnail and the lightbox href.
		expect(invokeMock).toHaveBeenCalledTimes(1);
	});

	it("returns null on bridge failure so callers fall back to the raw url", async () => {
		invokeMock.mockRejectedValueOnce(new Error("boom"));
		const resolved = await resolveAuthedImage(
			"https://cdns.grindr.com/images/fails",
		);
		expect(resolved).toBeNull();
	});

	it("fetchAuthedBytes sniffs the mime from magic bytes", async () => {
		const result = await fetchAuthedBytes(AUTH_URL);
		expect(result?.mime).toBe("image/jpeg");
	});
});
