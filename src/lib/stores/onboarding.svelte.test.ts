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
		getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear(),
		key: (i: number) => Array.from(store.keys())[i] ?? null,
		get length() {
			return store.size;
		},
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("localStorage", createMemoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

describe("onboarding store", () => {
	it("reports first run when nothing is recorded, then not after the tour/version is marked", async () => {
		const m = await import("$lib/stores/onboarding.svelte");
		expect(m.isFirstRun()).toBe(true);
		m.markTourDone();
		expect(m.isFirstRun()).toBe(false);
		expect(m.isTourDone()).toBe(true);
	});

	it("isNewVersion is false on a fresh install (no prior version) and true after an upgrade", async () => {
		const m = await import("$lib/stores/onboarding.svelte");
		// No version recorded yet -> not treated as an "upgrade" (that's first-run).
		expect(m.isNewVersion("0.1.30")).toBe(false);
		m.markVersionSeen("0.1.29");
		expect(m.isNewVersion("0.1.29")).toBe(false);
		expect(m.isNewVersion("0.1.30")).toBe(true);
		m.markVersionSeen("0.1.30");
		expect(m.isNewVersion("0.1.30")).toBe(false);
	});
});
