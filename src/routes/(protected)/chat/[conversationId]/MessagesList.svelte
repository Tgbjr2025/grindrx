<script module lang="ts">
	// ---------------------------------------------------------------------
	// P1-005 — windowed rendering.
	//
	// The list used to mount every message in the conversation. At ~20 DOM
	// subtrees per bubble (wrapper, group, context-menu button, media, reaction
	// badges) a 2,000-message thread built tens of thousands of nodes, all of
	// which Svelte had to diff on every `reconcile` poll. The work was
	// proportional to the WHOLE history even though a viewport shows ~10 bubbles.
	//
	// Everything below is deliberately pure and free of component state so it can
	// be unit-tested directly (see `messages-window.test.ts`); the component only
	// supplies measurements and acts on the result.
	// ---------------------------------------------------------------------

	/** Render every message below this count, exactly as before.
	 *
	 *  Windowing changes the DOM shape (spacer nodes, `display: contents`
	 *  wrappers), so short conversations — nearly all of them — keep a byte-for-
	 *  byte identical element tree. This also guarantees the `*:first:mt-auto`
	 *  bottom-alignment rule on the scroll container still applies to a real
	 *  message: it only matters while the content is SHORTER than the viewport,
	 *  and a windowed list is by construction taller than the viewport. */
	export const VIRTUALIZE_THRESHOLD = 100;

	/** Extra items rendered above and below the viewport. Covers the gap between
	 *  a scroll event and the window recomputing, and the measurement pass. */
	export const OVERSCAN_ITEMS = 8;

	/** Floor on the rendered window, so a tall viewport still renders enough to
	 *  fill it even when the estimated heights are wildly optimistic. */
	export const MIN_WINDOW_ITEMS = 24;

	/** Height used for a message with no measured height yet. Every real bubble
	 *  is taller than this (padding, timestamp line, avatar), so this is a floor. */
	const DEFAULT_ESTIMATED_HEIGHT = 64;

	/** The scroll container is `gap-1`, so each rendered item is followed by a
	 *  4px gap. Heights are accumulated as a STRIDE (height + gap) so the two
	 *  spacer nodes reproduce the scroll extent the unwindowed list had. */
	export const ITEM_GAP = 4;

	/**
	 * Per-type estimated heights, in CSS px.
	 *
	 * A single constant would make the scrollbar meaningless in a thread that
	 * mixes one-line texts with photo grids and albums — a 64px estimate against a
	 * 260px album misplaces the thumb by 4x. These are only starting points;
	 * `ResizeObserver` replaces each one with the real value as soon as the item
	 *  is rendered (see `measureHeight`).
	 */
	const ESTIMATED_HEIGHT_BY_TYPE: Record<string, number> = {
		Text: 52,
		Retract: 44,
		ProfileLink: 52,
		Generative: 56,
		Unknown: 56,
		VideoCall: 60,
		Gaymoji: 76,
		Audio: 84,
		Location: 150,
		Giphy: 190,
		Image: 210,
		ExpiringImage: 210,
		ProfilePhotoReply: 220,
		AlbumContentReaction: 220,
		AlbumContentReply: 240,
		Video: 230,
		PrivateVideo: 230,
		Album: 240,
		ExpiringAlbum: 240,
		ExpiringAlbumV2: 240,
	};

	export function estimateMessageHeight(type: string): number {
		return ESTIMATED_HEIGHT_BY_TYPE[type] ?? DEFAULT_ESTIMATED_HEIGHT;
	}

	/** Stand-in used when the list is not being windowed, so that path does no
	 *  window arithmetic at all — a short conversation should cost exactly what it
	 *  cost before P1-005. */
	export const EMPTY_WINDOW: MessageWindow = {
		start: 0,
		end: 0,
		offsets: [0],
		heights: [],
		totalHeight: 0,
	};

	export type MessageWindow = {
		/** Index of the first rendered item, into the ordered (oldest-first) list. */
		start: number;
		/** Exclusive. */
		end: number;
		/** Strided offset of each item; `offsets[n]` is the total. */
		offsets: number[];
		/** Per-item rendered height, excluding the trailing gap. */
		heights: number[];
		/** Total scrollable extent, gaps included. */
		totalHeight: number;
	};

	/** Index of the last item whose bottom edge is below `top`, via binary search.
	 *  Clamps to the final item, which is the right answer when `top` overshoots
	 *  the end — that happens transiently while estimates and real heights
	 *  disagree. */
	function indexAtOffset(
		offsets: number[],
		heights: number[],
		top: number,
		count: number,
	): number {
		let low = 0;
		let high = count - 1;
		let answer = count - 1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (offsets[mid] + heights[mid] > top) {
				answer = mid;
				high = mid - 1;
			} else {
				low = mid + 1;
			}
		}
		return answer;
	}

	/**
	 * Pick the slice of the list to render.
	 *
	 * `scrollTop === null` means "no scroll position yet" — the chat opens pinned
	 * to the newest message, so anchoring to the END avoids a flash of the oldest
	 * messages before the first scroll lands. Passing the real scroll position on
	 * every scroll event takes over from there.
	 */
	export function computeMessageWindow({
		ids,
		types,
		measured,
		scrollTop,
		viewportHeight,
	}: {
		ids: string[];
		types: string[];
		measured: Record<string, number>;
		scrollTop: number | null;
		viewportHeight: number;
	}): MessageWindow {
		const count = ids.length;
		const heights: number[] = new Array<number>(count);
		const offsets: number[] = new Array<number>(count + 1);
		offsets[0] = 0;
		for (let i = 0; i < count; i++) {
			const known = measured[ids[i]];
			const height =
				typeof known === "number" && known > 0
					? known
					: estimateMessageHeight(types[i]);
			heights[i] = height;
			// Strided: every item carries the container's `gap-1` after it, so the
			// sum is the scroll extent the unwindowed list would have produced.
			offsets[i + 1] = offsets[i] + height + ITEM_GAP;
		}
		const totalHeight = count === 0 ? 0 : offsets[count] - ITEM_GAP;
		if (count === 0) return { start: 0, end: 0, offsets, heights, totalHeight };

		// Average height, not the default constant: a viewport of photos needs far
		// fewer items than a viewport of one-line texts.
		const averageHeight = totalHeight / count;
		const visibleCount = Math.max(
			MIN_WINDOW_ITEMS,
			Math.ceil(viewportHeight / Math.max(averageHeight, 1)) + 1,
		);

		let start: number;
		let end: number;
		if (scrollTop === null) {
			start = Math.max(0, count - visibleCount);
			end = count;
		} else {
			const firstVisible = indexAtOffset(offsets, heights, scrollTop, count);
			const lastVisible = indexAtOffset(
				offsets,
				heights,
				scrollTop + Math.max(viewportHeight, 0),
				count,
			);
			start = Math.max(0, firstVisible - OVERSCAN_ITEMS);
			end = Math.min(count, lastVisible + OVERSCAN_ITEMS + 1);
			// Grow back to the floor, biased so the viewport stays covered.
			if (end - start < visibleCount) {
				const deficit = visibleCount - (end - start);
				start = Math.max(0, start - Math.ceil(deficit / 2));
				end = Math.min(count, start + visibleCount);
				start = Math.max(0, Math.min(start, end - visibleCount));
			}
		}
		return { start, end, offsets, heights, totalHeight };
	}
</script>

<script lang="ts">
	import { ArrowDownIcon } from "phosphor-svelte";
	import { tick, untrack } from "svelte";
	import { toast } from "svelte-sonner";

	import { deleteMessageForMe, unsendMessage } from "$lib/api/messages";
	import { Button } from "$lib/components/ui/button";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { Spinner } from "$lib/components/ui/spinner";
	import type { ConversationState } from "./conversation-state.svelte";
	import Message from "./message/Message.svelte";
	import { processMessages } from "./messages";

	let { conversationState }: { conversationState: ConversationState } =
		$props();

	let container: HTMLDivElement | null = $state(null);

	// FIX 12: pre-compute skeleton widths once to avoid jitter on re-renders
	const skeletonShapes = Array.from({ length: 10 }, () => ({
		width: Math.floor(Math.random() * 400) + 100,
		alignEnd: Math.random() < 0.5,
	}));

	const messages = $derived(
		processMessages({
			messages: conversationState.messages,
			ourProfileId: conversationState.ourProfileId,
		}),
	);

	// ---------------------------------------------------------------------
	// P1-005 — windowed rendering (see the module block for the rationale)
	// ---------------------------------------------------------------------

	type VisibleMessage = (typeof messages)[number];

	/** Oldest first — the order the list renders in, so a lower index is older. */
	const ordered = $derived(messages.toReversed());

	const virtualized = $derived(ordered.length > VIRTUALIZE_THRESHOLD);

	const windowIds = $derived(ordered.map((message) => message.messageId));
	const windowTypes = $derived(ordered.map((message) => message.type));

	/** `null` until the first scroll event, which anchors the window to the END of
	 *  the list — the same place the mount effect scrolls to. */
	let scrollTopPx = $state<number | null>(null);
	let viewportHeight = $state(0);
	/** Real rendered heights keyed by messageId, filled in by `ResizeObserver`.
	 *  Never pruned: an entry is a few bytes, and an entry for a message that has
	 *  since been unloaded is simply never read again. */
	let measuredHeights = $state<Record<string, number>>({});

	const win = $derived(
		virtualized
			? computeMessageWindow({
					ids: windowIds,
					types: windowTypes,
					measured: measuredHeights,
					scrollTop: scrollTopPx,
					viewportHeight,
				})
			: EMPTY_WINDOW,
	);

	/** The slice that actually gets mounted. Below the threshold this is the whole
	 *  list, so short conversations render exactly what they did before. */
	const visibleMessages = $derived(
		virtualized ? ordered.slice(win.start, win.end) : ordered,
	);

	/** Empty space above and below the rendered window. Each spacer is itself a
	 *  flex item, so the container inserts one `gap-1` around it that the
	 *  unwindowed list never had; that gap is subtracted here so the total scroll
	 *  extent matches what the unwindowed list produced. */
	const topPad = $derived(
		virtualized ? Math.max(0, win.offsets[win.start] - ITEM_GAP) : 0,
	);
	const bottomPad = $derived(
		virtualized
			? Math.max(0, win.totalHeight - win.offsets[win.end] - ITEM_GAP)
			: 0,
	);

	/** The rendered item the top of the viewport is sitting on, and how far above
	 *  that item's top edge the viewport starts. Restoring it after a measurement
	 *  is what stops the list jumping while the user scrolls. */
	function captureAnchor(): { id: string; delta: number } | null {
		if (!container) return null;
		const top = container.scrollTop;
		for (let i = win.start; i < win.end; i++) {
			if (win.offsets[i] + win.heights[i] > top) {
				return { id: windowIds[i], delta: win.offsets[i] - top };
			}
		}
		return null;
	}

	function restoreAnchor(anchor: { id: string; delta: number }) {
		if (!container) return;
		// Bottom-anchored: re-pin to the newest message instead of restoring an
		// offset, so the latest reply stays flush against the composer.
		if (atBottom) {
			container.scrollTop = container.scrollHeight;
			return;
		}
		const index = windowIds.indexOf(anchor.id);
		if (index < 0) return;
		const target = win.offsets[index] - anchor.delta;
		if (target >= 0) container.scrollTop = target;
	}

	function setMeasuredHeight(id: string, height: number) {
		// Read through `untrack`: this runs from a ResizeObserver callback, and the
		// write below feeds `computeMessageWindow`. Tracking the read here would
		// make the component re-subscribe to every measurement it applies.
		const snapshot = untrack(() => measuredHeights);
		const previous = snapshot[id];
		// Sub-pixel churn guard: ResizeObserver fires on fractional changes and
		// re-rendering the window to chase them would never settle.
		if (previous !== undefined && Math.abs(previous - height) <= 0.5) return;
		const anchor = captureAnchor();
		measuredHeights = { ...snapshot, [id]: height };
		if (anchor) void tick().then(() => restoreAnchor(anchor));
	}

	/**
	 * Measure one mounted message.
	 *
	 * The element this action is attached to is `display: contents`, so it
	 * generates no box of its own and the message stays a DIRECT flex child of the
	 * scroll container — the layout the unwindowed list had. The measurable box is
	 * therefore the wrapper's first element child.
	 */
	function measureHeight(node: HTMLElement, id: string) {
		// jsdom has no ResizeObserver. Without this the measurement path throws on
		// mount in the DOM test project and windowing cannot be exercised at all.
		if (typeof ResizeObserver === "undefined") return {};
		const target = node.firstElementChild;
		if (!(target instanceof HTMLElement)) return {};
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const blockSize = entry.borderBoxSize?.[0]?.blockSize;
			const height = blockSize ?? entry.contentRect.height;
			if (height > 0) setMeasuredHeight(id, height);
		});
		observer.observe(target);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}

	async function scrollToBottom(el: HTMLDivElement, behavior: ScrollBehavior) {
		await tick();
		el.scrollTo({ top: el.scrollHeight, behavior });
	}

	let scrollDone = false;
	$effect(() => {
		void conversationState.conversationId;
		untrack(() => {
			scrollDone = false;
		});
	});
	$effect(() => {
		if (!conversationState.loading && !scrollDone && container) {
			scrollDone = true;
			void scrollToBottom(container, "instant");
		}
	});

	let lastFirstId = "";
	// Track proximity to the bottom so an inbound message does not yank the view
	// away from history the user is reading.
	//
	// The old effect smooth-scrolled to the bottom on ANY change to
	// `messages[0].messageId`. Combined with `overflow-anchor: none` on the
	// container, scrolling up to read old messages and then receiving an inbound
	// message snapped the user to the newest one and lost their place with no way
	// back (the list is virtualisation-free, so there was no anchor to restore).
	let atBottom = $state(true);

	/** True when the container is scrolled to (or near) the newest message. */
	function isNearBottom(el: HTMLDivElement): boolean {
		return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
	}

	$effect(() => {
		const firstId = conversationState.messages.at(0)?.messageId ?? "";
		if (
			scrollDone &&
			firstId &&
			firstId !== lastFirstId &&
			lastFirstId !== ""
		) {
			// Only follow the conversation if the user was already at the bottom
			// (or is the one who sent it — their own message should always be
			// visible). Otherwise leave them where they are and show a pill.
			const ownMessage =
				conversationState.messages[0]?.senderId ===
				conversationState.ourProfileId;
			if (container && (atBottom || ownMessage)) {
				void scrollToBottom(container, "smooth");
			} else {
				newArrivals += 1;
			}
		}
		lastFirstId = firstId;
	});

	// "N new messages" pill, so a user reading history is never left guessing
	// whether something arrived.
	let newArrivals = $state(0);
	function jumpToNewest() {
		newArrivals = 0;
		if (container) void scrollToBottom(container, "smooth");
	}

	async function loadMore() {
		if (
			!container ||
			conversationState.loadingMore ||
			conversationState.pageKey === null
		)
			return;
		// Stop paginating when a page makes no progress. `messages.ts`
		// synthesises the cursor as `messages.at(-1)?.messageId` when the server
		// omits `pageKey`, which is only the OLDEST message if the server returns
		// newest-first. If the order ever differs, or the server repeats a page,
		// the same cursor comes back forever and this observer keeps firing — an
		// unbounded request loop with a spinner that never ends.
		const previousPageKey = conversationState.pageKey;
		const previousCount = conversationState.messages.length;
		const prevScrollHeight = container.scrollHeight;
		// `loadMore` reports whether the FETCH SUCCEEDED. On failure it swallowed
		// the error, left both `pageKey` and `messages.length` untouched, and the
		// two checks below were BOTH satisfied — so a single transient network
		// failure nulled the cursor sentinel and nothing ever set it back,
		// permanently ending the user's ability to read history. Bail out before the
		// end-of-history test when the request did not succeed; the sentinel stays
		// mounted and the next intersection retries.
		const ok = await conversationState.loadMore();
		if (!ok) return;
		// Guard: same cursor, or a page that added nothing, means we are done.
		if (
			conversationState.pageKey === previousPageKey ||
			conversationState.messages.length === previousCount
		) {
			conversationState.pageKey = null;
			return;
		}
		newArrivals = 0;
		await tick();
		container.scrollTop += container.scrollHeight - prevScrollHeight;
	}

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(es) => {
				if (es[0].isIntersecting)
					loadMore().catch((error) => console.error(error));
			},
			{ rootMargin: "400px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}
</script>

<!--
	The one and only definition of a message row. P1-005 renders it either bare (the
	whole list, unchanged DOM) or inside a `display: contents` measurement wrapper
	(windowed). A snippet rather than a duplicated `{#if}` branch, because the row
	carries twelve callbacks and duplicating it would guarantee the two copies drift.
-->
{#snippet messageRow(message: VisibleMessage, isOut: boolean)}
	<Message
		{message}
		{isOut}
		ourProfileId={conversationState.ourProfileId}
		indexInStack={message.indexInStack}
		stackLength={message.stackLength}
		dayStart={message.dayStart}
		status={message.status}
		isRead={isOut && message.messageId === messages[0]?.messageId
			? conversationState.recipientReadTimestamp !== null && message.timestamp <= conversationState.recipientReadTimestamp
			: null}
		onVisible={!isOut
			? () => conversationState.reportRead(message)
			: undefined}
		onDelete={async () => {
			let revert: (() => void) | undefined;
			try {
				({ revert } = conversationState.remove(message.messageId));
				await deleteMessageForMe({
					conversationId: conversationState.conversationId,
					messageId: message.messageId,
				});
			} catch {
				toast.error("Failed to delete message");
				revert?.();
			}
		}}
		onReact={async (reactionType: number) => {
			try {
				const result = await conversationState.reactTo(
					message.messageId,
					reactionType,
				);
				// Re-tapping a reaction you already hold is NOT a silent no-op
				// any more. There is no remove-reaction endpoint available to
				// this client, so say that instead of pretending nothing
				// happened.
				if (result === "already-held")
					toast.info(
						"You already reacted — removing a reaction isn't supported yet.",
					);
			} catch {
				toast.error("Failed to react to message");
			}
		}}
		onUnsend={isOut && !message.unsent
			? async () => {
					let revert: (() => void) | undefined;
					try {
						({ revert } = conversationState.markMessageAsUnsent(
							message.messageId,
						));
						await unsendMessage({
							conversationId: conversationState.conversationId,
							messageId: message.messageId,
						});
					} catch {
						toast.error("Failed to unsend message");
						revert?.();
					}
				}
			: undefined}
		onRetry={isOut && message.status === "error"
			? () => conversationState.retry(message.messageId)
			: undefined}
	/>
{/snippet}

<div
	class="flex-1 flex flex-col min-h-0 overflow-auto gap-1 p-2 max-w-full pt-20 *:first:mt-auto"
	bind:this={container}
	style:overflow-anchor="none"
	// Announce new messages to assistive tech. Without a live region, a screen
	// reader user had no way to learn a reply had arrived.
	role="log"
	aria-live="polite"
	aria-label="Messages"
	onscroll={() => {
		if (!container) return;
		const near = isNearBottom(container);
		// Only clear the pill when the user actually goes back to the bottom.
		if (near) newArrivals = 0;
		atBottom = near;
		// Drives the rendered window. The scroll offset is the anchor, so reading it
		// here — rather than inferring position from message indices — is what keeps
		// the window stable while the user moves through history.
		if (virtualized) {
			scrollTopPx = container.scrollTop;
			viewportHeight = container.clientHeight;
		}
	}}
>
	{#if conversationState.loading}
		{#each skeletonShapes as shape}
			<Skeleton
				class={[
					"h-10 shrink-0 max-w-full rounded-2xl",
					shape.alignEnd ? "self-end" : "self-start",
				]}
				style="width: {shape.width}px"
			/>
		{/each}
	{:else if conversationState.error}
		<div class="flex-1 m-auto flex flex-col items-center gap-3 p-4 text-center">
			<p class="text-sm text-muted-foreground select-text">
				{conversationState.error.message}
			</p>
			<!-- Previously the only recovery was the navbar refresh, which only
			     renders while the WebSocket is disconnected — so a failed load
			     while connected left a dead end. -->
			<Button size="sm" variant="outline" onclick={() => void conversationState.refresh()}>
				Retry
			</Button>
		</div>
	{:else}
		<!--
			Sticky so it stays visible while scrolling. Rendered only when the user
			is NOT at the bottom, which is exactly when the auto-follow above was
			suppressed — so this is the "something arrived, come back when you're
			ready" affordance that was missing.
		-->
		{#if newArrivals > 0}
			<!-- `z-10` matches nothing above it any more: the navbar was raised to
			     `z-20` (see ChatNavBar). At equal stacking level this pill is LATER in
			     the DOM than the absolutely-positioned navbar, so it painted over the
			     back button whenever the user was scrolled up in a long thread. -->
			<div class="sticky top-0 z-10 flex justify-center pt-1 shrink-0">
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground shadow-lg"
					onclick={jumpToNewest}
				>
					{newArrivals} new {newArrivals === 1 ? "message" : "messages"}
					<ArrowDownIcon weight="bold" class="size-3" />
				</button>
			</div>
		{/if}
		{#if conversationState.loadingMore}
			<Spinner class="mt-25 shrink-0 self-center" />
		{/if}
		{#if conversationState.pageKey !== null}
			<div class="h-0" use:observeSentinel></div>
		{/if}
		<!--
			P1-005 spacers. They occupy the scroll extent of the messages that are
			NOT mounted, which is what keeps the scrollbar honest while only a window
			of the thread exists in the DOM. `aria-hidden` so a screen reader does not
			announce two empty log entries on every re-window. Both are zero-height
			when not windowing, and are not rendered at all below the threshold.
		-->
		{#if topPad > 0}
			<div
				class="shrink-0"
				style="height: {topPad}px"
				aria-hidden="true"
				data-testid="messages-top-spacer"
			></div>
		{/if}
		{#each visibleMessages as message (message.messageId)}
			{@const isOut = message.senderId === conversationState.ourProfileId}
			{#if virtualized}
				<!--
					`display: contents` generates no box, so the message is still laid
					out as a DIRECT flex child of the scroll container — same parent, same
					gap, same `*:first:mt-auto` — while giving the measurement pass a
					hook that is not the message's own root element.
				-->
				<div
					class="contents"
					data-message-id={message.messageId}
					data-testid="message-window-item"
					use:measureHeight={message.messageId}
				>
					{@render messageRow(message, isOut)}
				</div>
			{:else}
				{@render messageRow(message, isOut)}
			{/if}
		{/each}
		{#if bottomPad > 0}
			<div
				class="shrink-0"
				style="height: {bottomPad}px"
				aria-hidden="true"
				data-testid="messages-bottom-spacer"
			></div>
		{/if}
	{/if}
</div>
