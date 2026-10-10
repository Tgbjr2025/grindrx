import { beforeEach, describe, expect, it, vi } from "vitest";

// `$lib/api/audio` reaches the Tauri bridge via `invoke`, so mock the command
// layer exactly as the sibling api tests (`album.test.ts`, `profile.test.ts`)
// do — the real `upload_image` cannot run outside Tauri.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

import { pickAudioMimeType, uploadAudioBlob } from "./audio";

const mockedInvoke = vi.mocked(invoke);

/** A 64-char private hash — what the docs say an AUDIO upload returns. */
const PRIVATE_HASH = "f".repeat(64);
/** The signed CloudFront chat-media URL the upload endpoint actually returns. */
const SIGNED_URL = `https://d2wxe7lth7kp8g.cloudfront.net/42/${PRIVATE_HASH}?Expires=1791514394&Signature=abc123&Key-Pair-Id=KPIDEXAMPLE`;

/** A tiny but real Blob — `blobToBase64` reads it through `arrayBuffer()`. */
function audioBlob(type = "audio/webm"): Blob {
	return new Blob([new Uint8Array([1, 2, 3, 4])], { type });
}

function respondWith(body: unknown, status = 200) {
	mockedInvoke.mockResolvedValue({
		status,
		body: typeof body === "string" ? body : JSON.stringify(body),
	} as never);
}

beforeEach(() => {
	mockedInvoke.mockReset();
});

describe("uploadAudioBlob — the url contract", () => {
	it("returns the server's url verbatim when the upload supplies one", async () => {
		respondWith({ mediaId: 99, mediaHash: PRIVATE_HASH, url: SIGNED_URL });

		const uploaded = await uploadAudioBlob(audioBlob(), 1200);

		expect(uploaded.url).toBe(SIGNED_URL);
		expect(uploaded.mediaId).toBe(99);
		expect(uploaded.mediaHash).toBe(PRIVATE_HASH);
	});

	it("REFUSES to send when the response has no url", async () => {
		// THE DEFECT. The old code fell back to
		// `https://cdns.grindr.com/images/${mediaHash}`, which is wrong on every
		// axis: chat media lives on SIGNED CLOUDFRONT, an audio hash is 64 chars
		// (private) where that path wants 40 (public), and the `Signature` /
		// `Key-Pair-Id` of a real chat-media URL are server-minted. There is no
		// client-side reconstruction, so a known-invalid URL must not be
		// synthesized to dodge an error.
		respondWith({ mediaId: 99, mediaHash: PRIVATE_HASH });

		await expect(uploadAudioBlob(audioBlob(), 1200)).rejects.toThrow(/missing `url`/);
	});

	it("never synthesizes an images/ URL for a chat-media upload", async () => {
		respondWith({ mediaId: 99, mediaHash: PRIVATE_HASH });

		const result = await uploadAudioBlob(audioBlob(), 1200).catch(
			(error: Error) => error,
		);
		// Whichever way it resolves, the public IMAGE CDN must not appear.
		expect(JSON.stringify(result)).not.toContain("cdns.grindr.com/images");
	});

	it("refuses an explicitly null url as well as an absent one", async () => {
		// A server that returns `url: null` has told us there is no URL. Treating
		// that as "fall back" is the defect in another guise.
		respondWith({ mediaId: 99, mediaHash: PRIVATE_HASH, url: null });

		await expect(uploadAudioBlob(audioBlob(), 1200)).rejects.toThrow(/missing `url`/);
	});

	it("refuses an empty url", async () => {
		respondWith({ mediaId: 99, mediaHash: PRIVATE_HASH, url: "" });

		await expect(uploadAudioBlob(audioBlob(), 1200)).rejects.toThrow(/missing `url`/);
	});

	it("explains WHY the url cannot be reconstructed, so the failure is actionable", async () => {
		respondWith({ mediaId: 99, mediaHash: PRIVATE_HASH });

		await expect(uploadAudioBlob(audioBlob(), 1200)).rejects.toThrow(
			/signed CloudFront URL that cannot be reconstructed/,
		);
	});

	it("includes the raw response in the failure so it can be diagnosed", async () => {
		respondWith({ mediaId: 99, mediaHash: PRIVATE_HASH, note: "upstream probe" });

		await expect(uploadAudioBlob(audioBlob(), 1200)).rejects.toThrow(/upstream probe/);
	});
});

describe("uploadAudioBlob — existing behaviour is preserved", () => {
	it("reports the error body on an HTTP failure", async () => {
		respondWith("server exploded", 500);

		await expect(uploadAudioBlob(audioBlob(), 1200)).rejects.toThrow(
			/Audio upload failed \(500\)/,
		);
	});

	it("rejects a non-JSON response", async () => {
		respondWith("<html>gateway timeout</html>");

		await expect(uploadAudioBlob(audioBlob(), 1200)).rejects.toThrow(
			/Unexpected upload response/,
		);
	});

	it("rejects a response that is missing mediaId/mediaHash", async () => {
		respondWith({ url: SIGNED_URL });

		await expect(uploadAudioBlob(audioBlob(), 1200)).rejects.toThrow(
			/missing mediaId\/mediaHash/,
		);
	});

	it("passes the recorded MIME type through as the upload Content-Type", async () => {
		respondWith({ mediaId: 1, mediaHash: PRIVATE_HASH, url: SIGNED_URL });

		await uploadAudioBlob(audioBlob("audio/mp4"), 500);

		expect(mockedInvoke).toHaveBeenCalledWith("upload_image", {
			imageBase64: expect.any(String),
			mimeType: "audio/mp4",
		});
	});

	it("defaults an untyped blob to audio/webm", async () => {
		respondWith({ mediaId: 1, mediaHash: PRIVATE_HASH, url: SIGNED_URL });

		const uploaded = await uploadAudioBlob(new Blob([new Uint8Array([1])]), 250);

		expect(uploaded.contentType).toBe("audio/webm");
	});

	it("rounds the length and never goes negative", async () => {
		respondWith({ mediaId: 1, mediaHash: PRIVATE_HASH, url: SIGNED_URL });

		expect((await uploadAudioBlob(audioBlob(), 1200.6)).length).toBe(1201);
		expect((await uploadAudioBlob(audioBlob(), -50)).length).toBe(0);
	});
});

describe("pickAudioMimeType", () => {
	it("prefers mp4/aac when the WebView supports it", () => {
		// The function reads `MediaRecorder` off the global; jsdom has no
		// MediaRecorder, so this exercises the documented fallback rather than
		// the preference order (which needs a browser).
		expect(pickAudioMimeType()).toBe("audio/webm");
	});

	it("falls back to audio/webm when MediaRecorder is absent", () => {
		expect(pickAudioMimeType()).toBe("audio/webm");
	});

	it("picks the first supported candidate in preference order", () => {
		const original = globalThis.MediaRecorder;
		const seen: string[] = [];
		class FakeMediaRecorder {
			static isTypeSupported(type: string) {
				seen.push(type);
				return type === "audio/aac";
			}
		}
		globalThis.MediaRecorder =
			FakeMediaRecorder as unknown as typeof globalThis.MediaRecorder;
		try {
			expect(pickAudioMimeType()).toBe("audio/aac");
			// Preference order is mp4 first, then aac — it must not stop at the
			// first candidate before trying aac.
			expect(seen[0]).toBe("audio/mp4");
			expect(seen[1]).toBe("audio/aac");
		} finally {
			globalThis.MediaRecorder = original;
		}
	});
});