<script lang="ts">
	import type { Conversation as ConversationModel } from "$lib/model/conversation";
	import { getConversations } from "$lib/api/conversation";
	import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
	import Conversation from "./Conversation.svelte";
	import toast from "svelte-french-toast";

	let {
		class: className,
	}: {
		class?: import("svelte/elements").ClassValue;
	} = $props();

	let entries = $state<ConversationModel[]>([]);
	let nextPage = $state<number | null>(null);
	let loadingMore = $state(false);

	let initial = $state(load(1));

	async function load(page: number) {
		const result = await getConversations(page);
		entries.push(...result.entries);
		nextPage = result.nextPage;
	}

	async function loadMore() {
		if (loadingMore || nextPage === null) return;
		loadingMore = true;
		try {
			await load(nextPage);
		} catch (e) {
			console.error(e);
			toast.error("Failed to load more conversations");
		} finally {
			loadingMore = false;
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
	class={[
		"flex flex-col gap-1 p-4 w-full h-full overflow-auto min-w-29.25",
		className,
	]}
>
	{#await initial}
		{#each Array(8)}
			<Skeleton class="w-full h-24.5 shrink-0" />
		{/each}
	{:then}
		{#each entries as conversation (conversation.data.conversationId)}
			<Conversation {conversation} />
		{/each}
		{#if loadingMore}
			{#each Array(6)}
				<Skeleton class="w-full h-24.5 shrink-0" />
			{/each}
		{/if}
		{#if nextPage !== null}
			<div class="h-0" use:observeSentinel></div>
		{/if}
	{/await}
</div>
