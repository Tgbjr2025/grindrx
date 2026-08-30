// App-lock: an optional PIN gate shown over the authenticated app.
//
// State is reactive so a mounted gate component re-renders when the lock state
// changes. The PIN itself is stored only as a salted SHA-256 (see
// `$lib/utils/pin`). Enabling a PIN locks on the next cold start / reload; the
// gate can also re-lock on demand (e.g. when the app returns from background).

import { browser } from "$app/environment";

import { constantTimeEqual, generateSalt, hashPin } from "$lib/utils/pin";

const ENABLED_KEY = "grindrx-pinlock-enabled";
const SALT_KEY = "grindrx-pinlock-salt";
const HASH_KEY = "grindrx-pinlock-hash";

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

let enabled = $state(readBool(ENABLED_KEY));
// If a PIN is set, the app starts locked and must be unlocked once per session.
let locked = $state(readBool(ENABLED_KEY));

/** True when the user has set up a PIN lock. */
export function isPinEnabled(): boolean {
	return enabled;
}

/** True when the app should currently be gated behind the PIN entry screen. */
export function isLocked(): boolean {
	return enabled && locked;
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
	enabled = true;
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

/** Turn off the PIN lock and forget the stored hash. */
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
	enabled = false;
	locked = false;
}

/** Re-lock now (no-op when no PIN is set). */
export function lockNow(): void {
	if (enabled) locked = true;
}
