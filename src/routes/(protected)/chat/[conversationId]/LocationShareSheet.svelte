<script lang="ts">
	import {
		checkPermissions,
		getCurrentPosition,
		requestPermissions,
	} from "@tauri-apps/plugin-geolocation";
	import { platform as getPlatform } from "@tauri-apps/plugin-os";
	import { CrosshairIcon, MapPinIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import LocationChooser from "$lib/components/location-chooser/LocationChooser.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Sheet from "$lib/components/ui/sheet";
	import { decodeGeohash, encodeGeohash } from "$lib/model/geohash";

	// Pick a point, then confirm before sending.
	//
	// Sharing a location is a genuine privacy disclosure — the recipient gets
	// exact coordinates they can save and act on — so this never sends on the
	// map tap alone. The confirm step shows the literal lat/lon that will be
	// transmitted rather than just the place name, so there is no ambiguity
	// about what is being shared.
	let {
		open = $bindable(),
		onSend,
	}: {
		open: boolean;
		onSend: (lat: number, lon: number, label: string | null) => void;
	} = $props();

	let pinPos = $state<{ lat: number; lon: number } | undefined>(undefined);
	let pinLabel = $state<string | null>(null);
	let pickerOpen = $state(false);
	let gpsBusy = $state(false);
	const geoSupported = ["android", "ios"].includes(getPlatform());

	function reset() {
		pinPos = undefined;
		pinLabel = null;
		pickerOpen = false;
	}

	function close() {
		open = false;
		reset();
	}

	function confirm() {
		if (!pinPos) return;
		onSend(pinPos.lat, pinPos.lon, pinLabel);
		close();
	}

	/** Pre-fill with the device's current position — the common "I'm here" case. */
	async function useMyLocation() {
		gpsBusy = true;
		try {
			let permissions = await checkPermissions();
			if (
				permissions.location === "prompt" ||
				permissions.location === "prompt-with-rationale"
			) {
				permissions = await requestPermissions(["location"]);
			}
			if (permissions.location !== "granted") {
				toast.error(
					"Location permission denied. Enable it in system settings to use this.",
				);
				return;
			}
			const pos = await getCurrentPosition();
			pinPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
			pinLabel = "My current location";
		} catch (e) {
			console.error(e);
			toast.error("Couldn't get your current location");
		} finally {
			gpsBusy = false;
		}
	}
</script>

<Sheet.Root
	bind:open
	onOpenChange={(next) => {
		// Clear a stale pin whenever the sheet is dismissed by swipe/back.
		if (!next) reset();
	}}
>
	<Sheet.Content
		side="bottom"
		showCloseButton={false}
		class="max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom))] mt-(--safe-area-top) mb-(--safe-area-bottom)"
	>
		<Sheet.Header class="px-4 pt-4">
			<Sheet.Title class="flex items-center gap-2">
				<MapPinIcon weight="fill" class="size-5" />
				Share a location
			</Sheet.Title>
			<Sheet.Description>
				Pick a spot on the map, or share where you are right now.
			</Sheet.Description>
		</Sheet.Header>

		<div class="px-4 pb-4 flex flex-col gap-3">
			<div class="flex flex-wrap gap-2">
				{#if geoSupported}
					<Button
						variant="outline"
						size="sm"
						disabled={gpsBusy}
						onclick={() => void useMyLocation()}
					>
						<CrosshairIcon weight="fill" class="size-4" />
						{gpsBusy ? "Locating…" : "Use my location"}
					</Button>
				{/if}
				<Button
					variant={pinPos ? "secondary" : "default"}
					size="sm"
					onclick={() => (pickerOpen = true)}
				>
					{pinPos ? "Change on map" : "Pick on map"}
				</Button>
			</div>

			{#if pinPos}
				<div class="rounded-xl border border-border bg-muted/40 p-3 flex flex-col gap-1">
					<span class="text-sm font-medium truncate">
						{pinLabel ?? "Selected point"}
					</span>
					<!-- Show the literal coordinates: this is what gets sent. -->
					<span class="text-xs text-muted-foreground font-mono select-text">
						{pinPos.lat.toFixed(5)}, {pinPos.lon.toFixed(5)}
					</span>
					<span class="text-xs text-muted-foreground">
						Geohash {encodeGeohash(pinPos.lat, pinPos.lon)}
					</span>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">
					No location chosen yet.
				</p>
			{/if}

			<div class="flex gap-2 justify-end">
				<Button variant="ghost" size="sm" onclick={close}>Cancel</Button>
				<Button size="sm" disabled={!pinPos} onclick={confirm}>
					Send location
				</Button>
			</div>
		</div>
	</Sheet.Content>
</Sheet.Root>

<!--
	The map picker is a full-screen drawer/dialog of its own, so it is mounted
	separately and its dismissal must not close the sheet underneath it.
-->
<LocationChooser
	bind:open={pickerOpen}
	onSubmit={(geohash: string, label?: string | null) => {
		pickerOpen = false;
		// Round-trip through the geohash so the coordinates we send are exactly
		// the ones the picker committed, not a re-derived float.
		const { lat, lon } = decodeGeohash(geohash);
		pinPos = { lat, lon };
		pinLabel = label ?? null;
	}}
/>
