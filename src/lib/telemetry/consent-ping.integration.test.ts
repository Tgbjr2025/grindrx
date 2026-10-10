/**
 * Telemetry consent → gated ping, end to end (P1-001).
 *
 * `consent.svelte.test.ts` pins the store in isolation and `usage-ping.test.ts`
 * pins the gate against a stubbed consent module. Both halves can each be correct
 * while the seam between them is wrong — a gate that imports the wrong symbol, a
 * store whose exported getter is not the one the gate reads, a rename that leaves
 * one file importing a stale name and silently getting `undefined` (which is
 * falsy, so it would still "fail closed" and pass every safety test while never
 * sending for anybody).
 *
 * That last one is the reason this file exists: it is the only place that proves
 * the happy path actually sends. Nothing above it would notice a gate wired to a
 * permanently-false flag.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/api/usage", () => ({
	sendUsagePing: vi.fn(),
}));

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

/** Real consent store + real gate + mocked Tauri boundary, all freshly imported. */
async function freshStack() {
	vi.resetModules();
	const usage = await import("$lib/api/usage");
	const sendUsagePing = vi.mocked(usage.sendUsagePing);
	sendUsagePing.mockResolvedValue(undefined);
	const consent = await import("$lib/telemetry/consent.svelte");
	const ping = await import("$lib/telemetry/usage-ping");
	return { consent, ping, sendUsagePing };
}

let storage: Storage;

beforeEach(() => {
	// `vi.mock` factories are not re-run by `vi.resetModules()`, so the
	// `sendUsagePing` handle is shared across tests in this file — without this the
	// call counts accumulate and every `not.toHaveBeenCalled()` fails on the third.
	vi.clearAllMocks();
	storage = createMemoryStorage();
	vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("launch ping is gated on explicit consent", () => {
	it("sends nothing on a first launch, before anyone has been asked", async () => {
		// This is the exact call the root layout makes in `onMount`. Before P1-001
		// it went out unconditionally on every launch, on every install, including
		// brand-new ones that had never shown a dialog.
		const { ping, sendUsagePing } = await freshStack();

		const sent = await ping.sendUsagePingIfConsented();

		expect(sent).toBe(false);
		expect(sendUsagePing).not.toHaveBeenCalled();
	});

	it("sends only after an explicit accept, and only once", async () => {
		const { consent, ping, sendUsagePing } = await freshStack();

		await ping.sendUsagePingIfConsented();
		expect(sendUsagePing).not.toHaveBeenCalled();

		consent.grantTelemetryConsent();
		await ping.sendUsagePingIfConsented();

		expect(sendUsagePing).toHaveBeenCalledTimes(1);
	});

	it("keeps sending nothing after an explicit decline, on this launch and the next", async () => {
		const { consent, ping, sendUsagePing } = await freshStack();

		consent.declineTelemetryConsent();

		expect(await ping.sendUsagePingIfConsented()).toBe(false);
		expect(sendUsagePing).not.toHaveBeenCalled();

		// Relaunch: fresh modules, but the decline is still on disk.
		const relaunched = await freshStack();

		expect(await relaunched.ping.sendUsagePingIfConsented()).toBe(false);
		expect(relaunched.sendUsagePing).not.toHaveBeenCalled();
	});

	it("keeps sending after a relaunch only if the accept was recorded", async () => {
		const { consent } = await freshStack();
		consent.grantTelemetryConsent();

		const relaunched = await freshStack();

		expect(await relaunched.ping.sendUsagePingIfConsented()).toBe(true);
		expect(relaunched.sendUsagePing).toHaveBeenCalledTimes(1);
	});

	it("sends nothing when the accept could not be persisted", async () => {
		// The consent was clicked, but it did not stick. Sending here would be a
		// ping authorised by a state that no longer exists anywhere.
		vi.stubGlobal("localStorage", undefined);

		const { consent, ping, sendUsagePing } = await freshStack();
		vi.spyOn(console, "error").mockImplementation(() => {});
		consent.grantTelemetryConsent();

		expect(await ping.sendUsagePingIfConsented()).toBe(false);
		expect(sendUsagePing).not.toHaveBeenCalled();
	});
});
