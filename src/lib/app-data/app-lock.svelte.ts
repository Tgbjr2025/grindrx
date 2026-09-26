// App-lock: an optional gate shown over the authenticated app. Two independent
// gates that can be used alone or together:
//   - PIN: a salted SHA-256 PIN (see `$lib/utils/pin`). Ground-truth fallback.
//   - Biometric: fingerprint/face. Can gate the app on its OWN (no PIN required);
//     when used alone, the OS biometric prompt falls back to the device
//     credential (phone PIN/pattern), so you're never locked out.
// The app is locked whenever EITHER gate is enabled. State is reactive so a
// mounted gate re-renders when it changes.

import { browser } from "$app/environment";

import {
	constantTimeEqual,
	generateSalt,
	hashPin,
	isValidPin,
	PBKDF2_ITERATIONS,
} from "$lib/utils/pin";

const ENABLED_KEY = "grindrx-pinlock-enabled";
const SALT_KEY = "grindrx-pinlock-salt";
const HASH_KEY = "grindrx-pinlock-hash";
const BIOMETRIC_KEY = "grindrx-pinlock-biometric";
const ITERATIONS_KEY = "grindrx-pinlock-iterations";
const ATTEMPTS_KEY = "grindrx-pinlock-failures";
const LOCKOUT_KEY = "grindrx-pinlock-lockout-until";

/**
 * Failed-attempt backoff.
 *
 * There was no limit at all: `unlock()` could be called forever, so a 4-digit
 * PIN (10,000 candidates) could be recovered unattended in minutes by anyone with
 * brief access to an unlocked phone. After `FAILURES_BEFORE_BACKOFF` misses we
 * impose a cooldown that doubles per subsequent miss, capped at
 * `MAX_LOCKOUT_MS`, and it is persisted so killing the app does not clear it.
 */
const FAILURES_BEFORE_BACKOFF = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 30 * 60_000;

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
// Consecutive failed PIN attempts, and the persisted lockout deadline.
let failures = $state(readNumber(ATTEMPTS_KEY));
let lockoutUntil = $state(readNumber(LOCKOUT_KEY));

function readNumber(key: string): number {
	if (!browser) return 0;
	try {
		const raw = localStorage.getItem(key);
		const value = raw === null ? 0 : Number(raw);
		return Number.isFinite(value) ? value : 0;
	} catch {
		return 0;
	}
}

function persistBackoff() {
	if (!browser) return;
	try {
		if (failures > 0) localStorage.setItem(ATTEMPTS_KEY, String(failures));
		else localStorage.removeItem(ATTEMPTS_KEY);
		if (lockoutUntil > Date.now()) {
			localStorage.setItem(LOCKOUT_KEY, String(lockoutUntil));
		} else {
			localStorage.removeItem(LOCKOUT_KEY);
		}
	} catch (err) {
		console.error("[GrindrX] Failed to persist PIN backoff:", err);
	}
}

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
	if (!isValidPin(pin)) {
		throw new Error("PIN must be 4-8 digits");
	}
	const salt = generateSalt();
	const hash = await hashPin(pin, salt, PBKDF2_ITERATIONS);
	if (browser) {
		try {
			localStorage.setItem(SALT_KEY, salt);
			localStorage.setItem(HASH_KEY, hash);
			localStorage.setItem(ITERATIONS_KEY, String(PBKDF2_ITERATIONS));
			localStorage.setItem(ENABLED_KEY, "1");
		} catch (err) {
			console.error("[GrindrX] Failed to persist PIN:", err);
			throw new Error("Could not save PIN", { cause: err });
		}
	}
	pinEnabled = true;
	locked = false;
	// A new PIN clears any outstanding backoff.
	failures = 0;
	lockoutUntil = 0;
	persistBackoff();
}

/**
 * Milliseconds until another attempt is allowed; `0` when not in a cooldown.
 * Reactive, so the unlock screen can show a live countdown.
 */
export function lockoutRemainingMs(): number {
	return Math.max(0, lockoutUntil - Date.now());
}

/** Check a PIN against the stored hash without changing lock state. */
export async function verifyPin(pin: string): Promise<boolean> {
	const salt = readStr(SALT_KEY);
	const stored = readStr(HASH_KEY);
	if (!salt || !stored) return false;
	// Read the stored iteration count so hashes written by an older build (or
	// with a raised count) still verify, and re-hash at the current cost.
	const iterations = readNumber(ITERATIONS_KEY) || PBKDF2_ITERATIONS;
	const candidate = await hashPin(pin, salt, iterations);
	if (!constantTimeEqual(candidate, stored)) return false;
	// Transparent upgrade: the PIN matched, so re-derive at today's cost.
	if (iterations < PBKDF2_ITERATIONS) {
		const upgraded = await hashPin(pin, salt, PBKDF2_ITERATIONS);
		if (browser) {
			try {
				localStorage.setItem(HASH_KEY, upgraded);
				localStorage.setItem(ITERATIONS_KEY, String(PBKDF2_ITERATIONS));
			} catch (err) {
				console.error("[GrindrX] Failed to upgrade PIN hash:", err);
			}
		}
	}
	return true;
}

/**
 * Attempt to unlock with a PIN; returns whether it matched.
 *
 * A correct PIN clears the failure counter. A wrong one increments it and,
 * past `FAILURES_BEFORE_BACKOFF`, imposes a doubling cooldown that is persisted
 * across restarts.
 */
export async function unlock(pin: string): Promise<boolean> {
	// Respect an active cooldown before spending a KDF round on the attempt.
	if (lockoutRemainingMs() > 0) return false;
	const ok = await verifyPin(pin);
	if (ok) {
		locked = false;
		failures = 0;
		lockoutUntil = 0;
		persistBackoff();
		return true;
	}
	failures += 1;
	if (failures >= FAILURES_BEFORE_BACKOFF) {
		const over = failures - FAILURES_BEFORE_BACKOFF;
		const delay = Math.min(BASE_LOCKOUT_MS * 2 ** over, MAX_LOCKOUT_MS);
		lockoutUntil = Date.now() + delay;
	}
	persistBackoff();
	return false;
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
			localStorage.removeItem(ITERATIONS_KEY);
			localStorage.removeItem(ENABLED_KEY);
		} catch (err) {
			console.error("[GrindrX] Failed to clear PIN:", err);
		}
	}
	pinEnabled = false;
	// Turning off the gate must not leave a backoff behind for a future one.
	failures = 0;
	lockoutUntil = 0;
	persistBackoff();
	if (!lockActive()) locked = false;
}

/** Re-lock now (no-op when no lock is configured). */
export function lockNow(): void {
	if (lockActive()) locked = true;
}
