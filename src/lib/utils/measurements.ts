import type { DistanceUnit } from "$lib/utils/distance";

/**
 * The app exposes a single measurement-system toggle, persisted as the
 * distance unit (`km` / `mi`). The whole app derives metric vs. imperial
 * from that one choice:
 *   - `km` ⇒ metric  (height in cm, weight in kg)
 *   - `mi` ⇒ imperial (height in ft/in, weight in lbs)
 *
 * Keeping the distance unit as the single source of truth means there is no
 * second competing setting and the persisted values stay backwards
 * compatible.
 */
export type MeasurementSystem = "metric" | "imperial";

export function measurementSystemFor(unit: DistanceUnit): MeasurementSystem {
	return unit === "mi" ? "imperial" : "metric";
}

const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;
// The live Grindr API stores `weight` in grams (e.g. 86182.65 ≈ 86.18 kg).
const GRAMS_PER_KG = 1000;
const POUNDS_PER_KG = 2.2046226218;

/**
 * Format a height (stored in centimeters) for display.
 *
 * @param cm     height in centimeters (as provided by the API / profile model)
 * @param unit   the active distance unit (drives metric vs. imperial)
 */
export function formatHeight(cm: number, unit: DistanceUnit): string {
	if (measurementSystemFor(unit) === "imperial") {
		const totalInches = Math.round(cm / CM_PER_INCH);
		const feet = Math.floor(totalInches / INCHES_PER_FOOT);
		const inches = totalInches % INCHES_PER_FOOT;
		return `${feet}'${inches}"`;
	}
	return `${Math.round(cm)} cm`;
}

/**
 * Format a weight (stored in grams) for display.
 *
 * @param grams  weight in grams (raw API value, e.g. 86182.65)
 * @param unit   the active distance unit (drives metric vs. imperial)
 */
export function formatWeight(grams: number, unit: DistanceUnit): string {
	const kg = grams / GRAMS_PER_KG;
	if (measurementSystemFor(unit) === "imperial") {
		return `${Math.round(kg * POUNDS_PER_KG)} lbs`;
	}
	return `${Math.round(kg)} kg`;
}

/* ------------------------------------------------------------------ *
 * Helpers for editable inputs (EditProfileSheet).
 *
 * The form lets the user type a value in whichever system is active, so we
 * need to convert the raw storage units (cm / grams) to/from the display
 * units and back again on save.
 * ------------------------------------------------------------------ */

export function heightUnitLabel(unit: DistanceUnit): string {
	return measurementSystemFor(unit) === "imperial" ? "in" : "cm";
}

export function weightUnitLabel(unit: DistanceUnit): string {
	return measurementSystemFor(unit) === "imperial" ? "lbs" : "kg";
}

/** Convert stored height (cm) into the editable display number. */
export function heightToInput(cm: number, unit: DistanceUnit): number {
	if (measurementSystemFor(unit) === "imperial") {
		return Math.round(cm / CM_PER_INCH);
	}
	return Math.round(cm);
}

/** Convert an edited height value back into stored centimeters. */
export function heightFromInput(value: number, unit: DistanceUnit): number {
	if (measurementSystemFor(unit) === "imperial") {
		return Math.round(value * CM_PER_INCH);
	}
	return value;
}

/** Convert stored weight (grams) into the editable display number. */
export function weightToInput(grams: number, unit: DistanceUnit): number {
	const kg = grams / GRAMS_PER_KG;
	if (measurementSystemFor(unit) === "imperial") {
		return Math.round(kg * POUNDS_PER_KG);
	}
	return Math.round(kg);
}

/** Convert an edited weight value back into stored grams. */
export function weightFromInput(value: number, unit: DistanceUnit): number {
	if (measurementSystemFor(unit) === "imperial") {
		const kg = value / POUNDS_PER_KG;
		return Math.round(kg * GRAMS_PER_KG);
	}
	return value * GRAMS_PER_KG;
}
