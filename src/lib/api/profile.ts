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
				...m,
				reason: null,
				takenOnGrindr: null,
				createdAt: null,
			}));
		} catch {
			// best-effort
		}
	}
	myProfileCache = { profile, updatedAt: Date.now() };
	return profile;
}

export async function getProfileUploadedPhotos() {
	return await fetchRest("/v3.1/me/profile/images").then((res) =>
		res.jsonParsed(
			z.object({
				medias: z.array(
					z.object({
						mediaHash: mediaHashPublicSchema,
						mediaId: z.number().int().optional(),
						type: z.number().int(),
						state: z.number().int(),
						createdAt: z.number().nonnegative().optional(),
					}),
				),
			}),
		),
	);
}

export type ProfilePhoto = Awaited<
	ReturnType<typeof getProfileUploadedPhotos>
>["medias"][number];

const uploadResponseSchema = z.object({
	images: z.array(
		z.object({
			mediaHash: mediaHashPublicSchema,
			mediaId: z.number().int().optional(),
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
	try {
		const json = JSON.parse(result.body);
		const parsed = uploadResponseSchema.safeParse(json);
		if (parsed.success && parsed.data.images.length > 0) {
			return {
				mediaHash: parsed.data.images[0].mediaHash,
				mediaId: parsed.data.images[0].mediaId,
			};
		}
		// Fallback: try flat response { mediaHash, mediaId }
		const flat = z
			.object({ mediaHash: mediaHashPublicSchema, mediaId: z.number().int().optional() })
			.safeParse(json);
		if (flat.success) {
			return { mediaHash: flat.data.mediaHash, mediaId: flat.data.mediaId };
		}
	} catch {
		// ignore parse error
	}

	throw new Error(`Unexpected upload response: ${result.body}`);
}
