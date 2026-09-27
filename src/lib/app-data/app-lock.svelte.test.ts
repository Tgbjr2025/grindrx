import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashPin, PBKDF2_ITERATIONS, sha256Hex } from "$lib/utils/pin";

vi.mock("$app/environment", () => ({
	browser: true,
	building: false,
	dev: false,
	version: "test",
}));

function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("localStorage", createMemoryStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("app-lock store", () => {
	it("starts disabled and unlocked with no PIN set", async () => {
		const { isPinEnabled, isLocked } = await import("$lib/app-data/app-lock.svelte");
		expect(isPinEnabled()).toBe(false);
		expect(isLocked()).toBe(false);
	});

	it("setPin enables the lock, persists a salted hash (not the PIN), and leaves the session unlocked", async () => {
		const { setPin, isPinEnabled, isLocked } = await import(
			"$lib/app-data/app-lock.svelte"
		);

		await setPin("123456");

		expect(isPinEnabled()).toBe(true);
		expect(isLocked()).toBe(false); // just set it — user is in
		expect(localStorage.getItem("grindrx-pinlock-enabled")).toBe("1");
		// The stored hash must not be the raw PIN.
		expect(localStorage.getItem("grindrx-pinlock-hash")).not.toBe("123456");
		expect(localStorage.getItem("grindrx-pinlock-hash")).toMatch(/^[0-9a-f]{64}$/);
		expect(localStorage.getItem("grindrx-pinlock-salt")).toBeTruthy();
	});

	it("verifyPin accepts the correct PIN and rejects a wrong one", async () => {
		const { setPin, verifyPin } = await import("$lib/app-data/app-lock.svelte");
		await setPin("432187");

		expect(await verifyPin("432187")).toBe(true);
		expect(await verifyPin("000000")).toBe(false);
	});

	it("a set PIN starts the app locked on the next load; unlock requires the right PIN", async () => {
		// Pre-seed a persisted PIN, then load the module fresh (cold start).
		const { setPin } = await import("$lib/app-data/app-lock.svelte");
		await setPin("918273");
		const salt = localStorage.getItem("grindrx-pinlock-salt");
		const hash = localStorage.getItem("grindrx-pinlock-hash");

		vi.resetModules();
		// Same storage contents survive; simulate reload.
		localStorage.setItem("grindrx-pinlock-enabled", "1");
		localStorage.setItem("grindrx-pinlock-salt", salt as string);
		localStorage.setItem("grindrx-pinlock-hash", hash as string);

		const { isLocked, unlock } = await import("$lib/app-data/app-lock.svelte");
		expect(isLocked()).toBe(true);

		expect(await unlock("000000")).toBe(false);
		expect(isLocked()).toBe(true);

		expect(await unlock("918273")).toBe(true);
		expect(isLocked()).toBe(false);
	});

	it("disablePin clears everything", async () => {
		const { setPin, disablePin, isPinEnabled, isLocked } = await import(
			"$lib/app-data/app-lock.svelte"
		);
		await setPin("123456");

		disablePin();

		expect(isPinEnabled()).toBe(false);
		expect(isLocked()).toBe(false);
		expect(localStorage.getItem("grindrx-pinlock-hash")).toBeNull();
		expect(localStorage.getItem("grindrx-pinlock-salt")).toBeNull();
		expect(localStorage.getItem("grindrx-pinlock-enabled")).toBeNull();
	});

	it("lockNow re-locks when a PIN is set", async () => {
		const { setPin, lockNow, isLocked } = await import(
			"$lib/app-data/app-lock.svelte"
		);
		await setPin("123456");
		expect(isLocked()).toBe(false);

		lockNow();
		expect(isLocked()).toBe(true);
	});

	it("biometric can be the SOLE lock (no PIN), and unlockWithBiometric unlocks", async () => {
		const m = await import("$lib/app-data/app-lock.svelte");
		expect(m.isLockEnabled()).toBe(false);

		m.setBiometricUnlock(true);
		expect(m.isBiometricUnlockEnabled()).toBe(true);
		expect(m.isPinEnabled()).toBe(false);
		expect(m.isLockEnabled()).toBe(true);
		expect(localStorage.getItem("grindrx-pinlock-biometric")).toBe("1");

		m.lockNow();
		expect(m.isLocked()).toBe(true);
		m.unlockWithBiometric();
		expect(m.isLocked()).toBe(false);
	});

	it("a biometric-only lock starts locked on the next load", async () => {
		localStorage.setItem("grindrx-pinlock-biometric", "1");
		const m = await import("$lib/app-data/app-lock.svelte");
		expect(m.isPinEnabled()).toBe(false);
		expect(m.isLocked()).toBe(true);
	});

	it("disablePin keeps a biometric-only lock; setBiometricUnlock(false) fully unlocks", async () => {
		const m = await import("$lib/app-data/app-lock.svelte");
		await m.setPin("123456");
		m.setBiometricUnlock(true);

		m.disablePin();
		expect(m.isPinEnabled()).toBe(false);
		expect(m.isBiometricUnlockEnabled()).toBe(true); // biometric survives
		expect(m.isLockEnabled()).toBe(true);

		m.setBiometricUnlock(false);
		expect(m.isLockEnabled()).toBe(false);
		expect(m.isLocked()).toBe(false);
		expect(localStorage.getItem("grindrx-pinlock-biometric")).toBeNull();
	});
});

// The PIN had no attempt limit at all, so a 4-digit PIN (10,000 candidates)
// could be recovered unattended by calling unlock() repeatedly.
describe("PIN attempt backoff", () => {
	it("allows attempts up to the threshold, then imposes a cooldown", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("123456");

		// Threshold is 5, so the first 4 misses must NOT lock us out.
		for (let i = 0; i < 4; i++) {
			expect(await lock.unlock("918273")).toBe(false);
			expect(lock.lockoutRemainingMs()).toBe(0);
		}
		// The 5th miss trips the backoff.
		expect(await lock.unlock("918273")).toBe(false);
		expect(lock.lockoutRemainingMs()).toBeGreaterThan(0);
	});

	it("refuses further attempts while a cooldown is active", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("123456");
		// Re-lock first: the backoff exists to slow down guessing at the lock
		// screen. Failed attempts against an already-unlocked app deliberately do
		// NOT re-lock it (that would be a trivial DoS — tap 5 times while walking
		// past and the phone locks itself).
		lock.lockNow();
		expect(lock.isLocked()).toBe(true);

		for (let i = 0; i < 5; i++) await lock.unlock("918273");
		expect(lock.lockoutRemainingMs()).toBeGreaterThan(0);

		// Even the CORRECT pin is refused during the cooldown, and must not
		// consume a KDF round-trip.
		expect(await lock.unlock("123456")).toBe(false);
		expect(lock.isLocked()).toBe(true);
	});

	it("does not re-lock an unlocked app on failed attempts (no trivial DoS)", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("123456");
		expect(lock.isLocked()).toBe(false);
		for (let i = 0; i < 6; i++) await lock.unlock("918273");
		expect(lock.isLocked()).toBe(false);
	});

	it("clears the counter and cooldown after a correct PIN", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("123456");
		for (let i = 0; i < 3; i++) await lock.unlock("918273");

		expect(await lock.unlock("123456")).toBe(true);
		expect(lock.lockoutRemainingMs()).toBe(0);
		expect(lock.isLocked()).toBe(false);
	});

	it("persists the failure count and cooldown so a restart cannot clear them", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("123456");
		for (let i = 0; i < 5; i++) await lock.unlock("918273");

		// Simulate an app kill + relaunch: fresh module, same localStorage.
		vi.resetModules();
		const after = await import("$lib/app-data/app-lock.svelte");
		expect(after.isLocked()).toBe(true);
		expect(after.lockoutRemainingMs()).toBeGreaterThan(0);
		expect(await after.unlock("123456")).toBe(false);
	});

	it("rejects a PIN that is not 6-8 digits", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await expect(lock.setPin("12")).rejects.toThrow(/6-8 digits/);
		await expect(lock.setPin("abcdefgh")).rejects.toThrow(/6-8 digits/);
		expect(lock.isPinEnabled()).toBe(false);
	});

	// The verifier is plaintext app storage, so a 4-digit PIN (10,000
	// candidates) is a GPU sweep of seconds. The floor is 6.
	it("refuses a 4- or 5-digit PIN but still verifies one that was already set", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await expect(lock.setPin("1234")).rejects.toThrow(/6-8 digits/);
		await expect(lock.setPin("12345")).rejects.toThrow(/6-8 digits/);
		expect(lock.isPinEnabled()).toBe(false);

		// Raising the floor must not lock out an install that already has a
		// shorter PIN — nothing gates verification, only setting.
		const salt = "abcdef0123456789";
		localStorage.setItem("grindrx-pinlock-enabled", "1");
		localStorage.setItem("grindrx-pinlock-salt", salt);
		localStorage.setItem("grindrx-pinlock-hash", await hashPin("1234", salt));
		localStorage.setItem("grindrx-pinlock-iterations", String(PBKDF2_ITERATIONS));
		expect(await lock.verifyPin("1234")).toBe(true);
	});
});

// v0.1.33 (b802080 shipped v0.1.25–v0.1.32) wrote `hash = SHA-256(salt:pin)`
// with NO iterations key, then started comparing a 200k PBKDF2 digest against
// it. A plain SHA-256 can never equal a PBKDF2 digest, the "transparent
// upgrade" sat AFTER the successful compare (so it never ran for exactly the
// installs that needed it), and there is no forgot-PIN: every v0.1.25–v0.1.32
// PIN was a permanent, unrecoverable lockout.
describe("legacy (v0.1.25-v0.1.32) PIN migration", () => {
	const LEGACY_SALT = "00112233445566778899aabbccddeeff";
	const LEGACY_PIN = "482913";
	// The literal three-key payload an old install left behind: enabled, salt,
	// hash — and no iterations key.
	async function seedLegacyInstall() {
		localStorage.setItem("grindrx-pinlock-enabled", "1");
		localStorage.setItem("grindrx-pinlock-salt", LEGACY_SALT);
		localStorage.setItem("grindrx-pinlock-hash", await sha256Hex(`${LEGACY_SALT}:${LEGACY_PIN}`));
		localStorage.removeItem("grindrx-pinlock-iterations");
	}

	it("unlocks with the legacy PIN and rewrites the verifier as PBKDF2", async () => {
		await seedLegacyInstall();
		const lock = await import("$lib/app-data/app-lock.svelte");
		expect(lock.isLocked()).toBe(true);

		expect(await lock.unlock(LEGACY_PIN)).toBe(true);
		expect(lock.isLocked()).toBe(false);

		// The stored form is now PBKDF2, so the legacy path is retired.
		const iterations = localStorage.getItem("grindrx-pinlock-iterations");
		expect(iterations).toBe(String(PBKDF2_ITERATIONS));
		const stored = localStorage.getItem("grindrx-pinlock-hash");
		expect(stored).toBe(await hashPin(LEGACY_PIN, LEGACY_SALT, PBKDF2_ITERATIONS));
		expect(stored).not.toBe(await sha256Hex(`${LEGACY_SALT}:${LEGACY_PIN}`));

		// And it still verifies afterwards, with the fallback no longer needed.
		vi.resetModules();
		const after = await import("$lib/app-data/app-lock.svelte");
		expect(await after.unlock(LEGACY_PIN)).toBe(true);
	});

	it("a wrong PIN does not unlock, and does not upgrade the stored hash", async () => {
		await seedLegacyInstall();
		const legacyHash = localStorage.getItem("grindrx-pinlock-hash");
		const lock = await import("$lib/app-data/app-lock.svelte");

		expect(await lock.unlock("000000")).toBe(false);
		expect(lock.isLocked()).toBe(true);
		// No upgrade on a miss: the legacy format must survive until a real match.
		expect(localStorage.getItem("grindrx-pinlock-hash")).toBe(legacyHash);
		expect(localStorage.getItem("grindrx-pinlock-iterations")).toBeNull();
	});

	it("a PBKDF2-written PIN with a valid iterations key does not take the legacy path", async () => {
		localStorage.setItem("grindrx-pinlock-enabled", "1");
		localStorage.setItem("grindrx-pinlock-salt", LEGACY_SALT);
		localStorage.setItem("grindrx-pinlock-hash", await hashPin("135792", LEGACY_SALT));
		localStorage.setItem("grindrx-pinlock-iterations", String(PBKDF2_ITERATIONS));
		const lock = await import("$lib/app-data/app-lock.svelte");

		// The legacy digest of some other PIN must not unlock a current install.
		expect(await lock.verifyPin(LEGACY_PIN)).toBe(false);
		expect(await lock.verifyPin("135792")).toBe(true);
	});
});

// The cooldown is a wall-clock epoch in writable storage, so moving the device
// clock used to both satisfy the guard and erase the deadline on the next
// persist, handing out 5 free guesses per clock change.
describe("backoff clock tampering", () => {
	it("a clock moved forward past the deadline is still locked", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("123456");
		for (let i = 0; i < 5; i++) await lock.unlock("918273");
		expect(lock.lockoutRemainingMs()).toBeGreaterThan(0);

		// Restart with the clock a day further on: the stored epoch is now in the
		// past, which used to read as "cooldown over".
		vi.useFakeTimers();
		try {
			vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
			vi.resetModules();
			const after = await import("$lib/app-data/app-lock.svelte");

			expect(after.isLocked()).toBe(true);
			expect(after.lockoutRemainingMs()).toBeGreaterThan(0);
			// Even the correct PIN is refused, and no KDF round is spent.
			expect(await after.unlock("123456")).toBe(false);
			expect(after.isLocked()).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("a clock moved backwards is treated as tampering too", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("123456");
		for (let i = 0; i < 6; i++) await lock.unlock("918273");

		vi.useFakeTimers();
		try {
			vi.setSystemTime(Date.now() - 5 * 60 * 60_000);
			vi.resetModules();
			const after = await import("$lib/app-data/app-lock.svelte");
			expect(after.lockoutRemainingMs()).toBeGreaterThan(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("clamps a hand-edited far-future deadline to the ladder the count earns", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("123456");
		for (let i = 0; i < 5; i++) await lock.unlock("918273");

		// Five misses earn 30s, not the 10 years an attacker would write.
		vi.resetModules();
		localStorage.setItem("grindrx-pinlock-lockout-until", String(Date.now() + 315_360_000_000));
		const after = await import("$lib/app-data/app-lock.svelte");
		expect(after.lockoutRemainingMs()).toBeLessThanOrEqual(30_000);
		expect(after.lockoutRemainingMs()).toBeGreaterThan(0);
	});

	// KNOWN LIMITATION, not a fix: localStorage is writable by anything running
	// in this WebView, so wiping the failure count resets the ladder. Only the
	// counter (never the PIN) is lost, so the worst case is a 5-free-guess
	// restart, and closing it needs the counter outside JS-reachable storage
	// (Rust/Stronghold) — a native change this batch does not own.
	it("clearing the backoff keys resets the ladder (documented limitation)", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("123456");
		for (let i = 0; i < 6; i++) await lock.unlock("918273");
		expect(lock.lockoutRemainingMs()).toBeGreaterThan(0);

		vi.resetModules();
		localStorage.removeItem("grindrx-pinlock-failures");
		localStorage.removeItem("grindrx-pinlock-lockout-until");
		localStorage.removeItem("grindrx-pinlock-last-clock");
		const after = await import("$lib/app-data/app-lock.svelte");
		expect(after.lockoutRemainingMs()).toBe(0);
		expect(await after.unlock("123456")).toBe(true);
	});
});
