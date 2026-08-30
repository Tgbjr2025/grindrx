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

	it("biometric opt-in only counts when a PIN is set, persists, and unlockWithBiometric unlocks", async () => {
		const m = await import("$lib/app-data/app-lock.svelte");
		// No PIN yet -> biometric never "enabled".
		m.setBiometricUnlock(true);
		expect(m.isBiometricUnlockEnabled()).toBe(false);

		await m.setPin("1234");
		m.setBiometricUnlock(true);
		expect(m.isBiometricUnlockEnabled()).toBe(true);
		expect(localStorage.getItem("grindrx-pinlock-biometric")).toBe("1");

		m.lockNow();
		expect(m.isLocked()).toBe(true);
		m.unlockWithBiometric();
		expect(m.isLocked()).toBe(false);
	});

	it("disablePin also clears the biometric opt-in", async () => {
		const m = await import("$lib/app-data/app-lock.svelte");
		await m.setPin("1234");
		m.setBiometricUnlock(true);

		m.disablePin();

		expect(m.isBiometricUnlockEnabled()).toBe(false);
		expect(localStorage.getItem("grindrx-pinlock-biometric")).toBeNull();
	});
});
