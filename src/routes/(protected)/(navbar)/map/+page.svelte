<script lang="ts">
	import "leaflet/dist/leaflet.css";
	import { onMount, onDestroy } from "svelte";
	import { goto } from "$app/navigation";
	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import { decodeGeohash } from "$lib/model/geohash";
	import { getExploreLocation } from "$lib/stores/explore-location.svelte";
	import { gridState } from "../(root)/grid-state.svelte";
	import { profileCache, resolvePartialBatch } from "../(root)/grid";
	import type { FullGridProfile } from "../(root)/grid.ts";
	import * as Empty from "$lib/components/ui/empty";
	import MapPinIcon from "phosphor-svelte/lib/MapPinIcon";

	const preferences = getPreferences();

	let mapEl: HTMLDivElement | null = $state(null);
	let map: import("leaflet").Map | null = null;
	let L: typeof import("leaflet") | null = null;
	let markersLayer: import("leaflet").LayerGroup | null = null;
	let centerLatLon: { lat: number; lon: number } | null = null;

	// Stable bearing per profile id so markers don't jump on re-render
	const bearingCache = new Map<number, number>();
	function getBearing(id: number): number {
		if (!bearingCache.has(id)) {
			bearingCache.set(id, Math.random() * 2 * Math.PI);
		}
		return bearingCache.get(id)!;
	}

	function offsetCoord(
		lat: number,
		lon: number,
		distanceMetres: number,
		bearingRad: number,
	): [number, number] {
		const R = 6_371_000;
		const d = distanceMetres / R;
		const lat1 = (lat * Math.PI) / 180;
		const lon1 = (lon * Math.PI) / 180;
		const lat2 = Math.asin(
			Math.sin(lat1) * Math.cos(d) +
				Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad),
		);
		const lon2 =
			lon1 +
			Math.atan2(
				Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1),
				Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
			);
		return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
	}

	function makeAvatarIcon(hash: string | null, name: string | null) {
		const initials = (name ?? "?")
			.split(" ")
			.map((w) => w[0] ?? "")
			.join("")
			.slice(0, 2)
			.toUpperCase();

		const imgHtml = hash
			? `<img src="https://cdns.grindr.com/images/thumb/320x320/${hash}" alt="" />`
			: `<span>${initials}</span>`;

		return L!.divIcon({
			className: "",
			html: `<div class="map-avatar">${imgHtml}</div>`,
			iconSize: [44, 44],
			iconAnchor: [22, 22],
			popupAnchor: [0, -22],
		});
	}

	function renderMarkers(centerLat: number, centerLon: number) {
		if (!map || !L || !markersLayer) return;
		markersLayer.clearLayers();

		const fullProfiles = gridState.items.filter(
			(p): p is FullGridProfile => p.type === "full" && p.distance !== null,
		);

		for (const profile of fullProfiles) {
			const bearing = getBearing(profile.id);
			const dist = Math.max(profile.distance!, 30); // min 30m so not on top of you
			const [lat, lon] = offsetCoord(centerLat, centerLon, dist, bearing);
			const icon = makeAvatarIcon(
				profile.profilePhotosHashes?.[0] ?? null,
				profile.displayName,
			);
			const marker = L.marker([lat, lon], { icon });
			marker.on("click", () => {
				goto(`/profile/${profile.id}`).catch((err) => console.error(err));
			});
			const label = profile.displayName ?? "Profile";
			const distLabel =
				dist >= 1000
					? `${(dist / 1000).toFixed(1)} km`
					: `${Math.round(dist)} m`;
			marker.bindTooltip(`${label} · ${distLabel}`, {
				direction: "top",
				offset: [0, -24],
				className: "map-tooltip",
			});
			markersLayer.addLayer(marker);
		}
	}

	function addDistanceRings(
		centerLat: number,
		centerLon: number,
		rings: number[],
	) {
		if (!map || !L) return;
		for (const r of rings) {
			L.circle([centerLat, centerLon], {
				radius: r,
				color: "rgba(255,255,255,0.12)",
				fillColor: "transparent",
				weight: 1,
				interactive: false,
			}).addTo(map);

			const labelLatLon = offsetCoord(centerLat, centerLon, r, 0);
			L.marker(labelLatLon, {
				icon: L.divIcon({
					className: "",
					html: `<span class="ring-label">${r >= 1000 ? `${r / 1000} km` : `${r} m`}</span>`,
					iconAnchor: [20, 8],
				}),
				interactive: false,
			}).addTo(map);
		}
	}

	function addSelfMarker(lat: number, lon: number) {
		if (!map || !L) return;
		L.circleMarker([lat, lon], {
			radius: 7,
			color: "#fff",
			fillColor: "hsl(var(--accent))",
			fillOpacity: 1,
			weight: 2,
			interactive: false,
		})
			.bindTooltip("You", { permanent: false, direction: "top" })
			.addTo(map);
	}

	onMount(async () => {
		const prefs = await preferences;
		// Mirror the grid: when exploring a remote area, centre the map there too.
		const geohash = getExploreLocation()?.geohash ?? prefs.geohash;
		if (!geohash || !mapEl) return;

		const { lat, lon } = decodeGeohash(geohash);

		L = await import("leaflet");
		// Fix default icon paths broken by bundlers
		// @ts-expect-error leaflet internal
		delete L.Icon.Default.prototype._getIconUrl;
		L.Icon.Default.mergeOptions({
			iconRetinaUrl: new URL(
				"leaflet/dist/images/marker-icon-2x.png",
				import.meta.url,
			).href,
			iconUrl: new URL(
				"leaflet/dist/images/marker-icon.png",
				import.meta.url,
			).href,
			shadowUrl: new URL(
				"leaflet/dist/images/marker-shadow.png",
				import.meta.url,
			).href,
		});

		map = L.map(mapEl, {
			center: [lat, lon],
			zoom: 14,
			zoomControl: false,
			attributionControl: false,
		});

		L.tileLayer(
			"https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
			{ maxZoom: 19 },
		).addTo(map);

		L.control.zoom({ position: "topright" }).addTo(map);
		L.control.attribution({ position: "bottomright", prefix: false })
			.addAttribution('&copy; <a href="https://carto.com/">CARTO</a>')
			.addTo(map);

		addDistanceRings(lat, lon, [250, 500, 1000, 2000]);
		addSelfMarker(lat, lon);

		markersLayer = L.layerGroup().addTo(map);
		centerLatLon = { lat, lon };
		renderMarkers(lat, lon);

		// Resolve any partial profiles so they appear on the map
		const partialIds = gridState.items
			.filter((p) => p.type === "partial")
			.map((p) => p.id);
		if (partialIds.length > 0) {
			resolvePartialBatch(partialIds)
				.then((resolved) => {
					for (const profile of resolved) {
						profileCache.set(profile.id, profile);
						const idx = gridState.items.findIndex((i) => i.id === profile.id);
						if (idx !== -1) gridState.items[idx] = profile;
					}
				})
				.catch((err) => console.error("Map partial resolution failed", err));
		}
	});

	$effect(() => {
		void gridState.items;
		if (centerLatLon) renderMarkers(centerLatLon.lat, centerLatLon.lon);
	});

	onDestroy(() => {
		map?.remove();
		map = null;
	});

	const hasLocation = $derived(
		preferences.then((p) => !!(getExploreLocation()?.geohash ?? p.geohash)),
	);

	const profileCount = $derived(
		gridState.items.filter((p): p is FullGridProfile => p.type === "full").length,
	);
</script>

{#await hasLocation then ok}
	{#if !ok}
		<Empty.Root class="flex-1">
			<Empty.Header>
				<Empty.Media variant="icon">
					<MapPinIcon weight="fill" />
				</Empty.Media>
				<Empty.Title>Location required</Empty.Title>
				<Empty.Description>
					Set your location on the Browse tab first.
				</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{:else}
		<div class="relative flex-1 min-h-0">
			<div bind:this={mapEl} class="absolute inset-0"></div>
			{#if profileCount > 0}
				<div class="map-count">
					{profileCount} nearby
				</div>
			{/if}
		</div>
	{/if}
{/await}

<style>
	:global(.map-avatar) {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 2px solid hsl(var(--accent));
		overflow: hidden;
		background: hsl(var(--muted));
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
		transition: transform 0.15s;
	}
	:global(.map-avatar:hover) {
		transform: scale(1.12);
	}
	:global(.map-avatar img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	:global(.map-avatar span) {
		font-size: 13px;
		font-weight: 700;
		color: hsl(var(--foreground));
	}
	:global(.map-tooltip) {
		background: rgba(0, 0, 0, 0.85) !important;
		border: 1px solid rgba(255, 255, 255, 0.1) !important;
		color: #fff !important;
		border-radius: 8px !important;
		font-size: 12px !important;
		padding: 4px 8px !important;
		box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important;
		white-space: nowrap;
	}
	:global(.map-tooltip::before) {
		display: none !important;
	}
	:global(.ring-label) {
		font-size: 10px;
		color: rgba(255, 255, 255, 0.35);
		white-space: nowrap;
		pointer-events: none;
	}
	:global(.leaflet-container) {
		background: #1a1a2e;
	}
	.map-count {
		position: absolute;
		top: 12px;
		left: 12px;
		z-index: 1000;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(8px);
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 9999px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		pointer-events: none;
	}
</style>
