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

export type OptimisticMessage = ApiResponseMessage & {
	status: "sent" | "pending" | "error";
};

type Profile = Awaited<ReturnType<typeof getConversation>>["profile"];

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
		return ws.status;
	}

	readonly conversationId: string;
	readonly ourProfileId: number;

	#conversations: ConversationsState;
	#readQueue: { messageId: string; timestamp: number }[] = [];
	#readTimer: ReturnType<typeof setTimeout> | null = null;
	#typingTimer: ReturnType<typeof setTimeout> | null = null;
	#pollTimer: ReturnType<typeof setInterval> | null = null;
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
	}: {
		conversationId: string;
		ourProfileId: number;
		conversations: ConversationsState;
	}) {
		this.conversationId = conversationId;
		this.ourProfileId = ourProfileId;
		this.#conversations = conversations;
		conversations.setActive(conversationId);
		this.lastReadTimestamp =
			z.coerce
				.number()
				.int()
				.safeParse(localStorage.getItem(`chat:read:${conversationId}`)).data ??
			null;
		void this.#initialLoad();

		this.#removeReconcileListener = conversations.onReconcile(() =>
			this.#reconcileMessages(),
		);

		// Start polling immediately if already disconnected when this state is created.
		if (ws.status === "disconnected") {
			this.#startPolling();
		}

		// Listen for WS connect / disconnect to toggle polling. Keep the promises so
		// destroy() can await + unlisten even if it runs before listen() resolves.
		this.#removeWsConnectedListener = ws.onConnected(() => {
			if (this.#destroyed) return;
			this.#stopPolling();
			// Catch up the open thread on anything that arrived while the socket was
			// down. The disconnect-time poll was just stopped and the WS replays
			// nothing, so without this a message received during a brief drop never
			// shows until the user leaves and reopens the conversation.
			void this.#reconcileMessages();
		});
		this.#removeWsConnectedListener.catch(console.error);

		this.#removeWsDisconnectedListener = import("@tauri-apps/api/event").then(
			({ listen }) =>
				listen<void>("ws:disconnected", () => {
					if (this.#destroyed) return;
					this.#startPolling();
				}),
		);
		this.#removeWsDisconnectedListener.catch(console.error);

		this.#unlistenWs = ws.on(
			"chat.v1.message_sent",
			chatV1MessageSentEventSchema,
			(event) => {
				if (this.#destroyed) return;
				if (event.payload.conversationId !== this.conversationId) return;
				if (event.payload.senderId === this.ourProfileId) {
					// First try an exact messageId match (works once the send() response
					// has rewritten the pending message's id). If no exact match exists,
					// only fall back to "the single pending message" when exactly one is
					// in flight — with concurrent sends, blindly upgrading the first
					// pending corrupts cross-type messages (text vs album).
					const exact = this.messages.find(
						(m) => m.status === "pending" && m.messageId === event.payload.messageId,
					);
					const pendings = this.messages.filter((m) => m.status === "pending");
					const pending = exact ?? (pendings.length === 1 ? pendings[0] : undefined);
					if (pending) {
						// Replace pending with full server data in-place (avoids array replacement
						// during Drawer close animation which would freeze the UI on Android).
						const idx = this.messages.indexOf(pending);
						if (idx >= 0) {
							this.messages[idx] = { ...event.payload, status: "sent" };
						} else {
							pending.status = "sent";
							pending.messageId = event.payload.messageId;
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
		this.#unlistenWsTyping = ws.onTyping((event) => {
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

	/** Immediately fetch the latest messages. Useful for a manual refresh button. */
	async refresh(): Promise<void> {
		await this.#reconcileMessages();
	}

	async #reconcileMessages(): Promise<void> {
		if (this.loading || this.loadingMore || this.#destroyed) return;
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
				{ now: Date.now(), ourProfileId: this.ourProfileId },
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

	async loadMore(): Promise<void> {
		if (this.loadingMore || this.pageKey === null) return;
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
		} catch (err) {
			toast.error("Failed to load more messages");
			console.error(err);
		} finally {
			this.loadingMore = false;
		}
	}

	// Original payloads of in-flight/failed generic sends, keyed by tempId, so a
	// failed message can be retried with its exact body (see retry()).
	#pendingSends = new Map<string, MessageType>();

	send(message: MessageType): void {
		if (!this.profile) return;
		const tempId = `pending-${crypto.randomUUID()}`;
		const optimistic: OptimisticMessage = {
			...message,
			messageId: tempId,
			conversationId: this.conversationId,
			senderId: this.ourProfileId,
			timestamp: Date.now(),
			unsent: false,
			reactions: [],
			status: "pending" as const,
		};
		this.messages = removeDuplicateMessages([optimistic, ...this.messages]);
		this.#updatePreview(optimistic);
		this.#pendingSends.set(tempId, message);
		void this.#resolveMessage({ tempId, message });
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
		const tempId = `pending-${crypto.randomUUID()}`;
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
			timestamp: Date.now(),
			unsent: false,
			reactions: [] as Array<{ profileId: number; reactionType: number }>,
			status: "pending" as const,
		} satisfies OptimisticMessage;
		this.messages = removeDuplicateMessages([optimistic, ...this.messages]);
		this.#updatePreview(optimistic);
		try {
			const { messageId } = await shareAlbum({ albumId, profileId: this.profile.profileId, expirationType });
			// Update the pending message with the real messageId from the HTTP response.
			// This mirrors #resolveMessage so the WS dedup check finds it and returns without
			// mutating the array — preventing the scroll trigger that freezes the UI on Android.
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
		const tempId = `pending-${crypto.randomUUID()}`;
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
			timestamp: Date.now(),
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
		const tempId = `pending-${crypto.randomUUID()}`;
		const optimistic: OptimisticMessage = {
			type: "Audio",
			body: { mediaId, mediaHash, url, contentType, length, expiresAt: null },
			messageId: tempId,
			conversationId: this.conversationId,
			senderId: this.ourProfileId,
			timestamp: Date.now(),
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
			toast.error("Message failed to send — tap to retry");
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
			cachedAt: Date.now(),
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
				this.messages.splice(index, 0, removed);
				if (isLatest) this.#updatePreview(removed);
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
		localStorage.setItem(
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
				toast.error("Failed to mark conversation as read");
			}
		}
	}

	async reactTo(messageId: string, reactionType: number): Promise<void> {
		const msg = this.messages.find((m) => m.messageId === messageId);
		if (!msg) return;
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
			const idx = msg.reactions.findIndex((r) => r === optimisticReaction);
			if (idx !== -1) msg.reactions.splice(idx, 1);
			this.#syncCache();
			throw err;
		}
	}

	markMessageAsUnsent(messageId: string) {
		const msg = this.messages.find((m) => m.messageId === messageId);
		let revert: () => void = () => {};
		if (msg) {
			const originalUnsent = msg.unsent;
			msg.unsent = true;
			msg.type = "Unsent";
			msg.body = null;
			this.#syncCache();
			this.#updatePreview(msg);
			revert = () => {
				msg.unsent = originalUnsent;
				this.#syncCache();
				this.#updatePreview(msg);
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
			const mineIdx = pendingMine.findIndex(
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
