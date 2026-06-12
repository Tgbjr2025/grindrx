import z from "zod";

import { fetchRest } from "$lib/api";
import {
	type ApiResponseMessage,
	apiResponseMessageSchema,
	messageSchema,
} from "$lib/model/message";
import { unixTimestampMsSchema } from "$lib/model/types";
import type { Conversation } from "$lib/model/conversation";

const conversationMessagesSchema = z.object({
	lastReadTimestamp: z.number().nonnegative().nullable(),
	// Parse each message individually below so one unrecognized/malformed message
	// (e.g. a shared album with a null thumbnail, or a message type we don't model
	// yet) can't throw the whole conversation parse and blank the chat.
	messages: z.array(z.unknown()),
	pageKey: z.string().nullable().optional(),
	profile: z.object({
		distance: z.number().nullable(),
		mediaHash: z.string().nullable(),
		name: z.string().nullable(),
		onlineUntil: z.number().nullable(),
		profileId: z.number().int(),
		showDistance: z.boolean(),
	}),
});

/**
 * Parse a single API message, degrading gracefully to an `Unknown` message
 * (preserving the routing/overlay fields) instead of throwing when the body
 * shape is unexpected. This keeps a single exotic message from making an entire
 * conversation fail to load.
 */
function coerceApiResponseMessage(raw: unknown, index: number): ApiResponseMessage {
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
				: `unparsed-${index}-${typeof r.timestamp === "number" ? r.timestamp : 0}`,
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
	).then((res) => {
		if (res.status >= 400) throw new Error(`Messages fetch failed: ${res.status}`);
		return res.jsonParsed(conversationMessagesSchema);
	});
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
	}).then((res) => res.jsonParsed(apiResponseMessageSchema));
}

export async function sendProfilePhotoMessage({
	toUserId,
	mediaId,
	mediaHash,
	createdAt,
}: {
	toUserId: number;
	mediaId: number;
	mediaHash: string;
	createdAt: number | null;
}) {
	const res = await fetchRest("/v4/chat/message/send", {
		method: "POST",
		body: {
			type: "Image",
			target: { type: "Direct", targetId: toUserId },
			body: {
				mediaId,
				url: `https://cdns.grindr.com/images/${mediaHash}`,
				width: null,
				height: null,
				imageHash: mediaHash,
				takenOnGrindr: false,
				createdAt,
			},
		},
	});
	if (res.status >= 400) {
		throw new Error(`HTTP ${res.status}: ${res.text().slice(0, 200)}`);
	}
	return res.jsonParsed(apiResponseMessageSchema);
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
	if (res.status >= 400) throw new Error(`Reaction failed: ${res.status}`);
	return res;
}

export async function deleteMessageForMe({
	conversationId,
	messageId,
}: {
	conversationId: Conversation["data"]["conversationId"];
	messageId: ApiResponseMessage["messageId"];
}) {
	return await fetchRest(`/v4/chat/message/delete`, {
		method: "POST",
		body: {
			conversationId,
			messageId,
		},
	}).then((res) => {
		if (res.status !== 200) {
			console.error("Failed to delete message, status:", res.status);
			throw new Error("Failed to delete message");
		}
	});
}
