import z from "zod";

import { fetchRest } from "$lib/api";
import {
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

/**
 * Share one of OUR albums with another profile.
 *
 * Uses Grindr's dedicated album-share endpoint `POST /v4/albums/{albumId}/shares`,
 * which GRANTS the recipient view access to the album AND (per the documented
 * behaviour) automatically delivers the shared-album message into the chat with
 * every listed profile.
 *
 * This is the key fix for the "recipient receives the album but it stays locked"
 * bug: the previous implementation posted a raw `Album`/`ExpiringAlbumV2` chat
 * message via `/v4/chat/message/send`, which only references the album. That path
 * never registers a share grant, so on the recipient's side `isViewable` is false
 * and the album renders locked. Going through `/shares` is what actually entitles
 * the recipient to unlock it.
 *
 * The endpoint returns an empty body (no messageId). Because the share auto-sends
 * the album to chat, the real chat message arrives over the WebSocket
 * `chat.v1.message_sent` event and is reconciled by ConversationState. We return a
 * synthetic id purely to satisfy the existing `{ messageId }` caller contract in
 * conversation-state without having to touch that out-of-scope file; the optimistic
 * pending message it created is upgraded/deduped by the WS event and the poll
 * reconcile, not by this id.
 */
export async function shareAlbum({
	albumId,
	profileId,
	expirationType,
}: {
	albumId: number;
	profileId: number;
	expirationType: AlbumExpirationType;
}): Promise<{ messageId: string }> {
	const res = await fetchRest(`/v4/albums/${albumId}/shares`, {
		method: "POST",
		body: {
			profiles: [{ profileId, expirationType }],
		},
	});
	if (res.status >= 400) {
		throw new Error(`HTTP ${res.status}: ${res.text().slice(0, 200)}`);
	}
	// Response body is empty; the chat message is delivered via the share itself
	// and reconciled through the WebSocket message_sent event.
	return { messageId: `album-share-${albumId}-${profileId}-${Date.now()}` };
}
