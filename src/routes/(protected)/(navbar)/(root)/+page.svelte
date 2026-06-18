<script lang="ts">
	import { checkPermissions, getCurrentPosition } from "@tauri-apps/plugin-geolocation";
	import { platform } from "@tauri-apps/plugin-os";
	import { onMount } from "svelte";
	import { ArrowCounterClockwiseIcon, CompassIcon, EyeSlashIcon } from "phosphor-svelte";

	import { getPreferences, setPreferences } from "$lib/app-data/preferences.svelte";
	import { encodeGeohash } from "$lib/model/geohash";
	import {
		clearExploreLocation,
		getExploreLocation,
	} from "$lib/stores/explore-location.svelte";
	import Grid from "./Grid.svelte";
	import { gridState } from "./grid-state.svelte";
	import LocationChooser from "./LocationEmpty.svelte";
	import TopBar from "./top-bar/TopBar.svelte";

	let preferences = $state(getPreferences());

	// Explore override: when set, the grid browses this remote area instead of
	// the device's GPS location. Kept separate so resetting restores GPS.
	const explore = $derived(getExploreLocation());

	onMount(async () => {
		const prefs = await preferences;
		if (!prefs.geohash) return;
		// Don't chase GPS while the user is intentionally browsing a remote area.
		if (getExploreLocation()) return;
		if (!["android", "ios"].includes(platform())) return;
		try {
			const perms = await checkPermissions();
			if (perms.location !== "granted") return;
			const {
				coords: { latitude, longitude },
			} = await getCurrentPosition();
			const newHash = encodeGeohash(latitude, longitude);
			// Only update if position changed by more than ~1 km (6-char geohash cell)
			if (newHash.slice(0, 6) !== prefs.geohash.slice(0, 6)) {
				await setPreferences({ geohash: newHash });
				preferences = getPreferences();
			}
		} catch {
			// Best-effort — silently skip if location unavailable
		}
	});

	function resetToRealLocation() {
		clearExploreLocation();
		// Re-evaluate which geohash the grid should use.
		preferences = getPreferences();
	}
</script>

<svelte:head>
	<title>Open Grind</title>
</svelte:head>
{#await preferences then { geohash: deviceGeohash, incognito }}
	<!--
		`nearbyGeoHash` (the server's distance reference) must stay the device's
		real location even while exploring; the chosen remote area is passed as a
		separate `exploreGeoHash` so distances stay correct and the server's explore
		aggregation is used (see grid-state). Without this the explore area was
		routed through nearbyGeoHash, which the server treats as your own location.
		Fall back to the explore hash only when there is no device location at all.
	-->
	{@const nearbyGeohash = deviceGeohash ?? explore?.geohash ?? null}
	{@const exploreGeohash = explore?.geohash ?? null}
	{#if nearbyGeohash === null}
		<main class="m-auto flex flex-1 max-w-full">
			<LocationChooser onUpdate={() => (preferences = getPreferences())} />
		</main>
	{:else}
		<main class="flex flex-col p-4 gap-4">
			<TopBar
				onUpdatePreferences={() => (preferences = getPreferences())}
				onRefreshGrid={() => gridState.refresh()}
			/>
			{#if explore || incognito}
				<div class="flex justify-end -mt-2 px-1 gap-1.5 flex-wrap">
					{#if explore}
						<button
							type="button"
							onclick={resetToRealLocation}
							class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/15 border border-accent/30 text-accent text-xs font-medium backdrop-blur-sm"
							aria-label="Stop exploring and return to your real location"
						>
							<CompassIcon weight="fill" class="size-3.5 shrink-0" />
							<span class="truncate max-w-[55vw]">
								Exploring {explore.label ?? "a remote area"}
							</span>
							<ArrowCounterClockwiseIcon class="size-3.5 shrink-0" />
						</button>
					{/if}
					{#if incognito}
						<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-800/80 border border-neutral-700/60 text-neutral-300 text-xs font-medium backdrop-blur-sm pointer-events-none">
							<EyeSlashIcon class="size-3.5 shrink-0" />
							Incognito
						</span>
					{/if}
				</div>
			{/if}
			<Grid geohash={nearbyGeohash} {exploreGeohash} />
		</main>
	{/if}
{/await}
