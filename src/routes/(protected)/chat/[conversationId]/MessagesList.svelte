<script lang="ts">
	import { Skeleton } from "$lib/components/ui/skeleton";
	import Message from "./Message.svelte";
	import type { getConversation } from "./messages";

	let {
		ourProfileId,
		conversation,
	}: {
		ourProfileId: number;
		conversation: ReturnType<typeof getConversation>;
	} = $props();
</script>

<div
	class="flex-1 flex flex-col-reverse min-h-0 overflow-auto gap-1 p-2 max-w-full pt-20"
>
	{#await conversation}
		{#each Array(10)}
			<Skeleton
				class={[
					"h-9 shrink-0 max-w-full",
					Math.random() < 0.5 ? "self-start" : "self-end",
				]}
				style="width: {Math.floor(Math.random() * 400) + 100}px"
			/>
		{/each}
	{:then { messages }}
		{#each messages as message (message.messageId)}
			<Message
				{message}
				{ourProfileId}
				indexInStack={message.indexInStack}
				stackLength={message.stackLength}
				dayStart={message.dayStart}
			/>
		{/each}
	{:catch error}
		<p
			class="flex-1 m-auto whitespace-pre bg-card ring ring-card-foreground/10 rounded-lg p-2 select-text overflow-x-auto w-full"
		>
			{#if error instanceof Error}
				{error.message}
			{:else}
				Failed to load messages
			{/if}
		</p>
	{/await}
</div>
