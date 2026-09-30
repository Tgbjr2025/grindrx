import { toast } from "svelte-sonner";
import z from "zod";

import { shareAlbum } from "$lib/api/album";
import { markConversationAsRead } from "$lib/api/conversation";
import { reactToMessage, sendMessage, sendProfilePhotoMessage } from "$lib/api/messages";
import { getPreferences } from "$lib/app-data/preferences.svelte";
import {
	apiResponseMessageSchema,
	previewFromMessage,
} from "$lib/model/message";
import {
	shareAlbumsErrorMessage,
	shareAlbumsSequential,
} from "$lib/utils/share-albums";
import { chatV1MessageSentEventSchema, ws } from "$lib/ws.svelte";
import type { AlbumExpirationType } from "$lib/model/album";
import type {
	ApiResponseMessage,
	Message as MessageType,
} from "$lib/model/message";
import type { ConversationsState } from "../conversations.svelte";
import { getConversation } from "./messages";

const POLL_INTERVAL_MS = 10_000;

/** Slow reconcile cadence used while the WebSocket is connected. */
const SAFETY_NET_INTERVAL_MS = 60_000;

/**
 * Stable identity for ONE album-share attempt. The share endpoint returns an
 * empty body, so there is no real `messageId` to adopt — see
 * `OptimisticMessage.pendingKey`. Exported so tests can assert the same key.
 *
 * The key MUST be unique per attempt, not per album. `album:${albumId}` alone
 * meant that sharing album 42 twice produced two optimistic bubbles carrying the
 * SAME key, and both the WS handler (`find`) and `reconcile` (`findIndex`) take
 * the FIRST match — leaving the second bubble on `status: "pending"` forever.
 * `#syncCache` filters pendings out, so it was not even persisted: a ghost
 * "Sending…" bubble for the whole session, with no error and no retry. Including
 * the already-unique `tempId` makes every attempt individually addressable;
 * matchers use `albumPendingKeyPrefix` so they still pair an echo with a share
 * attempt for the same album.
 */
export function albumPendingKey(albumId: number, tempId: string): string {
	return `album:${albumId}:${tempId}`;
}

/**
 * Prefix shared by every attempt at sharing `albumId`. Used to match an inbound
 * `chat.v1.message_sent` payload (which knows the album but not our temp id)
 * against a pending share bubble.
 */
export function albumPendingKeyPrefix(albumId: number): string {
	return `album:${albumId}:`;
}

/**
 * The `pendingKey` prefix an inbound `chat.v1.message_sent` payload should
 * match, or `null` for message types that always carry a real id. Album shares
 * are the only type whose send call gives us nothing back.
 */
function pendingKeyForPayload(payload: {
	type: string;
	body?: unknown;
}): string | null {
	// `ExpiringAlbum` was missing here even though it is a member of
	// `messageSchema` and is rendered by `Message.svelte`, so an echo for that
	// variant could never be adopted onto its optimistic bubble.
	if (
		payload.type !== "Album" &&
		payload.type !== "ExpiringAlbum" &&
		payload.type !== "ExpiringAlbumV2"
	)
		return null;
	const albumId = (payload.body as { albumId?: unknown } | null)?.albumId;
	return typeof albumId === "number" ? albumPendingKeyPrefix(albumId) : null;
}

/**
 * Index of the OLDEST still-pending message whose `pendingKey` starts with
 * `prefix`, or -1.
 *
 * Oldest-first matters: `this.messages` is sorted newest-first, so scanning from
 * the end pairs share attempt #1 with echo #1 rather than crossing the two
 * attempts. Callers `splice` the returned entry out of their candidate list, so
 * each pending is consumed at most once.
 */
function indexOfOldestPendingWithPrefix(
	messages: OptimisticMessage[],
	prefix: string,
): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.status === "pending" && m.pendingKey?.startsWith(prefix) === true)
			return i;
	}
	return -1;
}

export type OptimisticMessage = ApiResponseMessage & {
	status: "sent" | "pending" | "error";
	/**
	 * Stable identity for an optimistic message whose real `messageId` the
	 * server never hands back.
	 *
	 * `POST /v4/albums/{id}/shares` answers with an EMPTY body, so there is no
	 * real id to adopt. The previous code invented one
	 * (`album-share-…-${Date.now()}`) and wrote it onto the optimistic bubble,
	 * which broke every dedup path at once: the WS echo matched neither the
	 * exact id nor the single-pending fallback, so a second album bubble was
	 * prepended, and `removeDuplicateMessages` cannot collapse it because it
	 * keys on `messageId`. Instead we keep the message `pending` and tag it with
	 * a `pendingKey` derived from the album, which the WS handler and `reconcile`
	 * both match on. Cleared once the message is adopted.
	 */
	pendingKey?: string;
};

type Profile = Awaited<ReturnType<typeof getConversation>>["profile"];

/**
 * The ambient things this class reaches for: the WebSocket singleton, the
 * `ws:disconnected` Tauri event, `localStorage`, the clock, the id generator and
 * the toast function.
 *
 * They are injected rather than imported so the state machine can be unit-tested
 * in this project's `node` vitest environment (`vite.config.mjs` sets
 * `environment: "node"`), which has no `localStorage`, no live socket and no
 * deterministic clock — so all 12 public methods below were previously
 * untestable. `AUDIT_REPORT_v0.1.37` recorded 2 CRITICAL + 5 HIGH findings in the
 * Photos tab, and the tab had zero coverage.
 *
 * This is a SEAM, not a refactor. Every method keeps its body, its order and its
 * in-place mutation of `this.messages`. The invariant that the `chat.v1.message_sent`
 * echo replaces array slots under you — so no method may hold a message reference
 * across an `await`, and every rollback re-finds by id — is load-bearing and stays
 * contained in this one class on purpose. Splitting these methods across modules
 * to shorten the file would re-introduce the detached-proxy bugs already fixed
 * here; see the notes on `reactTo` and `markMessageAsUnsent` below.
 *
 * Defaults are the real singletons, so production behaviour is byte-identical.
 */
export interface ConversationStateDeps {
	ws: Pick<typeof ws, "status" | "onConnected" | "on" | "onTyping">;
	/**
	 * Subscribe to the Tauri `ws:disconnected` event. Split out from `ws` because
	 * it crosses the IPC boundary via a dynamic `import()`, which cannot be
	 * reached through the socket object.
	 */
	listenWsDisconnected: (handler: () => void) => Promise<() => void>;
	storage: Pick<Storage, "getItem" | "setItem">;
	now: () => number;
	newId: () => string;
	toast: Pick<typeof toast, "error">;
}

/**
 * Resolved per key, NOT via `{ ...DEFAULTS, ...overrides }`: a spread evaluates
 * the real globals eagerly, so `localStorage` was read even when a test supplied
 * its own `storage` — and this project's `node` vitest environment has none,
 * which is the exact barrier this seam exists to remove. `??` short-circuits, so
 * a global is only touched when that key was not overridden.
 */
function resolveDeps(
	overrides: Partial<ConversationStateDeps> = {},
): ConversationStateDeps {
	return {
		ws: overrides.ws ?? ws,
		listenWsDisconnected:
			overrides.listenWsDisconnected ??
			((handler) =>
				import("@tauri-apps/api/event").then(({ listen }) =>
					listen<void>("ws:disconnected", () => handler()),
				)),
		storage: overrides.storage ?? localStorage,
		now: overrides.now ?? (() => Date.now()),
		newId: overrides.newId ?? (() => crypto.randomUUID()),
		toast: overrides.toast ?? toast,
	};
}

export class ConversationState {
	messages: OptimisticMessage[] = $state([]);
	profile: Profile | null = $state(null);
	pageKey: string | null = $state(null);
	loading = $state(true);
	loadingMore = $state(false);
	error: Error | null = $state(null);
	// Our own read cursor — the timestamp up to which WE have read the other
	// party's messages. Persisted locally (chat:read:{id}) and used only by
	// reportRead's dedup guard. Do NOT use this to render the "Read"/"Sent"
	// label under our own outgoing messages — see recipientReadTimestamp.
	lastReadTimestamp: number | null = $state(null);
	// The RECIPIENT's read position, authoritative from the server (GET
	// .../message -> lastReadTimestamp). Drives the "Read"/"Sent" label in
	// MessagesList. There is no live chat.v1.read WS event on the real
	// server, so this only advances via the initial load / poll reconcile.
	recipientReadTimestamp: number | null = $state(null);
	isTypingProfileId: number | null = $state(null);

	get wsStatus() {
		return this.#deps.ws.status;
	}

	readonly conversationId: string;
	readonly ourProfileId: number;

	#conversations: ConversationsState;
	#deps!: ConversationStateDeps;
	#readQueue: { messageId: string; timestamp: number }[] = [];
	#readTimer: ReturnType<typeof setTimeout> | null = null;
	#typingTimer: ReturnType<typeof setTimeout> | null = null;
	#pollTimer: ReturnType<typeof setInterval> | null = null;
	#safetyTimer: ReturnType<typeof setInterval> | null = null;
	// Guards against overlapping reconciles: `loading`/`loadingMore` only cover
	// the first page and pagination, so on a slow/hanging network N poll
	// callbacks could pile up concurrent full-page fetches.
	#reconcileInFlight = false;
	#removeReconcileListener: () => void;
	// Store the *promises* (not the resolved unlisten fns). Storing only the
	// resolved fn leaked the listener when destroy() ran before the listen()
	// promise settled — the unlisten was assigned after destroy had already
	// checked the field. Awaiting the promise in destroy() is leak-safe and
	// mirrors the #unlistenWs* handlers below.
	#removeWsConnectedListener: Promise<() => void> | null = null;
	#removeWsDisconnectedListener: Promise<() => void> | null = null;
	#unlistenWs: Promise<() => void> | null = null;
	#unlistenWsTyping: Promise<() => void> | null = null;

	constructor({
		conversationId,
		ourProfileId,
		conversations,
		deps,
	}: {
		conversationId: string;
		ourProfileId: number;
		conversations: ConversationsState;
		/** Test seam. Omitted in production, where the real singletons are used. */
		deps?: Partial<ConversationStateDeps>;
	}) {
		// Assigned before anything below can use it: the constructor body
		// synchronously reads storage, subscribes to the socket and kicks off
		// `#initialLoad`.
		this.#deps = resolveDeps(deps);
		this.conversationId = conversationId;
		this.ourProfileId = ourProfileId;
		this.#conversations = conversations;
		conversations.setActive(conversationId);
		this.lastReadTimestamp =
			z.coerce
				.number()
				.int()
				.safeParse(
					this.#deps.storage.getItem(`chat:read:${conversationId}`),
				).data ??
			null;
		void this.#initialLoad();

		this.#removeReconcileListener = conversations.onReconcile(() =>
			this.#reconcileMessages(),
		);

		// Start polling immediately if already disconnected when this state is created.
		if (this.#deps.ws.status === "disconnected") {
			this.#startPolling();
		}
		// Always run the slow safety net, connected or not. It is idempotent and it
		// is RESTARTED on every socket transition below — see #startSafetyNet.
		this.#startSafetyNet();

		// Listen for WS connect / disconnect to toggle polling. Keep the promises so
		// destroy() can await + unlisten even if it runs before listen() resolves.
		this.#removeWsConnectedListener = this.#deps.ws.onConnected(() => {
			if (this.#destroyed) return;
			this.#stopPolling();
			// The safety net must be (re)started HERE, not only in the constructor:
			// `onConnected` stopped it, and nothing ever started it again, so after
			// the first WS connect BOTH timers were null forever. That silently
			// disabled the load-bearing recovery path for a dropped album-share echo
			// AND froze `recipientReadTimestamp` (so the "Read" label never moved for
			// the whole session) for as long as the socket stayed healthy.
			this.#startSafetyNet();
			// Catch up the open thread on anything that arrived while the socket was
			// down. The disconnect-time poll was just stopped and the WS replays
			// nothing, so without this a message received during a brief drop never
			// shows until the user leaves and reopens the conversation.
			void this.#reconcileMessages();
		});
		this.#removeWsConnectedListener.catch(console.error);

		this.#removeWsDisconnectedListener = this.#deps.listenWsDisconnected(() => {
			if (this.#destroyed) return;
			this.#startPolling();
			// Same hole as onConnected: the safety net must be restarted on
			// every transition, or it only ever ran during construction.
			// Its body is `if (ws.status === "connected")`, so while the
			// socket is down it is a no-op timer and the 10s poll does the work.
			this.#startSafetyNet();
		});
		this.#removeWsDisconnectedListener.catch(console.error);

		this.#unlistenWs = this.#deps.ws.on(
			"chat.v1.message_sent",
			chatV1MessageSentEventSchema,
			(event) => {
				if (this.#destroyed) return;
				if (event.payload.conversationId !== this.conversationId) return;
				if (event.payload.senderId === this.ourProfileId) {
					// First try an exact messageId match (works once the send() response
					// has rewritten the pending message's id). If no exact match exists,
					// album shares are matched by `pendingKey` PREFIX (album id + our
					// unique per-attempt temp id), taking the OLDEST unconsumed attempt.
					const exact = this.messages.find(
						(m) =>
							m.status === "pending" &&
							m.messageId === event.payload.messageId,
					);
					// Album shares get no messageId back from the send call, so match the
					// pending bubble by `pendingKey` instead. Without this the echo fell
					// through to the prepend below and the user saw the album twice,
					// permanently.
					const echoKey = pendingKeyForPayload(event.payload);
					const byKey =
						echoKey === null
							? undefined
							: (() => {
									const idx = indexOfOldestPendingWithPrefix(
										this.messages,
										echoKey,
									);
									return idx === -1 ? undefined : this.messages[idx];
								})();
					// There is deliberately NO "the single pending message" fallback any
					// more. It could adopt an echo onto the WRONG bubble: send a photo
					// (pending bubble), then a text — the text's HTTP response lands
					// first and flips it to `sent`, leaving the photo as the only
					// pending, and the text's own echo (no id match, no pendingKey for
					// Text) then OVERWROTE the photo bubble with the text payload. The
					// photo the user had just sent simply disappeared. A miss now falls
					// through to the existing-message / prepend paths below, which are
					// safe.
					const pending = exact ?? byKey;
					if (pending) {
						// Replace pending with full server data in-place (avoids array replacement
						// during Drawer close animation which would freeze the UI on Android).
						const idx = this.messages.indexOf(pending);
						if (idx >= 0) {
							this.messages[idx] = { ...event.payload, status: "sent" };
						} else {
							pending.status = "sent";
							pending.messageId = event.payload.messageId;
							// Adopted: the synthetic identity is no longer needed.
							delete pending.pendingKey;
						}
						this.#syncCache();
						return;
					}
				}
				// chat.v1.message_sent also fires when an existing message is unsent
				// or gains/loses a reaction (per the Grindr notification-event docs;
				// there is no separate message_reaction/message_retracted event from
				// the real server). Previously this branch returned immediately on a
				// known messageId, so live reactions from the other party and live
				// unsend/retract flips were silently dropped until the 10s reconcile
				// poll. Update the existing message in place instead.
				const existingIdx = this.messages.findIndex(
					(m) => m.messageId === event.payload.messageId,
				);
				if (existingIdx >= 0) {
					const parsedExisting = apiResponseMessageSchema.safeParse(event.payload);
					if (parsedExisting.success) {
						this.messages[existingIdx] = {
							...parsedExisting.data,
							status: this.messages[existingIdx].status,
						};
						this.#syncCache();
					}
					return;
				}
				const parsed = apiResponseMessageSchema.safeParse(event.payload);
				if (!parsed.success) {
					console.error("[ws] failed to parse incoming message", parsed.error);
					return;
				}
				const msg: OptimisticMessage = { ...parsed.data, status: "sent" };
				this.messages = [msg, ...this.messages];
				// A Retract message references the message it deletes via
				// body.targetMessageId. Flip the target to a tombstone in place so the
				// live view matches what a reload renders (the dedicated
				// chat.v1.message_retracted handler never fires — the real server
				// delivers retracts through chat.v1.message_sent).
				if (
					msg.type === "Retract" &&
					msg.body &&
					typeof msg.body === "object" &&
					"targetMessageId" in msg.body &&
					typeof (msg.body as { targetMessageId?: unknown }).targetMessageId ===
						"string"
				) {
					const targetId = (msg.body)
						.targetMessageId;
					const targetIdx = this.messages.findIndex(
						(m) => m.messageId === targetId,
					);
					if (targetIdx >= 0) {
						this.messages[targetIdx] = {
							...this.messages[targetIdx],
							type: "Retract",
							unsent: true,
							body: { targetMessageId: targetId },
						};
					}
				}
				this.#syncCache();
				// Only report read for messages from the other party — our own messages
				// (e.g. echoed from another device) must not generate a self read-receipt.
				// Mirrors the guard in #reconcileMessages.
				if (msg.senderId !== this.ourProfileId) {
					void this.reportRead({
						messageId: msg.messageId,
						timestamp: msg.timestamp,
					});
				}
			},
		);

		// FIX 4: typing indicator. The real server events are chat.v1.typing.start
		// / chat.v1.typing.stop delivered via the standard notification envelope
		// (see ws.svelte.ts onTyping) — not a single flat chat.v1.typing event.
		// Reactions and retracts are intentionally NOT subscribed here:
		// chat.v1.message_reaction / chat.v1.message_retracted / chat.v1.read are
		// not real events on the live server (see ws.svelte.ts WS_EVENT comment) —
		// reactions/retracts arrive inline via chat.v1.message_sent above, and the
		// recipient's read position comes from the REST message list
		// (recipientReadTimestamp, set in #initialLoad / #reconcileMessages).
		this.#unlistenWsTyping = this.#deps.ws.onTyping((event) => {
			if (this.#destroyed) return;
			if (event.conversationId !== this.conversationId) return;
			if (event.profileId === this.ourProfileId) return;
			if (this.#typingTimer !== null) clearTimeout(this.#typingTimer);
			this.isTypingProfileId = event.isTyping ? event.profileId : null;
			if (event.isTyping) {
				this.#typingTimer = setTimeout(() => {
					if (!this.#destroyed) this.isTypingProfileId = null;
					this.#typingTimer = null;
				}, 3000);
			}
		});
	}

	#destroyed = false;
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#conversations.clearActive(this.conversationId);
		this.#unlistenWs?.then((unlisten) => unlisten()).catch(console.error);
		this.#unlistenWsTyping?.then((unlisten) => unlisten()).catch(console.error);
		this.#removeReconcileListener();
		if (this.#readTimer !== null) clearTimeout(this.#readTimer);
		if (this.#typingTimer !== null) clearTimeout(this.#typingTimer);
		this.#stopPolling();
		// The 60s safety-net interval was never cleared on teardown, so every
		// conversation the user ever opened leaked one live interval for the rest
		// of the process. It was previously invisible only because
		// `#reconcileMessages` early-returns on `#destroyed`.
		this.#stopSafetyNet();
		this.#removeWsConnectedListener
			?.then((unlisten) => unlisten())
			.catch(console.error);
		this.#removeWsDisconnectedListener
			?.then((unlisten) => unlisten())
			.catch(console.error);
	}

	#startPolling(): void {
		if (this.#pollTimer !== null) return; // already polling
		this.#pollTimer = setInterval(() => {
			void this.#reconcileMessages();
		}, POLL_INTERVAL_MS);
	}

	#stopPolling(): void {
		if (this.#pollTimer !== null) {
			clearInterval(this.#pollTimer);
			this.#pollTimer = null;
		}
	}

	/**
	 * Slow safety-net reconcile that runs even while the WebSocket is healthy.
	 *
	 * The 10s poll only runs when the socket is DOWN, so anything that relies
	 * solely on a WS event (an album share, whose send call returns no id) had
	 * no recovery path: if the echo was missed, the optimistic bubble stayed
	 * pending for the whole session. This closes that hole without paying for a
	 * full page fetch every 10s.
	 *
	 * It is idempotent (`#safetyTimer !== null` guard) and MUST be called on EVERY
	 * socket transition — the constructor, `ws.onConnected` and `ws:disconnected` —
	 * not just the constructor. It was previously stopped by `onConnected` and never
	 * restarted, so after the first connect both timers were null for the rest of
	 * the session.
	 */
	#startSafetyNet(): void {
		if (this.#safetyTimer !== null) return;
		this.#safetyTimer = setInterval(() => {
			if (this.#deps.ws.status === "connected") void this.#reconcileMessages();
		}, SAFETY_NET_INTERVAL_MS);
	}

	#stopSafetyNet(): void {
		if (this.#safetyTimer !== null) {
			clearInterval(this.#safetyTimer);
			this.#safetyTimer = null;
		}
	}

	/** Immediately fetch the latest messages. Useful for a manual refresh button. */
	async refresh(): Promise<void> {
		await this.#reconcileMessages();
	}

	async #reconcileMessages(): Promise<void> {
		if (this.loading || this.loadingMore || this.#destroyed) return;
		// Don't stack concurrent full-page fetches on a slow/hanging network.
		if (this.#reconcileInFlight) return;
		this.#reconcileInFlight = true;
		try {
			const result = await getConversation({
				conversationId: this.conversationId,
			});
			if (this.#destroyed) return;

			// Authoritative recipient-side read position — see recipientReadTimestamp.
			this.recipientReadTimestamp = Math.max(
				this.recipientReadTimestamp ?? 0,
				result.lastReadTimestamp ?? 0,
			);

			const { messages, changed, fresh } = reconcile(
				this.messages,
				result.messages,
				{ now: this.#deps.now(), ourProfileId: this.ourProfileId },
			);

			if (!changed) {
				this.#syncCache();
				return;
			}

			this.messages = messages;
			this.#updatePreview(this.messages.at(0));
			this.#syncCache();

			for (const m of fresh) {
				if (m.senderId === this.ourProfileId) continue;
				void this.reportRead({
					messageId: m.messageId,
					timestamp: m.timestamp,
				});
			}
		} catch (error) {
			console.error("Failed to reconcile messages", error);
		} finally {
			this.#reconcileInFlight = false;
		}
	}

	async #initialLoad(): Promise<void> {
		const cached = this.#conversations.getCachedConversation(
			this.conversationId,
		);
		if (cached) {
			this.messages = cached.messages.map((m) => ({
				...m,
				status: "sent" as const,
			}));
			this.profile = cached.profile;
			this.pageKey = cached.pageKey;
			this.loading = false;
			this.#conversations.markRead(this.conversationId);
			void this.#reconcileMessages();
			return;
		}
		this.loading = true;
		this.error = null;
		try {
			const result = await getConversation({
				conversationId: this.conversationId,
			});
			this.messages = removeDuplicateMessages(
				result.messages.map((m) => ({
					...m,
					status: "sent" as const,
				})),
			);
			this.profile = result.profile;
			this.pageKey = result.pageKey;
			// Authoritative recipient-side read position — see recipientReadTimestamp.
			this.recipientReadTimestamp = Math.max(
				this.recipientReadTimestamp ?? 0,
				result.lastReadTimestamp ?? 0,
			);
			this.#updatePreview(this.messages.at(0));
			this.#conversations.markRead(this.conversationId);
			this.#syncCache();
		} catch (err) {
			this.error = err instanceof Error ? err : new Error(String(err));
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Fetch the next page of history.
	 *
	 * Resolves to whether the fetch SUCCEEDED — deliberately NOT "did we get new
	 * messages". The caller (`MessagesList.loadMore`) treats "same pageKey" or
	 * "same length" as end-of-history and nulls the cursor sentinel; if a
	 * transient network failure also answered false to both of those tests, one
	 * flaky request on a train permanently ended the user's ability to read
	 * history, with nothing ever setting the sentinel back. So a failure now
	 * returns `false` and the caller leaves the cursor alone, retrying on the next
	 * sentinel intersection.
	 */
	async loadMore(): Promise<boolean> {
		if (this.loadingMore || this.pageKey === null) return false;
		this.loadingMore = true;
		try {
			const result = await getConversation({
				conversationId: this.conversationId,
				pageKey: this.pageKey,
			});
			this.messages = removeDuplicateMessages([
				...this.messages,
				...result.messages.map((m) => ({ ...m, status: "sent" as const })),
			]);
			this.pageKey = result.pageKey;
			this.#syncCache();
			return true;
		} catch (err) {
			this.#deps.toast.error("Failed to load more messages");
			console.error(err);
			return false;
		} finally {
			this.loadingMore = false;
		}
	}

	// Original payloads of in-flight/failed generic sends, keyed by tempId, so a
	// failed message can be retried with its exact body (see retry()).
	#pendingSends = new Map<string, MessageType>();

	/**
	 * Queue a generic outbound message with an optimistic bubble.
	 *
	 * Returns whether a bubble was actually created. The composer's `onSubmit`
	 * used to `await onSend(...)` and clear the text field unconditionally, and
	 * `send` *bails* (rather than throwing) when the conversation's profile has
	 * not resolved — so awaiting a `void` return resolved and wiped the user's
	 * typed text while the bail toasted an error. Returning the boolean makes the
	 * bail observable to both the text composer and the location sender, which
	 * must not tell the user their coordinates were transmitted when they were not.
	 */
	send(message: MessageType): boolean {
		// Don't silently discard the message. The composer's text field and submit
		// button are not disabled while the conversation's profile is still
		// resolving, so a user who typed and hit send immediately watched the field
		// clear with no bubble, no toast and no error — the message just vanished.
		if (!this.profile) {
			this.#deps.toast.error("Still loading this conversation. Try again in a moment.");
			return false;
		}
		const tempId = `pending-${this.#deps.newId()}`;
		const optimistic: OptimisticMessage = {
			...message,
			messageId: tempId,
			conversationId: this.conversationId,
			senderId: this.ourProfileId,
			timestamp: this.#deps.now(),
			unsent: false,
			reactions: [],
			status: "pending" as const,
		};
		this.messages = removeDuplicateMessages([optimistic, ...this.messages]);
		this.#updatePreview(optimistic);
		this.#pendingSends.set(tempId, message);
		void this.#resolveMessage({ tempId, message });
		return true;
	}

	/**
	 * Share one or more of our albums into this conversation. Each album is a
	 * separate share (the endpoint is keyed by album id) and gets its own
	 * optimistic message, so partial success is possible: if some albums fail we
	 * still surface the ones that succeeded and throw an aggregated error for the
	 * rest so the picker can report it.
	 */
	async sendAlbums(albumIds: number[], expirationType: AlbumExpirationType): Promise<void> {
		if (!this.profile) throw new Error("Conversation not loaded");
		const result = await shareAlbumsSequential(albumIds, (albumId) =>
			this.#sendOneAlbum(albumId, expirationType),
		);
		const message = shareAlbumsErrorMessage(result, albumIds.length);
		if (message !== null) throw new Error(message);
	}

	async #sendOneAlbum(albumId: number, expirationType: AlbumExpirationType): Promise<void> {
		if (!this.profile) throw new Error("Conversation not loaded");
		const tempId = `pending-${this.#deps.newId()}`;
		const isExpiring = expirationType !== "INDEFINITE";
		// Optimistic pending message — coverUrl is empty until WS event confirms with real data.
		const optimistic = {
			type: isExpiring ? "ExpiringAlbumV2" as const : "Album" as const,
			body: {
				albumId,
				hasUnseenContent: false,
				expiresAt: null,
				expirationType,
				coverUrl: "",
				ownerProfileId: this.ourProfileId,
				isViewable: true,
				hasVideo: false,
				hasPhoto: true,
				viewableUntil: null,
			},
			messageId: tempId,
			conversationId: this.conversationId,
			senderId: this.ourProfileId,
			timestamp: this.#deps.now(),
			unsent: false,
			reactions: [] as Array<{ profileId: number; reactionType: number }>,
			status: "pending" as const,
			// The share endpoint returns no messageId, so identify THIS attempt by
			// the album it carries plus the unique temp id (see
			// OptimisticMessage.pendingKey / albumPendingKey).
			pendingKey: albumPendingKey(albumId, tempId),
		} satisfies OptimisticMessage;
		this.messages = removeDuplicateMessages([optimistic, ...this.messages]);
		this.#updatePreview(optimistic);
		try {
			// Fire-and-await the share. The real chat message (and its real id)
			// arrives over the `chat.v1.message_sent` WebSocket event, or is picked
			// up by the reconcile poll; either path adopts it onto this entry via
			// `pendingKey`. Deliberately NOT flipping to "sent" with a synthetic
			// id — that produced a permanent duplicate bubble.
			await shareAlbum({
				albumId,
				profileId: this.profile.profileId,
				expirationType,
			});
			// A WS echo can arrive before this HTTP response returns. Collapse any
			// duplicate the echo may already have produced rather than waiting for
			// the next reconcile.
			this.messages = removeDuplicateMessages(this.messages);
			this.#syncCache();
		} catch (err) {
			// Match THIS attempt only. The old `m.pendingKey === albumPendingKey(albumId)`
			// matched every attempt at the same album, so a failure could mark a
			// different (successful) share as errored.
			const msg = this.messages.find(
				(m) => m.messageId === tempId || m.pendingKey === albumPendingKey(albumId, tempId),
			);
			if (msg) {
				msg.status = "error";
				this.#updatePreview(this.messages.find((m) => m.status === "sent"));
			}
			throw err;
		}
	}

	// FIX 10: optimistic photo send
	async sendPhoto({
		mediaId,
		mediaHash,
		url,
		createdAt,
	}: {
		mediaId: number;
		mediaHash: string;
		// Signed media URL from the chat-media upload endpoint. Used as the send
		// body URL and the lightbox (full-res) source.
		url?: string;
		createdAt: number | null;
	}): Promise<void> {
		if (!this.profile) throw new Error("Conversation not loaded");
		const tempId = `pending-${this.#deps.newId()}`;
		// For the inline optimistic bubble, prefer a small public THUMBNAIL when we
		// have a 40-char public hash — this caps the main-thread decode size. The
		// signed upload URL (full-res) is reserved for the real send body + lightbox.
		const isPublicHash = /^[0-9a-f]{40}$/i.test(mediaHash);
		const inlineUrl = isPublicHash
			? `https://cdns.grindr.com/images/thumb/320x320/${mediaHash}`
			: (url ?? `https://cdns.grindr.com/images/${mediaHash}`);
		const optimistic: OptimisticMessage = {
			type: "Image",
			body: {
				mediaId,
				url: inlineUrl,
				width: null,
				height: null,
				imageHash: mediaHash,
				takenOnGrindr: false,
				createdAt,
			},
			messageId: tempId,
			conversationId: this.conversationId,
			senderId: this.ourProfileId,
			timestamp: this.#deps.now(),
			unsent: false,
			reactions: [],
			status: "pending",
		};
		this.messages = removeDuplicateMessages([optimistic, ...this.messages]);
		this.#updatePreview(optimistic);
		try {
			const { messageId } = await sendProfilePhotoMessage({
				toUserId: this.profile.profileId,
				mediaId,
				mediaHash,
				url,
				createdAt,
			});
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg) {
				msg.status = "sent";
				msg.messageId = messageId;
			}
			// A WS echo (chat.v1.message_sent) can arrive before this HTTP
			// response and, with 2+ concurrent pending sends, create a second
			// entry with the same real messageId — collapse it immediately
			// rather than waiting for the next poll reconcile.
			this.messages = removeDuplicateMessages(this.messages);
			this.#syncCache();
			const latestMsg = this.messages[0] ?? this.messages.at(-1);
			if (latestMsg) this.#updatePreview(latestMsg);
		} catch (err) {
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg) {
				msg.status = "error";
				this.#updatePreview(this.messages.find((m) => m.status === "sent"));
			}
			throw err;
		}
	}

	async sendAudio({
		mediaId,
		mediaHash,
		url,
		contentType,
		length,
	}: {
		mediaId: number;
		mediaHash: string;
		url: string;
		contentType: string;
		length: number;
	}): Promise<void> {
		if (!this.profile) throw new Error("Conversation not loaded");
		const tempId = `pending-${this.#deps.newId()}`;
		const optimistic: OptimisticMessage = {
			type: "Audio",
			body: { mediaId, mediaHash, url, contentType, length, expiresAt: null },
			messageId: tempId,
			conversationId: this.conversationId,
			senderId: this.ourProfileId,
			timestamp: this.#deps.now(),
			unsent: false,
			reactions: [],
			status: "pending",
		};
		this.messages = removeDuplicateMessages([optimistic, ...this.messages]);
		this.#updatePreview(optimistic);
		try {
			const { messageId } = await sendMessage({
				toUserId: this.profile.profileId,
				message: {
					type: "Audio",
					body: { mediaId, mediaHash, url, contentType, length, expiresAt: null },
				},
			});
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg) {
				msg.status = "sent";
				msg.messageId = messageId;
			}
			this.messages = removeDuplicateMessages(this.messages);
			this.#syncCache();
			const latestMsg = this.messages[0] ?? this.messages.at(-1);
			if (latestMsg) this.#updatePreview(latestMsg);
		} catch (err) {
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg) {
				msg.status = "error";
				this.#updatePreview(this.messages.find((m) => m.status === "sent"));
			}
			throw err;
		}
	}

	async #resolveMessage({
		tempId,
		message,
	}: {
		tempId: string;
		message: MessageType;
	}): Promise<void> {
		try {
			const { messageId } = await sendMessage({
				toUserId: this.profile!.profileId,
				message,
			});
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg) {
				msg.status = "sent";
				msg.messageId = messageId;
			}
			// A WS echo (chat.v1.message_sent) can arrive before this HTTP
			// response and, with 2+ concurrent pending sends, create a second
			// entry with the same real messageId — collapse it immediately
			// rather than waiting for the next poll reconcile.
			this.messages = removeDuplicateMessages(this.messages);
			this.#pendingSends.delete(tempId);
			this.#syncCache();
			void this.#conversations.ensureLoaded(this.conversationId);
		} catch {
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg) msg.status = "error";
			const latestSent = this.messages.find((m) => m.status === "sent");
			this.#updatePreview(latestSent);
			this.#deps.toast.error("Message failed to send — tap to retry");
		}
	}

	/**
	 * Re-drive a message that failed to send. Only messages that go through the
	 * generic send() path are retryable here; photo/album sends use dedicated
	 * endpoints, so those are left for the user to re-pick.
	 */
	retry(messageId: string): void {
		const msg = this.messages.find((m) => m.messageId === messageId);
		if (!msg || msg.status !== "error") return;
		// Only messages sent through the generic send() path are retryable here;
		// their original payload is kept in #pendingSends. Photo/album sends use
		// dedicated endpoints, so those aren't tracked and are left to re-pick.
		const message = this.#pendingSends.get(messageId);
		if (!message) return;
		msg.status = "pending";
		void this.#resolveMessage({ tempId: messageId, message });
	}

	#syncCache(): void {
		if (!this.profile) return;
		const cachedMessages: ApiResponseMessage[] = this.messages
			.filter((m) => m.status === "sent")
			.map(({ status: _status, ...rest }) => {
				void _status;
				return rest;
			});
		this.#conversations.setCachedConversation(this.conversationId, {
			messages: cachedMessages,
			profile: this.profile,
			pageKey: this.pageKey,
			cachedAt: this.#deps.now(),
		});
	}

	#updatePreview(message: OptimisticMessage | undefined) {
		this.#conversations.updatePreview({
			conversationId: this.conversationId,
			preview: previewFromMessage(message),
			timestamp: message?.timestamp ?? -1,
		});
	}

	remove(messageId: string) {
		const isLatest = this.messages.at(0)?.messageId === messageId;

		let revert = () => {};
		const index = this.messages.findIndex((m) => m.messageId === messageId);
		if (index > -1) {
			const [removed] = this.messages.splice(index, 1);
			if (isLatest) this.#updatePreview(this.messages.at(0));
			this.#syncCache();
			const revertDeleteMessage = () => {
				// Re-derive the insertion point from the removed message's own
				// timestamp instead of closing over the pre-delete `index`. A
				// `chat.v1.message_sent` (or a reconcile) that landed while the
				// DELETE request was in flight shifts every later index, so the old
				// code re-inserted the message into the wrong slot — visibly
				// re-ordering the thread on a failed delete.
				let insertAt = this.messages.length;
				for (let i = 0; i < this.messages.length; i++) {
					if (this.messages[i].timestamp <= removed.timestamp) {
						insertAt = i;
						break;
					}
				}
				this.messages.splice(insertAt, 0, removed);
				// Re-check "is this still the newest message" rather than trusting the
				// pre-delete `isLatest`: a newer message may have arrived meanwhile, in
				// which case the preview must not be rolled back to the restored one.
				if (this.messages.at(0)?.messageId === messageId)
					this.#updatePreview(removed);
				this.#syncCache();
			};

			const isOnly = this.messages.length === 0;
			let revertDeleteConversation = () => {};
			if (isOnly) {
				({ revert: revertDeleteConversation } = this.#conversations.remove(
					this.conversationId,
				));
			}

			revert = () => {
				revertDeleteConversation();
				revertDeleteMessage();
			};
		}

		return {
			revert,
		};
	}

	reportRead({
		messageId,
		timestamp,
	}: {
		messageId: string;
		timestamp: number;
	}): void {
		if (this.lastReadTimestamp !== null && timestamp <= this.lastReadTimestamp)
			return;
		this.#readQueue.push({ messageId, timestamp });
		if (this.#readTimer !== null) clearTimeout(this.#readTimer);
		this.#readTimer = setTimeout(() => {
			void this.#flushReadQueue();
		}, 500);
	}

	async #flushReadQueue(): Promise<void> {
		const queue = this.#readQueue;
		this.#readQueue = [];
		this.#readTimer = null;
		if (queue.length === 0) return;
		queue.sort((a, b) => a.timestamp - b.timestamp);
		const highest = queue[queue.length - 1];
		this.lastReadTimestamp = highest.timestamp;
		this.#deps.storage.setItem(
			`chat:read:${this.conversationId}`,
			String(highest.timestamp),
		);
		const { revealMessageRead } = await getPreferences();
		if (revealMessageRead) {
			try {
				await markConversationAsRead({
					conversationId: this.conversationId,
					messageId: highest.messageId,
				});
			} catch (err) {
				console.error("Failed to mark conversation as read", err);
				this.#deps.toast.error("Failed to mark conversation as read");
			}
		}
	}

	/**
	 * Result of a reaction attempt, so the caller can give real feedback instead
	 * of silently doing nothing.
	 *
	 * - `added` — the reaction is now on the message.
	 * - `already-held` — you already hold this reaction type, so nothing was sent.
	 * - `missing` — no such message in this conversation.
	 */
	async reactTo(
		messageId: string,
		reactionType: number,
	): Promise<"added" | "already-held" | "missing"> {
		const msg = this.messages.find((m) => m.messageId === messageId);
		if (!msg) return "missing";
		// Don't stack duplicate reactions from a double-tap before the first
		// request resolves — it inflated the count.
		if (
			msg.reactions.some(
				(r) =>
					r.profileId === this.ourProfileId && r.reactionType === reactionType,
			)
		) {
			// NOT a silent no-op. This used to `return` here, so re-tapping your own
			// reaction did nothing at all — no un-react, no toast, no visual change —
			// and the `Reaction` badge is not clickable, so there was no removal path
			// anywhere in the app.
			//
			// There is no remove-reaction endpoint in `lib/api/messages.ts` (only
			// `POST /v4/chat/message/reaction` via `reactToMessage`), and inventing
			// one would be guessing at a prod write path, so the honest minimum is a
			// distinct return value the UI turns into a message. See the routing note
			// in the handoff: adding `unreactToMessage` to `lib/api/messages.ts` is
			// what makes this a real toggle.
			return "already-held";
		}
		const optimisticReaction = { reactionType, profileId: this.ourProfileId };
		msg.reactions.push(optimisticReaction);
		this.#syncCache();
		try {
			await reactToMessage({
				conversationId: this.conversationId,
				messageId,
				reactionType,
			});
		} catch (err) {
			// Re-find by id instead of closing over `msg`. The
			// `chat.v1.message_sent` echo replaces the array slot with a NEW
			// object, which orphans `msg`; the old `msg.reactions.splice(...)` then
			// mutated a detached object and the visible reaction was never removed,
			// leaving the user with a reaction the server had rejected.
			const current = this.messages.find((m) => m.messageId === messageId);
			if (current) {
				const idx = current.reactions.findIndex(
					(r) => r === optimisticReaction,
				);
				if (idx !== -1) current.reactions.splice(idx, 1);
				// Fallback for the case where the echo already replaced the object
				// and our optimistic entry is gone from the copy we now hold.
				if (idx === -1) {
					const still = current.reactions.findIndex(
						(r) =>
							r.profileId === this.ourProfileId &&
							r.reactionType === reactionType,
					);
					if (still !== -1) current.reactions.splice(still, 1);
				}
			}
			this.#syncCache();
			throw err;
		}
		return "added";
	}

	markMessageAsUnsent(messageId: string) {
		const msg = this.messages.find((m) => m.messageId === messageId);
		let revert: () => void = () => {};
		if (msg) {
			// Capture the FULL original shape, not just `unsent`. The revert used to
			// restore only `msg.unsent`, leaving `type: "Unsent"` and `body: null` in
			// place — so after a FAILED `unsendMessage` the bubble read "Message
			// unsent" forever, the original text was unrecoverable, and
			// `previewFromMessage` returned `{type:"Unsent", text:null}` so the inbox
			// row fell back to "Preview not available". It only healed if a reconcile
			// adopted the server's version, which (see #startSafetyNet) never ran
			// while the socket was healthy.
			const originalUnsent = msg.unsent;
			const originalType = msg.type;
			const originalBody = msg.body;
			msg.unsent = true;
			msg.type = "Unsent";
			msg.body = null;
			this.#syncCache();
			this.#updatePreview(msg);
			revert = () => {
				// Re-find by id rather than closing over `msg`. The
				// `chat.v1.message_sent` echo replaces the array slot with a NEW
				// object, orphaning `msg`; writes to it then hit a detached proxy and
				// the visible bubble never healed. Same class of bug as the fix in
				// `reactTo` below.
				const current = this.messages.find((m) => m.messageId === messageId);
				const target = current ?? msg;
				target.unsent = originalUnsent;
				target.type = originalType;
				target.body = originalBody;
				this.#syncCache();
				this.#updatePreview(target);
			};
		}
		return {
			revert,
		};
	}
}

export interface ReconcileResult {
	messages: OptimisticMessage[];
	/** Mirrors the previous no-op guard: false means nothing actually changed,
	 * so the caller can skip reassigning its message array on an idle poll. */
	changed: boolean;
	/** Newly-added messages this reconcile introduced from the server page
	 * (used to drive read-receipt reporting). */
	fresh: OptimisticMessage[];
}

/**
 * Pure merge of the locally-held optimistic message list with a freshly
 * fetched server page. Extracted out of the class so the dedup / adopt /
 * drop-on-error / retract-tombstone invariants are unit-testable without a
 * Tauri/WS runtime — see conversation-state.reconcile.test.ts.
 */
export function reconcile(
	local: OptimisticMessage[],
	server: ApiResponseMessage[],
	opts: { now: number; ourProfileId: number },
): ReconcileResult {
	const { now, ourProfileId } = opts;
	const serverById = new Map(
		server.map((m) => [m.messageId, m] as const),
	);
	const oldestServerTs =
		server.length > 0
			? server[server.length - 1].timestamp
			: Number.POSITIVE_INFINITY;

	const recentCutoff = now - 60_000;
	const next: OptimisticMessage[] = [];
	const seenLocalIds = new Set<string>();
	// Still-pending optimistic messages we authored. Used below to adopt the
	// server copy onto the pending entry instead of rendering a duplicate when
	// the reconcile poll observes our just-sent message before the send()
	// response has rewritten its temp id.
	const pendingMine: OptimisticMessage[] = [];
	let dropped = 0;
	let updated = 0;
	for (const msg of local) {
		if (msg.status !== "sent") {
			// FIX 9: preserve still-pending messages so an in-flight send isn't
			// dropped mid-poll.
			if (msg.status === "pending") {
				if (msg.senderId === ourProfileId) pendingMine.push(msg);
				next.push(msg);
			} else {
				// BUG 2: do NOT retain failed (status "error") messages. A failed
				// optimistic Image bubble that survives every 10s reconcile gets
				// re-spread into a new object by processMessages, which re-fires
				// ImageMessage's $effect and re-fetches+re-decodes a multi-MB data
				// URL on the WebView main thread -> UI lock. Dropping the failed
				// entry on the next reconcile (the "Failed to send" toast already
				// notified the user) breaks that loop. Pending/sent are unaffected.
				// Count it as dropped so the array below is actually rebuilt even
				// when there are no fresh server messages.
				dropped++;
			}
			continue;
		}
		seenLocalIds.add(msg.messageId);
		// If the server now reports a copy of this sent message, adopt it so a
		// remote unsend (type flips to "Unsent", body cleared) or a reaction
		// propagates into the live view — but only when it actually differs
		// (cheap structural signature compare). Replacing-and-counting every
		// echoed message defeated the "nothing changed" early-return below and
		// forced a full array rebuild on virtually every poll.
		const serverVersion = serverById.get(msg.messageId);
		if (serverVersion) {
			if (messageSignature(msg) !== messageSignature(serverVersion)) {
				next.push({ ...serverVersion, status: "sent" });
				updated++;
			} else {
				next.push(msg);
			}
			continue;
		}
		// FIX 9: preserve recently-sent messages even if not yet in server page
		const recentlySent = msg.timestamp >= recentCutoff;
		if (recentlySent || msg.timestamp < oldestServerTs) {
			next.push(msg);
		} else {
			dropped++;
		}
	}

	const fresh: OptimisticMessage[] = [];
	for (const sv of server) {
		if (seenLocalIds.has(sv.messageId)) continue;
		// Dedup against a still-pending optimistic message we authored: if the
		// server now reports a message of the same type with a near-identical
		// timestamp, it IS our pending message (temp id not yet rewritten).
		// Adopt the server id/data onto the pending entry in place so the user
		// never sees the message twice. Each pending is matched at most once.
		if (sv.senderId === ourProfileId) {
			// Prefer an exact `pendingKey`-PREFIX match (album shares have no id to
			// match on), then fall back to type + near-identical timestamp. The
			// prefix match takes the OLDEST unconsumed attempt at that album, so two
			// concurrent shares of the SAME album are adopted onto two distinct
			// bubbles instead of the first one twice (which left the second stuck on
			// "Sending…" for the whole session).
			const svKey = pendingKeyForPayload(sv);
			const mineIdx =
				svKey !== null
					? indexOfOldestPendingWithPrefix(pendingMine, svKey)
					: pendingMine.findIndex(
							(p) =>
								p.type === sv.type &&
								Math.abs(p.timestamp - sv.timestamp) < 60_000,
						);
			if (mineIdx >= 0) {
				const pending = pendingMine[mineIdx];
				pendingMine.splice(mineIdx, 1);
				pending.messageId = sv.messageId;
				pending.timestamp = sv.timestamp;
				pending.reactions = sv.reactions;
				pending.unsent = sv.unsent;
				pending.status = "sent";
				// Adopted: drop the synthetic identity.
				delete pending.pendingKey;
				continue;
			}
		}
		const msg: OptimisticMessage = { ...sv, status: "sent" as const };
		next.push(msg);
		fresh.push(msg);
	}

	// A Retract message references the message it deletes via
	// body.targetMessageId. Flip the target to a tombstone in place so a
	// retract observed only through the poll (rather than the live WS echo,
	// which does this same flip inline in the message_sent handler) matches
	// what a reload renders.
	for (const msg of fresh) {
		if (
			msg.type === "Retract" &&
			msg.body &&
			typeof msg.body === "object" &&
			"targetMessageId" in msg.body &&
			typeof (msg.body as { targetMessageId?: unknown }).targetMessageId ===
				"string"
		) {
			const targetId = msg.body.targetMessageId;
			const targetIdx = next.findIndex((m) => m.messageId === targetId);
			if (targetIdx >= 0) {
				next[targetIdx] = {
					...next[targetIdx],
					type: "Retract",
					unsent: true,
					body: { targetMessageId: targetId },
				};
			}
		}
	}

	const changed = fresh.length > 0 || dropped > 0 || updated > 0;
	return {
		messages: changed ? removeDuplicateMessages(next) : local,
		changed,
		fresh,
	};
}

/**
 * Cheap structural signature used to detect whether a server-echoed message
 * actually differs from the local copy (type / unsent / reactions / body).
 * Avoids treating every echo as a change — see `reconcile` above.
 */
function messageSignature(m: {
	type: string;
	unsent: boolean;
	body: unknown;
	reactions: { profileId: number; reactionType: number }[];
}): string {
	const reactions = m.reactions
		.map((r) => `${r.profileId}:${r.reactionType}`)
		.sort()
		.join(",");
	return `${m.type}|${m.unsent}|${reactions}|${JSON.stringify(m.body)}`;
}

export function removeDuplicateMessages(
	messages: OptimisticMessage[],
): OptimisticMessage[] {
	const ids = new Set<string>();
	return messages
		.filter((m) => {
			if (ids.has(m.messageId)) return false;
			ids.add(m.messageId);
			return true;
		})
		.toSorted((a, b) => b.timestamp - a.timestamp);
}
