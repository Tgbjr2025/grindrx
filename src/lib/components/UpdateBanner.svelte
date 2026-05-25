<script lang="ts">
	import { onMount } from "svelte";
	import { getVersion } from "@tauri-apps/api/app";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { XIcon } from "phosphor-svelte";

	const RELEASES_API = "https://git.dominusaxis.com/api/v1/repos/dominus/open-grind/releases/latest";

	let updateAvailable = $state(false);
	let releaseUrl = $state("");
	let latestVersion = $state("");
	let dismissed = $state(false);

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

	function parseSemver(v: string): [number, number, number] {
		const clean = v.replace(/^v/, "");
		const parts = clean.split(".").map(Number);
		return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
	}

	function isNewer(latest: string, current: string): boolean {
		const [lMaj, lMin, lPat] = parseSemver(latest);
		const [cMaj, cMin, cPat] = parseSemver(current);
		if (lMaj !== cMaj) return lMaj > cMaj;
		if (lMin !== cMin) return lMin > cMin;
		return lPat > cPat;
	}

	onMount(async () => {
		try {
			const [current, res] = await Promise.all([
				getVersion(),
				fetch(RELEASES_API, { headers: { Accept: "application/json" } }),
			]);
			if (!res.ok) return;
			const release = (await res.json()) as { tag_name?: string; html_url?: string };
			if (!release.tag_name || !release.html_url) return;
			if (isNewer(release.tag_name, current)) {
				latestVersion = release.tag_name;
				releaseUrl = release.html_url;
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
	<div class="fixed top-(--safe-area-top) inset-x-0 z-50 flex items-center gap-3 bg-primary px-4 py-2.5 text-primary-foreground text-sm shadow-md">
		<span class="flex-1 font-medium">Update available — {latestVersion}</span>
		<button
			type="button"
			class="shrink-0 rounded-lg border border-primary-foreground/30 px-3 py-1 text-xs font-semibold hover:bg-primary-foreground/10 active:bg-primary-foreground/20 transition-colors"
			onclick={() => openUrl(releaseUrl)}
		>
			Download
		</button>
		<button
			type="button"
			aria-label="Dismiss"
			class="shrink-0 hover:bg-primary-foreground/10 active:bg-primary-foreground/20 rounded-md p-0.5 transition-colors"
			onclick={() => { dismissed = true; persistDismiss(latestVersion); }}
		>
			<XIcon class="size-4" />
		</button>
	</div>
{/if}
