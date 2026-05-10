<script lang="ts">
	import { tick } from "svelte";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import Message from "./message/Message.svelte";
	import type { ApiResponseMessage } from "$lib/model/message";
	import { getConversation, processMessages } from "./messages";
	import { Spinner } from "$lib/components/ui/spinner";
	import toast from "svelte-french-toast";
	import { reactToMessage } from "$lib/api/messages";

	let {
		ourProfileId,
		conversationId,
		conversation,
	}: {
		ourProfileId: number;
		conversationId: string;
		conversation: ReturnType<typeof getConversation>;
	} = $props();

	let container: HTMLDivElement | null = $state(null);

	let responseMessages = $state<ApiResponseMessage[]>([]);
	let pageKey = $state<string | null>(null);
	let loadingMore = $state(false);

	const messages = $derived(
		processMessages({ messages: responseMessages, ourProfileId }),
	);

	const initial = $derived(
		conversation.then((res) => {
			pageKey = res.pageKey;
			responseMessages = res.messages;
			tick().then(() => {
				container?.scrollTo({
					top: container!.scrollHeight,
					behavior: "instant",
				});
			});
		}),
	);

	async function loadMore() {
		if (loadingMore || pageKey === null || !container) return;
		const prevScrollHeight = container.scrollHeight;
		loadingMore = true;
		try {
			const result = await getConversation({
				conversationId,
				pageKey,
			});
			responseMessages = [...responseMessages, ...result.messages];
			pageKey = result.pageKey;
		} catch (error) {
			console.error(error);
			toast.error("Failed to load more messages");
		} finally {
			loadingMore = false;
			await tick();
			container.scrollTop += container.scrollHeight - prevScrollHeight;
		}
	}

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(es) => {
				if (es[0].isIntersecting) loadMore();
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
>
	{#await initial}
		{#each Array(10)}
			<Skeleton
				class={[
					"h-9 shrink-0 max-w-full",
					Math.random() < 0.5 ? "self-start" : "self-end",
				]}
				style="width: {Math.floor(Math.random() * 400) + 100}px"
			/>
		{/each}
	{:then}
		{#if loadingMore}
			<Spinner class="mt-25 shrink-0 self-center" />
		{/if}
		{#if pageKey !== null}
			<div class="h-0" use:observeSentinel></div>
		{/if}
		{#each messages.toReversed() as message (message.messageId)}
			<Message
				{message}
				{ourProfileId}
				indexInStack={message.indexInStack}
				stackLength={message.stackLength}
				dayStart={message.dayStart}
				onReact={async (reactionType) => {
					try {
						responseMessages
							.find((m) => m.messageId === message.messageId)
							?.reactions.push({
								reactionType,
								profileId: ourProfileId,
							});
						await reactToMessage({
							conversationId: message.conversationId,
							messageId: message.messageId,
							reactionType,
						});
					} catch (error) {
						console.error(error);
						toast.error("Failed to react to message");
						responseMessages
							.find((m) => m.messageId === message.messageId)
							?.reactions.pop();
					}
				}}
			/>
		{/each}
	{:catch error}
		<p
			class="flex-1 m-auto whitespace-pre bg-card ring ring-card-foreground/10 rounded-lg p-2 select-text overflow-x-auto w-full font-mono"
		>
			{#if error instanceof Error}
				{error.message}
			{:else}
				Failed to load messages
			{/if}
		</p>
	{/await}
</div>
