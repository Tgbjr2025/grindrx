import z from "zod";

import { invoke } from "@tauri-apps/api/core";
import { fetchRest } from "$lib/api";
import { mediaHashPublicSchema } from "$lib/model/media";
import {
	type Profile,
	profileRightNowSchema,
	profileSchema,
	profileShortSchema,
} from "$lib/model/profile";

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

const getProfilesResponseSchema = z.object({
	profiles: z.array(
		z.object({
			...profileShortSchema.shape,
			...profileRightNowSchema.shape,
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

// A single uploaded profile photo. `mediaId` is the numeric id that Grindr's
// chat-send endpoint (`POST /v4/chat/message/send`, type "Image") requires.
const profilePhotoSchema = z.object({
	mediaHash: mediaHashPublicSchema,
	// Nullable + optional: the legacy `/v3.1/me/profile/images` fallback omits it,
	// and `/v4/me/profile` may briefly serve it as null until eventually consistent.
	mediaId: z.number().int().nullable().optional(),
	type: z.number().int(),
	state: z.number().int(),
	createdAt: z.number().nonnegative().nullable().optional(),
});

export type ProfilePhoto = z.infer<typeof profilePhotoSchema>;

// `/v4/me/profile` is the only endpoint that still carries a real numeric
// `mediaId` alongside each media's `mediaHash` (inside the single returned
// profile's `medias[]` array). The `/v*/me/profile/images` endpoints now only
// return `{ mediaHash, type, state }`, so saved photos can no longer be sent
// from there. We parse `/v4/me/profile` with a tolerant schema that keeps just
// the media fields we need.
const v4MeProfileMediasSchema = z.object({
	profiles: z
		.array(
			z.object({
				medias: z.array(profilePhotoSchema).optional().catch([]),
			}),
		)
		.min(1),
});

/**
 * The user's saved profile photos, each carrying the numeric `mediaId` needed
 * to (re)send it in chat. Sourced from `/v4/me/profile`'s `medias` array.
 *
 * Falls back to the legacy `/v3.1/me/profile/images` endpoint only if
 * `/v4/me/profile` yields no usable medias — those entries have no `mediaId`,
 * so sending them will still fail, but the picker at least renders thumbnails.
 */
export async function getProfileUploadedPhotos(): Promise<{
	medias: ProfilePhoto[];
}> {
	try {
		const res = await fetchRest("/v4/me/profile", { method: "GET" });
		if (res.status < 400) {
			const parsed = res.jsonParsed(v4MeProfileMediasSchema);
			const medias = parsed.profiles[0]?.medias ?? [];
			if (medias.length > 0) {
				const withId = medias.filter(
					(m) => typeof m.mediaId === "number" && m.mediaId > 0,
				).length;
				console.error(
					`[mediaid-fix] getProfileUploadedPhotos: ${medias.length} photo(s) from /v4/me/profile, ${withId} with mediaId`,
				);
				return { medias };
			}
		}
	} catch (err) {
		console.error("[mediaid-fix] /v4/me/profile photos fetch failed", err);
	}

	// Fallback — legacy endpoint, no mediaId available.
	const medias = await fetchRest("/v3.1/me/profile/images").then((res) =>
		res.jsonParsed(z.object({ medias: z.array(profilePhotoSchema) })).medias,
	);
	console.error(
		`[mediaid-fix] getProfileUploadedPhotos: fell back to /v3.1/me/profile/images, ${medias.length} photo(s), NO mediaId`,
	);
	return { medias };
}

/**
 * Re-fetch `/v4/me/profile` and resolve the numeric `mediaId` for a freshly
 * uploaded photo by matching its `mediaHash`. Grindr is eventually consistent,
 * so we poll a few times before giving up.
 */
async function resolveMediaIdByHash(
	mediaHash: string,
	{ attempts = 4, delayMs = 700 }: { attempts?: number; delayMs?: number } = {},
): Promise<number | undefined> {
	for (let i = 0; i < attempts; i++) {
		try {
			const { medias } = await getProfileUploadedPhotos();
			const match = medias.find((m) => m.mediaHash === mediaHash);
			if (match && typeof match.mediaId === "number" && match.mediaId > 0) {
				console.error(
					`[mediaid-fix] resolveMediaIdByHash: matched mediaId=${match.mediaId} for hash=${mediaHash} (attempt ${i + 1}) source=/v4/me/profile`,
				);
				return match.mediaId;
			}
		} catch (err) {
			console.error("[mediaid-fix] resolveMediaIdByHash fetch failed", err);
		}
		if (i < attempts - 1) {
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}
	console.error(
		`[mediaid-fix] resolveMediaIdByHash: no mediaId found for hash=${mediaHash} after ${attempts} attempt(s)`,
	);
	return undefined;
}

const uploadResponseSchema = z.object({
	images: z.array(
		z.object({
			mediaHash: mediaHashPublicSchema,
			mediaId: z.number().int().nullable().optional(),
		}),
	),
});

export async function uploadProfileImage(file: File): Promise<{
	mediaHash: string;
	mediaId: number | undefined;
}> {
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	// convert to base64
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	const imageBase64 = btoa(binary);

	const result = await invoke<{ status: number; body: string }>("upload_image", {
		imageBase64,
		mimeType: file.type || "image/jpeg",
	});

	// Grindr responds 200/201 on success
	if (result.status >= 400) {
		throw new Error(`Upload failed (${result.status}): ${result.body}`);
	}

	// Try to parse the response for mediaHash/mediaId
	let mediaHash: string | undefined;
	let mediaId: number | undefined;
	try {
		const json = JSON.parse(result.body);
		const parsed = uploadResponseSchema.safeParse(json);
		if (parsed.success && parsed.data.images.length > 0) {
			mediaHash = parsed.data.images[0].mediaHash;
			mediaId = parsed.data.images[0].mediaId ?? undefined;
		} else {
			// Fallback: try flat response { mediaHash, mediaId }
			const flat = z
				.object({
					mediaHash: mediaHashPublicSchema,
					mediaId: z.number().int().nullable().optional(),
				})
				.safeParse(json);
			if (flat.success) {
				mediaHash = flat.data.mediaHash;
				mediaId = flat.data.mediaId ?? undefined;
			}
		}
	} catch {
		// ignore parse error
	}

	if (mediaHash === undefined) {
		throw new Error(`Unexpected upload response: ${result.body}`);
	}

	// The upload response no longer reliably includes a numeric mediaId, which the
	// chat-send endpoint requires. If it's missing, resolve it by re-fetching
	// /v4/me/profile and matching the freshly-uploaded photo by its mediaHash.
	if (mediaId === undefined) {
		console.error(
			`[mediaid-fix] uploadProfileImage: upload response had no mediaId for hash=${mediaHash}, resolving via /v4/me/profile`,
		);
		mediaId = await resolveMediaIdByHash(mediaHash);
	} else {
		console.error(
			`[mediaid-fix] uploadProfileImage: resolved mediaId=${mediaId} for hash=${mediaHash} source=upload-response`,
		);
	}

	return { mediaHash, mediaId };
}
