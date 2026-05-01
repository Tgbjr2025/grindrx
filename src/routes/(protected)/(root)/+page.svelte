<script lang="ts">
	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import LocationChooser from "./LocationEmpty.svelte";
	import Grid from "./Grid.svelte";
	import TopBar from "./top-bar/TopBar.svelte";

	let preferences = $state(getPreferences());
	let grid: Grid | undefined = $state();
</script>

<svelte:head>
	<title>Open Grind</title>
</svelte:head>
{#await preferences then { geohash }}
	{#if geohash === null}
		<main class="min-h-dvh">
			<div class="m-auto flex min-h-dvh pb-16">
				<LocationChooser onUpdate={() => (preferences = getPreferences())} />
			</div>
		</main>
	{:else}
		<main class="min-h-dvh flex flex-col p-4 gap-4 pb-24">
			<TopBar
				onUpdatePreferences={() => (preferences = getPreferences())}
				onRefreshGrid={() => grid?.refresh()}
			/>
			<Grid {geohash} bind:this={grid} />
		</main>
	{/if}
{/await}
