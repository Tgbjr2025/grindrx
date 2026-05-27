<script lang="ts">
	import type { TextMessage } from "$lib/model/message";
	import { getMessageContext, getMessageMetaContext } from "./context";
	import MessageTail from "./MessageTail.svelte";

	let { message }: { message: TextMessage["body"] } = $props();

	const { lastInStack, isOut } = $derived(getMessageContext()());
	const { clone, setRef, adornments } = $derived(getMessageMetaContext()());

	let el: HTMLDivElement | null = $state(null);
	$effect(() => {
		setRef(el ?? null);
	});
</script>

<div
	class={[
		"py-2 px-3.5 rounded-2xl w-fit max-w-100 text-black shrink-0 relative overflow-visible select-text text-[15px] leading-[1.45]",
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
			class={{
				"fill-message-bubble-in": !isOut,
				"fill-message-bubble-out": isOut,
			}}
		/>
	{/if}
	<span class="whitespace-pre-wrap">{message.text}</span>
	{@render adornments?.()}
</div>
