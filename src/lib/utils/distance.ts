const STORAGE_KEY = "pref:distanceUnit";
const METERS_PER_MILE = 1609.344;

export type DistanceUnit = "km" | "mi";

export function getDistanceUnit(): DistanceUnit {
	if (typeof localStorage === "undefined") return "km";
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored === "mi" ? "mi" : "km";
}

export function setDistanceUnit(unit: DistanceUnit): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(STORAGE_KEY, unit);
}

/**
 * Format a distance in meters according to the given unit preference.
 * Pass `unit` explicitly (from the reactive `getDistanceUnit()` in
 * `$lib/app-data/distance-unit.svelte`) so Svelte templates can track
 * reactivity.
 */
export function formatDistance(meters: number, unit: DistanceUnit): string {
	if (unit === "mi") {
		const miles = meters / METERS_PER_MILE;
		return `${miles.toFixed(1)} mi`;
	}
	// km mode
	if (meters < 1000) {
		return `${Math.round(meters)} m`;
	}
	return `${(meters / 1000).toFixed(1)} km`;
}
