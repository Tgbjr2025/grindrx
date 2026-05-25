import z from "zod";

import { fetchRest } from "$lib/api";
import {
	type Conversation,
	fullConversationSchema,
} from "$lib/model/conversation";

const conversationsSchema = z.object({
	entries: z.array(fullConversationSchema),
	nextPage: z.number().nullable(),
});

export async function getConversations(page: number = 1) {
	const conversations = await fetchRest(
		"/v4/inbox?" + new URLSearchParams({ page: String(page) }).toString(),
		{
			method: "POST",
		},
	).then((res) => res.jsonParsed(conversationsSchema));
	return conversations;
}

export async function markConversationAsRead({
	conversationId,
	messageId = "0:00000000-0000-0000-0000-000000000000",
}: {
	conversationId: string;
	messageId?: string;
}) {
	const res = await fetchRest(
		`/v4/chat/conversation/${conversationId}/read/${messageId}`,
		{
			method: "POST",
		},
	);
	if (res.status >= 400) throw new Error(`Failed: ${res.status}`);
	return res;
}

export async function deleteConversationForMe({
	conversationId,
}: {
	conversationId: Conversation["data"]["conversationId"];
}) {
	const res = await fetchRest(`/v4/chat/conversation/${conversationId}`, {
		method: "DELETE",
	});
	if (res.status >= 400) throw new Error(`Failed: ${res.status}`);
	return res;
}
