// Reactive half of the app-lock → backend push (E0b). Split from
// `./app-lock-gate.ts` because a lock/unlock transition can only be OBSERVED
// through a rune (`$effect`) reading `$lib/app-data/app-lock.svelte`'s `$state`,
// and the Svelte compiler only processes runes in `.svelte` / `.svelte.ts`
// modules. `hooks.client.ts` is a plain `.ts` file, so the subscription cannot
// live there — and putting the `invoke` in a rune module would make it
// untestable without a component harness. The invoke itself therefore stays in
// `app-lock-gate.ts` (plain TS, mockable) and only the watcher lives here.

import { pushAppLockState } from "$lib/api/app-lock-gate";
import { isLocked } from "$lib/app-data/app-lock.svelte";

export { pushAppLockState, syncAppLockToBackend } from "$lib/api/app-lock-gate";

let cleanup: (() => void) | null = null;

/**
 * Start mirroring the app-lock state into `AppState::locked`, pushing the
 * CURRENT value once immediately and again on every transition.
 *
 * Idempotent: calling it twice does not create two effects (and so does not
 * double-invoke on every transition). Returns a stop function; `hooks.client`
 * never calls it because the WebView lives for the process lifetime, but
 * `stopAppLockGateSync()` is exported for tests and for symmetry with
 * `ws.dispose()`.
 */
export function startAppLockGateSync(): () => void {
	if (cleanup) return cleanup;

	cleanup = $effect.root(() => {
		// `isLocked()` is read SYNCHRONOUSLY, here in the effect body, and the
		// value is handed to `pushAppLockState`. That read is what registers the
		// dependency: `isLocked` closes over `pinEnabled`, `biometric` and
		// `locked`, so enabling/disabling a gate, a re-lock, and an unlock all
		// re-run this effect. The first run IS the app-start push.
		//
		// It must not be `await syncAppLockToBackend()`: the `await` on the
		// dynamic import would move the `isLocked()` read out of the effect's
		// tracked context, and the subscription would then fire exactly once.
		$effect(() => {
			void pushAppLockState(isLocked());
		});
		return () => {
			cleanup = null;
		};
	});

	return stopAppLockGateSync;
}

/** Stop mirroring. Safe to call when never started. */
export function stopAppLockGateSync(): void {
	const stop = cleanup;
	cleanup = null;
	stop?.();
}
