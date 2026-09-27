<script lang="ts">
	import { LockIcon } from "phosphor-svelte";
	import { onDestroy } from "svelte";

	import { isAuthedHost, resolveAuthedImage } from "$lib/utils/authed-image";
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

	// Videos were completely unplayable (the "Video"/"PrivateVideo" half of the
	// H20 finding that was only half-fixed — `AudioMessage.svelte` had been
	// rewritten to resolve through `resolveAuthedImage`, this sibling had not).
	//
	// `<video src={message.url}>` sends no `Authorization` header. A
	// bearer-gated `cdns.grindr.com` URL in a plain `src` is a silent 403, so a
	// PrivateVideo rendered a black rectangle with working controls that played
	// nothing, forever.
	//
	// Resolve through the same authenticated path as audio/images so the bytes
	// actually arrive. Signed CloudFront URLs are returned unchanged, so this
	// costs nothing for those.
	let playUrl = $state<string | null>(null);
	let failed = $state(false);
	// Plain `let`, not `$state`: read/written only inside the effect below, and
	// making it reactive would self-schedule the effect (see the same note in
	// `ImageMessage.svelte` and `AudioMessage.svelte`).
	let cancelled = false;

	$effect(() => {
		const url = message.url;
		cancelled = false;
		failed = false;
		playUrl = null;
		if (!url) return;
		void resolveAuthedImage(url)
			.then((resolved) => {
				// The component may have been torn down while the bytes were in
				// flight.
				if (cancelled) return;
				playUrl = resolved;
			})
			.catch((error) => {
				if (cancelled) return;
				console.error("[GrindrX] failed to resolve chat video", error);
				failed = true;
			});
		return () => {
			cancelled = true;
		};
	});

	// Whether the URL needs the auth round-trip at all — used only to make the
	// loading state honest for direct (signed) URLs.
	const needsAuth = $derived(
		message.url === null ? false : isAuthedHost(message.url),
	);

	onDestroy(() => {
		cancelled = true;
	});
</script>

<div
	class={[
		"relative",
		{ "w-2/5 min-w-35 max-w-60 ms-3": !media.clone, "size-full": media.clone },
	]}
	bind:this={media.el}
>
	{#if !message.url}
		<div
			class={[
				"w-full aspect-video rounded-lg bg-card-foreground/10 flex items-center justify-center",
				media.cornerClass,
			]}
		>
			<LockIcon weight="fill" size={36} color="var(--color-neutral-600)" />
		</div>
	{:else if failed}
		<div
			class={[
				"w-full aspect-video rounded-lg bg-card-foreground/10 flex items-center justify-center text-xs text-muted-foreground px-2 text-center",
				media.cornerClass,
			]}
		>
			Couldn't load video
		</div>
	{:else if playUrl === null}
		<div
			class={[
				"w-full aspect-video rounded-lg bg-card-foreground/10 flex items-center justify-center text-xs text-muted-foreground",
				media.cornerClass,
			]}
		>
			{needsAuth ? "Loading video…" : ""}
		</div>
	{:else}
		<!-- No empty <track>: with no `src` it added a dead captions entry to the
		     native player that could never play — the same removal
		     `AudioMessage.svelte` already made. The svelte-ignore is that same
		     decision; chat videos from the server carry no caption track at all, so
		     there is nothing truthful to point a `<track>` at. -->
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			controls
			preload="none"
			playsinline
			src={playUrl}
			class={[
				"w-full aspect-video rounded-lg bg-card-foreground/10 object-cover",
				media.cornerClass,
			]}
		>
			Your browser does not support video playback.
		</video>
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
