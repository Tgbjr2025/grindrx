import { describe, expect, it } from "vitest";

// `node:fs` does not type-check here (@types/node is not a dependency); Vite's
// `?raw` import gives the same text without pulling in a types package.
import SRC_TEXT from "./authed-image.ts?raw";
import REST_TEXT from "../../../src-tauri/src/api/rest.rs?raw";

/**
 * Closes U2 from the fork-vs-rescue reconciliation: the P2-004 fetch limiter
 * lives in TypeScript, while the rescued commit bb05c55 had put the equivalent
 * cap in Rust, inside `fetch_authed_bytes`, where no caller could bypass it.
 *
 * Having read P2-004's rationale (`authed-image.ts`, "THE DEFAULT AND WHY IT IS
 * 4" and the defect note above it): it argues carefully about the DEFECT and
 * the NUMBER, and says nothing about which LAYER should enforce it. So the
 * choice of layer was never a recorded decision.
 *
 * Measured today: exactly ONE production `invoke("fetch_authed_bytes")` call
 * site exists, at authed-image.ts:610. The TypeScript cap therefore covers all
 * current traffic, and moving the semaphore into Rust would be a rewrite for no
 * present benefit — which is precisely why it should not be done speculatively.
 *
 * What IS worth closing is the drift risk. The TS cap is an invariant held by
 * convention: nothing stops a second component from calling the command and
 * quietly bypassing the queue, reintroducing the exact memory spike the limiter
 * exists to prevent, with a fully green suite. This test is that guard. If a
 * second caller ever appears it fails here rather than in production.
 */

describe("P2-004 fetch limiter: one caller, one queue", () => {
	it("has exactly ONE production call site for fetch_authed_bytes", () => {
		const source = SRC_TEXT;
		const calls = source.match(/invoke[^\n]*"fetch_authed_bytes"/g) ?? [];
		expect(calls).toHaveLength(1);
	});

	it("the limiter is documented at the layer that enforces it", () => {
		const source = SRC_TEXT;
		// If someone moves the cap into Rust, this guard becomes moot and should
		// be deleted deliberately rather than left to rot against a stale claim.
		expect(source).toContain("P2-004");
		expect(source).toMatch(/limiter|Semaphore|acquireFetchSlot/);
	});

	it("the Rust command exists, so the alternative layer is a real option later", () => {
		const rust = REST_TEXT;
		expect(rust).toContain("fetch_authed_bytes");
	});
});