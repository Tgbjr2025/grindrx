// "Explore other areas" — a browsing-location override.
//
// Normally the grid is centred on the device's location (`preferences.geohash`,
// kept fresh from GPS). When the user opens Explore and picks a remote place,
// we store that choice here instead of overwriting the device location. The
// grid/map prefer this override when it is set, so the real GPS location is
// never lost and a single tap restores it.
//
// Persisted in localStorage so the chosen area survives reloads, matching the
// pattern used by `distance-unit.svelte.ts`.

import { browser } from "$app/environment";
import z from "zod";

import { geohashSchema } from "$lib/model/geohash";

const STORAGE_KEY = "grindrx-explore-location";

const exploreLocationSchema = z.object({
	geohash: geohashSchema,
	/** Human-readable label for the indicator, e.g. a place name. */
	label: z.string().nullable().default(null),
});

export type ExploreLocation = z.infer<typeof exploreLocationSchema>;

function read(): ExploreLocation | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = exploreLocationSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

let exploreLocation = $state<ExploreLocation | null>(read());

/** The active explore-location override, or `null` when browsing real location. */
export function getExploreLocation(): ExploreLocation | null {
	return exploreLocation;
}

/** True when the grid is currently centred on a remote (non-device) area. */
export function isExploring(): boolean {
	return exploreLocation !== null;
}

/** Set (or replace) the explore override and persist it. */
export function setExploreLocation(value: {
	geohash: string;
	label?: string | null;
}): void {
	const next = exploreLocationSchema.parse({
		geohash: value.geohash,
		label: value.label ?? null,
	});
	exploreLocation = next;
	if (browser) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch (err) {
			console.error("[GrindrX] Failed to persist explore location:", err);
		}
	}
}

/** Clear the override — return to the device's real location. */
export function clearExploreLocation(): void {
	exploreLocation = null;
	if (browser) {
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch (err) {
			console.error("[GrindrX] Failed to clear explore location:", err);
		}
	}
}
