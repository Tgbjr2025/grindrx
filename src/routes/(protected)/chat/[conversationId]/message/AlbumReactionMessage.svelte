<script lang="ts">
	import { LockSimpleIcon } from "phosphor-svelte";

	import AuthedImage from "$lib/components/AuthedImage.svelte";
	import type {
		AlbumContentReactionMessage,
		AlbumContentReplyMessage,
	} from "$lib/model/message";
	import { getMessageContext, getMessageMetaContext } from "./context";

	// `reply` is the text of an AlbumContentReply; absent for a plain reaction.
	let {
		message,
		reply,
	}: {
		message:
			| AlbumContentReactionMessage["body"]
			| AlbumContentReplyMessage["body"];
		reply?: string;
	} = $props();

	const { lastInStack, isOut } = $derived(getMessageContext()());
	const { clone, setRef, adornments } = $derived(getMessageMetaContext()());

	let el: HTMLDivElement | null = $state(null);
	$effect(() => {
		setRef(el ?? null);
	});

	// Grindr sends album-photo reactions/replies as their own message type
	// carrying a preview of the photo that was reacted to (not the emoji). Render
	// a compact bubble so it reads naturally instead of "Unsupported message".
	const caption = $derived(
		reply !== undefined
			? isOut
				? "You replied to a photo"
				: "Replied to a photo in your album"
			: isOut
				? "You reacted to a photo"
				: "Reacted to a photo in your album",
	);
	const showPreview = $derived(message.viewable && !!message.previewUrl);
</script>

<div
	class={[
		"py-2 px-3 rounded-2xl w-fit max-w-100 text-black shrink-0 relative overflow-visible select-text",
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
	<div class="flex items-center gap-2.5">
		<div
			class="size-12 rounded-lg overflow-hidden shrink-0 bg-black/10 flex items-center justify-center"
		>
			{#if showPreview}
				<AuthedImage
					src={message.previewUrl!}
					alt=""
					class="w-full h-full object-cover"
					loading="lazy"
					draggable="false"
				/>
			{:else}
				<LockSimpleIcon weight="fill" class="size-5 text-black/40" />
			{/if}
		</div>
		<div class="flex flex-col min-w-0 gap-0.5">
			<span class="text-[13px] font-medium opacity-70">{caption}</span>
			{#if reply}
				<span class="text-[15px] leading-[1.4] whitespace-pre-wrap break-words"
					>{reply}</span
				>
			{/if}
		</div>
	</div>
	{@render adornments?.()}
</div>
