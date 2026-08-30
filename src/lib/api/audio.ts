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

async function blobToBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

export async function uploadAudioBlob(blob: Blob, lengthMs: number): Promise<UploadedAudio> {
	const contentType = blob.type || "audio/webm";
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
		url: parsed.data.url ?? `https://cdns.grindr.com/images/${parsed.data.mediaHash}`,
		contentType,
		length: Math.max(0, Math.round(lengthMs)),
	};
}
