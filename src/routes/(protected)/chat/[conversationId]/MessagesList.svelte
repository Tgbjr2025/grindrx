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
		{#each messages.toReversed() as message (message.messageId)}
			{@const isOut = message.senderId === conversationState.ourProfileId}
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
		{/each}
	{/if}
</div>
