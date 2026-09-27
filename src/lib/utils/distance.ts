const STORAGE_KEY = "pref:distanceUnit";
const METERS_PER_MILE = 1609.344;
const FEET = 5280;
/** ~161 m (0.1 mi): below this the imperial branch reports feet, not "0.0 mi". */
const FEET_CUTOFF_METERS = METERS_PER_MILE * 0.1;

export type DistanceUnit = "km" | "mi";

/**
 * RAW, NON-REACTIVE localStorage accessor.
 *
 * This is the persistence primitive, NOT the app's source of truth for the
 * current unit: every component must import `getDistanceUnit` from
 * `$lib/app-data/distance-unit.svelte` instead, which is `$state`-backed and
 * therefore reactive. Same for `setDistanceUnit` below.
 *
 * Both are kept (rather than inlined into the reactive store) because that
 * module is the only thing that may touch localStorage for this setting — it
 * also gates writes on `browser`, which is what makes the store SSR-safe. Read
 * `distance-unit.svelte.ts` before changing anything here.
 */
export function getDistanceUnit(): DistanceUnit {
	if (typeof localStorage === "undefined") return "km";
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored === "mi" ? "mi" : "km";
}

/**
 * RAW, NON-REACTIVE localStorage writer. See {@link getDistanceUnit}: use the
 * reactive `setDistanceUnit` in `$lib/app-data/distance-unit.svelte` from UI.
 */
export function setDistanceUnit(unit: DistanceUnit): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(STORAGE_KEY, unit);
}

/**
 * Format a distance in meters according to the given unit preference.
 * Pass `unit` explicitly (from the reactive `getDistanceUnit()` in
 * `$lib/app-data/distance-unit.svelte`) so Svelte templates can track
 * reactivity.
 *
 * SUB-KILOMETRE HANDLING (the bug this fixes)
 * --------------------------------------------
 * The metric branch switched to whole metres below 1000 m, but the imperial
 * branch went straight to `miles.toFixed(1)`. Every profile within ~150 m
 * therefore read "30 m" in metric and "0.0 mi" in imperial — the same distance,
 * two different-looking answers, one of them a lie (it looked like a distance
 * and rounded to nothing). The imperial branch now mirrors the metric one: below
 * 0.1 mi it reports whole FEET, the imperial counterpart of the metric
 * branch's metres.
 */
export function formatDistance(meters: number, unit: DistanceUnit): string {
	if (unit === "mi") {
		const miles = meters / METERS_PER_MILE;
		// 0.1 mi == 160.9 m. Below that, one decimal of a mile is coarser than the
		// metric branch's 1 m resolution, so fall back to feet.
		if (meters < FEET_CUTOFF_METERS) {
			const feet = Math.round((meters * FEET) / METERS_PER_MILE);
			return `${feet} ft`;
		}
		return `${miles.toFixed(1)} mi`;
	}
	// km mode
	if (meters < 1000) {
		return `${Math.round(meters)} m`;
	}
	return `${(meters / 1000).toFixed(1)} km`;
}
