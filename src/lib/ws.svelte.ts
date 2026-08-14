import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import z from "zod";

import { coerceApiResponseMessage } from "$lib/api/messages";

export const notificationEventSchema = z.object({
	type: z.string(),
	notificationId: z.string().nullable(),
	ref: z.string().nullable(),
	payload: z.unknown(),
});

export const chatV1MessageSentEventSchema = notificationEventSchema.safeExtend({
	type: z.literal("chat.v1.message_sent"),
	// Coerce unknown/new message types to `Unknown` (same as the REST path) so a
	// single unmodeled message type doesn't drop the live event entirely — it
	// would otherwise only surface on the next poll reconcile.
	payload: z.unknown().transform((raw) => coerceApiResponseMessage(raw, 0)),
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

// FIX 10 / FIX 16 — typed event schemas and name constants. `chat.v1.typing.start`
// / `chat.v1.typing.stop` are the real (WIP, per
// docs/content/grindr-api/websocket/notification-event.md) server events, each
// delivered through the standard notification envelope. There is NO
// `chat.v1.message_reaction`, `chat.v1.message_retracted`, or `chat.v1.read`
// event on the real server — reactions/retracts arrive inline via
// chat.v1.message_sent, and the recipient's read position comes from the REST
// message-list response (see conversation-state.svelte.ts), so those
// speculative event names + schemas were removed rather than kept as dead code.
export const WS_EVENT = {
	MESSAGE_SENT: "chat.v1.message_sent",
	CONVERSATION_DELETE: "chat.v1.conversation.delete",
	TYPING_START: "chat.v1.typing.start",
	TYPING_STOP: "chat.v1.typing.stop",
} as const;

export type WsEventName = (typeof WS_EVENT)[keyof typeof WS_EVENT];

const typingPayloadSchema = z.object({
	conversationId: z.string(),
	profileId: z.number(),
});

export const chatV1TypingStartEventSchema = notificationEventSchema.safeExtend({
	type: z.literal("chat.v1.typing.start"),
	payload: typingPayloadSchema,
});

export const chatV1TypingStopEventSchema = notificationEventSchema.safeExtend({
	type: z.literal("chat.v1.typing.stop"),
	payload: typingPayloadSchema,
});

export type ChatV1Typing = z.infer<typeof typingPayloadSchema> & {
	isTyping: boolean;
};

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

	// FIX 4: typing indicator. The real server events are `chat.v1.typing.start`
	// / `chat.v1.typing.stop` (WIP), delivered through the standard
	// notification envelope — not a single flat `chat.v1.typing` event with an
	// `isTyping` field. Subscribe to both and normalize into one callback.
	onTyping(handler: (payload: ChatV1Typing) => void): Promise<() => void> {
		const start = this.on(
			WS_EVENT.TYPING_START,
			chatV1TypingStartEventSchema,
			(event) => handler({ ...event.payload, isTyping: true }),
		);
		const stop = this.on(
			WS_EVENT.TYPING_STOP,
			chatV1TypingStopEventSchema,
			(event) => handler({ ...event.payload, isTyping: false }),
		);
		return Promise.all([start, stop]).then(([unlistenStart, unlistenStop]) => () => {
			unlistenStart();
			unlistenStop();
		});
	}
}

export const ws = new WsState();
