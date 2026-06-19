<script lang="ts">
	import type { ClassValue } from "svelte/elements";

	import { resolveAuthedImage } from "$lib/utils/authed-image";

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

	let resolvedSrc = $state(src);
	let authFailed = $state(false);
	let currentSrc = $state(src);

	$effect(() => {
		currentSrc = src;
		resolvedSrc = src;
		authFailed = false;
	});

	async function handleError() {
		if (authFailed) {
			externalOnerror?.();
			return;
		}
		authFailed = true;
		const srcAtStart = currentSrc;
		const dataUrl = await resolveAuthedImage(srcAtStart);
		// Ignore the result if the bound `src` changed while we were fetching.
		if (currentSrc !== srcAtStart) return;
		if (dataUrl) {
			resolvedSrc = dataUrl;
		} else {
			// resolveAuthedImage already logged the reason; let the parent react.
			externalOnerror?.();
		}
	}
</script>

<img
	src={resolvedSrc}
	{alt}
	class={className}
	{style}
	decoding="async"
	loading="lazy"
	onerror={() => { handleError().catch(console.error); }}
	{...rest}
/>
