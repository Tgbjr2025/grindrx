<script lang="ts">
	import { ChatCircleSlashIcon } from "phosphor-svelte";
	import { onMount, tick } from "svelte";

	import * as Empty from "$lib/components/ui/empty";
	import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
	import Conversation from "./Conversation.svelte";
	import { getConversations } from "./conversations-context.svelte";
	import type { ConversationsState } from "./conversations.svelte";

	const conversations: ConversationsState = getConversations();

	let container: HTMLDivElement | null = $state(null);

	onMount(() => {
		void conversations.initial.then(tick).then(() => {
			if (container && conversations.listScrollY > 0) {
				container.scrollTop = conversations.listScrollY;
			}
		});
	});

	let {
		class: className,
	}: {
		class?: import("svelte/elements").ClassValue;
	} = $props();

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(es) => {
				if (es[0].isIntersecting)
					conversations.loadMore().catch((error) => console.error(error));
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
	bind:this={container}
	class={[
		"flex flex-col gap-1 p-4 pb-[calc(0.5rem+var(--content-pb))] w-full h-full overflow-auto min-w-29.25",
		className,
	]}
	onscroll={() => (conversations.listScrollY = container?.scrollTop ?? 0)}
>
	{#await conversations.initial}
		{#each Array(8)}
			<Skeleton class="w-full h-24.5 shrink-0" />
		{/each}
	{:then}
		{#each conversations.entries as conversation (conversation.data.conversationId)}
			<Conversation {conversation} />
		{:else}
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon">
						<ChatCircleSlashIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>No Conversations Yet</Empty.Title>
					<Empty.Description>
						Browse <a href="/">Grid</a> to find people to chat with.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{/each}
		{#if conversations.loadingMore}
			{#each Array(6)}
				<Skeleton class="w-full h-24.5 shrink-0" />
			{/each}
		{/if}
		{#if conversations.nextPage !== null}
			<div class="h-0" use:observeSentinel></div>
		{/if}
	{/await}
</div>
