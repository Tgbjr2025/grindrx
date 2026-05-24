<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import type { ClassValue } from "svelte/elements";

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
		try {
			const dataUrl = await invoke<string>("fetch_authed_bytes", { url: srcAtStart });
			if (currentSrc === srcAtStart) {
				resolvedSrc = dataUrl;
			}
		} catch {
			if (currentSrc === srcAtStart) {
				externalOnerror?.();
			}
		}
	}
</script>

<img src={resolvedSrc} {alt} class={className} {style} onerror={handleError} {...rest} />
