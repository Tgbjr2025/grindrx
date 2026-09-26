<script lang="ts">
	import { CompassIcon } from "phosphor-svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import { getPreferences, setPreferences } from "$lib/app-data/preferences.svelte";
	import LocationChooser from "$lib/components/location-chooser/LocationChooser.svelte";
	import { Button } from "$lib/components/ui/button";
	import { decodeGeohash } from "$lib/model/geohash";
	import {
		clearExploreLocation,
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
	//
	// That path uses the `exploreGeoHash` cascade param, which Grindr gates
	// behind a paid tier (the server answers CAS-4001). The sheet therefore also
	// offers "browse from here", which changes our OWN nearby reference point
	// instead. That costs nothing, works on every account, and gives a free user
	// a way to actually browse an area they picked.
	const explore = $derived(getExploreLocation());

	// The most recent pick, kept so we can offer the untiered alternative after
	// the picker closes. `LocationChooser` only surfaces the place label through
	// its `onSubmit(geohash, label)` callback, so this is where we capture it.
	let lastPick = $state<{ geohash: string; label: string | null } | null>(null);

	let pinPos: { lat: number; lon: number } | undefined = $state();
	let geoMapPickerOpen = $state(false);

	function onSubmit(geohash: string, label?: string | null) {
		try {
			setExploreLocation({ geohash, label: label ?? null });
			lastPick = { geohash, label: label ?? null };
			geoMapPickerOpen = false;
			onUpdate?.();
		} catch (error) {
			console.error(error);
			toast.error("Failed to set explore location");
		}
	}

	function applyBrowseFromHere(pick: { geohash: string; label: string | null }) {
		lastPick = null;
		void browseFromHere(pick.geohash, pick.label);
	}

	/**
	 * Browse the picked area by moving our own nearby reference point there.
	 * Not the `exploreGeoHash` param, so it is not paywalled. Clears any explore
	 * override first, otherwise the grid would still centre on the old remote
	 * area and this would look like it did nothing.
	 */
	async function browseFromHere(geohash: string, label?: string | null) {
		try {
			clearExploreLocation();
			await setPreferences({ geohash });
			geoMapPickerOpen = false;
			onUpdate?.();
			toast.success(
				label ? `Browsing near ${label}.` : "Browsing from the selected area.",
			);
		} catch (error) {
			console.error(error);
			toast.error("Failed to set location");
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

	// The chooser's imperative `centerAt` handle. Structural type rather than
	// `InstanceType<typeof LocationChooser>` (which does not surface the
	// component's `export function` members) or a bare `LocationChooser` (which
	// widens to `any`). Undefined until the chooser mounts, hence the `?.`.
	let locationChooser = $state<
		{ centerAt: (pos: { lat: number; lon: number }) => void } | undefined
	>();

	$effect(() => {
		if (geoMapPickerOpen && pinPos) locationChooser?.centerAt(pinPos);
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
	onSubmit={onSubmit}
	bind:open={geoMapPickerOpen}
	bind:this={locationChooser}
	bind:pinPos
/>

<!--
	Alternative route to the same place. Exploring uses the `exploreGeoHash`
	cascade param, which Grindr gates behind a paid tier (the server answers
	CAS-4001 and the grid shows the reset prompt). "Browse from here" instead
	moves our OWN nearby reference point, which is not tiered, so a free
	account can still browse an area it picked. Offered right after a pick,
	with an explicit dismiss so it never nags.
-->
{#if lastPick}
	<div
		class="flex items-center gap-2 px-1 pt-1.5 text-xs text-muted-foreground"
	>
		<span class="min-w-0 truncate">
			{lastPick.label ?? lastPick.geohash}
		</span>
		<button
			type="button"
			class="shrink-0 px-2 py-1 rounded-full border border-border bg-secondary text-secondary-foreground font-medium"
			onclick={() => {
				if (lastPick) applyBrowseFromHere(lastPick);
			}}
		>
			Browse from here
		</button>
		<button
			type="button"
			aria-label="Dismiss"
			class="shrink-0 size-5 rounded-full border border-border"
			onclick={() => (lastPick = null)}
		>
			×
		</button>
	</div>
{/if}
