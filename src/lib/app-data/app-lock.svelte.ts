// App-lock: an optional gate shown over the authenticated app. Two independent
// gates that can be used alone or together:
//   - PIN: a salted PBKDF2-SHA-256 derivation (see `$lib/utils/pin`, which also
//     carries the real threat model). Ground-truth fallback.
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
	sha256Hex,
} from "$lib/utils/pin";

const ENABLED_KEY = "grindrx-pinlock-enabled";
const SALT_KEY = "grindrx-pinlock-salt";
const HASH_KEY = "grindrx-pinlock-hash";
const BIOMETRIC_KEY = "grindrx-pinlock-biometric";
const ITERATIONS_KEY = "grindrx-pinlock-iterations";
const ATTEMPTS_KEY = "grindrx-pinlock-failures";
const LOCKOUT_KEY = "grindrx-pinlock-lockout-until";
const CLOCK_KEY = "grindrx-pinlock-last-clock";

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

/**
 * How far the wall clock is allowed to disagree with the last reading we
 * recorded before we treat it as tampering rather than as elapsed time.
 *
 * The backoff deadline is a `Date.now()` epoch in writable storage, so without
 * this the whole ladder is bypassable by moving the device clock: forward past
 * the deadline and the guard reports "no cooldown" (and the deadline is erased
 * on the next persist), so every 5th attempt is free.
 *
 * The forward gap is deliberately generous (24 h). A tight bound here would
 * fail CLOSED on the ordinary case — a user who misses 5 attempts, puts the
 * phone down for 40 minutes and comes back would be re-armed for another
 * cooldown, which is a support-visible lockout bug. The residual: an attacker
 * who advances the clock by less than 24 h still converts a cooldown into a free
 * attempt, but not into an unlimited one — the failure count is the source of
 * truth, so they get 5 more guesses per clock change and the ladder re-arms
 * behind them. The backward bound is tight because no legitimate correction
 * produces a minute of skew.
 */
const MAX_CLOCK_SKEW_BACK_MS = 60_000;
const MAX_CLOCK_GAP_MS = 24 * 60 * 60_000;

/** The cooldown `failures` consecutive misses has earned; 0 when none is owed. */
function lockoutDelayMs(failureCount: number): number {
	if (failureCount < FAILURES_BEFORE_BACKOFF) return 0;
	const over = failureCount - FAILURES_BEFORE_BACKOFF;
	return Math.min(BASE_LOCKOUT_MS * 2 ** over, MAX_LOCKOUT_MS);
}

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
// Consecutive failed PIN attempts, and the persisted lockout deadline. The
// failure COUNT is the source of truth; the deadline is a cache of it that we
// clamp against the last clock reading we saw (see `recoverLockoutUntil`).
let failures = $state(readNumber(ATTEMPTS_KEY));
let lockoutUntil = $state(0);
lockoutUntil = recoverLockoutUntil();

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

/** True when `now` cannot be reconciled with the clock reading we last stored. */
function clockSkewed(lastClock: number, now: number): boolean {
	if (lastClock <= 0) return false;
	return (
		now < lastClock - MAX_CLOCK_SKEW_BACK_MS ||
		now > lastClock + MAX_CLOCK_GAP_MS
	);
}

/**
 * Rebuild the cooldown deadline on load from the failure count, treating the
 * stored epoch as a hint rather than as truth.
 *
 * Two things can make the stored deadline a lie, because it lives in writable
 * storage: hand-editing, and moving the device clock. So we clamp it to
 * `lastClock + delayFor(failures)` (a hand-edited far-future value is clipped
 * back to the ladder the count actually earns) and, when the current reading
 * can't be reconciled with `lastClock`, re-arm the full ladder instead of
 * granting the free attempt the mismatch would otherwise buy.
 */
function recoverLockoutUntil(): number {
	const delay = lockoutDelayMs(failures);
	// No cooldown owed: never resurrect a deadline the count doesn't back.
	if (delay <= 0) return 0;
	const now = Date.now();
	const lastClock = readNumber(CLOCK_KEY);
	if (clockSkewed(lastClock, now)) return now + delay;
	return Math.max(0, Math.min(readNumber(LOCKOUT_KEY), lastClock + delay));
}

/**
 * Re-arm the ladder if the clock jumped since the last reading we recorded.
 *
 * `recoverLockoutUntil` only runs at module init, so a clock change made while
 * the app is open (the lock screen is counting down) would otherwise be enough
 * on its own. Returns whether a new cooldown was armed.
 */
function reArmOnClockTamper(): boolean {
	const delay = lockoutDelayMs(failures);
	if (delay <= 0) return false;
	const now = Date.now();
	if (!clockSkewed(readNumber(CLOCK_KEY), now)) return false;
	lockoutUntil = now + delay;
	persistBackoff();
	return true;
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
		// The reading the deadline above was computed against. Without it a
		// clock change is indistinguishable from elapsed time.
		localStorage.setItem(CLOCK_KEY, String(Date.now()));
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
		throw new Error("PIN must be 6-8 digits");
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

/**
 * Check a PIN against the stored hash without changing lock state.
 *
 * THREAT MODEL — this is a gate on the UI, not a secret store. The salt, the
 * hash and the iteration count are three adjacent plaintext localStorage entries
 * that any WebView code (or a storage dump: adb backup, rooted device) can read
 * together, so 200k PBKDF2 rounds do not make an offline sweep of a 6-digit PIN
 * infeasible — see the measured numbers in `$lib/utils/pin`. What the iteration
 * count buys is cost against that sweep; what actually bounds guessing is the
 * online backoff in `unlock()`, the 6-digit floor in `isValidPin`, and the
 * current-PIN prompt in front of every change/removal in `PinLockSetting.svelte`.
 *
 * On top of the PBKDF2 comparison it also accepts the pre-PBKDF2 digest
 * (`SHA-256(salt:pin)`, no iteration count) that v0.1.25–v0.1.32 wrote. Those
 * installs are otherwise PERMANENTLY locked out: the legacy digest can never
 * equal a PBKDF2 one, there is no forgot-PIN, and the old "transparent upgrade"
 * only ran after a successful verify — unreachable for exactly the users who
 * needed it. A legacy match is rewritten to PBKDF2 immediately, so the
 * migration is one-shot and the fallback path is left behind.
 */
export async function verifyPin(pin: string): Promise<boolean> {
	const salt = readStr(SALT_KEY);
	const stored = readStr(HASH_KEY);
	if (!salt || !stored) return false;
	// Read the stored iteration count so hashes written by an older build (or
	// with a raised count) still verify, and re-hash at the current cost. An
	// absent or unusable count is the legacy shape (plain SHA-256 digest).
	const storedIterations = readNumber(ITERATIONS_KEY);
	const legacyShape = storedIterations <= 0;
	const iterations = legacyShape ? PBKDF2_ITERATIONS : storedIterations;
	const candidate = await hashPin(pin, salt, iterations);
	if (!constantTimeEqual(candidate, stored)) {
		// Both candidates go through `constantTimeEqual`, so neither the KDF
		// digest nor the cheap legacy digest leaks a length/prefix oracle.
		if (!legacyShape) return false;
		if (!constantTimeEqual(await sha256Hex(`${salt}:${pin}`), stored))
			return false;
	}
	// Transparent upgrade: the PIN matched, so re-derive at today's cost. On the
	// legacy path this is the only write that ever retires that format.
	if (legacyShape || iterations < PBKDF2_ITERATIONS) {
		const upgraded =
			iterations === PBKDF2_ITERATIONS
				? candidate
				: await hashPin(pin, salt, PBKDF2_ITERATIONS);
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
	// A clock moved past the persisted deadline would otherwise read as "no
	// cooldown" and hand out a free attempt; re-arm the ladder instead.
	if (reArmOnClockTamper()) return false;
	const ok = await verifyPin(pin);
	if (ok) {
		locked = false;
		failures = 0;
		lockoutUntil = 0;
		persistBackoff();
		return true;
	}
	failures += 1;
	const delay = lockoutDelayMs(failures);
	if (delay > 0) lockoutUntil = Date.now() + delay;
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
			localStorage.removeItem(CLOCK_KEY);
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
