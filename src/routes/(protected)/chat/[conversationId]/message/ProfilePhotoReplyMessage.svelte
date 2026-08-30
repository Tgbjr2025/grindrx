<script lang="ts">
	import { ImageBrokenIcon } from "phosphor-svelte";

	import AuthedImage from "$lib/components/AuthedImage.svelte";
	import type { ProfilePhotoReplyMessage } from "$lib/model/message";
	import { getMessageContext, getMessageMetaContext } from "./context";

	let { message }: { message: ProfilePhotoReplyMessage } = $props();

	const { lastInStack, isOut } = $derived(getMessageContext()());
	const { clone, setRef, adornments } = $derived(getMessageMetaContext()());

	let el: HTMLDivElement | null = $state(null);
	$effect(() => {
		setRef(el ?? null);
	});

	// Grindr delivers "replied to a profile photo" as its own message type. The
	// body carries a public media hash for the photo being replied to plus the
	// reply text/emoji. Render a compact bubble mirroring the album
	// reaction/reply bubble so it reads naturally instead of "Unsupported
	// message".
	const caption = $derived(
		isOut ? "You replied to a photo" : "Replied to your photo",
	);
	// Public media hash -> CDN thumbnail. AuthedImage falls back to an authed
	// fetch on error and calls `onerror` only if that also fails.
	const photoUrl = $derived(
		`https://cdns.grindr.com/images/thumb/320x320/${message.body.imageHash}`,
	);
	let imageFailed = $state(false);
	// Re-arm the fallback if the hash changes (reconcile poll re-spreads the
	// message object even when the hash is byte-for-byte identical).
	$effect(() => {
		void message.body.imageHash;
		imageFailed = false;
	});
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
			{#if imageFailed}
				<ImageBrokenIcon weight="fill" class="size-5 text-black/40" />
			{:else}
				<AuthedImage
					src={photoUrl}
					alt=""
					class="w-full h-full object-cover"
					loading="lazy"
					draggable="false"
					onerror={() => (imageFailed = true)}
				/>
			{/if}
		</div>
		<div class="flex flex-col min-w-0 gap-0.5">
			<span class="text-[13px] font-medium opacity-70">{caption}</span>
			{#if message.body.photoContentReply}
				<span class="text-[15px] leading-[1.4] whitespace-pre-wrap break-words"
					>{message.body.photoContentReply}</span
				>
			{/if}
		</div>
	</div>
	{@render adornments?.()}
</div>
