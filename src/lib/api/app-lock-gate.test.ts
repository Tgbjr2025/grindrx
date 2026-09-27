import { beforeEach, describe, expect, it, vi } from "vitest";

// E0b: `set_app_locked(locked: bool)` is registered in
// `src-tauri/src/lib.rs` and is the ONLY thing that can tell the Rust WS
// notifier that the app lock is engaged, so it can suppress lock-screen
// notifications. Nothing in the WebView called it, so `AppState::locked` stayed
// at its hardcoded `false` default and the "don't leak chat text to the lock
// screen" fix did nothing.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("$lib/app-data/app-lock.svelte", () => ({
	isLocked: vi.fn().mockReturnValue(true),
}));

import { invoke } from "@tauri-apps/api/core";

import { pushAppLockState, syncAppLockToBackend } from "$lib/api/app-lock-gate";
import { isLocked } from "$lib/app-data/app-lock.svelte";

const mockedInvoke = vi.mocked(invoke);
const mockedIsLocked = vi.mocked(isLocked);

beforeEach(() => {
	vi.clearAllMocks();
	mockedIsLocked.mockReturnValue(true);
});

describe("syncAppLockToBackend", () => {
	it("invokes set_app_locked with the CURRENT lock state", async () => {
		await expect(syncAppLockToBackend()).resolves.toBe(true);
		expect(mockedInvoke).toHaveBeenCalledWith("set_app_locked", { locked: true });
	});

	it("pushes `false` on unlock, not a stale `true`", async () => {
		mockedIsLocked.mockReturnValue(false);
		await syncAppLockToBackend();
		expect(mockedInvoke).toHaveBeenCalledWith("set_app_locked", { locked: false });
	});

	it("reads the lock state at CALL time, so a transition is not missed", async () => {
		mockedIsLocked.mockReturnValue(true);
		await syncAppLockToBackend();
		mockedIsLocked.mockReturnValue(false);
		await syncAppLockToBackend();

		expect(mockedInvoke.mock.calls).toEqual([
			["set_app_locked", { locked: true }],
			["set_app_locked", { locked: false }],
		]);
	});

	it("logs and resolves false instead of rejecting when the push fails", async () => {
		// Callers are app start and the lock-state effect; neither can act on a
		// rejection, and one must not take down an unlock.
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		mockedInvoke.mockRejectedValueOnce("no such command");

		await expect(syncAppLockToBackend()).resolves.toBe(false);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});
});

describe("pushAppLockState", () => {
	it("is the untracked primitive the $effect subscription uses", async () => {
		// The effect must read `isLocked()` synchronously so Svelte registers the
		// dependency; an `await` before the read silently ends the subscription.
		await expect(pushAppLockState(true)).resolves.toBe(true);
		expect(mockedInvoke).toHaveBeenCalledWith("set_app_locked", { locked: true });
	});
});
