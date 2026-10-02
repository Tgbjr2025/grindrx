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
	import { syncNotificationPrefs } from "$lib/api/notifications";
	import { sendUsagePing } from "$lib/api/usage";
	import { isLockEnabled, lockNow } from "$lib/app-data/app-lock.svelte";

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
		// Anonymous launch ping so active-user counts can be aggregated (best-effort).
		void sendUsagePing();
		// Push the local notification toggles into the Rust notifier on launch.
		void syncNotificationPrefs();
		applyAndroidInsets();
		applyBackGestureHandler();

		// Track foreground/background so Rust knows when to fire OS notifications,
		// and re-engage the app lock when the app comes back to the foreground.
		//
		// The lock previously only ever cleared: `lockNow()` existed but nothing
		// called it, so pressing Home and returning left the app unlocked
		// indefinitely and the gate only reappeared on a full process restart.
		// Re-lock on any backgrounding, plus after a short grace period in the
		// background so a brief app switch (notification shade, permission dialog)
		// does not demand the PIN again.
		//
		// The grace was 30 s, which defeated the feature for its realistic case:
		// press Home, and an attacker picks the phone up 10 s later — no re-lock.
		// 2 s is enough to absorb a shade pull or a permission dialog (both of
		// which return in well under a second of the user acting) and no more.
		let backgroundedAt: number | null = null;
		const RELOCK_GRACE_MS = 2_000;

		const syncForeground = () => {
			const foreground = document.visibilityState === "visible";
			invoke("set_foreground", { foreground }).catch(() => {});

			if (isLockEnabled()) {
				if (foreground) {
					const away =
						backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
					if (backgroundedAt !== null && away >= RELOCK_GRACE_MS) {
						lockNow();
					}
					backgroundedAt = null;
				} else {
					backgroundedAt = Date.now();
				}
			}
		};
		document.addEventListener("visibilitychange", syncForeground);

		// `visibilitychange` alone is not enough: on Android the WebView can be
		// torn down or backgrounded without a final visibilitychange being
		// delivered, and the app can then be resumed from the recents list
		// without ever having been observed as hidden. `pagehide` is the reliable
		// "this document is going away" signal, and there is no grace period to
		// apply to it — the moment we lose the foreground is the moment the
		// attacker has the phone.
		const lockOnPageHide = () => {
			if (isLockEnabled()) lockNow();
		};
		window.addEventListener("pagehide", lockOnPageHide);

		// Request notification permission on Android 13+
		isPermissionGranted()
			.then((granted) => {
				if (!granted) return requestPermission();
			})
			.catch(() => {});

		return () => {
			document.removeEventListener("visibilitychange", syncForeground);
			window.removeEventListener("pagehide", lockOnPageHide);
		};
	});

	import RequestBlockedAlert from "$lib/api/request-blocked/RequestBlockedAlert.svelte";
	import favicon from "$lib/assets/favicon.png";
	import ForceUpdateGate from "$lib/components/ForceUpdateGate.svelte";

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
<!--
	Mounted ABOVE the app content and after the request-blocked alert: the
	force-update gate must be the last thing rendered so it sits on top of
	everything, including any other overlay. See $lib/update-gate.svelte for why
	it is safe to block on (it is not — a network failure never blocks).
-->
<IconContext values={{}}>
	{@render children?.()}
</IconContext>
<RequestBlockedAlert />
<ForceUpdateGate />
