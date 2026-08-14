<script lang="ts">
	import type { GiphyMessage } from "$lib/model/message";
	import { MessageMediaState } from "./message-media.svelte";

	let { message }: { message: GiphyMessage["body"] } = $props();

	const media = new MessageMediaState();

	// Giphy assets can 404 (removed upstream, expired short-URL, etc) — fall
	// back once to the still frame before giving up on the bubble entirely.
	let triedFallback = $state(false);
	let imgSrc = $derived(triedFallback ? message.stillPath : message.urlPath);

	function handleError() {
		triedFallback = true;
	}
</script>

<div
	class={[
		"relative",
		{ "w-2/5 min-w-35 max-w-60 ms-3": !media.clone, "size-full": media.clone },
	]}
	bind:this={media.el}
>
	<img
		src={imgSrc}
		alt="GIF"
		decoding="async"
		loading="lazy"
		draggable="false"
		onerror={handleError}
		class={["w-full rounded-lg bg-card-foreground/10 object-cover", media.cornerClass]}
		style={message.width > 0 && message.height > 0
			? `aspect-ratio: ${message.width} / ${message.height}`
			: undefined}
	/>
	{@render media.adornments?.()}
</div>
