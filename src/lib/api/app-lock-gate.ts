// Push the WebView's app-lock state into the Rust side (E0b).
//
// WHY THIS FILE HAS TO EXIST
// --------------------------
// `src-tauri/src/lib.rs` registers `set_app_locked(locked: bool)`, and
// `AppState::locked` is the ONLY thing the Rust WS notifier can read to decide
// whether a lock-screen notification may contain chat text
// (`src-tauri/src/state.rs`, `set_locked`). Nothing in the WebView called it:
// `grep -rn set_app_locked src/` returned nothing. `AppState::locked` therefore
// stayed at its `AtomicBool::new(false)` default for the whole process, so the
// entire "lock-screen notifications must not leak chat text" fix was INERT — a
// message arriving while the PIN screen was up was posted to the shade in full.
//
// The default is deliberately `false` (not fail-safe `true`) so a message
// arriving during startup cannot be silently suppressed; see the comment on
// `AppState { locked }` in `lib.rs`. That trade-off only holds if the WebView
// pushes the real value during init — which is this module's job.
//
// Deliberately kept free of Svelte runes so the invoke can be unit-tested with a
// plain `invoke` mock; the reactive subscription that calls it on every
// lock/unlock transition lives in `./app-lock-gate.svelte`.

import { invoke } from "@tauri-apps/api/core";

/**
 * Invoke `set_app_locked` with an explicit lock state.
 *
 * Never throws: a failed push is logged, not propagated, because every caller
 * (app start, the lock-state effect) has nothing useful to do about it and a
 * rejection here must not take down an unlock. The worst case of a dropped push
 * is the pre-existing one — a lock-screen notification that leaks a chat
 * preview, exactly as before this module existed — so it is logged loudly.
 *
 * Takes the value as an argument rather than reading it itself because the
 * reactive caller MUST read `isLocked()` synchronously, inside its `$effect`,
 * for Svelte to register the dependency. An `await` before the read puts it
 * outside the tracked context and the subscription silently stops firing.
 *
 * @returns whether the backend accepted the new value.
 */
export async function pushAppLockState(locked: boolean): Promise<boolean> {
	try {
		await invoke("set_app_locked", { locked });
		return true;
	} catch (error) {
		console.error(
			"[GrindrX] Failed to push app-lock state to the backend; lock-screen " +
				"notifications may show chat text until the next transition.",
			error,
		);
		return false;
	}
}

/**
 * Push whatever the CURRENT lock state is.
 *
 * This is the untracked entry point — correct for imperative callers (and for
 * tests) that are not inside a reactive context. The lock/unlock subscription
 * uses `pushAppLockState` directly; see `app-lock-gate.svelte.ts`.
 */
export async function syncAppLockToBackend(): Promise<boolean> {
	try {
		const { isLocked } = await import("$lib/app-data/app-lock.svelte");
		return await pushAppLockState(isLocked());
	} catch (error) {
		console.error("[GrindrX] Could not read the app-lock state.", error);
		return false;
	}
}
