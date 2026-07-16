<script lang="ts">
	import Link from "$lib/components/ui/link/Link.svelte";
	import type { TextMessage } from "$lib/model/message";
	import { linkifySegments } from "$lib/utils/linkify";
	import { getMessageContext, getMessageMetaContext } from "./context";

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
		<svg
			viewBox="0 0 11 20"
			width="12"
			class={[
				"absolute bottom-0",
				{
					"fill-message-bubble-in right-full translate-x-[0.5px]": !isOut,
					"fill-message-bubble-out -scale-x-100 left-full translate-x-[-0.5px]":
						isOut,
				},
			]}
		>
			<g transform="translate(11 -12.5)" fill-rule="evenodd">
				<path
					d="M-6 16h6v17c-.193-2.84-.876-5.767-2.05-8.782-.904-2.325-2.446-4.485-4.625-6.48A1 1 0 01-6 16z"
					transform="matrix(1 0 0 -1 0 49)"
				></path>
			</g>
		</svg>
	{/if}
	<span class="whitespace-pre-wrap [overflow-wrap:anywhere]"
		>{#each linkifySegments(message.text) as seg}{#if seg.type === "url"}<Link
					href={seg.value}
					rel="noreferrer nofollow noopener"
					class="underline underline-offset-2 break-all"
					onclick={(e) => e.stopPropagation()}>{seg.value}</Link
				>{:else}{seg.value}{/if}{/each}</span
	>
	{@render adornments?.()}
</div>
