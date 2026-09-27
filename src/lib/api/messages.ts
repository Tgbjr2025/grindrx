import z from "zod";

import { fetchRest } from "$lib/api";
import { throwForStatus } from "$lib/api/http";
import {
	type ApiResponseMessage,
	apiResponseMessageSchema,
	messageSchema,
} from "$lib/model/message";
import type { Conversation } from "$lib/model/conversation";

// The send endpoints (sendMessage/sendProfilePhotoMessage) only need
// `messageId` back — the optimistic bubble already has the full local copy.
// Parsing the response with the full strict discriminated-union message
// schema made a schema-drifted-but-successful (2xx) send throw and get
// marked "failed" in the UI, and tapping retry then double-sent it. This
// lenient shape mirrors the read path's tolerance (coerceApiResponseMessage)
// instead of requiring the exact modeled message shape.
//
// `messageId` is accepted as a number too: the goal here is leniency, and a
// numeric id on an otherwise-2xx send would reproduce the exact failure the
// lenient shape exists to prevent (a marked-failed bubble the user then
// double-sends by retrying). Normalised to a string — `messageId` is the dedup
// key everywhere, so the same id in two types must not become two messages.
const sendMessageResponseSchema = z.object({
	messageId: z.union([z.string(), z.number()]).transform(String),
});

const conversationMessagesSchema = z.object({
	lastReadTimestamp: z.number().nonnegative().nullable().catch(null),
	// Parse each message individually below so one unrecognized/malformed message
	// (e.g. a shared album with a null thumbnail, or a message type we don't model
	// yet) can't throw the whole conversation parse and blank the chat.
	messages: z.array(z.unknown()),
	pageKey: z.string().nullable().optional().catch(null),
	// Tolerate drift in the profile sub-object too: the 10s reconcile poll only
	// consumes `messages`, so a single changed/added profile field must NOT throw
	// the whole parse and freeze the chat (same philosophy as the v0.1.9 grid fix).
	profile: z.object({
		distance: z.number().nullable().optional().catch(null),
		mediaHash: z.string().nullable().optional().catch(null),
		name: z.string().nullable().optional().catch(null),
		onlineUntil: z.number().nullable().optional().catch(null),
		profileId: z.number().int(),
		showDistance: z.boolean().optional().catch(true),
	}).catch({ distance: null, mediaHash: null, name: null, onlineUntil: null, profileId: 0, showDistance: true }),
});

/**
 * Stable 32-bit FNV-1a hash of a payload, rendered base36.
 *
 * Used ONLY to make the synthetic id of an unparseable message distinct per
 * payload. It is not a security primitive and needs no distribution guarantees
 * beyond "different inputs usually differ"; FNV-1a is one multiply and one xor
 * per byte, which matters because this runs over the whole message array on
 * every conversation load.
 */
function hashPayload(raw: unknown): string {
	const text =
		typeof raw === "string" ? raw : safeStringify(raw);
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		// hash *= 16777619, kept in 32-bit range without BigInt.
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(36);
}

function safeStringify(raw: unknown): string {
	try {
		return JSON.stringify(raw) ?? String(raw);
	} catch {
		// Circular / unserialisable. `String(raw)` is still stable per call for
		// primitives; for objects it degrades to "[object Object]", which the
		// caller's `index` disambiguator covers.
		return String(raw);
	}
}

/**
 * Parse a single API message, degrading gracefully to an `Unknown` message
 * (preserving the routing/overlay fields) instead of throwing when the body
 * shape is unexpected. This keeps a single exotic message from making an entire
 * conversation fail to load.
 *
 * SYNTHETIC ID: when the payload has no usable `messageId`, the fallback used to
 * be `unparsed-${index}-${timestamp}`. `index` is a POSITION, not an identity,
 * and the WebSocket caller passed a hardcoded `0` — so two different malformed
 * payloads landing in the same place (the single WS event, or a list whose
 * earlier entries were dropped/reordered by a concurrent poll) collapsed onto
 * one id. `messageId` is the dedup key throughout the chat state, so they
 * became ONE message and one of the two was silently dropped. The id is now
 * derived from a hash of the raw payload, so distinct payloads get distinct ids;
 * `index` is retained only to separate two *byte-identical* payloads.
 */
export function coerceApiResponseMessage(raw: unknown, index: number): ApiResponseMessage {
	const parsed = apiResponseMessageSchema.safeParse(raw);
	if (parsed.success) return parsed.data;

	const r = (raw ?? {}) as Record<string, unknown>;
	if (import.meta.env.DEV) {
		console.warn(
			"Coercing unparseable message to Unknown:",
			typeof r.type === "string" ? r.type : "<no type>",
			parsed.error.issues.slice(0, 3),
		);
	}
	return {
		type: "Unknown",
		body: r.body,
		messageId:
			typeof r.messageId === "string" && r.messageId.length > 0
				? r.messageId
				: `unparsed-${hashPayload(raw)}-${index}`,
		conversationId: typeof r.conversationId === "string" ? r.conversationId : "",
		senderId: typeof r.senderId === "number" ? r.senderId : 0,
		timestamp: typeof r.timestamp === "number" ? r.timestamp : 0,
		unsent: typeof r.unsent === "boolean" ? r.unsent : false,
		reactions: Array.isArray(r.reactions)
			? (r.reactions as ApiResponseMessage["reactions"])
			: [],
	};
}

export async function getConversationMessages({
	conversationId,
	pageKey,
}: {
	conversationId: string;
	pageKey?: string;
}) {
	const params = new URLSearchParams({ profile: "true" });
	if (pageKey !== undefined) params.set("pageKey", pageKey);
	const messages = await fetchRest(
		`/v5/chat/conversation/${conversationId}/message?` + params.toString(),
		{ method: "GET" },
	).then((res) =>
		// No `res.status >= 400` pre-check here: it ran BEFORE `.json()`, so
		// `classifyResponseBody` never classified the body and every server
		// failure surfaced as a bare `Error("Messages fetch failed: 400")` with
		// no `status`/`code` for callers to branch on. `jsonParsed` raises
		// `ApiHttpError` for any non-2xx itself — see `isApiHttpError(err, 400)`.
		res.jsonParsed(conversationMessagesSchema),
	);
	return {
		...messages,
		messages: messages.messages.map(coerceApiResponseMessage),
	};
}

export async function sendMessage({
	toUserId,
	message,
}: {
	toUserId: number;
	message: z.infer<typeof messageSchema>;
}) {
	return await fetchRest("/v4/chat/message/send", {
		method: "POST",
		body: {
			type: message.type,
			target: {
				type: "Direct",
				targetId: toUserId,
			},
			body: message.body,
		},
	}).then((res) => res.jsonParsed(sendMessageResponseSchema));
}

export async function sendProfilePhotoMessage({
	toUserId,
	mediaId,
	mediaHash,
	url,
	createdAt,
}: {
	toUserId: number;
	// The numeric id minted by `POST /v5/chat/media/upload`. Type "Image" sends
	// 400 (urn:gr:err:internal_error) without it.
	mediaId: number;
	mediaHash: string;
	// The signed media URL returned by the upload endpoint. Falls back to the
	// public CDN path if a caller has no signed URL on hand.
	url?: string;
	createdAt: number | null;
}) {
	const res = await fetchRest("/v4/chat/message/send", {
		method: "POST",
		body: {
			type: "Image",
			target: { type: "Direct", targetId: toUserId },
			body: {
				mediaId,
				url: url ?? `https://cdns.grindr.com/images/${mediaHash}`,
				width: null,
				height: null,
				imageHash: mediaHash,
				takenOnGrindr: false,
				createdAt,
			},
		},
	});
	// The previous `res.status >= 400` pre-check threw
	// `new Error(\`HTTP ${res.status}: ${res.text().slice(0, 200)}\`)` — a raw
	// server body pasted into a user-facing `Error.message` that the composer
	// toasts verbatim. `jsonParsed` classifies the body first and raises
	// `ApiHttpError`, which keeps the raw body in `.body` (logs) and the message
	// to the server's own message/code.
	return res.jsonParsed(sendMessageResponseSchema);
}

/**
 * Send a shared location pin.
 *
 * The `Location` message type and its `{ lat, lon }` body were already modelled
 * (`locationMessageSchema` in $lib/model/message) and rendered
 * (`LocationMessage.svelte`, which opens the point in the device maps app), but
 * there was no way to CREATE one — so the feature was receive-only. This closes
 * that gap; `ConversationState.send` already handles arbitrary message types, so
 * it flows through the same optimistic + WebSocket-echo path as text.
 */
export async function sendLocationMessage({
	toUserId,
	lat,
	lon,
}: {
	toUserId: number;
	lat: number;
	lon: number;
}) {
	return await fetchRest("/v4/chat/message/send", {
		method: "POST",
		body: {
			type: "Location",
			target: {
				type: "Direct",
				targetId: toUserId,
			},
			body: { lat, lon },
		},
	}).then((res) => res.jsonParsed(sendMessageResponseSchema));
}

export async function reactToMessage({
	conversationId,
	messageId,
	reactionType,
}: {
	conversationId: Conversation["data"]["conversationId"];
	messageId: ApiResponseMessage["messageId"];
	reactionType: number;
}) {
	const res = await fetchRest("/v4/chat/message/reaction", {
		method: "POST",
		body: {
			conversationId,
			messageId,
			reactionType,
		},
	});
	// No body is read on this path, so nothing downstream can raise for us.
	throwForStatus(res, "/v4/chat/message/reaction");
	return res;
}

export async function deleteMessageForMe({
	conversationId,
	messageId,
}: {
	conversationId: Conversation["data"]["conversationId"];
	messageId: ApiResponseMessage["messageId"];
}) {
	const path = `/v4/chat/message/delete`;
	return await fetchRest(path, {
		method: "POST",
		body: {
			conversationId,
			messageId,
		},
	}).then((res) => {
		// The raw body used to be pasted into a `console.error` AND the
		// user-visible message; `ApiHttpError` keeps the status/code in the
		// message and the body available for logs.
		throwForStatus(res, path);
	});
}

export async function unsendMessage({
	conversationId,
	messageId,
}: {
	conversationId: Conversation["data"]["conversationId"];
	messageId: ApiResponseMessage["messageId"];
}) {
	const path = `/v4/chat/message/unsend`;
	return await fetchRest(path, {
		method: "POST",
		body: {
			conversationId,
			messageId,
		},
	}).then((res) => {
		// Same as deleteMessageForMe: the previous failure log concatenated up
		// to 200 characters of the raw server body.
		throwForStatus(res, path);
	});
}
