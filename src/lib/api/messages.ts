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
	messages: z.array(apiResponseMessageSchema),
	profile: z.object({
		distance: z.number().nullable(),
		mediaHash: z.string().nullable(),
		name: z.string().nullable(),
		onlineUntil: z.number().nullable(),
		profileId: z.number().int(),
		showDistance: z.boolean(),
	}),
});

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
	return messages;
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
	return await fetchRest("/v4/chat/message/reaction", {
		method: "POST",
		body: {
			conversationId,
			messageId,
			reactionType,
		},
	});
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
