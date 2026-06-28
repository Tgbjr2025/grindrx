import z from "zod";

import { fetchRest } from "$lib/api";
import {
	type Conversation,
	fullConversationSchema,
} from "$lib/model/conversation";

// Parse each inbox entry independently so one malformed conversation (schema
// drift, an unrecognised last-message type) can't throw the entire inbox load
// and leave the chat list blank. Bad entries are dropped + logged.
const conversationsSchema = z.object({
	entries: z.array(z.unknown()).transform((raw) =>
		raw.flatMap((entry) => {
			const result = fullConversationSchema.safeParse(entry);
			if (result.success) return [result.data];
			console.warn("[GrindrX] dropping unparseable conversation", {
				issue: result.error.issues[0],
			});
			return [];
		}),
	),
	nextPage: z.number().nullable().catch(null),
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
