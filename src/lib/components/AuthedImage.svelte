<script lang="ts">
	import type { ClassValue } from "svelte/elements";

	import { resolveAuthedImageRetained } from "$lib/utils/authed-image";

	let {
		src,
		alt = "",
		class: className,
		style,
		onerror: externalOnerror,
		...rest
	}: {
		src: string;
		alt?: string;
		class?: ClassValue;
		style?: string;
		onerror?: () => void;
		[key: string]: unknown;
	} = $props();

	// Grindr CDN media is bearer-gated, so a plain `<img src>` 403s. Resolve the
	// authed URL up front rather than optimistically rendering `src` and waiting
	// for `onerror`: that old shape spent one wasted WebView request per image
	// and flashed the broken state before recovering.
	//
	// `null` means "nothing renderable yet" (or resolution failed) and shows the
	// placeholder. Non-authed hosts resolve to themselves synchronously below.
	let blobUrl = $state<string | null>(null);
	let directUrl = $state<string | null>(null);
	let authFailed = $state(false);
	let currentSrc = $state(src);

	// Retain the resolved blob for as long as it is DISPLAYED, and release it in
	// this effect's teardown. Without this the cache's ref-count is always zero,
	// so eviction revokes a blob the mounted <img> is still using — the element
	// goes blank and re-runs the whole IPC byte fetch (a flash-and-refetch storm
	// every time you scrolled past the cache size).
	$effect(() => {
		const requested = src;
		currentSrc = requested;
		authFailed = false;
		blobUrl = null;
		directUrl = null;

		// A cancellation flag, NOT reactive state: writing `$state` that this
		// effect also reads would make the effect re-schedule itself.
		let cancelled = false;
		let release: (() => void) | null = null;

		void resolveAuthedImageRetained(requested).then((result) => {
			// The bound `src` changed while we were fetching.
			if (cancelled || currentSrc !== requested) {
				result.release?.();
				return;
			}
			release = result.release;
			if (result.url.startsWith("blob:")) {
				blobUrl = result.url;
			} else {
				directUrl = result.url;
			}
		});

		return () => {
			cancelled = true;
			release?.();
			release = null;
		};
	});

	const displaySrc = $derived(blobUrl ?? directUrl);

	function handleError() {
		if (authFailed) {
			externalOnerror?.();
			return;
		}
		authFailed = true;
		// The resolved URL is already gone (it 403'd or was revoked); let the
		// parent decide how to present the failure.
		externalOnerror?.();
	}
</script>

{#if displaySrc}
	<img
		src={displaySrc}
		{alt}
		class={className}
		{style}
		decoding="async"
		loading="lazy"
		onerror={handleError}
		{...rest}
	/>
{:else}
	<!--
		Placeholder box while the authed bytes are in flight (or after a failed
		resolve). A <div> not a <span> so caller classes like `size-full` apply.
	-->
	<div class={className} {style} aria-hidden="true"></div>
{/if}
