import { toast } from "svelte-sonner";

import {
	getConversations,
	markConversationAsRead,
} from "$lib/api/conversation";
import { previewFromMessage } from "$lib/model/message";
import { setTotalUnread } from "$lib/stores/unread.svelte";
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
	/**
	 * The first page load. Resolves on success and REJECTS on failure.
	 *
	 * It used to be `.catch()`-wrapped, so it never rejected, which made
	 * `{#await conversations.initial}{:catch}` in `ConversationsList` dead code —
	 * a failed inbox load fell through to the `{:then}` branch and rendered
	 * "No Conversations Yet", i.e. telling the user they have no conversations
	 * when the truth was that the network failed. The rejection is deliberately
	 * re-thrown; the no-op `.catch` below only marks it handled so an observer
	 * that attaches late does not produce a host-level unhandled rejection.
	 * `loading` / `initialError` are the reactive surface the UI should read.
	 */
	initial: Promise<void>;
	/** First-page loading flag, for the skeleton state. */
	loading = $state(true);
	/** First-page failure, for a real error state with a retry. */
	initialError = $state<Error | null>(null);
	listScrollY = 0;

	readonly ourProfileId: number;
	#activeConversationId: string | null = null;
	// Conversations the user has read locally. If revealMessageRead is off we
	// never tell the server, so it keeps reporting them unread; this set stops
	// the periodic reconcile from resurrecting the badge until a new message
	// genuinely arrives (which removes the id from the set).
	#locallyRead = new Set<string>();
	// Last known server `unreadCount` per conversation, so a reconcile can tell
	// "the server's count is unchanged since last time" from "the server's count
	// went UP while we were away" — the difference between legitimately honouring
	// a local read and swallowing genuinely-new unread messages.
	#serverUnread = new Map<string, number>();
	#wsPromises: Promise<() => void>[] = [];
	#messageCache = new Map<string, CachedConversation>();
	#firstConnect = true;
	#wasHidden = false;
	#lastReconcileAt = 0;
	#lastEnsureLoadedAt = 0;
	#ensureLoadedInFlight = new Set<string>();
	#reconcileListeners = new Set<() => void | Promise<void>>();
	#removeVisibility: (() => void) | null = null;

	constructor(ourProfileId: number) {
		this.ourProfileId = ourProfileId;
		this.initial = this.#loadInitial();
		// See the `initial` doc comment: re-thrown for `{#await}`, marked handled
		// here so a late observer does not trip a host-level unhandled rejection.
		this.initial.catch(() => {});

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
					// chat.v1.message_sent ALSO fires when an existing message is
					// unsent/retracted or gains/loses a reaction (the real server has
					// no separate event). Those carry `unsent: true` or the existing
					// message's older timestamp — only a genuinely newer, non-unsent
					// inbound message is a new unread, else the badge inflates on every
					// reaction the other party makes.
					const isNewInbound =
						!message.unsent &&
						message.senderId !== this.ourProfileId &&
						message.timestamp > (entry.data.lastActivityTimestamp ?? 0);
					if (isNewInbound) {
						// A real new message — let reconcile reflect server unread again.
						this.#locallyRead.delete(message.conversationId);
						if (!isActive) {
							entry.data.unreadCount += 1;
							this.#syncUnread();
						}
					}
					if (!isActive) {
						this.invalidateConversation(message.conversationId);
					}
					// `updatePreview` guards on the timestamp itself, which matters for
					// the non-new-inbound events above: a reaction or unsend echo carries
					// the TARGET's older timestamp, and writing that into
					// `lastActivityTimestamp` unconditionally re-ordered the inbox
					// (sorted desc) and persisted until a reconcile corrected it.
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

	/** Re-run the first-page load after a failure. */
	retryInitialLoad(): void {
		this.loading = true;
		this.initialError = null;
		this.initial = this.#loadInitial();
		this.initial.catch(() => {});
	}

	async #loadInitial(): Promise<void> {
		this.loading = true;
		this.initialError = null;
		try {
			await this.#load(1);
		} catch (error) {
			console.error("Failed to load conversations:", error);
			this.initialError =
				error instanceof Error ? error : new Error(String(error));
			throw error;
		} finally {
			this.loading = false;
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
						// Honor a local read: if the user opened this conversation but we
						// suppressed the server read receipt (revealMessageRead off), the
						// server still reports it unread — don't resurrect the badge.
						//
						// BUT ONLY while the server's count is UNCHANGED from the last time
						// we saw it. `#locallyRead` was cleared only by a live
						// `chat.v1.message_sent` or a `markRead` failure, so if the socket
						// was down when messages arrived, the id was still in the set and
						// this branch forced `unreadCount = 0` against a server count of 5.
						// Those messages became invisible: no badge, no toast, no way to
						// know.
						//
						// A "moved since last seen" count is the signal, because it is
						// exactly the evidence that the suppression is stale. Clearing the
						// id when it moves is what makes the suppression ONE-SHOT: without
						// it the very next reconcile would see 5 === 5 and suppress the
						// badge again, swallowing the messages a second time.
						//
						// Deliberately NOT a blanket "clear every locally-read id on the
						// first reconcile after resume": with `revealMessageRead` off the
						// server legitimately keeps reporting a genuinely-read conversation
						// as unread, so a blanket clear would resurrect phantom badges on
						// every app resume. The count comparison already covers the resume
						// case, because messages that arrived while hidden moved the count.
						const id = incoming.data.conversationId;
						const previousServerCount = this.#serverUnread.get(id);
						// No baseline means we cannot prove the server count is stale, so
						// do not suppress. Erring towards showing a real unread badge is
						// recoverable; swallowing messages is not.
						const serverCountUnchanged =
							previousServerCount !== undefined &&
							previousServerCount === incoming.data.unreadCount;
						this.#serverUnread.set(id, incoming.data.unreadCount);
						if (!serverCountUnchanged) this.#locallyRead.delete(id);
						existing.data.unreadCount =
							this.#locallyRead.has(id) && serverCountUnchanged
								? 0
								: incoming.data.unreadCount;
					} else {
						this.#serverUnread.set(
							incoming.data.conversationId,
							incoming.data.unreadCount,
						);
					}
				} else {
					this.entries.unshift(incoming);
					this.#serverUnread.set(
						incoming.data.conversationId,
						incoming.data.unreadCount,
					);
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
		// Seed the server-unread baseline from the very first page too, so the
		// "did the server count move?" test in #reconcile has a sample even before
		// any reconcile has run. Without this the first post-resume reconcile had no
		// baseline and fell back to `true` (unchanged) — exactly the case that
		// swallowed unread messages.
		for (const e of result.entries) {
			this.#serverUnread.set(e.data.conversationId, e.data.unreadCount);
		}
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

	/**
	 * Make sure a conversation we have never listed is present in the inbox.
	 *
	 * A new match sending 5 messages fires 5 of these, and each one refetched the
	 * ENTIRE inbox with no throttle and no in-flight guard. Throttled to the same
	 * 2s window `#reconcile` uses, plus a per-conversation in-flight set.
	 */
	async ensureLoaded(conversationId: string): Promise<void> {
		if (this.entries.some((e) => e.data.conversationId === conversationId)) {
			return;
		}
		if (this.#ensureLoadedInFlight.has(conversationId)) return;
		const now = Date.now();
		if (now - this.#lastEnsureLoadedAt < 2000) return;
		this.#lastEnsureLoadedAt = now;
		this.#ensureLoadedInFlight.add(conversationId);
		try {
			const result = await getConversations(1);
			for (const entry of result.entries) {
				this.#serverUnread.set(
					entry.data.conversationId,
					entry.data.unreadCount,
				);
			}
			const newEntries = result.entries.filter(
				(entry) =>
					!this.entries.some(
						(e) => e.data.conversationId === entry.data.conversationId,
					),
			);
			if (newEntries.length > 0) {
				this.entries.unshift(...newEntries);
				this.#syncUnread();
			}
		} catch (error) {
			console.error("Failed to sync conversation into sidebar", error);
		} finally {
			this.#ensureLoadedInFlight.delete(conversationId);
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
					// The captured `index` is stale if anything was unshifted onto the
					// head of the list while the DELETE was in flight (which
					// `ensureLoaded` and `#reconcile` both do), so re-inserting there put
					// the conversation in the wrong slot. Clamp to the live length.
					const at = Math.min(index, this.entries.length);
					this.entries.splice(at, 0, removed);
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
			// Remember the local read so a reconcile can't resurrect the badge from
			// stale server state (see #locallyRead).
			this.#locallyRead.add(conversationId);
			const unreadCount = entry.data.unreadCount;
			if (unreadCount > 0) {
				entry.data.unreadCount = 0;
				this.#syncUnread();
				markConversationAsRead({ conversationId }).catch((error) => {
					console.error("Failed to mark conversation as read", error);
					toast.error("Failed to mark conversation as read");
					this.#locallyRead.delete(conversationId);
					entry.data.unreadCount = unreadCount;
					this.#syncUnread();
				});
			}
		}
	}

	/**
	 * Update the inbox row's preview and activity time.
	 *
	 * The activity timestamp is only moved FORWARD. `chat.v1.message_sent` also
	 * fires for a reaction or an unsend, and those events carry the TARGET
	 * message's OLD timestamp; writing it into `lastActivityTimestamp`
	 * unconditionally re-ordered the (desc-sorted) inbox and persisted the wrong
	 * order until a reconcile happened to correct it. The preview itself is
	 * always written — it is current information either way.
	 */
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
		entry.data.lastActivityTimestamp = Math.max(
			entry.data.lastActivityTimestamp ?? 0,
			timestamp ?? 0,
		);
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
