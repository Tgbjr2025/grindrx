<script lang="ts">
	import { ChatCircleSlashIcon, MagnifyingGlassIcon } from "phosphor-svelte";
	import { onMount, tick } from "svelte";

	import * as Empty from "$lib/components/ui/empty";
	import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
	import Conversation from "./Conversation.svelte";
	import { getConversations } from "./conversations-context.svelte";
	import type { ConversationsState } from "./conversations.svelte";

	const conversations: ConversationsState = getConversations();

	let container: HTMLDivElement | null = $state(null);
	let searchQuery = $state("");

	const filteredEntries = $derived(
		(searchQuery.trim() === ""
			? conversations.entries
			: conversations.entries.filter((c) =>
					(c.data.name ?? "")
						.toLowerCase()
						.includes(searchQuery.trim().toLowerCase()),
				)
		)
			// Newest activity first, so a conversation that just received a
			// message jumps to the top of the inbox instead of staying in place.
			.slice()
			.sort(
				(a, b) =>
					(b.data.lastActivityTimestamp ?? 0) -
					(a.data.lastActivityTimestamp ?? 0),
			),
	);

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
	{:catch}
		<Empty.Root>
			<Empty.Header>
				<Empty.Media variant="icon">
					<ChatCircleSlashIcon weight="fill" />
				</Empty.Media>
				<Empty.Title>Couldn't Load Conversations</Empty.Title>
				<Empty.Description>Check your connection and try again.</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{:then}
		<div class="relative mb-2 shrink-0">
			<MagnifyingGlassIcon
				class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
			/>
			<input
				type="search"
				bind:value={searchQuery}
				placeholder="Search conversations…"
				class="w-full rounded-xl border border-input bg-input/30 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
			/>
		</div>
		{#each filteredEntries as conversation (conversation.data.conversationId)}
			<Conversation {conversation} />
		{:else}
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon">
						<ChatCircleSlashIcon weight="fill" />
					</Empty.Media>
					{#if searchQuery.trim() !== ""}
						<Empty.Title>No Results</Empty.Title>
						<Empty.Description>No conversations match your search.</Empty.Description>
					{:else}
						<Empty.Title>No Conversations Yet</Empty.Title>
						<Empty.Description>
							Browse <a href="/">Grid</a> to find people to chat with.
						</Empty.Description>
					{/if}
				</Empty.Header>
			</Empty.Root>
		{/each}
		{#if conversations.loadingMore}
			{#each Array(6)}
				<Skeleton class="w-full h-24.5 shrink-0" />
			{/each}
		{/if}
		{#if conversations.nextPage !== null && searchQuery.trim() === ""}
			<div class="h-0" use:observeSentinel></div>
		{/if}
	{/await}
</div>
