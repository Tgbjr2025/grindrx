import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import z from "zod";

import { apiResponseMessageSchema } from "$lib/model/message";

export const notificationEventSchema = z.object({
	type: z.string(),
	notificationId: z.string().nullable(),
	ref: z.string().nullable(),
	payload: z.unknown(),
});

export const chatV1MessageSentEventSchema = notificationEventSchema.safeExtend({
	type: z.literal("chat.v1.message_sent"),
	payload: apiResponseMessageSchema,
});

export const chatV1ConversationDeleteEventSchema =
	notificationEventSchema.safeExtend({
		type: z.literal("chat.v1.conversation.delete"),
		payload: z.object({
			conversationIds: z.array(z.string()),
		}),
	});

export type ChatV1MessageSentEventPayload = z.infer<
	typeof chatV1MessageSentEventSchema
>;
export type ChatV1ConversationDeleteEventPayload = z.infer<
	typeof chatV1ConversationDeleteEventSchema
>;

// FIX 10 / FIX 16 — typed event schemas and name constants for retract, reactions, read receipts, typing
export const WS_EVENT = {
	MESSAGE_SENT: "chat.v1.message_sent",
	CONVERSATION_DELETE: "chat.v1.conversation.delete",
	MESSAGE_RETRACTED: "chat.v1.message_retracted",
	MESSAGE_REACTION: "chat.v1.message_reaction",
	READ: "chat.v1.read",
	TYPING: "chat.v1.typing",
} as const;

export type WsEventName = (typeof WS_EVENT)[keyof typeof WS_EVENT];

export const chatV1MessageRetractedSchema = z.object({
	targetMessageId: z.string(),
});

export const chatV1MessageReactionSchema = z.object({
	messageId: z.string(),
	reactionType: z.union([z.number().int().nonnegative(), z.string()]).transform((v) =>
		typeof v === "string" ? parseInt(v, 10) : v,
	),
	profileId: z.number(),
});

export const chatV1ReadSchema = z.object({
	conversationId: z.string(),
	lastReadTimestamp: z.number(),
});

export const chatV1TypingSchema = z.object({
	conversationId: z.string(),
	profileId: z.number(),
	isTyping: z.boolean(),
});

export type ChatV1MessageRetracted = z.infer<typeof chatV1MessageRetractedSchema>;
export type ChatV1MessageReaction = z.infer<typeof chatV1MessageReactionSchema>;
export type ChatV1Read = z.infer<typeof chatV1ReadSchema>;
export type ChatV1Typing = z.infer<typeof chatV1TypingSchema>;

export type WsStatus = "disconnected" | "connecting" | "connected" | "error";

class WsState {
	status = $state<WsStatus>("disconnected");

	constructor() {
		listen<void>("ws:connected", () => {
			this.status = "connected";
			console.log("[ws] connected");
		}).catch(console.error);

		listen<void>("ws:disconnected", () => {
			this.status = "disconnected";
		}).catch(console.error);

		listen<string>("ws:ws_error", (event) => {
			console.error("[ws] server error", event.payload);
		}).catch(console.error);
	}

	connect(): void {
		console.log("[ws] connecting...");
		invoke("ws_connect").catch((e: unknown) => {
			console.error("[ws] connect failed", e);
		});
	}

	onConnected(handler: () => void): Promise<() => void> {
		return listen<void>("ws:connected", () => handler());
	}

	send(type: string, payload: unknown): Promise<void> {
		const ref_id = crypto.randomUUID();
		return invoke<void>("ws_send", { command: { type, ref_id, payload } }).catch(
			(e: unknown) => {
				console.error("[ws] send failed", type, e);
				throw e;
			},
		);
	}

	on<T>(
		eventType: string,
		schema: z.ZodType<T>,
		handler: (payload: T) => void,
	): Promise<() => void> {
		const safeName = eventType.replaceAll(".", "_");
		return listen<unknown>(`grindr:${safeName}`, (event) => {
			const result = schema.safeParse(event.payload);
			if (result.success) {
				handler(result.data);
			} else {
				// FIX 9 — fallback: emit with minimal { type, raw } so callers know something arrived
				const minimalResult = z.object({ type: z.string() }).safeParse(event.payload);
				if (minimalResult.success) {
					console.warn(
						`[ws] unknown payload shape for ${eventType} (type=${minimalResult.data.type}), emitting raw:`,
						event.payload,
					);
					// Re-emit as a generic raw event so listeners can react if they want
					invoke("ws_raw_event", { type: minimalResult.data.type, raw: event.payload }).catch(() => {
						// best-effort — backend may not implement this command
					});
				} else {
					console.error(
						`[ws] unexpected payload for ${eventType}:`,
						result.error,
						event.payload,
					);
				}
			}
		});
	}

	onRetracted(handler: (payload: ChatV1MessageRetracted) => void): Promise<() => void> {
		return this.on(WS_EVENT.MESSAGE_RETRACTED, chatV1MessageRetractedSchema, handler);
	}

	onReaction(handler: (payload: ChatV1MessageReaction) => void): Promise<() => void> {
		return this.on(WS_EVENT.MESSAGE_REACTION, chatV1MessageReactionSchema, handler);
	}

	onRead(handler: (payload: ChatV1Read) => void): Promise<() => void> {
		return this.on(WS_EVENT.READ, chatV1ReadSchema, handler);
	}

	onTyping(handler: (payload: ChatV1Typing) => void): Promise<() => void> {
		return this.on(WS_EVENT.TYPING, chatV1TypingSchema, handler);
	}
}

export const ws = new WsState();
