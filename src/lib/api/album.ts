import { invoke } from "@tauri-apps/api/core";
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
 * The endpoint returns an empty body — there is no `messageId` to adopt. That is
 * fine because the share auto-sends the album to chat, so the real chat message
 * arrives over the WebSocket `chat.v1.message_sent` event and is reconciled by
 * ConversationState.
 *
 * This function previously returned a *synthetic* id
 * (`album-share-${albumId}-${profileId}-${Date.now()}`) to satisfy the old
 * `{ messageId }` caller contract. That was actively harmful: ConversationState
 * wrote the fake id onto the optimistic bubble, which broke every dedup path
 * (the WS echo could not match it, and `removeDuplicateMessages` keys on
 * `messageId`) and left a permanent duplicate album bubble that could not be
 * unsent. Callers now keep the bubble `pending` and adopt the real message via
 * `pendingKey` — see `OptimisticMessage.pendingKey`.
 */
export async function shareAlbum({
	albumId,
	profileId,
	expirationType,
}: {
	albumId: number;
	profileId: number;
	expirationType: AlbumExpirationType;
}): Promise<void> {
	const res = await fetchRest(`/v4/albums/${albumId}/shares`, {
		method: "POST",
		body: {
			profiles: [{ profileId, expirationType }],
		},
	});
	if (res.status >= 400) {
		throw new Error(`HTTP ${res.status}: ${res.text().slice(0, 200)}`);
	}
	// Intentionally returns nothing: the real chat message is delivered via the
	// share itself and reconciled through the WebSocket message_sent event.
}

// ---------------------------------------------------------------------------
// Album management (create / rename / delete / content / viewers)
//
// Everything below was ADDED for the settings > Albums management page. The
// functions above (getAlbumContent / getMyAlbums / shareAlbum) are untouched.
//
// Conventions mirrored from `shareAlbum`: go through `fetchRest`, then throw on
// `res.status >= 400` with the HTTP status + a slice of the body. Response
// bodies are validated with tolerant zod (safeParse) so a Grindr schema drift
// degrades gracefully instead of throwing.
// ---------------------------------------------------------------------------

/**
 * Album names are limited to 255 UTF-8 BYTES (not characters) by the API — see
 * docs/content/grindr-api/messaging/albums.md#album-name. Clamp on a codepoint
 * boundary so we never split a multi-byte character (which would corrupt the
 * name) and never send an over-long name the server would reject. Pure + tested.
 */
export const ALBUM_NAME_MAX_BYTES = 255;

export function truncateToUtf8Bytes(value: string, maxBytes: number): string {
	const encoder = new TextEncoder();
	if (encoder.encode(value).length <= maxBytes) return value;
	let out = "";
	// Iterate by codepoint (for..of over a string yields whole codepoints, not
	// surrogate halves) so we only ever cut on a character boundary.
	for (const ch of value) {
		if (encoder.encode(out + ch).length > maxBytes) break;
		out += ch;
	}
	return out;
}

/**
 * Build the `{ albumName }` body shared by create + rename. The API coerces
 * non-string names to string and caps them at 255 UTF-8 bytes, so we do the
 * same client-side. Pure + tested.
 */
export function buildAlbumNameBody(name: string): { albumName: string } {
	return { albumName: truncateToUtf8Bytes(String(name), ALBUM_NAME_MAX_BYTES) };
}

function throwIfError(
	res: { status: number; text(): string },
	action: string,
): void {
	if (res.status >= 400) {
		throw new Error(
			`Failed to ${action} (HTTP ${res.status}): ${res.text().slice(0, 200)}`,
		);
	}
}

const createAlbumResponseSchema = z.object({ albumId: z.number().int() });

/**
 * Create a new (empty) album. `POST /v2/albums`, body `{ albumName }`, returns
 * `{ albumId }`. The API answers HTTP 402 if the account is at its album limit.
 */
export async function createAlbum(name: string): Promise<{ albumId: number }> {
	const res = await fetchRest("/v2/albums", {
		method: "POST",
		body: buildAlbumNameBody(name),
	});
	throwIfError(res, "create album");
	const parsed = createAlbumResponseSchema.safeParse(res.json());
	if (!parsed.success) {
		throw new Error("Create-album response was missing an albumId");
	}
	return parsed.data;
}

const renameAlbumResponseSchema = z.object({
	albumId: z.number().int(),
	albumName: z.string().nullable(),
});

/**
 * Rename an existing album. `PUT /v2/albums/{albumId}`, body `{ albumName }`,
 * returns `{ albumId, albumName }`.
 */
export async function renameAlbum({
	albumId,
	name,
}: {
	albumId: number;
	name: string;
}): Promise<{ albumId: number; albumName: string | null }> {
	const res = await fetchRest(`/v2/albums/${albumId}`, {
		method: "PUT",
		body: buildAlbumNameBody(name),
	});
	throwIfError(res, "rename album");
	const parsed = renameAlbumResponseSchema.safeParse(res.json());
	// The server echoes the new name; if the shape drifts, fall back to what we
	// sent so the caller still gets a usable result.
	if (parsed.success) return parsed.data;
	return { albumId, albumName: buildAlbumNameBody(name).albumName };
}

/**
 * Delete an album. `DELETE /v1/albums/{albumId}`, empty response. Repeated
 * deletes of the same album answer 403 ("Action not permitted").
 */
export async function deleteAlbum(albumId: number): Promise<void> {
	const res = await fetchRest(`/v1/albums/${albumId}`, { method: "DELETE" });
	throwIfError(res, "delete album");
}

const addContentResponseSchema = z.object({
	contentId: z.coerce.number().int().optional(),
});

/**
 * Upload image bytes into an album: `POST /v1/albums/{albumId}/content`.
 *
 * ⚠️ This replaces a broken by-reference implementation. The endpoint is
 * `multipart/form-data` with the raw file under the field `content`, but the
 * generic `request` bridge re-encodes every body as JSON
 * (`src-tauri/src/api/rest.rs`), so the WebView could not reach it. The previous
 * code therefore uploaded the bytes to the **chat** media store to mint a
 * `{mediaId, mediaHash}` and POST that as JSON to a multipart-only endpoint. It
 * failed, and because there is no `chat/media/delete` endpoint wired up, every
 * attempt orphaned an undeletable copy of the photo in the chat media store.
 *
 * `upload_album_content` is a dedicated Tauri command that builds a real
 * multipart body, so the bytes go straight to the album.
 */
export async function addAlbumContentFromBytes({
	albumId,
	base64,
	mimeType,
}: {
	albumId: number;
	base64: string;
	mimeType: string;
}): Promise<{ contentId: number | null }> {
	const res = await invoke<{ status: number; body: string }>("upload_album_content", {
		albumId,
		imageBase64: base64,
		mimeType,
	});
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
	}
	// The documented success body is `{ contentId, contentUrl }`, but treat an
	// empty/non-JSON 2xx as success-without-an-id rather than failing a photo
	// that did land.
	let contentId: number | null = null;
	try {
		const parsed = addContentResponseSchema.safeParse(JSON.parse(res.body));
		if (parsed.success) contentId = parsed.data.contentId ?? null;
	} catch {
		// empty / non-JSON body — treated as a success with no id
	}
	return { contentId };
}

/**
 * Remove one media item from an album. `DELETE
 * /v1/albums/{albumId}/content/{contentId}`, empty response. Note the CDN copy
 * is not purged — signed URLs keep working until they expire.
 */
export async function removeAlbumContent({
	albumId,
	contentId,
}: {
	albumId: number;
	contentId: number;
}): Promise<void> {
	const res = await fetchRest(
		`/v1/albums/${albumId}/content/${contentId}`,
		{ method: "DELETE" },
	);
	throwIfError(res, "remove photo from album");
}

/**
 * Parse the `GET /v1/albums/{albumId}/shares` response into a plain list of
 * viewer profile ids. The documented shape is `{ profileIds: number[] }`; we
 * parse each id tolerantly and drop any that aren't coercible to an int rather
 * than throwing the whole list away. Pure + tested.
 */
export function parseAlbumViewerIds(data: unknown): number[] {
	const parsed = z.object({ profileIds: z.array(z.unknown()) }).safeParse(data);
	if (!parsed.success) return [];
	return parsed.data.profileIds.flatMap((v) => {
		// Accept a real int or a numeric string (Grindr sometimes serialises longs
		// as strings). Deliberately NOT `z.coerce.number()`, which would turn
		// `null`/`""`/`false` into 0 and invent viewer ids that aren't there.
		if (typeof v === "number" && Number.isInteger(v)) return [v];
		if (typeof v === "string" && v.trim() !== "" && Number.isInteger(Number(v))) {
			return [Number(v)];
		}
		return [];
	});
}

/**
 * List the profile ids an album is currently shared with. `GET
 * /v1/albums/{albumId}/shares` → `{ profileIds: number[] }`.
 */
export async function getAlbumViewers(albumId: number): Promise<number[]> {
	const res = await fetchRest(`/v1/albums/${albumId}/shares`);
	throwIfError(res, "load album viewers");
	return parseAlbumViewerIds(res.json());
}

/**
 * Body for revoking one viewer's access. Pure + tested. See `removeAlbumViewer`
 * for the endpoint-choice rationale.
 */
export function buildRemoveViewerBody(profileId: number): {
	profiles: { profileId: number; shareId: number }[];
} {
	// `shareId` is documented as "unknown integer, can be 0"; 0 is the only value
	// the doc gives, and per-profile unshare works with it.
	return { profiles: [{ profileId, shareId: 0 }] };
}

/**
 * Revoke a single viewer's access to an album.
 *
 * ⚠️ ENDPOINT CHOICE: the task brief named `PUT
 * /v1/albums/{albumId}/shares/remove`, but the doc marks that exact route as
 * WIP and says it "returns 403" (Unshare from everybody, unknown body) —
 * docs/content/grindr-api/messaging/albums.md#unshare-an-album-from-everybody.
 * The WORKING, documented per-viewer revoke is `PUT
 * /v1/albums/{albumId}/unshares` with body
 * `{ profiles: [{ profileId, shareId }] }` (#unshare-an-album), so we use that.
 */
export async function removeAlbumViewer({
	albumId,
	profileId,
}: {
	albumId: number;
	profileId: number;
}): Promise<void> {
	const res = await fetchRest(`/v1/albums/${albumId}/unshares`, {
		method: "PUT",
		body: buildRemoveViewerBody(profileId),
	});
	throwIfError(res, "remove viewer");
}
