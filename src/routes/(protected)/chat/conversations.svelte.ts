import { toast } from "svelte-sonner";

import {
	getConversations,
	markConversationAsRead,
} from "$lib/api/conversation";
import { setTotalUnread } from "$lib/stores/unread.svelte";
import { previewFromMessage } from "$lib/model/message";
import {
	chatV1ConversationDeleteEventSchema,
	chatV1MessageSentEventSchema,
	ws,
} from "$lib/ws.svelte";
import type { Conversation } from "$lib/model/conversation";
import type { ApiResponseMessage } from "$lib/model/message";
import type { getConversation } from "./[conversationId]/messages";

type ConversationProfile = Awaited<
	ReturnType<typeof getConversation>
>["profile"];

export type CachedConversation = {
	messages: ApiResponseMessage[];
	profile: ConversationProfile;
	pageKey: string | null;
	cachedAt: number;
};

class ConversationsState {
	entries = $state<Conversation[]>([]);
	nextPage = $state<number | null>(null);
	loadingMore = $state(false);
	initial: Promise<void>;
	listScrollY = 0;

	readonly ourProfileId: number;
	#activeConversationId: string | null = null;
	#wsPromises: Promise<() => void>[] = [];
	#messageCache = new Map<string, CachedConversation>();
	#firstConnect = true;
	#wasHidden = false;
	#lastReconcileAt = 0;
	#reconcileListeners = new Set<() => void | Promise<void>>();
	#removeVisibility: (() => void) | null = null;

	constructor(ourProfileId: number) {
		this.ourProfileId = ourProfileId;
		this.initial = this.#load(1).catch((error: unknown) => {
			console.error("Failed to load conversations:", error);
		});

		this.#wsPromises.push(
			ws.onConnected(() => {
				if (this.#firstConnect) {
					this.#firstConnect = false;
					return;
				}
				void this.#reconcile();
			}),
			ws.on("chat.v1.message_sent", chatV1MessageSentEventSchema, (event) => {
				const message = event.payload;
				const entry = this.entries.find(
					(entry) => entry.data.conversationId === message.conversationId,
				);
				if (entry) {
					const isActive =
						message.conversationId === this.#activeConversationId;
					if (!isActive && message.senderId !== this.ourProfileId) {
						entry.data.unreadCount += 1;
						this.#syncUnread();
					}
					if (!isActive) {
						this.invalidateConversation(message.conversationId);
					}
					this.updatePreview({
						conversationId: message.conversationId,
						preview: previewFromMessage(message),
						timestamp: message.timestamp,
					});
				} else {
					void this.ensureLoaded(message.conversationId);
				}
			}),
			ws.on(
				"chat.v1.conversation.delete",
				chatV1ConversationDeleteEventSchema,
				(event) => {
					for (const id of event.payload.conversationIds) {
						this.remove(id);
					}
				},
			),
		);

		if (typeof document !== "undefined") {
			const onVisibility = () => {
				if (document.visibilityState === "hidden") {
					this.#wasHidden = true;
					return;
				}
				if (!this.#wasHidden) return;
				this.#wasHidden = false;
				void this.#reconcile();
			};
			document.addEventListener("visibilitychange", onVisibility);
			this.#removeVisibility = () =>
				document.removeEventListener("visibilitychange", onVisibility);
		}
	}

	async destroy(): Promise<void> {
		// Use allSettled — Promise.all rejects on the first failed listen() and
		// abandons every other already-resolved unlistener, leaking Tauri event
		// handlers across SvelteKit navigations.
		const results = await Promise.allSettled(this.#wsPromises);
		for (const r of results) {
			if (r.status === "fulfilled") {
				try {
					r.value();
				} catch (e) {
					console.error("[conversations] unlisten failed:", e);
				}
			}
		}
		this.#wsPromises = [];
		this.#removeVisibility?.();
		this.#removeVisibility = null;
		this.#reconcileListeners.clear();
	}

	onReconcile(handler: () => void | Promise<void>): () => void {
		this.#reconcileListeners.add(handler);
		return () => this.#reconcileListeners.delete(handler);
	}

	async #reconcile(): Promise<void> {
		const now = Date.now();
		if (now - this.#lastReconcileAt < 2000) return;
		this.#lastReconcileAt = now;
		await this.initial.catch(() => {});

		const activeId = this.#activeConversationId;

		try {
			const result = await getConversations(1);

			const freshIds = new Set(
				result.entries.map((e) => e.data.conversationId),
			);
			for (const id of [...this.#messageCache.keys()]) {
				if (id !== activeId && !freshIds.has(id)) this.#messageCache.delete(id);
			}

			for (const incoming of result.entries) {
				const existing = this.entries.find(
					(e) => e.data.conversationId === incoming.data.conversationId,
				);
				if (existing) {
					existing.data.preview = incoming.data.preview;
					existing.data.lastActivityTimestamp =
						incoming.data.lastActivityTimestamp;
					if (incoming.data.conversationId !== activeId) {
						existing.data.unreadCount = incoming.data.unreadCount;
					}
				} else {
					this.entries.unshift(incoming);
				}
			}
		} catch (error) {
			console.error("Failed to reconcile conversation list", error);
		}

		this.#syncUnread();

		for (const handler of [...this.#reconcileListeners]) {
			try {
				await handler();
			} catch (error) {
				console.error("Reconcile listener failed", error);
			}
		}
	}

	#syncUnread(): void {
		const total = this.entries.reduce(
			(sum, e) => sum + e.data.unreadCount,
			0,
		);
		setTotalUnread(total);
	}

	async #load(page: number): Promise<void> {
		const result = await getConversations(page);
		this.entries.push(...result.entries);
		this.nextPage = result.nextPage;
		this.#syncUnread();
	}

	async loadMore(): Promise<void> {
		if (this.loadingMore || this.nextPage === null) return;
		this.loadingMore = true;
		try {
			await this.#load(this.nextPage);
		} catch (error) {
			console.error(error);
			toast.error("Failed to load more conversations");
		} finally {
			this.loadingMore = false;
		}
	}

	async ensureLoaded(conversationId: string): Promise<void> {
		if (this.entries.some((e) => e.data.conversationId === conversationId)) {
			return;
		}
		try {
			const result = await getConversations(1);
			const newEntries = result.entries.filter(
				(entry) =>
					!this.entries.some(
						(e) => e.data.conversationId === entry.data.conversationId,
					),
			);
			this.entries.unshift(...newEntries);
		} catch (error) {
			console.error("Failed to sync conversation into sidebar", error);
		}
	}

	remove(conversationId: string) {
		this.#messageCache.delete(conversationId);
		const index = this.entries.findIndex(
			(e) => e.data.conversationId === conversationId,
		);
		let revert = () => {};
		if (index > -1) {
			const [removed] = this.entries.splice(index, 1);
			this.#syncUnread();
			revert = () => {
				if (removed) {
					this.entries.splice(index, 0, removed);
					this.#syncUnread();
				}
			};
		}
		return {
			revert,
		};
	}

	setActive(conversationId: string): void {
		this.#activeConversationId = conversationId;
		this.markRead(conversationId);
	}

	clearActive(conversationId: string): void {
		if (this.#activeConversationId === conversationId) {
			this.#activeConversationId = null;
		}
	}

	markRead(conversationId: string): void {
		const entry = this.entries.find(
			(e) => e.data.conversationId === conversationId,
		);
		if (entry) {
			const unreadCount = entry.data.unreadCount;
			if (unreadCount > 0) {
				entry.data.unreadCount = 0;
				this.#syncUnread();
				markConversationAsRead({ conversationId }).catch((error) => {
					console.error("Failed to mark conversation as read", error);
					toast.error("Failed to mark conversation as read");
					entry.data.unreadCount = unreadCount;
					this.#syncUnread();
				});
			}
		}
	}

	updatePreview({
		conversationId,
		preview,
		timestamp,
	}: {
		conversationId: Conversation["data"]["conversationId"];
		preview: Conversation["data"]["preview"];
		timestamp: Conversation["data"]["lastActivityTimestamp"];
	}): void {
		const entry = this.entries.find(
			(e) => e.data.conversationId === conversationId,
		);
		if (!entry) return;
		entry.data.preview = preview;
		entry.data.lastActivityTimestamp = timestamp;
	}

	getCachedConversation(id: string): CachedConversation | undefined {
		return this.#messageCache.get(id);
	}

	setCachedConversation(id: string, data: CachedConversation): void {
		this.#messageCache.set(id, data);
	}

	invalidateConversation(id: string): void {
		this.#messageCache.delete(id);
	}
}

export { ConversationsState };
