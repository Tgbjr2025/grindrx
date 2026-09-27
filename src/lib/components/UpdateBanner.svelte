<script lang="ts">
	import { getVersion } from "@tauri-apps/api/app";
	import { invoke } from "@tauri-apps/api/core";
	import { CaretDownIcon, CaretUpIcon, XIcon } from "phosphor-svelte";
	import { onMount } from "svelte";

	import { openExternalUrl } from "$lib/api/open-url";
	import { isNewer } from "$lib/utils/version";

	let updateAvailable = $state(false);
	let releaseUrl = $state("");
	let latestVersion = $state("");
	let currentVersion = $state("");
	let releaseNotes = $state("");
	let dismissed = $state(false);
	let expanded = $state(false);
	let openError = $state<string | null>(null);

	function isDismissed(version: string): boolean {
		try {
			return localStorage.getItem(`grindrx-update-dismissed-${version}`) === "1";
		} catch {
			return false;
		}
	}

	function persistDismiss(version: string): void {
		try {
			localStorage.setItem(`grindrx-update-dismissed-${version}`, "1");
		} catch {
			// ignore — storage may be unavailable
		}
	}

	/**
	 * Open the release page.
	 *
	 * This used to be `openUrl` from `@tauri-apps/plugin-opener`, whose JS binding
	 * invokes `plugin:opener|open_url` while that plugin's Android build registers
	 * the command as `open` — so it rejected on every phone, and because the
	 * promise was never awaited the rejection was silent. The button simply did
	 * nothing. Routed through our own `open_external_url` command now, which uses
	 * the plugin's Rust API (correct on all platforms), and the failure is
	 * surfaced instead of swallowed.
	 */
	async function openRelease() {
		openError = null;
		const result = await openExternalUrl(releaseUrl);
		if (!result.opened) openError = result.error;
	}

	onMount(async () => {
		try {
			// Fetch the release info through Rust, not a WebView fetch: the release
			// API sends no CORS headers, so a browser fetch from tauri.localhost is
			// blocked and the update check would silently never fire.
			const [current, body] = await Promise.all([
				getVersion(),
				invoke<string>("fetch_latest_release"),
			]);
			const release = JSON.parse(body) as {
				tag_name?: string;
				html_url?: string;
				body?: string;
			};
			if (!release.tag_name || !release.html_url) return;
			if (isNewer(release.tag_name, current)) {
				currentVersion = current;
				latestVersion = release.tag_name;
				releaseUrl = release.html_url;
				releaseNotes = (release.body ?? "").trim();
				if (!isDismissed(release.tag_name)) {
					updateAvailable = true;
				}
			}
		} catch {
			// silently ignore — no network, CSP block, etc.
		}
	});
</script>

{#if updateAvailable && !dismissed}
	<div class="fixed top-(--safe-area-top) inset-x-0 z-50 bg-primary text-primary-foreground shadow-md">
		<div class="flex items-center gap-2 px-4 py-2.5 text-sm">
			<div class="flex-1 min-w-0">
				<span class="font-medium">Update available — {latestVersion}</span>
				{#if currentVersion}
					<span class="opacity-80 text-xs"> (you have {currentVersion})</span>
				{/if}
			</div>
			{#if releaseNotes}
				<button
					type="button"
					class="shrink-0 flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium hover:bg-primary-foreground/10 active:bg-primary-foreground/20 transition-colors"
					aria-expanded={expanded}
					onclick={() => (expanded = !expanded)}
				>
					What's new
					{#if expanded}
						<CaretUpIcon class="size-3.5" />
					{:else}
						<CaretDownIcon class="size-3.5" />
					{/if}
				</button>
			{/if}
			<button
				type="button"
				class="shrink-0 rounded-lg border border-primary-foreground/30 px-3 py-1 text-xs font-semibold hover:bg-primary-foreground/10 active:bg-primary-foreground/20 transition-colors"
				onclick={() => {
					void openRelease();
				}}
			>
				Download
			</button>
			<button
				type="button"
				aria-label="Dismiss"
				class="shrink-0 hover:bg-primary-foreground/10 active:bg-primary-foreground/20 rounded-md p-0.5 transition-colors"
				onclick={() => {
					dismissed = true;
					persistDismiss(latestVersion);
				}}
			>
				<XIcon class="size-4" />
			</button>
		</div>

		{#if openError}
			<p
				class="px-4 pb-2 -mt-1 text-xs text-primary-foreground/90"
				role="alert"
			>
				{openError} — open this link manually:
				<span class="font-mono break-all">{releaseUrl}</span>
			</p>
		{/if}

		{#if expanded && releaseNotes}
			<div class="px-4 pb-3 -mt-0.5">
				<div
					class="max-h-56 overflow-y-auto rounded-lg bg-primary-foreground/10 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words"
				>
					{releaseNotes}
				</div>
			</div>
		{/if}
	</div>
{/if}
