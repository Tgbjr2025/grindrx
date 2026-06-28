import { invoke } from "@tauri-apps/api/core";
import z from "zod";

import { fetchRest } from "$lib/api";
import {
	mediaHashPrivateSchema,
	mediaHashPublicSchema,
} from "$lib/model/media";
import {
	type Profile,
	profileRightNowSchema,
	profileSchema,
	profileShortSchema,
} from "$lib/model/profile";
import { fetchAuthedDataUrl } from "$lib/utils/authed-image";

const profileResponseSchema = z.object({
	profiles: z.array(profileSchema).length(1),
});

const profilesCache = new Map<
	number,
	{ profile: Profile; updatedAt: number }
>();

export function clearProfileCache(profileId: number) {
	profilesCache.delete(profileId);
}

export function clearAllProfileCaches() {
	myProfileCache = null;
	profilesCache.clear();
}

const inflight = new Map<number, Promise<Profile>>();

export async function getProfile(profileId: number) {
	const cached = profilesCache.get(profileId);
	if (cached && Date.now() - cached.updatedAt < 1000 * 60) {
		return cached.profile;
	}
	// FIX 12 — in-flight dedup: return existing promise for concurrent callers
	const existing = inflight.get(profileId);
	if (existing) return existing;

	const promise = (async () => {
		try {
			const res = await fetchRest(`/v7/profiles/${profileId}`, { method: "GET" });
			if (res.status >= 400) {
				throw new Error(`HTTP ${res.status}: ${res.text().slice(0, 200)}`);
			}
			// FIX 11 — use jsonParsed() to get Cloudflare block detection
			const data = res.jsonParsed(profileResponseSchema);
			const profile = data.profiles[0];
			profilesCache.set(profileId, { profile, updatedAt: Date.now() });
			return profile;
		} finally {
			inflight.delete(profileId);
		}
	})();

	inflight.set(profileId, promise);
	return promise;
}

const getProfilesProfileSchema = z.object({
	...profileShortSchema.shape,
	...profileRightNowSchema.shape,
});

// Parse each profile independently. Grindr drifts this schema regularly, and a
// single malformed record in a /v3/profiles batch (up to 150 ids) would
// otherwise throw the whole response and leave every one of those grid tiles
// stuck as a skeleton. Mirror the tolerant per-item parse used by the v3
// cascade: drop + log the bad ones, keep the rest.
const getProfilesResponseSchema = z.object({
	profiles: z.array(z.unknown()).transform((raw) =>
		raw.flatMap((p) => {
			const result = getProfilesProfileSchema.safeParse(p);
			if (result.success) return [result.data];
			console.warn("[GrindrX] dropping unparseable profile", {
				issue: result.error.issues[0],
			});
			return [];
		}),
	),
});

export async function getProfiles(
	profileIds: number[],
): Promise<z.infer<typeof getProfilesResponseSchema>["profiles"]> {
	if (profileIds.length === 0) return [];
	const profiles = await fetchRest("/v3/profiles", {
		method: "POST",
		body: {
			targetProfileIds: profileIds,
		},
	}).then((res) => res.jsonParsed(getProfilesResponseSchema).profiles);
	profiles.forEach((profile) => {
		profilesCache.set(profile.profileId, { profile: profile as unknown as Profile, updatedAt: Date.now() });
	});
	return profiles;
}

let myProfileCache: {
	profile: z.infer<typeof getProfilesResponseSchema>["profiles"][0];
	updatedAt: number;
} | null = null;

export async function getMyProfile() {
	if (myProfileCache && Date.now() - myProfileCache.updatedAt < 1000 * 60) {
		return myProfileCache.profile;
	}
	const profile = await fetchRest("/v4/me/profile").then(
		(res) => res.jsonParsed(getProfilesResponseSchema).profiles[0],
	);
	// /v4/me/profile sometimes omits medias for self — backfill from the images endpoint
	if (profile.medias.length === 0) {
		try {
			const { medias } = await getProfileUploadedPhotos();
			profile.medias = medias.map((m) => ({
				mediaHash: m.mediaHash,
				type: m.type,
				state: m.state,
				reason: null,
				takenOnGrindr: null,
				createdAt: m.createdAt ?? null,
			}));
		} catch {
			// best-effort
		}
	}
	myProfileCache = { profile, updatedAt: Date.now() };
	return profile;
}

// A single uploaded profile photo. Grindr's profile endpoints now return only a
// public `mediaHash` (40-char) — NO numeric `mediaId`. The chat-send endpoint
// (`POST /v4/chat/message/send`, type "Image") requires a numeric `mediaId`,
// which is only minted by the chat-media upload endpoint. So a saved photo
// carries just its hash; the numeric id is obtained at send time by re-uploading
// the photo's bytes (see `prepareSavedPhotoForSend`).
const profilePhotoSchema = z.object({
	mediaHash: mediaHashPublicSchema,
	type: z.number().int(),
	state: z.number().int(),
	createdAt: z.number().nonnegative().nullable().optional(),
});

export type ProfilePhoto = z.infer<typeof profilePhotoSchema>;

/**
 * The user's saved profile photos, used to populate the "My Photos" picker.
 *
 * Sourced from the legacy `/v3.1/me/profile/images` endpoint, which returns only
 * `{ mediaHash, type, state }` — no numeric `mediaId`. That's fine: to *send* a
 * saved photo we re-upload its bytes to the chat-media endpoint to mint a fresh
 * numeric `mediaId` (see `prepareSavedPhotoForSend`), so the picker only needs
 * the hash to render thumbnails.
 */
export async function getProfileUploadedPhotos(): Promise<{
	medias: ProfilePhoto[];
}> {
	const medias = await fetchRest("/v3.1/me/profile/images").then((res) =>
		res.jsonParsed(z.object({ medias: z.array(profilePhotoSchema) })).medias,
	);
	return { medias };
}

// `POST /v5/chat/media/upload` response shape: `{ mediaId, mediaHash, url }`.
// This is the only endpoint that returns a chat-usable numeric `mediaId`.
// See docs: grindr-api/users/profiles#upload-media.
const uploadResponseSchema = z.object({
	mediaId: z.number().int().nonnegative(),
	// The chat-media endpoint mints a signed (64-char) private hash.
	mediaHash: z.union([mediaHashPrivateSchema, mediaHashPublicSchema]),
	url: z.url(),
});

export type UploadedMedia = z.infer<typeof uploadResponseSchema>;

/**
 * Convert a byte array to a base64 string without stalling the main thread.
 *
 * The previous implementation built the binary string one `String.fromCharCode`
 * call per byte, which is O(n) JS-engine string concatenations and froze the
 * WebView on multi-MB images. We instead decode in fixed-size chunks via
 * `String.fromCharCode(...chunk)` (spread is bounded by `CHUNK` so we never blow
 * the argument-count limit) and concatenate a handful of chunk strings.
 */
function bytesToBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000; // 32 KiB per fromCharCode call
	let binary = "";
	for (let i = 0; i < bytes.length; i += CHUNK) {
		const chunk = bytes.subarray(i, i + CHUNK);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

/**
 * Upload raw image bytes to the chat-media endpoint and return the minted
 * `{ mediaId, mediaHash, url }`. Shared by the new-gallery-photo path and the
 * saved-photo re-upload path.
 */
async function uploadImageBytes(
	imageBase64: string,
	mimeType: string,
): Promise<UploadedMedia> {
	const result = await invoke<{ status: number; body: string }>("upload_image", {
		imageBase64,
		mimeType: mimeType || "image/jpeg",
	});

	// Grindr responds 200/201 on success
	if (result.status >= 400) {
		throw new Error(`Upload failed (${result.status}): ${result.body}`);
	}

	let json: unknown;
	try {
		json = JSON.parse(result.body);
	} catch {
		throw new Error(`Unexpected upload response: ${result.body.slice(0, 200)}`);
	}

	const parsed = uploadResponseSchema.safeParse(json);
	if (!parsed.success) {
		throw new Error(
			`Upload response missing mediaId/mediaHash: ${result.body.slice(0, 200)}`,
		);
	}
	return parsed.data;
}

/**
 * Upload a freshly-picked gallery `File` to the chat-media endpoint. Returns the
 * minted media, including the numeric `mediaId` the chat-send endpoint requires.
 */
const MAX_UPLOAD_EDGE = 1920;

/**
 * Downscale a picked/captured image before upload so we never store (and then
 * decode/render) a full ~12MP camera photo. Decoding a multi-megapixel image on
 * the WebView main thread froze the app; capping the longest edge keeps inline
 * bubbles, the lightbox, and the recipient cheap. Falls back to the original
 * bytes if anything goes wrong, and leaves animated GIFs untouched.
 */
async function downscaleImage(
	file: File,
): Promise<{ base64: string; mimeType: string }> {
	const original = async () => ({
		base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
		mimeType: file.type || "image/jpeg",
	});
	if (file.type === "image/gif") return original();
	try {
		const bitmap = await createImageBitmap(file);
		const longest = Math.max(bitmap.width, bitmap.height);
		if (longest <= MAX_UPLOAD_EDGE) {
			bitmap.close();
			return original();
		}
		const scale = MAX_UPLOAD_EDGE / longest;
		const w = Math.round(bitmap.width * scale);
		const h = Math.round(bitmap.height * scale);
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			bitmap.close();
			return original();
		}
		ctx.drawImage(bitmap, 0, 0, w, h);
		bitmap.close();
		const blob = await new Promise<Blob | null>((res) =>
			canvas.toBlob((b) => res(b), "image/jpeg", 0.85),
		);
		if (!blob) return original();
		const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
		return { base64, mimeType: "image/jpeg" };
	} catch {
		return original();
	}
}

export async function uploadProfileImage(file: File): Promise<UploadedMedia> {
	const { base64, mimeType } = await downscaleImage(file);
	return uploadImageBytes(base64, mimeType);
}

/**
 * Mint a chat-usable numeric `mediaId` for an already-saved profile photo.
 *
 * Saved photos (the "My Photos" tab) only carry a public `mediaHash` — Grindr's
 * profile endpoints no longer expose a numeric `mediaId`, and there is no
 * documented endpoint that converts a saved hash into a chat-usable id directly.
 * The documented path is therefore: fetch the saved image bytes from the public
 * CDN (with auth), then re-upload them to `POST /v5/chat/media/upload` to mint a
 * fresh `{ mediaId, mediaHash, url }`. See docs:
 * grindr-api/media/public-cdn-files (profile images) and
 * grindr-api/users/profiles#upload-media.
 */
export async function prepareSavedPhotoForSend(
	mediaHash: string,
): Promise<UploadedMedia> {
	// Pull the full-resolution profile image (largest reliably-available size).
	const cdnUrl = `https://cdns.grindr.com/images/profile/1024x1024/${mediaHash}`;
	const dataUrl = await fetchAuthedDataUrl(cdnUrl);
	if (!dataUrl || !dataUrl.startsWith("data:")) {
		throw new Error("Could not fetch the saved photo to re-send it.");
	}

	// `fetchAuthedDataUrl` returns `data:<mime>;base64,<payload>`.
	const commaIdx = dataUrl.indexOf(",");
	const header = dataUrl.slice(5, commaIdx); // strip leading "data:"
	const mimeType = header.split(";")[0] || "image/jpeg";
	const imageBase64 = dataUrl.slice(commaIdx + 1);

	return uploadImageBytes(imageBase64, mimeType);
}
