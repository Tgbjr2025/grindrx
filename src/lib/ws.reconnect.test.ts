import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The parked-socket regression.
 *
 * Rust deliberately parks the reconnect budget after N failures and does NOT
 * self-notify — that is the whole point of the budget. The frontend half of
 * that contract was never finished: `reconnectExhausted` was assigned by the
 * listener and read by NOTHING, and `retryAfterExhaustion()` had exactly one
 * reference, its own definition. So after ~5 minutes offline the socket was
 * dead until the app was force-quit, with nothing on screen explaining why.
 *
 * These tests pin the *behaviour*, not the shape. The important assertion is
 * that exhaustion leads to a further attempt — whether by timer or by a person
 * tapping a button — because that is precisely what was missing.
 */

const invoke = vi.fn();
const listenCalls: Array<{ event: string; handler: (e: { payload: unknown }) => void }> = [];

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => invoke(...args),
	emit: vi.fn(),
}));

// `listen` comes from @tauri-apps/api/event in ws.svelte.ts, not from core.
vi.mock("@tauri-apps/api/event", () => ({
	listen: (event: string, handler: (e: { payload: unknown }) => void) => {
		listenCalls.push({ event, handler });
		return Promise.resolve(() => {});
	},
}));

// Fire EVERY handler registered for an event, not just the first. `ws:connected`
// has two listeners: one sets `status`, the other clears the parked state. Only
// dispatching to the first would leave `reconnectExhausted` set and make a
// healthy socket look parked.
const fire = (event: string, payload: unknown) => {
	const cs = listenCalls.filter((l) => l.event === event);
	if (cs.length === 0) throw new Error(`no listener registered for ${event}`);
	for (const c of cs) c.handler({ payload });
};

describe("parked websocket recovery", () => {
	// `ws` is a module-level singleton and the module is cached, so it is booted
	// ONCE. Re-importing per test would return the same instance while
	// `listenCalls` — which the constructor fills once — had been cleared, and
	// every handler would look unregistered.
	let ws: typeof import("$lib/ws.svelte").ws;

	beforeAll(async () => {
		// Fake timers must be on before boot: the constructor registers listeners
		// through promises that settle on the microtask queue, which we drain
		// below.
		vi.useFakeTimers();
		const mod = await import("$lib/ws.svelte");
		ws = mod.ws;
		// let the listen() promises settle so handlers are registered
		await vi.advanceTimersByTimeAsync(0);
	});

	beforeEach(() => {
		vi.useFakeTimers();
		invoke.mockReset();
		invoke.mockResolvedValue(undefined);
		// Reset any parked state left by the previous test.
		ws.reconnectExhausted = null;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const EXHAUSTED = {
		attempts: 10,
		maxAttempts: 10,
		backoffSecs: 30,
		lastError: "connection refused",
	};

	it("retries on its own after the budget parks, with no user action", async () => {
		fire("ws:reconnect_exhausted", EXHAUSTED);
		expect(ws.reconnectExhausted).not.toBeNull();

		invoke.mockClear();
		// Nothing has retried yet — the failure was that it never would.
		expect(invoke).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(60_000);

		// The whole point: an unattended retry actually happened.
		expect(invoke).toHaveBeenCalledWith("ws_connect");
	});

	it("clears the parked state once the socket is back", async () => {
		fire("ws:reconnect_exhausted", EXHAUSTED);
		expect(ws.reconnectExhausted).not.toBeNull();

		fire("ws:connected", undefined);
		expect(ws.reconnectExhausted).toBeNull();
	});

	it("does not retry after recovery, so a live socket is left alone", async () => {
		fire("ws:reconnect_exhausted", EXHAUSTED);
		fire("ws:connected", undefined);
		invoke.mockClear();

		await vi.advanceTimersByTimeAsync(120_000);
		expect(invoke).not.toHaveBeenCalled();
	});

	it("ignores a malformed exhaustion payload rather than half-applying it", async () => {
		fire("ws:reconnect_exhausted", { nonsense: true });
		expect(ws.reconnectExhausted).toBeNull();

		await vi.advanceTimersByTimeAsync(60_000);
		expect(invoke).not.toHaveBeenCalled();
	});

	it("re-arms after a failed manual retry instead of giving up for good", async () => {
		invoke.mockRejectedValue(new Error("no session"));

		fire("ws:reconnect_exhausted", EXHAUSTED);

		const ok = await ws.retryAfterExhaustion();
		expect(ok).toBe(false);
		expect(ws.reconnectExhausted).not.toBeNull();

		invoke.mockClear();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(invoke).toHaveBeenCalledWith("ws_connect");
	});
});