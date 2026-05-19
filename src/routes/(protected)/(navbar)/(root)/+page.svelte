<script lang="ts">
	import { checkPermissions, getCurrentPosition } from "@tauri-apps/plugin-geolocation";
	import { platform } from "@tauri-apps/plugin-os";
	import { onMount } from "svelte";

	import { getPreferences, setPreferences } from "$lib/app-data/preferences.svelte";
	import { encodeGeohash } from "$lib/model/geohash";
	import Grid from "./Grid.svelte";
	import { gridState } from "./grid-state.svelte";
	import LocationChooser from "./LocationEmpty.svelte";
	import TopBar from "./top-bar/TopBar.svelte";

	let preferences = $state(getPreferences());

	onMount(async () => {
		const prefs = await preferences;
		if (!prefs.geohash) return;
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
</script>

<svelte:head>
	<title>Open Grind</title>
</svelte:head>
{#await preferences then { geohash }}
	{#if geohash === null}
		<main class="m-auto flex flex-1 max-w-full">
			<LocationChooser onUpdate={() => (preferences = getPreferences())} />
		</main>
	{:else}
		<main class="flex flex-col p-4 gap-4">
			<TopBar
				onUpdatePreferences={() => (preferences = getPreferences())}
				onRefreshGrid={() => gridState.refresh()}
			/>
			<Grid {geohash} />
		</main>
	{/if}
{/await}
