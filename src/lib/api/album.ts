import z from "zod";

import { fetchRest } from "$lib/api";
import {
	AlbumExpiration,
	albumContentSchema,
	albumDetailsSchema,
	type AlbumExpirationType,
	albumMinSchema,
} from "$lib/model/album";

const albumResponseSchema = z.object({
	...albumMinSchema.shape,
	...albumDetailsSchema.shape,
	content: z.array(
		z.object({
			...albumContentSchema.shape,
			remainingViews: z.number().int().optional(),
		}),
	),
});

export async function getAlbumContent(albumId: number) {
	return await fetchRest(`/v2/albums/${albumId}`).then((res) =>
		res.jsonParsed(albumResponseSchema),
	);
}

export type AlbumContentResponse = Awaited<ReturnType<typeof getAlbumContent>>;

const myAlbumSchema = z.object({
	albumId: z.number().int(),
	albumName: z.string().nullable(),
	profileId: z.number().int(),
	version: z.number().int().optional(),
	isShareable: z.boolean().optional(),
	...albumDetailsSchema.shape,
	content: z.array(albumContentSchema),
});

export type MyAlbum = z.infer<typeof myAlbumSchema>;

export async function getMyAlbums() {
	return await fetchRest("/v1/albums").then((res) =>
		res.jsonParsed(z.object({ albums: z.array(myAlbumSchema) })),
	);
}

function expiresAtMs(expirationType: AlbumExpirationType): number | null {
	const now = Date.now();
	switch (expirationType) {
		case "TEN_MINUTES": return now + 10 * 60 * 1000;
		case "ONE_HOUR": return now + 60 * 60 * 1000;
		case "ONE_DAY": return now + 24 * 60 * 60 * 1000;
		case "ONCE": return null; // view-count-limited, not time-limited — server controls expiry
		case "INDEFINITE": return null;
		default: return null;
	}
}

export async function shareAlbum({
	albumId,
	profileId,
	expirationType,
}: {
	albumId: number;
	profileId: number;
	expirationType: AlbumExpirationType;
}) {
	const isExpiring = expirationType !== "INDEFINITE";
	const res = await fetchRest("/v4/chat/message/send", {
		method: "POST",
		body: {
			type: isExpiring ? "ExpiringAlbumV2" : "Album",
			target: { type: "Direct", targetId: profileId },
			body: {
				albumId,
				expirationType,
				expiresAt: expiresAtMs(expirationType),
			},
		},
	});
	if (res.status >= 400) {
		throw new Error(`HTTP ${res.status}: ${res.text().slice(0, 200)}`);
	}
	return res;
}
