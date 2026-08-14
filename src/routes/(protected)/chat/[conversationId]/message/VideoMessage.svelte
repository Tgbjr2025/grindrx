<script lang="ts">
	import { LockIcon } from "phosphor-svelte";

	import type { PrivateVideoMessage, VideoMessage } from "$lib/model/message";
	import { MessageMediaState } from "./message-media.svelte";

	// Covers both "Video" and "PrivateVideo" (PrivateVideo is Video + viewCount).
	// "NonExpiringVideo" has an unknown/opaque body and stays on the
	// UnsupportedMessage fallback.
	let {
		message,
	}: { message: VideoMessage["body"] | PrivateVideoMessage["body"] } = $props();

	const media = new MessageMediaState();

	const viewsRemaining = $derived(message.viewsRemaining);
</script>

<div
	class={[
		"relative",
		{ "w-2/5 min-w-35 max-w-60 ms-3": !media.clone, "size-full": media.clone },
	]}
	bind:this={media.el}
>
	{#if message.url}
		<video
			controls
			preload="none"
			playsinline
			src={message.url}
			class={[
				"w-full aspect-video rounded-lg bg-card-foreground/10 object-cover",
				media.cornerClass,
			]}
		>
			<track kind="captions" />
		</video>
	{:else}
		<div
			class={[
				"w-full aspect-video rounded-lg bg-card-foreground/10 flex items-center justify-center",
				media.cornerClass,
			]}
		>
			<LockIcon weight="fill" size={36} color="var(--color-neutral-600)" />
		</div>
	{/if}
	{#if viewsRemaining !== undefined}
		<div
			class="absolute top-1.5 right-1.5 bg-black/55 text-white text-xs font-medium rounded-full px-2 py-0.5"
		>
			{viewsRemaining} {viewsRemaining === 1 ? "view" : "views"} left
		</div>
	{/if}
	{@render media.adornments?.()}
</div>
