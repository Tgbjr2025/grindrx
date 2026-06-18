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
import type { AlbumExpirationType } from "$lib/model/album";
import { chatV1MessageSentEventSchema, ws } from "$lib/ws.svelte";
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
	lastReadTimestamp: number | null = $state(null);
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
	#unlistenWsRetract: Promise<() => void> | null = null;
	#unlistenWsTyping: Promise<() => void> | null = null;
	#unlistenWsRead: Promise<() => void> | null = null;
	#unlistenWsReaction: Promise<() => void> | null = null;

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
					const targetId = (msg.body as { targetMessageId: string })
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
						} as OptimisticMessage;
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

		// FIX 1+2: retract event — use notificationEventSchema envelope (consistent with message_sent),
		// and show tombstone instead of splicing so live-retract matches reload behaviour.
		this.#unlistenWsRetract = ws.onRetracted((payload) => {
			if (this.#destroyed) return;
			const idx = this.messages.findIndex(
				(m) => m.messageId === payload.targetMessageId,
			);
			if (idx >= 0) {
				this.messages[idx] = {
					...this.messages[idx],
					type: "Retract",
					body: { targetMessageId: this.messages[idx].messageId },
				} as OptimisticMessage;
				this.#syncCache();
			}
		});

		// FIX 4: typing indicator
		this.#unlistenWsTyping = ws.on(
			"chat.v1.typing",
			z.object({
				conversationId: z.string(),
				profileId: z.number(),
				isTyping: z.boolean(),
			}),
			(event) => {
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
			},
		);

		// FIX 5: read receipt
		this.#unlistenWsRead = ws.on(
			"chat.v1.read",
			z.object({
				conversationId: z.string(),
				lastReadTimestamp: z.number(),
			}),
			(event) => {
				if (this.#destroyed) return;
				if (event.conversationId !== this.conversationId) return;
				if (
					this.lastReadTimestamp === null ||
					event.lastReadTimestamp > this.lastReadTimestamp
				) {
					this.lastReadTimestamp = event.lastReadTimestamp;
					localStorage.setItem(
						`chat:read:${this.conversationId}`,
						String(event.lastReadTimestamp),
					);
				}
			},
		);

		// FIX 6: reaction
		this.#unlistenWsReaction = ws.on(
			"chat.v1.message_reaction",
			z.object({
				messageId: z.string(),
				reactionType: z.union([z.number().int().nonnegative(), z.string()]).transform((v) =>
					typeof v === "string" ? parseInt(v, 10) : v,
				),
				profileId: z.number(),
			}),
			(event) => {
				if (this.#destroyed) return;
				const msg = this.messages.find((m) => m.messageId === event.messageId);
				if (!msg) return;
				const existing = msg.reactions.findIndex(
					(r) => r.profileId === event.profileId,
				);
				if (existing >= 0) {
					msg.reactions[existing] = {
						profileId: event.profileId,
						reactionType: event.reactionType,
					};
				} else {
					msg.reactions.push({ profileId: event.profileId, reactionType: event.reactionType });
				}
				this.#syncCache();
			},
		);
	}

	#destroyed = false;
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#conversations.clearActive(this.conversationId);
		this.#unlistenWs?.then((unlisten) => unlisten()).catch(console.error);
		this.#unlistenWsRetract?.then((unlisten) => unlisten()).catch(console.error);
		this.#unlistenWsTyping?.then((unlisten) => unlisten()).catch(console.error);
		this.#unlistenWsRead?.then((unlisten) => unlisten()).catch(console.error);
		this.#unlistenWsReaction?.then((unlisten) => unlisten()).catch(console.error);
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

			const serverById = new Map(
				result.messages.map((m) => [m.messageId, m] as const),
			);
			const oldestServerTs =
				result.messages.length > 0
					? result.messages[result.messages.length - 1].timestamp
					: Number.POSITIVE_INFINITY;

			const recentCutoff = Date.now() - 60_000;
			const next: OptimisticMessage[] = [];
			const seenLocalIds = new Set<string>();
			// Still-pending optimistic messages we authored. Used below to adopt the
			// server copy onto the pending entry instead of rendering a duplicate when
			// the reconcile poll observes our just-sent message before the send()
			// response has rewritten its temp id.
			const pendingMine: OptimisticMessage[] = [];
			let dropped = 0;
			for (const local of this.messages) {
				if (local.status !== "sent") {
					// FIX 9: always preserve pending/error messages
					if (local.status === "pending" && local.senderId === this.ourProfileId)
						pendingMine.push(local);
					next.push(local);
					continue;
				}
				seenLocalIds.add(local.messageId);
				// FIX 9: preserve recently-sent messages even if not yet in server page
				const recentlySent = local.timestamp >= recentCutoff;
				if (
					recentlySent ||
					local.timestamp < oldestServerTs ||
					serverById.has(local.messageId)
				) {
					next.push(local);
				} else {
					dropped++;
				}
			}

			const fresh: OptimisticMessage[] = [];
			for (const sv of result.messages) {
				if (seenLocalIds.has(sv.messageId)) continue;
				// Dedup against a still-pending optimistic message we authored: if the
				// server now reports a message of the same type with a near-identical
				// timestamp, it IS our pending message (temp id not yet rewritten).
				// Adopt the server id/data onto the pending entry in place so the user
				// never sees the message twice. Each pending is matched at most once.
				if (sv.senderId === this.ourProfileId) {
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

			if (fresh.length === 0 && dropped === 0) {
				this.#syncCache();
				return;
			}

			this.messages = removeDuplicateMessages(next);
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
		void this.#resolveMessage({ tempId, message });
	}

	async sendAlbum(albumId: number, expirationType: AlbumExpirationType): Promise<void> {
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
		createdAt,
	}: {
		mediaId: number;
		mediaHash: string;
		createdAt: number | null;
	}): Promise<void> {
		if (!this.profile) throw new Error("Conversation not loaded");
		const tempId = `pending-${crypto.randomUUID()}`;
		const optimistic: OptimisticMessage = {
			type: "Image",
			body: {
				mediaId,
				url: `https://cdns.grindr.com/images/${mediaHash}`,
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
				createdAt,
			});
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg) {
				msg.status = "sent";
				msg.messageId = messageId;
			}
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
			this.#syncCache();
			void this.#conversations.ensureLoaded(this.conversationId);
		} catch {
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg) msg.status = "error";
			const latestSent = this.messages.find((m) => m.status === "sent");
			this.#updatePreview(latestSent);
		}
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
}

function removeDuplicateMessages(
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
