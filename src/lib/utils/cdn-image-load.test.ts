import { describe, expect, it } from "vitest";

import {
	nextStateOnError,
	nextStateOnLoad,
	nextStateOnRetryFailure,
	nextStateOnRetryResult,
	shouldRenderImage,
	type CdnImageLoadState,
} from "./cdn-image-load";

const ALL_STATES: CdnImageLoadState[] = ["loading", "retrying", "loaded", "failed"];
const DIRECT = "https://cdns.grindr.com/images/thumb/320x320/abc";
const BLOB = "blob:http://localhost/retry";

describe("shouldRenderImage", () => {
	it("renders an image in every non-terminal state", () => {
		expect(shouldRenderImage("loading")).toBe(true);
		expect(shouldRenderImage("retrying")).toBe(true);
		expect(shouldRenderImage("loaded")).toBe(true);
	});

	it("renders NO image in the terminal state", () => {
		// The defect: a terminally failed image stayed mounted and kept painting
		// the browser's broken-image glyph over the placeholder.
		expect(shouldRenderImage("failed")).toBe(false);
	});
});

describe("nextStateOnError", () => {
	it("retries exactly once: the direct failure moves to `retrying`", () => {
		expect(nextStateOnError("loading")).toBe("retrying");
	});

	it("is terminal when the retried URL also errors", () => {
		expect(nextStateOnError("retrying")).toBe("failed");
	});

	it("is terminal when an already-loaded image errors (bytes do not decode)", () => {
		expect(nextStateOnError("loaded")).toBe("failed");
	});

	it("stays terminal on a stray error, so the retry cannot loop", () => {
		expect(nextStateOnError("failed")).toBe("failed");
	});

	it("can only ever retry from `loading`, and only once", () => {
		// Walk the cycle many times over: the machine arms a retry exactly once,
		// and once terminal it absorbs rather than re-arming.
		let state: CdnImageLoadState = "loading";
		let retries = 0;
		let terminal = false;
		for (let i = 0; i < 20; i++) {
			const next = nextStateOnError(state);
			if (next === "retrying") retries++;
			// Once the machine is terminal it must absorb every subsequent error; before
			// that it may arm exactly one retry.
			if (terminal) expect(next, `iteration ${i} re-armed a retry`).toBe("failed");
			if (next === "failed") terminal = true;
			state = next;
		}
		expect(retries).toBe(1);
		expect(state).toBe("failed");
	});

	it("is total: every state has a defined successor", () => {
		for (const state of ALL_STATES) {
			expect(ALL_STATES).toContain(nextStateOnError(state));
		}
	});
});

describe("nextStateOnRetryResult", () => {
	it("accepts a genuinely new URL (the authed blob)", () => {
		expect(nextStateOnRetryResult(DIRECT, BLOB)).toBe("loaded");
	});

	it("is terminal on a passthrough — the URL that just failed", () => {
		// THE DEFECT. `resolveAuthedImageRetained` returns its argument unchanged
		// when the authed fetch fails; treating that as a retry dead-ends with a
		// broken image still on screen.
		expect(nextStateOnRetryResult(DIRECT, DIRECT)).toBe("failed");
	});

	it("is terminal on an empty URL", () => {
		expect(nextStateOnRetryResult(DIRECT, "")).toBe("failed");
	});

	it("is terminal regardless of which state the retry was issued from", () => {
		expect(nextStateOnRetryResult(DIRECT, DIRECT)).not.toBe("retrying");
	});
});

describe("nextStateOnLoad", () => {
	it("confirms a load in every non-terminal state", () => {
		expect(nextStateOnLoad("loading")).toBe("loaded");
		expect(nextStateOnLoad("retrying")).toBe("loaded");
		expect(nextStateOnLoad("loaded")).toBe("loaded");
	});

	it("does not resurrect a terminal failure from a late load event", () => {
		expect(nextStateOnLoad("failed")).toBe("failed");
	});
});

describe("nextStateOnRetryFailure", () => {
	it("is terminal — a rejected retry has nothing left to try", () => {
		expect(nextStateOnRetryFailure()).toBe("failed");
		expect(shouldRenderImage(nextStateOnRetryFailure())).toBe(false);
	});
});

describe("the load -> retry -> terminal flow", () => {
	it("reaches the fallback after an unrecoverable direct load", () => {
		let state: CdnImageLoadState = "loading";
		state = nextStateOnError(state); // direct load failed
		expect(state).toBe("retrying");
		expect(shouldRenderImage(state)).toBe(true);
		state = nextStateOnRetryResult(DIRECT, DIRECT); // resolver passthrough
		expect(state).toBe("failed");
		expect(shouldRenderImage(state)).toBe(false);
	});

	it("reaches `loaded` instead when the retry is worth something", () => {
		let state: CdnImageLoadState = "loading";
		state = nextStateOnError(state);
		state = nextStateOnRetryResult(DIRECT, BLOB);
		expect(state).toBe("loaded");
		expect(shouldRenderImage(state)).toBe(true);
	});
});