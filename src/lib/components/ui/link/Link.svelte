<script lang="ts">
	let {
		onclick,
		children,
		href,
		...props
	}: import("svelte/elements").SvelteHTMLElements["a"] = $props();
</script>

<a
	{href}
	onclick={(event) => {
		onclick?.(event);
		if (href) {
			event.preventDefault();
			const url = new URL(href);
			if (["https:", "http:"].includes(url.protocol)) {
				void import("@tauri-apps/plugin-opener").then(({ openUrl }) =>
					openUrl(href),
				);
			} else {
				console.error(
					`Blocked navigation to URL with unsupported scheme: ${url.protocol}`,
				);
			}
		}
	}}
	{...props}
>
	{@render children?.()}
</a>
