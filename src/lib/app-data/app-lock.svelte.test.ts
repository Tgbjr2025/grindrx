import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

		await setPin("1234");

		expect(isPinEnabled()).toBe(true);
		expect(isLocked()).toBe(false); // just set it — user is in
		expect(localStorage.getItem("grindrx-pinlock-enabled")).toBe("1");
		// The stored hash must not be the raw PIN.
		expect(localStorage.getItem("grindrx-pinlock-hash")).not.toBe("1234");
		expect(localStorage.getItem("grindrx-pinlock-hash")).toMatch(/^[0-9a-f]{64}$/);
		expect(localStorage.getItem("grindrx-pinlock-salt")).toBeTruthy();
	});

	it("verifyPin accepts the correct PIN and rejects a wrong one", async () => {
		const { setPin, verifyPin } = await import("$lib/app-data/app-lock.svelte");
		await setPin("4321");

		expect(await verifyPin("4321")).toBe(true);
		expect(await verifyPin("0000")).toBe(false);
	});

	it("a set PIN starts the app locked on the next load; unlock requires the right PIN", async () => {
		// Pre-seed a persisted PIN, then load the module fresh (cold start).
		const { setPin } = await import("$lib/app-data/app-lock.svelte");
		await setPin("9999");
		const salt = localStorage.getItem("grindrx-pinlock-salt");
		const hash = localStorage.getItem("grindrx-pinlock-hash");

		vi.resetModules();
		// Same storage contents survive; simulate reload.
		localStorage.setItem("grindrx-pinlock-enabled", "1");
		localStorage.setItem("grindrx-pinlock-salt", salt as string);
		localStorage.setItem("grindrx-pinlock-hash", hash as string);

		const { isLocked, unlock } = await import("$lib/app-data/app-lock.svelte");
		expect(isLocked()).toBe(true);

		expect(await unlock("0000")).toBe(false);
		expect(isLocked()).toBe(true);

		expect(await unlock("9999")).toBe(true);
		expect(isLocked()).toBe(false);
	});

	it("disablePin clears everything", async () => {
		const { setPin, disablePin, isPinEnabled, isLocked } = await import(
			"$lib/app-data/app-lock.svelte"
		);
		await setPin("1234");

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
		await setPin("1234");
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
		await m.setPin("1234");
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
		await lock.setPin("1234");

		// Threshold is 5, so the first 4 misses must NOT lock us out.
		for (let i = 0; i < 4; i++) {
			expect(await lock.unlock("9999")).toBe(false);
			expect(lock.lockoutRemainingMs()).toBe(0);
		}
		// The 5th miss trips the backoff.
		expect(await lock.unlock("9999")).toBe(false);
		expect(lock.lockoutRemainingMs()).toBeGreaterThan(0);
	});

	it("refuses further attempts while a cooldown is active", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("1234");
		// Re-lock first: the backoff exists to slow down guessing at the lock
		// screen. Failed attempts against an already-unlocked app deliberately do
		// NOT re-lock it (that would be a trivial DoS — tap 5 times while walking
		// past and the phone locks itself).
		lock.lockNow();
		expect(lock.isLocked()).toBe(true);

		for (let i = 0; i < 5; i++) await lock.unlock("9999");
		expect(lock.lockoutRemainingMs()).toBeGreaterThan(0);

		// Even the CORRECT pin is refused during the cooldown, and must not
		// consume a KDF round-trip.
		expect(await lock.unlock("1234")).toBe(false);
		expect(lock.isLocked()).toBe(true);
	});

	it("does not re-lock an unlocked app on failed attempts (no trivial DoS)", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("1234");
		expect(lock.isLocked()).toBe(false);
		for (let i = 0; i < 6; i++) await lock.unlock("9999");
		expect(lock.isLocked()).toBe(false);
	});

	it("clears the counter and cooldown after a correct PIN", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("1234");
		for (let i = 0; i < 3; i++) await lock.unlock("9999");

		expect(await lock.unlock("1234")).toBe(true);
		expect(lock.lockoutRemainingMs()).toBe(0);
		expect(lock.isLocked()).toBe(false);
	});

	it("persists the failure count and cooldown so a restart cannot clear them", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await lock.setPin("1234");
		for (let i = 0; i < 5; i++) await lock.unlock("9999");

		// Simulate an app kill + relaunch: fresh module, same localStorage.
		vi.resetModules();
		const after = await import("$lib/app-data/app-lock.svelte");
		expect(after.isLocked()).toBe(true);
		expect(after.lockoutRemainingMs()).toBeGreaterThan(0);
		expect(await after.unlock("1234")).toBe(false);
	});

	it("rejects a PIN that is not 4-8 digits", async () => {
		const lock = await import("$lib/app-data/app-lock.svelte");
		await expect(lock.setPin("12")).rejects.toThrow(/4-8 digits/);
		await expect(lock.setPin("abcdefgh")).rejects.toThrow(/4-8 digits/);
		expect(lock.isPinEnabled()).toBe(false);
	});
});
