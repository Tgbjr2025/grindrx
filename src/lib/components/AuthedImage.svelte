<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import type { ClassValue } from "svelte/elements";

	// Limit concurrent fetch_authed_bytes calls to avoid flooding Tauri's
	// command queue when a grid of images all fail auth at the same time.
	const MAX_CONCURRENT = 4;
	let running = 0;
	const waitQueue: (() => void)[] = [];

	function acquireSlot(): Promise<void> {
		return new Promise((resolve) => {
			if (running < MAX_CONCURRENT) {
				running++;
				resolve();
			} else {
				waitQueue.push(() => { running++; resolve(); });
			}
		});
	}

	function releaseSlot() {
		running--;
		waitQueue.shift()?.();
	}

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
			await acquireSlot();
			try {
				const dataUrl = await invoke<string>("fetch_authed_bytes", { url: srcAtStart });
				if (currentSrc === srcAtStart) {
					resolvedSrc = dataUrl;
				}
			} finally {
				releaseSlot();
			}
		} catch {
			if (currentSrc === srcAtStart) {
				externalOnerror?.();
			}
		}
	}
</script>

<img src={resolvedSrc} {alt} class={className} {style} onerror={() => { handleError().catch(console.error); }} {...rest} />
