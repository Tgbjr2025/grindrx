<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import "@fontsource-variable/ibm-plex-sans/wght.css";
	import "@fontsource-variable/ibm-plex-sans/wght-italic.css";

	import "../layout.css";
	import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
	import { afterNavigate } from "$app/navigation";
	import { env } from "$env/dynamic/public";
	import { IconContext } from "phosphor-svelte";
	import { onMount } from "svelte";
	import { Toaster } from "svelte-sonner";

	import {
		applyAndroidInsets,
		applyBackGestureHandler,
	} from "$lib/android-native-bridge";

	// Analytics is OFF by default: this is a privacy-focused client and the route
	// path carries sensitive ids (which profiles you view, which chats you open).
	// It only fires when explicitly enabled at build time, and even then the path
	// is coarsened so no profile/conversation id leaves the device.
	const analyticsEnabled = env.PUBLIC_ENABLE_ANALYTICS === "true";

	// Collapse dynamic route segments (numeric ids, uuids, long hex hashes) to
	// `:id` so a pageview never reveals *which* profile/conversation it was.
	function coarsePath(pathname: string): string {
		return pathname
			.split("/")
			.map((seg) =>
				/^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) ? ":id" : seg,
			)
			.join("/");
	}

	async function trackPageview(url: string) {
		if (!analyticsEnabled) return;
		try {
			await fetch("https://analytics.dominusaxis.com/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "event",
					payload: {
						website: "41d0a4bc-b714-4d6d-b7e4-d3ed182258a6",
						url: coarsePath(url),
						hostname: "grindrx-app",
						language: navigator.language || "en",
						screen: `${screen.width}x${screen.height}`,
						title: "",
						referrer: "",
					},
				}),
			});
		} catch {
			// best-effort, never crash
		}
	}

	afterNavigate(({ to }) => {
		if (to?.url) void trackPageview(to.url.pathname);
	});

	onMount(() => {
		void trackPageview(window.location.pathname);
		applyAndroidInsets();
		applyBackGestureHandler();

		// Track foreground/background so Rust knows when to fire OS notifications
		const syncForeground = () => {
			invoke("set_foreground", { foreground: document.visibilityState === "visible" }).catch(
				() => {},
			);
		};
		document.addEventListener("visibilitychange", syncForeground);

		// Request notification permission on Android 13+
		isPermissionGranted()
			.then((granted) => {
				if (!granted) return requestPermission();
			})
			.catch(() => {});

		return () => {
			document.removeEventListener("visibilitychange", syncForeground);
		};
	});

	import RequestBlockedAlert from "$lib/api/request-blocked/RequestBlockedAlert.svelte";
	import favicon from "$lib/assets/favicon.png";

	let {
		children,
	}: {
		children?: import("svelte").Snippet;
	} = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>
<div
	class="fixed inset-x-0 top-0 z-150000 bg-background/50"
	style="height: var(--safe-area-top)"
></div>
<div
	class="fixed inset-x-0 bottom-0 z-150000 bg-background/50"
	style="height: var(--safe-area-bottom)"
></div>
<Toaster
	position="bottom-center"
	toastOptions={{
		style:
			"background-color: var(--accent); color: var(--popover); border: 1px solid var(--border);",
	}}
	expand
/>
<IconContext values={{}}>
	{@render children?.()}
</IconContext>
<RequestBlockedAlert />
