<script lang="ts">
	import { getMessageContext, getMessageMetaContext } from "./context";
	import MessageTail from "./MessageTail.svelte";

	const { lastInStack, isOut } = $derived(getMessageContext()());
	const { clone, setRef, adornments } = $derived(getMessageMetaContext()());

	let el: HTMLDivElement | null = $state(null);
	$effect(() => {
		setRef(el ?? null);
	});
</script>

<div
	class={[
		"py-2 px-3.5 rounded-2xl w-fit max-w-100 bg-muted text-muted-foreground italic shrink-0 relative overflow-visible select-text text-[15px] leading-[1.45]",
		{
			"ms-3": !isOut && !clone,
			"rounded-bl-sm": lastInStack && !isOut,
			"me-3": isOut && !clone,
			"rounded-br-sm": lastInStack && isOut,
		},
	]}
	bind:this={el}
>
	{#if lastInStack}
		<MessageTail {isOut} class="fill-muted" />
	{/if}
	<span class="whitespace-pre-wrap">Message unsent</span>
	{@render adornments?.()}
</div>
