// Onboarding state: decides when to show the first-run feature tour and the
// per-version "What's new" card. Backed by localStorage (per-install, per-device).

import { browser } from "$app/environment";

const SEEN_VERSION_KEY = "grindrx-last-seen-version";
const TOUR_DONE_KEY = "grindrx-tour-done";

function read(key: string): string | null {
	if (!browser) return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeKey(key: string, value: string): void {
	if (!browser) return;
	try {
		localStorage.setItem(key, value);
	} catch {
		// storage unavailable — onboarding just re-offers next time
	}
}

/** The very first time the app is opened (nothing ever recorded). */
export function isFirstRun(): boolean {
	return read(SEEN_VERSION_KEY) === null && read(TOUR_DONE_KEY) === null;
}

/** True when the running version hasn't shown its "What's new" yet. */
export function isNewVersion(current: string): boolean {
	const seen = read(SEEN_VERSION_KEY);
	return seen !== null && seen !== current;
}

/** Record that this version's "What's new" has been shown. */
export function markVersionSeen(current: string): void {
	writeKey(SEEN_VERSION_KEY, current);
}

export function isTourDone(): boolean {
	return read(TOUR_DONE_KEY) === "1";
}

export function markTourDone(): void {
	writeKey(TOUR_DONE_KEY, "1");
}
