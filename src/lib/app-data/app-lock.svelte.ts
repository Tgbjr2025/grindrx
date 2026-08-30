// App-lock: an optional gate shown over the authenticated app. Two independent
// gates that can be used alone or together:
//   - PIN: a salted SHA-256 PIN (see `$lib/utils/pin`). Ground-truth fallback.
//   - Biometric: fingerprint/face. Can gate the app on its OWN (no PIN required);
//     when used alone, the OS biometric prompt falls back to the device
//     credential (phone PIN/pattern), so you're never locked out.
// The app is locked whenever EITHER gate is enabled. State is reactive so a
// mounted gate re-renders when it changes.

import { browser } from "$app/environment";

import { constantTimeEqual, generateSalt, hashPin } from "$lib/utils/pin";

const ENABLED_KEY = "grindrx-pinlock-enabled";
const SALT_KEY = "grindrx-pinlock-salt";
const HASH_KEY = "grindrx-pinlock-hash";
const BIOMETRIC_KEY = "grindrx-pinlock-biometric";

function readBool(key: string): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(key) === "1";
	} catch {
		return false;
	}
}

function readStr(key: string): string | null {
	if (!browser) return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

let pinEnabled = $state(readBool(ENABLED_KEY));
let biometric = $state(readBool(BIOMETRIC_KEY));
// The app starts locked whenever either gate is enabled; it must be unlocked
// once per session (cold start / reload).
let locked = $state(readBool(ENABLED_KEY) || readBool(BIOMETRIC_KEY));

function lockActive(): boolean {
	return pinEnabled || biometric;
}

/** True when a PIN is set. */
export function isPinEnabled(): boolean {
	return pinEnabled;
}

/** True when biometric unlock/lock is enabled (with or without a PIN). */
export function isBiometricUnlockEnabled(): boolean {
	return biometric;
}

/** True when any app lock is configured. */
export function isLockEnabled(): boolean {
	return lockActive();
}

/** True when the app should currently be gated behind the lock screen. */
export function isLocked(): boolean {
	return lockActive() && locked;
}

/** Set (or replace) the PIN and mark the app unlocked for this session. */
export async function setPin(pin: string): Promise<void> {
	const salt = generateSalt();
	const hash = await hashPin(pin, salt);
	if (browser) {
		try {
			localStorage.setItem(SALT_KEY, salt);
			localStorage.setItem(HASH_KEY, hash);
			localStorage.setItem(ENABLED_KEY, "1");
		} catch (err) {
			console.error("[GrindrX] Failed to persist PIN:", err);
			throw new Error("Could not save PIN", { cause: err });
		}
	}
	pinEnabled = true;
	locked = false;
}

/** Check a PIN against the stored hash without changing lock state. */
export async function verifyPin(pin: string): Promise<boolean> {
	const salt = readStr(SALT_KEY);
	const stored = readStr(HASH_KEY);
	if (!salt || !stored) return false;
	const candidate = await hashPin(pin, salt);
	return constantTimeEqual(candidate, stored);
}

/** Attempt to unlock with a PIN; returns whether it matched. */
export async function unlock(pin: string): Promise<boolean> {
	const ok = await verifyPin(pin);
	if (ok) locked = false;
	return ok;
}

/** Enable/disable biometric unlock (can be the sole lock, no PIN needed). */
export function setBiometricUnlock(on: boolean): void {
	biometric = on;
	if (browser) {
		try {
			if (on) localStorage.setItem(BIOMETRIC_KEY, "1");
			else localStorage.removeItem(BIOMETRIC_KEY);
		} catch (err) {
			console.error("[GrindrX] Failed to persist biometric setting:", err);
		}
	}
	// Turning off the last active gate leaves nothing to unlock.
	if (!lockActive()) locked = false;
}

/** Unlock after a successful biometric check (bypasses PIN entry). */
export function unlockWithBiometric(): void {
	if (lockActive()) locked = false;
}

/** Turn off the PIN (keeps a biometric-only lock if one is enabled). */
export function disablePin(): void {
	if (browser) {
		try {
			localStorage.removeItem(SALT_KEY);
			localStorage.removeItem(HASH_KEY);
			localStorage.removeItem(ENABLED_KEY);
		} catch (err) {
			console.error("[GrindrX] Failed to clear PIN:", err);
		}
	}
	pinEnabled = false;
	if (!lockActive()) locked = false;
}

/** Re-lock now (no-op when no lock is configured). */
export function lockNow(): void {
	if (lockActive()) locked = true;
}
