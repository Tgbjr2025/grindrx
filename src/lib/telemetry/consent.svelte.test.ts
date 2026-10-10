/**
 * Telemetry consent store (P1-001).
 *
 * ## What is being pinned here
 *
 * The store is the whole security boundary for this feature: `usage-ping.ts` asks
 * it one question and refuses to send unless the answer is `"granted"`. That makes
 * the boring failure modes — storage absent, storage throwing, a corrupted value —
 * the ones that decide whether an unasked-for request leaves the device, so they
 * are tested as carefully as the happy path rather than left as untested branches.
 *
 * Every test re-imports the module under a fresh `localStorage` because the consent
 * state is module-level `$state` seeded at import time. Testing it against shared
 * module state would let one test's grant leak into the next one's "fresh install".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TELEMETRY_CONSENT_KEY } from "$lib/telemetry/consent.svelte";

/** In-memory `Storage`, so the test never depends on jsdom or on a real profile. */
function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) =>
			store.has(key) ? (store.get(key) as string) : null,
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

/**
 * Import the store fresh, so its module-level `$state` is re-seeded from whatever
 * the stubbed storage now holds. Mirrors `app-lock.svelte.test.ts`.
 */
async function importStore() {
	return import("$lib/telemetry/consent.svelte");
}

let storage: Storage;

beforeEach(() => {
	storage = createMemoryStorage();
	vi.stubGlobal("localStorage", storage);
	vi.resetModules();
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("telemetry consent — default", () => {
	it("is NOT granted on a fresh install (opt-in, never opt-out)", async () => {
		// The acceptance criterion for P1-001. A store that shipped `.default(true)`
		// — or, equivalently, that treated "no stored value" as permission — would
		// pass every other test in this file and still be the defect.
		const { getTelemetryConsent, isTelemetryConsentGranted } =
			await importStore();

		expect(getTelemetryConsent()).toBe("undecided");
		expect(isTelemetryConsentGranted()).toBe(false);
	});

	it("owes the user a decision on a fresh install", async () => {
		const { needsTelemetryConsentPrompt } = await importStore();

		expect(needsTelemetryConsentPrompt()).toBe(true);
	});
});

describe("telemetry consent — granting", () => {
	it("flips the gate only after an explicit accept, and persists it", async () => {
		const { isTelemetryConsentGranted, grantTelemetryConsent } =
			await importStore();

		expect(isTelemetryConsentGranted()).toBe(false);
		grantTelemetryConsent();

		expect(isTelemetryConsentGranted()).toBe(true);
		expect(storage.getItem(TELEMETRY_CONSENT_KEY)).toBe("granted");
	});

	it("stops asking once granted", async () => {
		const { grantTelemetryConsent, needsTelemetryConsentPrompt } =
			await importStore();

		grantTelemetryConsent();

		expect(needsTelemetryConsentPrompt()).toBe(false);
	});

	it("survives a restart: the grant is re-read from storage, not from memory", async () => {
		(await importStore()).grantTelemetryConsent();

		// New module instance == new app launch, as far as this store is concerned.
		const relaunched = await importStore();

		expect(relaunched.getTelemetryConsent()).toBe("granted");
		expect(relaunched.isTelemetryConsentGranted()).toBe(true);
		expect(relaunched.needsTelemetryConsentPrompt()).toBe(false);
	});
});

describe("telemetry consent — declining", () => {
	it("persists a decline and never re-asks", async () => {
		// A dialog that comes back on every launch gets dismissed without being read,
		// and a dialog dismissed without being read has not consented to anything.
		const { declineTelemetryConsent } = await importStore();

		declineTelemetryConsent();

		expect(storage.getItem(TELEMETRY_CONSENT_KEY)).toBe("declined");

		const relaunched = await importStore();
		expect(relaunched.getTelemetryConsent()).toBe("declined");
		expect(relaunched.isTelemetryConsentGranted()).toBe(false);
		expect(relaunched.needsTelemetryConsentPrompt()).toBe(false);
	});

	it("keeps 'declined' distinguishable from 'never asked' on disk", async () => {
		// Removing the key instead of writing "declined" would make the two states
		// identical, and the dialog would reopen forever.
		const { declineTelemetryConsent } = await importStore();

		declineTelemetryConsent();

		expect(storage.getItem(TELEMETRY_CONSENT_KEY)).not.toBeNull();
	});

	it("can revoke a previous grant (the same switch doubles as opt-out later)", async () => {
		const {
			declineTelemetryConsent,
			grantTelemetryConsent,
			isTelemetryConsentGranted,
		} = await importStore();

		grantTelemetryConsent();
		expect(isTelemetryConsentGranted()).toBe(true);

		declineTelemetryConsent();

		expect(isTelemetryConsentGranted()).toBe(false);
		expect(storage.getItem(TELEMETRY_CONSENT_KEY)).toBe("declined");
	});
});

describe("telemetry consent — fail-closed", () => {
	it("treats a stored value that is not an exact match as undecided", async () => {
		// The truthiness trap. `"1"`, `"true"`, `"yes"` and `" granted"` are all
		// non-empty strings, and a `if (raw)` gate would accept every one of them —
		// including a half-written or hand-edited value. Consent must be earned by
		// an exact match or not at all.
		for (const value of [
			"1",
			"true",
			"TRUE",
			"yes",
			" granted",
			"granted ",
			" ",
		]) {
			storage.setItem(TELEMETRY_CONSENT_KEY, value);
			vi.resetModules();

			const store = await importStore();

			expect(store.isTelemetryConsentGranted()).toBe(false);
			expect(store.getTelemetryConsent()).toBe("undecided");
		}
	});

	it("is undecided when there is no storage at all", async () => {
		// SSR, a WebView with storage disabled, and the `node` vitest project all
		// land here. The question is not whether consent survives — it cannot — but
		// whether the absence is read as "no" rather than as permission.
		vi.stubGlobal("localStorage", undefined);
		vi.resetModules();

		const store = await importStore();

		expect(store.isTelemetryConsentGranted()).toBe(false);
		expect(store.needsTelemetryConsentPrompt()).toBe(true);
	});

	it("does not keep an in-memory grant when there is nowhere to persist it", async () => {
		// Otherwise the session would ping off a consent that does not exist, and
		// the next launch would re-ask — the UI would claim a choice that was never
		// durable.
		vi.stubGlobal("localStorage", undefined);
		vi.resetModules();

		const store = await importStore();
		store.grantTelemetryConsent();

		expect(store.isTelemetryConsentGranted()).toBe(false);
		expect(store.getTelemetryConsent()).toBe("undecided");
	});

	it("is undecided when reading storage throws", async () => {
		// A sandboxed iframe / storage-disabled WebView throws on ACCESS to
		// `window.localStorage`, not only on use.
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("storage disabled");
			},
			setItem: () => {},
			removeItem: () => {},
		});
		vi.resetModules();

		const store = await importStore();

		expect(store.isTelemetryConsentGranted()).toBe(false);
	});

	it("rolls the grant back when writing it throws", async () => {
		// A quota error or a disabled store must not leave the session believing it
		// has consent it failed to record.
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
			removeItem: () => {},
		});
		vi.resetModules();

		const store = await importStore();
		store.grantTelemetryConsent();

		expect(store.isTelemetryConsentGranted()).toBe(false);
		expect(store.needsTelemetryConsentPrompt()).toBe(true);
		expect(console.error).toHaveBeenCalled();
	});
});
