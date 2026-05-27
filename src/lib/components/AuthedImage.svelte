<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import type { ClassValue } from "svelte/elements";

	// Cap concurrent fetch_authed_bytes calls so a full grid doesn't flood Tauri.
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

	let resolvedSrc = $state<string>("");
	let currentSrc = $state(src);

	$effect(() => {
		const s = src;
		currentSrc = s;
		resolvedSrc = "";

		// Android WebView doesn't reliably fire onerror when Grindr CDN returns
		// 401 — skip the direct load attempt and always go through Tauri for
		// external https:// URLs so auth headers are included.
		if (!s.startsWith("https://")) {
			resolvedSrc = s;
			return;
		}

		let cancelled = false;

		acquireSlot().then(() => {
			if (cancelled) { releaseSlot(); return; }
			return invoke<string>("fetch_authed_bytes", { url: s })
				.then((dataUrl) => {
					if (!cancelled && currentSrc === s) {
						resolvedSrc = dataUrl;
					}
				})
				.catch(() => {
					if (!cancelled && currentSrc === s) {
						externalOnerror?.();
					}
				})
				.finally(() => releaseSlot());
		});

		return () => { cancelled = true; };
	});
</script>

<img src={resolvedSrc} {alt} class={className} {style} {...rest} />
