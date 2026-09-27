<script lang="ts">
	import { CompassIcon } from "phosphor-svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import {
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import LocationChooser from "$lib/components/location-chooser/LocationChooser.svelte";
	import { Button } from "$lib/components/ui/button";
	import { decodeGeohash } from "$lib/model/geohash";
	import {
		clearExploreLocation,
		getExploreLocation,
		setExploreLocation,
	} from "$lib/stores/explore-location.svelte";
	import { setGeohashPinned } from "./grid";

	let {
		onUpdate,
		class: className,
		expansion,
		lastPick = $bindable(null),
		onBrowseFromHere,
	}: {
		onUpdate?: () => void;
		class?: import("svelte/elements").ClassValue;
		expansion: number;
		/**
		 * The most recent pick, OWNED BY THE PARENT (`TopBar`).
		 *
		 * This used to be local state here. Three `LocationChange` instances are
		 * alive at once (expanded / in-flight / collapsed), each with its own copy,
		 * so picking a place in one left the others blank — and collapsing the bar
		 * swapped which instance was on screen, so the "Browse from here"
		 * affordance (the only untiered way to browse a chosen area) vanished. It
		 * is bindable so the parent owns the single source of truth.
		 */
		lastPick?: { geohash: string; label: string | null } | null;
		/** Called after the user accepts "Browse from here", so the parent can clear. */
		onBrowseFromHere?: () => void;
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

	function applyBrowseFromHere(pick: {
		geohash: string;
		label: string | null;
	}) {
		onBrowseFromHere?.();
		void browseFromHere(pick.geohash, pick.label);
	}

	/**
	 * Browse the picked area by moving our own nearby reference point there.
	 * Not the `exploreGeoHash` param, so it is not paywalled. Clears any explore
	 * override first, otherwise the grid would still centre on the old remote
	 * area and this would look like it did nothing.
	 *
	 * `setGeohashPinned(true)` is what makes the choice survive a relaunch. The
	 * geohash goes into the SAME `preferences.geohash` slot the GPS updater
	 * writes, so without the flag the next cold start compared a real GPS fix
	 * against this remote hash, found them >1 km apart, and overwrote it — the
	 * chosen area silently reverting to the device's location. See `isGeohashPinned`.
	 */
	async function browseFromHere(geohash: string, label?: string | null) {
		try {
			clearExploreLocation();
			setGeohashPinned(true);
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
	style="width: max(44px, calc(44px + (100% - 44px) * {expansion}))"
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
