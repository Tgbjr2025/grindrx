<script lang="ts">
	import toast from "svelte-french-toast";
	import { GpsFixIcon, PencilSimpleIcon } from "phosphor-svelte";
	import { Button } from "$lib/components/ui/button";
	import { setPreferences } from "$lib/app-data/preferences.svelte";
	import LocationChooser from "$lib/components/location-chooser/LocationChooser.svelte";

	let {
		onUpdate,
		class: className,
		expansion,
	}: {
		onUpdate?: () => void;
		class?: import("svelte/elements").ClassValue;
		expansion: number;
	} = $props();

	let geoMapPickerOpen = $state(false);

	function onSubmit(geohash: string) {
		setPreferences({ geohash })
			.then(() => {
				geoMapPickerOpen = false;
				onUpdate?.();
			})
			.catch((e) => {
				console.error(e);
				toast.error("Failed to save location");
			});
	}
</script>

<Button
	variant="secondary"
	class={[
		"transition-none relative *:absolute *:top-1/2 *:left-1/2 *:-translate-1/2 *:flex *:items-center *:justify-center *:gap-1.5 overflow-clip",
		className,
	]}
	style="width: max(44px, {expansion * 100}%)"
	onclick={() => (geoMapPickerOpen = true)}
>
	<div style="opacity: {expansion}">
		<PencilSimpleIcon weight="fill" />
		Change location
	</div>
	<div style="opacity: {1 - expansion}">
		<GpsFixIcon weight="fill" />
	</div>
</Button>
<LocationChooser {onSubmit} bind:open={geoMapPickerOpen} />
