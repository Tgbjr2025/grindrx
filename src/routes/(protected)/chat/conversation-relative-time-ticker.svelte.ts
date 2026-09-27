// One shared 30-second ticker for the inbox's relative timestamps.
//
// `ConversationRelativeTimeDynamic.svelte` used to run its own `setInterval` per
// row (its cleanup was correct, but 100 rows meant 100 live timers all firing
// within the same 30s window, each re-running `formatTimeRelativeCustom` and
// re-rendering). This module holds the single timer and the single reactive
// "now", and hands out a reference-counted subscription.
//
// The `formatRelativeTime` wrapper is what components should use: the bare
// `relativeTimeNow()` read inside it is a tracked read, so calling it from a
// `$derived` (or any reactive context) re-runs the derivation when the shared
// tick advances. Calling it from a non-reactive context just formats once.

import { formatTimeRelativeCustom } from "$lib/utils";

/** Reactive "now". Bumped by the shared interval. */
let now = $state(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

/** How often the shared tick fires. Matches the previous per-row interval. */
export const RELATIVE_TIME_TICK_MS = 30_000;

function start() {
	if (timer !== null) return;
	timer = setInterval(() => {
		now = Date.now();
	}, RELATIVE_TIME_TICK_MS);
}

function stop() {
	if (timer === null) return;
	clearInterval(timer);
	timer = null;
}

/**
 * Register one consumer. Returns the release function, which the caller must run
 * on teardown (a component `$effect` teardown, or `onDestroy`).
 */
export function acquireRelativeTimeTicker(): () => void {
	start();
	refCount++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		refCount--;
		if (refCount <= 0) {
			refCount = 0;
			stop();
		}
	};
}

/** The shared "now". Reactive; read it to depend on the tick. */
export function relativeTimeNow(): number {
	return now;
}

/** `formatTimeRelativeCustom`, recomputed on every shared tick. */
export function formatRelativeTime(date: number): string {
	void relativeTimeNow();
	return formatTimeRelativeCustom(date);
}
