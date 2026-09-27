<script lang="ts">
	import { openExternalUrl } from "$lib/api/open-url";

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
			// Routed through our own command, not `@tauri-apps/plugin-opener`'s
			// `openUrl`, which rejects on Android because that plugin's JS binding
			// and its Android command name disagree. See $lib/api/open-url.
			void openExternalUrl(href).then((result) => {
				if (!result.opened) {
					console.error(
						`[GrindrX] blocked or failed to open ${href}:`,
						result.error,
					);
				}
			});
		}
	}}
	{...props}
>
	{@render children?.()}
</a>
