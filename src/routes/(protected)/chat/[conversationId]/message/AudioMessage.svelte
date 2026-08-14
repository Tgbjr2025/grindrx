<script lang="ts">
	import type { AudioMessage } from "$lib/model/message";
	import { getMessageContext, getMessageMetaContext } from "./context";
	import MessageTail from "./MessageTail.svelte";

	let { message }: { message: AudioMessage["body"] } = $props();

	const { lastInStack, isOut } = $derived(getMessageContext()());
	const { clone, setRef, adornments } = $derived(getMessageMetaContext()());

	let el: HTMLDivElement | null = $state(null);
	$effect(() => {
		setRef(el ?? null);
	});

	// `length` is milliseconds; render a short m:ss label alongside the player.
	function formatDuration(lengthMs: number): string {
		const totalSeconds = Math.max(0, Math.round(lengthMs / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${seconds.toString().padStart(2, "0")}`;
	}

	const durationLabel = $derived(
		message.length !== null ? formatDuration(message.length) : null,
	);
</script>

<div
	class={[
		"py-2 px-3 rounded-2xl w-fit max-w-70 text-black shrink-0 relative overflow-visible",
		{
			"bg-message-bubble-in shadow-sm": !isOut,
			"ms-3": !isOut && !clone,
			"rounded-bl-sm": lastInStack && !isOut,
			"bg-message-bubble-out shadow-sm": isOut,
			"me-3": isOut && !clone,
			"rounded-br-sm": lastInStack && isOut,
		},
	]}
	bind:this={el}
>
	{#if lastInStack}
		<MessageTail
			{isOut}
			class={isOut ? "fill-message-bubble-out" : "fill-message-bubble-in"}
		/>
	{/if}
	<div class="flex items-center gap-2">
		<audio controls preload="none" src={message.url} class="h-9 max-w-56 min-w-0">
			<track kind="captions" />
		</audio>
		{#if durationLabel}
			<span class="text-xs text-black/60 tabular-nums shrink-0">{durationLabel}</span>
		{/if}
	</div>
	{@render adornments?.()}
</div>
