/**
 * The gated usage ping (P1-001).
 *
 * This file pins the gate with the consent module MOCKED, deliberately. The gate's
 * whole job is "refuse to call through unless told yes", and the way that fails is
 * by asking the wrong question — a truthy check, a check after the call, a check
 * that throws and is not caught. Driving those from a controllable stub is the only
 * way to pin them precisely. The other half of the story — that the real consent
 * store really does start `false`, really does flip on accept, and really does
 * survive a decline — lives in `consent.svelte.test.ts`, and the two halves are
 * then exercised together in `consent-ping.integration.test.ts`.
 *
 * `$lib/api/usage` is mocked at the Tauri boundary, so nothing here needs a WebView,
 * a Rust toolchain, or a network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/api/usage", () => ({
	sendUsagePing: vi.fn(),
}));

/**
 * Fresh consent + gate pair per test. `vi.resetModules()` re-runs the `vi.mock`
 * factory, so the `sendUsagePing` handle has to be re-imported alongside them —
 * a handle captured at file scope would point at a dead module instance.
 */
async function importGate(granted: boolean) {
	vi.resetModules();
	const usage = await import("$lib/api/usage");
	const sendUsagePing = vi.mocked(usage.sendUsagePing);
	sendUsagePing.mockResolvedValue(undefined);
	// Both exports the gate actually consumes must be stubbed. `pushConsentToRust`
	// is not optional here: the gate calls it before deciding, so a partial mock
	// makes the module throw and the gate fail closed — which reads as "the ping
	// never sends" rather than as "the mock is wrong".
	const pushConsentToRust = vi.fn().mockResolvedValue(undefined);
	vi.doMock("$lib/telemetry/consent.svelte", () => ({
		isTelemetryConsentGranted: () => granted,
		pushConsentToRust,
	}));
	const gate = await import("$lib/telemetry/usage-ping");
	return { gate, sendUsagePing, pushConsentToRust };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.doUnmock("$lib/telemetry/consent.svelte");
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("sendUsagePingIfConsented", () => {
	it("does NOT send when consent has not been given, and reports it sent nothing", async () => {
		// The core of P1-001. Before this gate, `+layout.svelte` called the raw
		// `sendUsagePing()` unconditionally on every launch.
		const { gate, sendUsagePing } = await importGate(false);

		const sent = await gate.sendUsagePingIfConsented();

		expect(sent).toBe(false);
		expect(sendUsagePing).not.toHaveBeenCalled();
	});

	it("sends exactly once after an explicit accept", async () => {
		const { gate, sendUsagePing } = await importGate(true);

		const sent = await gate.sendUsagePingIfConsented();

		expect(sent).toBe(true);
		expect(sendUsagePing).toHaveBeenCalledTimes(1);
	});

	it("sends once per call, not once per launch, after an accept", async () => {
		// Guards against a "fire and forget, then forget the flag" regression where
		// a second call in the same session goes out ungated.
		const { gate, sendUsagePing } = await importGate(true);

		await gate.sendUsagePingIfConsented();
		await gate.sendUsagePingIfConsented();

		expect(sendUsagePing).toHaveBeenCalledTimes(2);
	});

	it("sends nothing when reading the consent flag throws", async () => {
		// A broken consent layer must fail towards "do not send". Swallowing the
		// error and continuing would be the worst possible direction for it to go in.
		vi.resetModules();
		const usage = await import("$lib/api/usage");
		const sendUsagePing = vi.mocked(usage.sendUsagePing);
		vi.doMock("$lib/telemetry/consent.svelte", () => ({
			isTelemetryConsentGranted: () => {
				throw new Error("consent store exploded");
			},
		}));
		const gate = await import("$lib/telemetry/usage-ping");

		const sent = await gate.sendUsagePingIfConsented();

		expect(sent).toBe(false);
		expect(sendUsagePing).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalled();
	});

	it("never rejects, even if the ping itself fails", async () => {
		// It runs on the launch path. An unhandled rejection there takes down app
		// start over a best-effort counter. Unreachable today (`sendUsagePing`
		// swallows its own failures) and kept so the promise survives an edit there.
		vi.resetModules();
		const usage = await import("$lib/api/usage");
		vi.mocked(usage.sendUsagePing).mockRejectedValue(new Error("network down"));
		vi.doMock("$lib/telemetry/consent.svelte", () => ({
			isTelemetryConsentGranted: () => true,
			pushConsentToRust: vi.fn().mockResolvedValue(undefined),
		}));
		const gate = await import("$lib/telemetry/usage-ping");

		await expect(gate.sendUsagePingIfConsented()).resolves.toBe(true);
		expect(console.warn).toHaveBeenCalled();
	});
});

describe("Rust consent mirror", () => {
	// Rust holds the authoritative gate and starts every process at
	// "not consented", so the gate must re-assert the decision on each launch or
	// a prior grant would silently stop working after the next cold start.
	it("pushes `granted` into Rust before sending after an accept", async () => {
		const { gate, sendUsagePing, pushConsentToRust } = await importGate(true);

		await gate.sendUsagePingIfConsented();

		expect(pushConsentToRust).toHaveBeenCalledWith("granted");
		expect(sendUsagePing).toHaveBeenCalledTimes(1);
	});

	it("pushes `declined` into Rust when consent was refused", async () => {
		const { gate, sendUsagePing, pushConsentToRust } = await importGate(false);

		const sent = await gate.sendUsagePingIfConsented();

		expect(pushConsentToRust).toHaveBeenCalledWith("declined");
		expect(sendUsagePing).not.toHaveBeenCalled();
		expect(sent).toBe(false);
	});

	it("fails closed and skips the ping if the Rust push throws", async () => {
		// Rust defaults to not-consented, so a push that never lands means the
		// ping cannot be sent even if the WebView believes consent was given.
		vi.resetModules();
		const usage = await import("$lib/api/usage");
		const sendUsagePing = vi.mocked(usage.sendUsagePing);
		sendUsagePing.mockResolvedValue(undefined);
		vi.doMock("$lib/telemetry/consent.svelte", () => ({
			isTelemetryConsentGranted: () => true,
			pushConsentToRust: vi.fn().mockRejectedValue(new Error("no bridge")),
		}));
		const gate = await import("$lib/telemetry/usage-ping");

		await expect(gate.sendUsagePingIfConsented()).resolves.toBe(false);
		expect(sendUsagePing).not.toHaveBeenCalled();
	});
});
