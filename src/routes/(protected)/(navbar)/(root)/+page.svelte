<script lang="ts">
	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import Grid from "./Grid.svelte";
	import LocationChooser from "./LocationEmpty.svelte";
	import TopBar from "./top-bar/TopBar.svelte";

	let preferences = $state(getPreferences());
	let grid: Grid | null = $state(null);
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
				onRefreshGrid={() => grid?.refresh()}
			/>
			<Grid {geohash} bind:this={grid} />
		</main>
	{/if}
{/await}
