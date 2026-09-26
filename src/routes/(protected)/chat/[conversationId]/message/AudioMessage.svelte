<script lang="ts">
	import { onDestroy } from "svelte";

	import { isAuthedHost, resolveAuthedImage } from "$lib/utils/authed-image";
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

	// Voice messages were completely unplayable.
	//
	// `<audio src={message.url}>` sends no `Authorization` header, unlike every
	// other media component in the app (all of which go through
	// `resolveAuthedImage` / `fetch_authed_bytes`). For a bearer-token-gated
	// `cdns.grindr.com` URL that is a silent 403 — the bubble renders, shows a
	// duration, and pressing play does nothing, forever.
	//
	// Resolve through the same authenticated path as images so the bytes actually
	// arrive. Signed CloudFront URLs are returned unchanged, so this costs
	// nothing for those.
	let playUrl = $state<string | null>(null);
	let failed = $state(false);
	let cancelled = false;

	$effect(() => {
		const url = message.url;
		cancelled = false;
		failed = false;
		playUrl = null;
		void resolveAuthedImage(url)
			.then((resolved) => {
				// The component may have been torn down while the bytes were in
				// flight.
				if (cancelled) return;
				playUrl = resolved;
			})
			.catch((error) => {
				if (cancelled) return;
				console.error("[GrindrX] failed to resolve voice message audio", error);
				failed = true;
			});
		return () => {
			cancelled = true;
		};
	});

	// Whether the URL needs the auth round-trip at all — used only to make the
	// loading state honest for direct (signed) URLs.
	const needsAuth = $derived(isAuthedHost(message.url));

	onDestroy(() => {
		cancelled = true;
	});
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
		{#if failed}
			<span class="text-xs text-black/70">Couldn't load audio</span>
		{:else if playUrl === null}
			<span class="text-xs text-black/60">
				{needsAuth ? "Loading voice message…" : ""}
			</span>
		{:else}
			<!-- No empty <track>: it added a dead captions entry to the native
			     player with no src, which is worse than having no captions at all. -->
			<audio controls preload="none" src={playUrl} class="h-9 max-w-56 min-w-0">
				Your browser does not support audio playback.
			</audio>
		{/if}
		{#if durationLabel}
			<span class="text-xs text-black/60 tabular-nums shrink-0">{durationLabel}</span>
		{/if}
	</div>
	{@render adornments?.()}
</div>
