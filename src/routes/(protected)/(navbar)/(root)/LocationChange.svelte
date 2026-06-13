<script lang="ts">
	import { CompassIcon } from "phosphor-svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import LocationChooser from "$lib/components/location-chooser/LocationChooser.svelte";
	import { Button } from "$lib/components/ui/button";
	import { decodeGeohash } from "$lib/model/geohash";
	import {
		getExploreLocation,
		setExploreLocation,
	} from "$lib/stores/explore-location.svelte";

	let {
		onUpdate,
		class: className,
		expansion,
	}: {
		onUpdate?: () => void;
		class?: import("svelte/elements").ClassValue;
		expansion: number;
	} = $props();

	// "Explore other areas": picking a place sets a browsing-location override
	// (see $lib/stores/explore-location) rather than overwriting the device's
	// real location, so the grid centres on the chosen area until reset.
	const explore = $derived(getExploreLocation());

	let pinPos: { lat: number; lon: number } | undefined = $state();
	let geoMapPickerOpen = $state(false);

	function onSubmit(geohash: string, label?: string | null) {
		try {
			setExploreLocation({ geohash, label: label ?? null });
			geoMapPickerOpen = false;
			onUpdate?.();
		} catch (error) {
			console.error(error);
			toast.error("Failed to set explore location");
		}
	}

	// Center the picker on the place we're currently browsing (explore override
	// if set, otherwise the device location).
	onMount(() => {
		getPreferences()
			.then(({ geohash }) => {
				const active = getExploreLocation()?.geohash ?? geohash;
				if (active) {
					pinPos = decodeGeohash(active);
				}
			})
			.catch((error) => {
				console.error(error);
				toast.error("Failed to load location");
				pinPos = undefined;
			});
	});

	let locationChooser: LocationChooser;

	$effect(() => {
		if (geoMapPickerOpen && pinPos) locationChooser.centerAt(pinPos);
	});
</script>

<Button
	variant={explore ? "default" : "secondary"}
	class={[
		"transition-none relative *:absolute *:top-1/2 *:left-1/2 *:-translate-1/2 *:flex *:items-center *:justify-center *:gap-1.5 overflow-clip",
		className,
	]}
	style="width: max(44px, {expansion * 100}%)"
	onclick={() => (geoMapPickerOpen = true)}
>
	<div style="opacity: {expansion}">
		<CompassIcon weight="fill" />
		{explore ? (explore.label ?? "Remote area") : "Explore areas"}
	</div>
	<div style="opacity: {1 - expansion}">
		<CompassIcon weight="fill" />
	</div>
</Button>
<LocationChooser
	{onSubmit}
	bind:open={geoMapPickerOpen}
	bind:this={locationChooser}
	bind:pinPos
/>
