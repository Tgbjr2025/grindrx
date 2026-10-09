// Voice-message sending: record audio in the WebView, upload the bytes through
// the chat-media endpoint (the same `upload_image` Rust command — it uploads raw
// bytes with whatever Content-Type we pass, so it works for audio too), and hand
// back the fields an "Audio" chat message needs.
//
// ## The `url` is server-minted and cannot be reconstructed
//
// `uploadAudioBlob` used to fall back to
// `https://cdns.grindr.com/images/${mediaHash}` when the upload response carried
// no `url`. That URL was wrong in three independent ways, and reconstructing a
// correct one is impossible from anything this module has:
//
//  1. WRONG HOST AND PATH SHAPE. These bytes go to `POST /v5/chat/media/upload`
//     (`src-tauri/src/api/rest.rs:upload_image`), the CHAT-media endpoint. Chat
//     media is served from SIGNED CLOUDFRONT, not the public image CDN:
//     `https://d2wxe7lth7kp8g.cloudfront.net/{uploaderProfileId}/{mediaHash}?Expires=…&Signature=…&Key-Pair-Id=…`
//     (`docs/content/grindr-api/media/signed-cdn-files.md`). The public
//     `cdns.grindr.com/images/{dir}/{size}/{hash}` tree used by `$lib/utils/cdn`
//     is a different bucket entirely, and its hash segments are
//     `{dir}/{size}/{hash}` — the fallback had no directory or size at all.
//  2. WRONG HASH CLASS. The docs state it plainly: "Confirmed cases: Audio uses
//     SHA-256 for its 64-character mediaHash"
//     (`docs/content/grindr-api/media/index.md`). So an audio upload's hash is a
//     64-char PRIVATE hash (`mediaHashPrivateSchema`), while the public image
//     path is only ever addressed by 40-char PUBLIC hashes
//     (`$lib/model/media`). The value cannot be placed in that path.
//  3. THE PART THAT ACTUALLY MATTERS — A SIGNATURE. The chat-media URL carries
//     `Signature` and `Key-Pair-Id` minted by the server, which is precisely why
//     the docs say "it's best to pull full URL from `url` property on media
//     object itself". No client-side computation turns a hash into a signed URL.
//
// So there is no fallback to reconcile: the only correct URL is the one the
// server returned. "Omit the url and let the client re-fetch" is not available
// either — `audioMessageSchema` types `url` as a REQUIRED `z.url()`
// (`src/lib/model/message.ts`), so a message without one would not validate.
//
// A known-invalid fallback is not kept to avoid an error. When the response has
// no `url` the send is REFUSED with an explicit error, which the composer
// surfaces as "Failed to send voice message: …". A user-visible failure is the
// correct outcome; a silently unplayable voice message in the recipient's chat
// is not.
//
// NOTE: the exact audio container Grindr's players accept is not verified from a
// live device here. We record in the best format the WebView offers and send its
// real MIME type; if a recipient can't play it, the recording MIME (see
// `pickAudioMimeType`) is the thing to revisit against the live API.

import { invoke } from "@tauri-apps/api/core";
import z from "zod";

import { blobToBase64 } from "$lib/base64";

// `url` is parsed as nullable-as-optional on purpose: a server that answers
// `url: null` has told us there is no URL, and that deserves the same explicit
// "missing url" refusal below rather than a misleading "missing mediaHash" —
// `url: null` must not fail the whole object parse and mask the real reason.
const uploadResponseSchema = z.object({
	mediaId: z.number().int(),
	mediaHash: z.string(),
	url: z.string().nullable().optional(),
});

export type UploadedAudio = {
	mediaId: number;
	mediaHash: string;
	url: string;
	contentType: string;
	/** Duration in milliseconds. */
	length: number;
};

/** Pick a MediaRecorder MIME type the WebView actually supports, preferring mp4/aac. */
export function pickAudioMimeType(): string {
	const candidates = [
		"audio/mp4",
		"audio/aac",
		"audio/webm;codecs=opus",
		"audio/webm",
		"audio/ogg;codecs=opus",
	];
	const supported =
		typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function";
	if (supported) {
		for (const c of candidates) {
			if (MediaRecorder.isTypeSupported(c)) return c;
		}
	}
	return "audio/webm";
}

export async function uploadAudioBlob(blob: Blob, lengthMs: number): Promise<UploadedAudio> {
	const contentType = blob.type || "audio/webm";
	// Delegates to `$lib/base64`'s single chunked encoder instead of keeping a
	// second copy of the byte->base64 loop (this module had a third).
	const base64 = await blobToBase64(blob);
	const result = await invoke<{ status: number; body: string }>("upload_image", {
		imageBase64: base64,
		mimeType: contentType,
	});
	if (result.status >= 400) {
		throw new Error(`Audio upload failed (${result.status}): ${result.body.slice(0, 200)}`);
	}
	let json: unknown;
	try {
		json = JSON.parse(result.body);
	} catch {
		throw new Error(`Unexpected upload response: ${result.body.slice(0, 200)}`);
	}
	const parsed = uploadResponseSchema.safeParse(json);
	if (!parsed.success) {
		throw new Error(`Upload response missing mediaId/mediaHash: ${result.body.slice(0, 200)}`);
	}
	// The URL is REQUIRED, and there is no way to invent one — see the header
	// comment. `mediaHash` alone cannot address chat media: the URL is a signed
	// CloudFront URL, and its `Signature`/`Key-Pair-Id` are server-minted.
	if (parsed.data.url === undefined || parsed.data.url === null || parsed.data.url.length === 0) {
		throw new Error(
			"Upload response is missing `url`; chat media is served from a signed " +
				"CloudFront URL that cannot be reconstructed from mediaHash, so the " +
				`voice message cannot be sent. Raw response: ${result.body.slice(0, 200)}`,
		);
	}
	return {
		mediaId: parsed.data.mediaId,
		mediaHash: parsed.data.mediaHash,
		url: parsed.data.url,
		contentType,
		length: Math.max(0, Math.round(lengthMs)),
	};
}
