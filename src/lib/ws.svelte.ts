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
	//
	// `wsMessageSequence` is passed instead of a hardcoded `0`: the synthetic
	// messageId this produces is a dedup key, and a constant `index` made every
	// unparseable live event collide on one id (see `coerceApiResponseMessage`).
	payload: z
		.unknown()
		.transform((raw) => coerceApiResponseMessage(raw, wsMessageSequence++)),
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

/**
 * Monotonic counter for the synthetic-message-id disambiguator on the live
 * event path. A single integer, so it cannot grow without bound.
 */
let wsMessageSequence = 0;

class WsState {
	status = $state<WsStatus>("disconnected");

	// The three lifecycle listeners below were registered in the constructor
	// with their `unlisten` functions discarded, so nothing could ever detach
	// them: every re-instantiation would stack another set, and there was no
	// teardown at all. Kept so `dispose()` can actually release them.
	#unlisteners: Array<() => void> = [];
	#disposed = false;

	constructor() {
		// `listen()` resolves asynchronously, so a listen that has not settled
		// yet is not yet in `#unlisteners` — `dispose()` closes that race by
		// setting `#disposed`, and each pending promise unlistens on arrival.
		const track = (p: Promise<() => void>) => {
			p
				.then((unlisten) => {
					if (this.#disposed) unlisten();
					else this.#unlisteners.push(unlisten);
				})
				.catch((e: unknown) => console.error("[ws] listen failed", e));
		};

		track(
			listen<void>("ws:connected", () => {
				this.status = "connected";
			}),
		);

		track(
			listen<void>("ws:disconnected", () => {
				this.status = "disconnected";
			}),
		);

		track(
			// A server-side WS error string is a protocol-level diagnostic, not a
			// chat payload — safe to log, and necessary to debug a dead socket.
			listen<string>("ws:ws_error", (event) => {
				console.error("[ws] server error", event.payload);
			}),
		);
	}

	/**
	 * Release every listener registered by this instance and mark it unusable.
	 * Idempotent. The module-level `ws` singleton lives for the WebView's
	 * lifetime, so this exists for symmetry with `on()`'s unlisten contract and
	 * for tests — it is NOT called on teardown today.
	 */
	dispose(): void {
		this.#disposed = true;
		for (const unlisten of this.#unlisteners.splice(0)) unlisten();
	}

	connect(): void {
		// Re-entrancy guard: `connect()` was fire-and-forget with no guard, so
		// every re-auth / re-render that reached it started ANOTHER Rust
		// `ws_connect`, and the first failed attempt tore down the socket the
		// successful one had just opened.
		if (this.status === "connected" || this.status === "connecting") return;
		this.status = "connecting";
		invoke("ws_connect").catch((e: unknown) => {
			this.status = "error";
			console.error("[ws] connect failed", e);
		});
	}

	/**
	 * Go back to the local "disconnected" state so a later `connect()` is
	 * allowed through the re-entrancy guard, and drop the socket's claim on the
	 * UI.
	 *
	 * SCOPE: this is CLIENT-side teardown only. There is no `ws_disconnect`
	 * Tauri command — `src-tauri/src/api/ws.rs` registers exactly `ws_connect`
	 * and `ws_send` — so the Rust reader loop is not stopped here. That is safe
	 * for the one caller, `$lib/api`'s session-lost path, because the socket was
	 * authenticated with a session the server has already rejected. Adding a real
	 * disconnect needs a new Rust command, which is out of scope for the API
	 * client layer.
	 */
	disconnect(): void {
		this.status = "disconnected";
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
				return;
			}
			// FIX 9 — a schema mismatch is NOT dropped silently: callers need to
			// know an event arrived, so the event TYPE and the first few zod
			// issues are logged.
			//
			// `event.payload` is deliberately NOT logged, and the
			// `invoke("ws_raw_event", …)` re-emit is deliberately REMOVED.
			//  - PAYLOAD (E5): `vite.config.mjs` strips `console.log` in
			//    production but keeps `console.warn`/`console.error`, and on
			//    Android those land in logcat, readable by any app with
			//    READ_LOGS and over adb. For `chat.v1.message_sent` the payload
			//    IS the message: body text, sender id, conversation id. Schema
			//    mismatches are exactly when an UNEXPECTED message shape arrives,
			//    so this path is where new message content is most likely to leak.
			//  - IPC (E4): `ws_raw_event` is not a Tauri command. It is absent
			//    from `src-tauri/src/api/ws.rs`, which registers only `ws_connect`
			//    and `ws_send`, and absent from the `invoke_handler!` list in
			//    `lib.rs`. Every schema-mismatched event therefore made a
			//    guaranteed-failing IPC round trip whose rejection was swallowed
			//    by an empty `.catch` — pure cost, and its own "best-effort"
			//    comment implied a fallback that did not exist. There was no
			//    listener for the re-emit either, so even if the command existed
			//    nothing would have received it. A diagnostic log is the honest
			//    behaviour: a mismatch means OUR schema needs updating, and that
			//    is a job for whoever owns the model file.
			const envelope = z.object({ type: z.string() }).safeParse(event.payload);
			console.warn(
				`[ws] dropping ${eventType} event (envelope type ${
					envelope.success ? envelope.data.type : "<unparseable>"
				}): payload does not match the schema`,
				result.error.issues.slice(0, 3),
			);
			if (import.meta.env.DEV) {
				// Dev-only: the full payload is genuinely useful when writing a
				// new model, and a dev build is not shipped or logcat-exposed.
				console.warn("[ws] raw payload (dev only)", event.payload);
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
