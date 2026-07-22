<script lang="ts">
	import { MapPinIcon } from "phosphor-svelte";

	import type { LocationMessage } from "$lib/model/message";
	import { MessageMediaState } from "./message-media.svelte";

	let { message }: { message: LocationMessage["body"] } = $props();

	const media = new MessageMediaState();

	// Static OSM tile preview: no live map instance per bubble (a chat with many
	// shared locations would otherwise mount one Leaflet map per message — the
	// same class of WebView-freeze bug fixed for the image grid). A single raster
	// tile is a plain <img>, same cost as any other thumbnail.
	const ZOOM = 15;
	const TILE_SIZE = 256;

	function project(lat: number, lon: number) {
		const clampedLat = Math.max(Math.min(lat, 85.05112878), -85.05112878);
		const latRad = (clampedLat * Math.PI) / 180;
		const n = 2 ** ZOOM;
		const x = ((lon + 180) / 360) * n;
		const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
		return { x, y };
	}

	const point = $derived(project(message.lat, message.lon));
	const tileX = $derived(Math.floor(point.x));
	const tileY = $derived(Math.floor(point.y));
	// Pin position as a percentage of the tile so it stays correctly placed
	// however the tile image ends up scaled by CSS.
	const pinLeftPct = $derived((point.x - tileX) * 100);
	const pinTopPct = $derived((point.y - tileY) * 100);
	const tileUrl = $derived(`https://tile.openstreetmap.org/${ZOOM}/${tileX}/${tileY}.png`);
	const mapsUrl = $derived(
		`https://www.google.com/maps?q=${message.lat},${message.lon}`,
	);

	async function openInMaps() {
		try {
			const { openUrl } = await import("@tauri-apps/plugin-opener");
			await openUrl(mapsUrl);
		} catch (error) {
			console.error("[GrindrX] failed to open location in maps:", error);
		}
	}
</script>

<button
	type="button"
	class={[
		"relative block aspect-4/3 overflow-hidden bg-card-foreground/10 cursor-pointer",
		{
			"w-2/5 min-w-35 max-w-60 ms-3": !media.clone,
			"size-full": media.clone,
		},
		media.cornerClass,
	]}
	style="border-radius: 12px"
	onclick={openInMaps}
	bind:this={media.el}
>
	<img
		src={tileUrl}
		alt="Shared location"
		class="absolute inset-0 size-full object-cover"
		draggable="false"
		loading="lazy"
	/>
	<MapPinIcon
		weight="fill"
		class="absolute size-8 text-red-500 drop-shadow-md -translate-x-1/2 -translate-y-full"
		style="left: {pinLeftPct}%; top: {pinTopPct}%"
	/>
	<div class="absolute inset-x-0 bottom-0 bg-black/55 text-white text-xs font-medium py-1 text-center">
		View location
	</div>
	{@render media.adornments?.()}
</button>
