<script lang="ts">
	import { ChatCircleSlashIcon } from "phosphor-svelte";

	import * as Empty from "$lib/components/ui/empty";
	import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
	import Conversation from "./Conversation.svelte";
	import { getConversations } from "./conversations-context.svelte";

	const conversations = getConversations();

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
	class={[
		"flex flex-col gap-1 p-4 w-full h-full overflow-auto min-w-29.25",
		className,
	]}
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
