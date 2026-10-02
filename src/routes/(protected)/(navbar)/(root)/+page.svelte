<script lang="ts">
	import {
		checkPermissions,
		getCurrentPosition,
		requestPermissions,
	} from "@tauri-apps/plugin-geolocation";
	import { platform } from "@tauri-apps/plugin-os";
	import {
		ArrowCounterClockwiseIcon,
		CompassIcon,
		EyeSlashIcon,
	} from "phosphor-svelte";
	import { onMount } from "svelte";

	import {
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import { encodeGeohash } from "$lib/model/geohash";
	import {
		clearExploreLocation,
		getExploreLocation,
	} from "$lib/stores/explore-location.svelte";
	import { isGeohashPinned, setGeohashPinned } from "./grid";
	import { gridState } from "./grid-state.svelte";
	import Grid from "./Grid.svelte";
	import LocationChooser from "./LocationEmpty.svelte";
	import TopBar from "./top-bar/TopBar.svelte";

	let preferences = $state(getPreferences());

	// Explore override: when set, the grid browses this remote area instead of
	// the device's GPS location. Kept separate so resetting restores GPS.
	const explore = $derived(getExploreLocation());

	onMount(async () => {
		// A first-run user is never asked for location on this route, so the
		// "Use current location" button on the empty state is the only way to get
		// it — and by then they have already been dropped onto a map with no
		// indication that permission was the missing step. Ask on mount, while
		// this is the screen the user is looking at. Best-effort: a denial is
		// handled by the map-picker path, and must never block the grid.
		if (["android", "ios"].includes(platform())) {
			try {
				const perms = await checkPermissions();
				if (
					perms.location === "prompt" ||
					perms.location === "prompt-with-rationale"
				) {
					await requestPermissions(["location"]);
				}
			} catch (error) {
				console.error("Failed to request location permission", error);
			}
		}

		const prefs = await preferences;
		if (!prefs.geohash) return;
		// Don't chase GPS while the user is intentionally browsing a remote area.
		if (getExploreLocation()) return;
		// D17: the same is true of a "Browse from here" location, which writes a
		// hand-picked geohash into the SAME `preferences.geohash` slot this
		// updater writes. The old early return only covered the explore override
		// (which is cleared by that path), so on the next cold start a real GPS
		// fix compared against the remote hash, differed by >1 km, and overwrote
		// it — the chosen area silently reverting to the device's location, with
		// no error. The pin flag is what distinguishes the two.
		if (isGeohashPinned()) return;
		if (!["android", "ios"].includes(platform())) return;
		try {
			const perms = await checkPermissions();
			if (perms.location !== "granted") return;
			const {
				coords: { latitude, longitude },
			} = await getCurrentPosition();
			const newHash = encodeGeohash(latitude, longitude);
			// Only update if position changed by more than ~1 km (6-char geohash cell)
			//
			// The length check is load-bearing (2026-10-02). A hash stored by an
			// earlier build can be SHORTER than the one we now produce while
			// describing the same place, so `slice(0, 6)` is identical and the
			// movement test alone would never rewrite it. That is exactly the
			// stale 8-char value left on disk by `PERSISTED_PRECISION = 8`, which
			// the server rejects with HTTP 400 `urn:gr:err:geo_hash_decode` — so
			// without this the grid stays broken for every existing user even
			// after the encoder is fixed.
			if (
				newHash.length !== prefs.geohash.length ||
				newHash.slice(0, 6) !== prefs.geohash.slice(0, 6)
			) {
				await setPreferences({ geohash: newHash });
				// A real GPS fix supersedes any hand-picked pin, so clear it.
				setGeohashPinned(false);
				preferences = getPreferences();
			}
		} catch {
			// Best-effort — silently skip if location unavailable
		}
	});

	function resetToRealLocation() {
		clearExploreLocation();
		// A hand-picked "browse from here" location is also not the real
		// location, so un-pin it: the next GPS fix is then allowed to take over.
		setGeohashPinned(false);
		// Re-evaluate which geohash the grid should use.
		preferences = getPreferences();
	}
</script>

<svelte:head>
	<title>GrindrX</title>
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
						<span
							class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-800/80 border border-neutral-700/60 text-neutral-300 text-xs font-medium backdrop-blur-sm pointer-events-none"
						>
							<EyeSlashIcon class="size-3.5 shrink-0" />
							Incognito
						</span>
					{/if}
				</div>
			{/if}
			<Grid geohash={nearbyGeohash} {exploreGeohash} />
		</main>
	{/if}
{:catch error}
	<!--
		getPreferences() now degrades to defaults rather than rejecting, so this
		branch should be unreachable — but keep it as a hard backstop so a future
		rejection can never tear down the whole home route (the old behaviour that
		crashed the app on a filter/location change until relaunch).
	-->
	<main class="m-auto flex flex-col items-center gap-3 p-6 text-center">
		<p class="text-sm text-muted-foreground">
			Something went wrong loading your preferences.
		</p>
		<button
			type="button"
			class="px-3 py-1.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-sm font-medium"
			onclick={() => (preferences = getPreferences())}
		>
			Retry
		</button>
		{#if import.meta.env.DEV}
			<pre class="text-xs text-muted-foreground/70">{String(error)}</pre>
		{/if}
	</main>
{/await}
