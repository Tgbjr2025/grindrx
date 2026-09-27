<script lang="ts">
	import {
		checkPermissions,
		getCurrentPosition,
		requestPermissions,
	} from "@tauri-apps/plugin-geolocation";
	import { platform } from "@tauri-apps/plugin-os";
	import GpsFixIcon from "phosphor-svelte/lib/GpsFixIcon";
	import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";
	import NavigationArrowIcon from "phosphor-svelte/lib/NavigationArrowIcon";
	import { toast } from "svelte-sonner";

	import { setPreferences } from "$lib/app-data/preferences.svelte";
	import LocationChooser from "$lib/components/location-chooser/LocationChooser.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { encodeGeohash } from "$lib/model/geohash";
	import { setGeohashPinned } from "./grid";

	let {
		onUpdate,
	}: {
		onUpdate?: () => void;
	} = $props();

	let geoMapPickerOpen = $state(false);

	const geoApiSupported = $derived(["android", "ios"].includes(platform()));
	let disabled = $state(false);

	async function handleDetectLocation() {
		disabled = true;
		try {
			// A single try/catch/finally with no `catch` meant any rejection here —
			// `checkPermissions`, `requestPermissions`, even a bridge failure —
			// escaped as an UNHANDLED REJECTION. The button simply stopped working
			// with nothing on screen to explain why, and `disabled` was reset by the
			// `finally` so it looked tappable again.
			let permissions = await checkPermissions();
			if (
				permissions.location === "prompt" ||
				permissions.location === "prompt-with-rationale"
			) {
				permissions = await requestPermissions(["location"]);
			}
			if (permissions.location === "granted") {
				try {
					const {
						coords: { latitude, longitude },
					} = await getCurrentPosition();

					await submitGeohash(encodeGeohash(latitude, longitude), {
						pinned: false,
					});
				} catch (e) {
					console.error(e);
					toast.error("Failed to get current location");
				}
			} else {
				toast.error(
					"Location permission denied. Change this in your system settings to use this button.",
				);
			}
		} catch (error) {
			console.error("Failed to detect location", error);
			toast.error("Couldn't check your location permission. Please try again.");
		} finally {
			disabled = false;
		}
	}

	/**
	 * Persist a chosen location.
	 *
	 * `pinned` distinguishes a real GPS fix from a hand-picked spot on the map.
	 * A fix supersedes a previous "Browse from here" pin and must clear the flag,
	 * or the GPS updater would keep refusing to refresh the real location.
	 */
	async function submitGeohash(
		geohash: string,
		opts: { pinned?: boolean } = {},
	) {
		try {
			setGeohashPinned(opts.pinned ?? true);
			await setPreferences({ geohash });
			geoMapPickerOpen = false;
			onUpdate?.();
		} catch (error) {
			console.error(error);
			toast.error("Failed to save location");
		}
	}
</script>

<Empty.Root class="max-md:p-6">
	<Empty.Header>
		<Empty.Media variant="icon">
			<NavigationArrowIcon weight="fill" color="var(--primary)" />
		</Empty.Media>
		<Empty.Title>Choose location</Empty.Title>
		<Empty.Description>
			Pick location on the map or select from the list to find nearby profiles.
		</Empty.Description>
	</Empty.Header>
	<Empty.Content>
		<div class="flex flex-wrap justify-center gap-2">
			{#if geoApiSupported}
				<Button variant="default" onclick={handleDetectLocation} {disabled}>
					<GpsFixIcon color="currentColor" weight="fill" />
					Use current location
				</Button>
			{/if}
			<Button
				variant={geoApiSupported ? "outline" : "default"}
				onclick={() => (geoMapPickerOpen = true)}
			>
				<MagnifyingGlassIcon color="currentColor" weight="fill" />
				Pick manually
			</Button>
		</div>
	</Empty.Content>
	<!-- <Button variant="link" class="text-muted-foreground" size="sm">
		<a href="#/">
			Learn More <ArrowUpRightIcon class="inline" />
		</a>
	</Button> -->
</Empty.Root>
<LocationChooser
	onSubmit={(geohash: string) => submitGeohash(geohash, { pinned: true })}
	bind:open={geoMapPickerOpen}
/>
