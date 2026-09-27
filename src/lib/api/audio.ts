// Voice-message sending: record audio in the WebView, upload the bytes through
// the chat-media endpoint (the same `upload_image` Rust command — it uploads raw
// bytes with whatever Content-Type we pass, so it works for audio too), and hand
// back the fields an "Audio" chat message needs.
//
// NOTE: the exact audio container Grindr's players accept is not verified from a
// live device here. We record in the best format the WebView offers and send its
// real MIME type; if a recipient can't play it, the recording MIME (see
// `pickAudioMimeType`) is the thing to revisit against the live API.

import { invoke } from "@tauri-apps/api/core";
import z from "zod";

import { blobToBase64 } from "$lib/base64";

const uploadResponseSchema = z.object({
	mediaId: z.number().int(),
	mediaHash: z.string(),
	url: z.string().optional(),
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
	return {
		mediaId: parsed.data.mediaId,
		mediaHash: parsed.data.mediaHash,
		// TODO(verify against a live device) — this is the ONE thing in this module
	// I could not verify, and I am deliberately not guessing a fix.
	//
	// `url` falls back to the IMAGE CDN path (`/images/{mediaHash}`) for an
	// audio upload. The bytes went to the `upload_image` command, so the media
	// hash is an image's, and the fallback produces a 404 URL the recipient
	// cannot play — a silently broken voice message. The real audio URL is
	// whatever `upload_image` returns in `url`; when it does not, the correct
	// behaviour is to refuse the send (or omit the url so the client fetches
	// through `fetch_media_bytes`) rather than synthesize an images path.
	// Which of those the API actually supports is a question for a live
	// capture, so the guess is left unmade rather than guessed wrong.
	url: parsed.data.url ?? `https://cdns.grindr.com/images/${parsed.data.mediaHash}`,
		contentType,
		length: Math.max(0, Math.round(lengthMs)),
	};
}
