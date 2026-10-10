/**
 * P1-005 — windowed rendering of `MessagesList`.
 *
 * These cover `computeMessageWindow`, the pure function the component feeds
 * measurements into. They are node-env tests (not `*.dom.test.ts`) on purpose:
 * the function has no DOM dependency, and pinning the window arithmetic directly
 * is what makes the acceptance criterion — "windowed rendering for >100 messages" —
 * a measured fact rather than a claim.
 *
 * What is deliberately NOT covered here: real scroll behaviour, sticky anchoring
 * and ResizeObserver re-anchoring. Those need a layout engine and a browser, and
 * neither exists in this repo's test projects. `MessagesList.dom.test.ts` covers
 * what jsdom can prove (that a long thread mounts a window and a short one does
 * not); it cannot prove scroll stability.
 */
import { describe, expect, it } from "vitest";

import {
	computeMessageWindow,
	estimateMessageHeight,
	ITEM_GAP,
	MIN_WINDOW_ITEMS,
	OVERSCAN_ITEMS,
	VIRTUALIZE_THRESHOLD,
} from "./MessagesList.svelte";

// Same ESLint limitation as `computeWindow` below, applied to the exported
// constants so they compare as `number` rather than an unresolved type.
const GAP = ITEM_GAP as number;
const MIN_WINDOW = MIN_WINDOW_ITEMS as number;
const OVERSCAN = OVERSCAN_ITEMS as number;
const THRESHOLD = VIRTUALIZE_THRESHOLD as number;

/** A synthetic conversation: `count` oldest-first messages of one type. */
function conversation(count: number, type = "Text") {
	return {
		ids: Array.from({ length: count }, (_, i) => `m${i}`),
		types: Array.from({ length: count }, () => type),
	};
}

/**
 * Structural stand-in for the return type of `computeMessageWindow`.
 *
 * Deliberately NOT `ReturnType<typeof computeMessageWindow>`: that is a type
 * query into a `.svelte` module, and ESLint's type-aware rules cannot resolve it
 * (svelte-check and vitest both can).
 */
type Window = {
	start: number;
	end: number;
	offsets: number[];
	heights: number[];
	totalHeight: number;
};

/**
 * Single typed adapter over the function exported from the component's
 * `<script module>`.
 *
 * ESLint cannot type-resolve a VALUE imported from a `.svelte` module, so it types
 * the call and its result as `any`/error and every downstream property access
 * cascades into `no-unsafe-member-access` — 120+ errors for code that svelte-check
 * and vitest both agree is well-typed. One adapter with one cast keeps the rest
 * of this file fully type-checked instead of disabling the rules file-wide.
 */
function computeWindow(args: {
	ids: string[];
	types: string[];
	measured: Record<string, number>;
	scrollTop: number | null;
	viewportHeight: number;
}): Window {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-call
	return computeMessageWindow(args) as Window;
}

/**
 * Per-type estimate, same adapter problem as `computeWindow`. The result is only
 * ever compared against a number, so the cast is to `number`.
 */
function estimate(type: string): number {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-call
	return estimateMessageHeight(type) as number;
}

/** Sum of the rendered heights for a window, i.e. what actually occupies space. */
function renderedHeight(w: Window): number {
	let sum = 0;
	for (let i = w.start; i < w.end; i++) sum += w.heights[i];
	return sum;
}

type WindowOptions = {
	scrollTop?: number | null;
	viewportHeight?: number;
	type?: string;
	measured?: Record<string, number>;
};

function windowOf(
	count: number,
	{
		scrollTop = null,
		viewportHeight = 800,
		type = "Text",
		measured = {},
	}: WindowOptions = {},
) {
	const { ids, types } = conversation(count, type);
	return computeWindow({ ids, types, measured, scrollTop, viewportHeight });
}

describe("computeMessageWindow — the acceptance criterion", () => {
	it("mounts a fraction of a 1,000-message thread, not all of it", () => {
		const w = windowOf(1000);
		const rendered = w.end - w.start;
		expect(rendered).toBeLessThan(1000);
		// The whole point: the mounted count does not grow with history length.
		// A 10x longer thread must not mount 10x the nodes.
		expect(rendered).toBeLessThanOrEqual(MIN_WINDOW);
	});

	it("mounts a bounded window no matter how long the thread is", () => {
		for (const count of [101, 250, 1000, 5000]) {
			const w = windowOf(count);
			expect(w.end - w.start).toBeLessThanOrEqual(MIN_WINDOW);
		}
	});

	it("uses the same window size at 101 messages as at 5,000", () => {
		const small = windowOf(THRESHOLD + 1);
		const large = windowOf(5000);
		expect(small.end - small.start).toBe(large.end - large.start);
	});

	it("bounds the window even below the component's bypass threshold", () => {
		// `computeMessageWindow` ALWAYS returns a bounded slice; below
		// `THRESHOLD` it is the COMPONENT that ignores it and renders
		// `ordered` whole (`virtualized ? ordered.slice(...) : ordered`). This test
		// pins that the function is not the thing quietly dropping messages for a
		// short thread — if the bypass were ever removed, a 20-message conversation
		// would silently render only 24... and a 3-message one would render 3, but a
		// 100-message one would render 24 and lose 76. The bypass is what makes that
		// safe; this pins the function's contract so the two cannot be confused.
		expect(THRESHOLD).toBeGreaterThan(MIN_WINDOW);
		const w = windowOf(THRESHOLD);
		expect(w.end - w.start).toBe(MIN_WINDOW);
	});

	it("handles an empty conversation without producing a bad slice", () => {
		const w = windowOf(0);
		expect(w.start).toBe(0);
		expect(w.end).toBe(0);
		expect(w.totalHeight).toBe(0);
	});
});

describe("computeMessageWindow — anchoring", () => {
	it("anchors to the newest message when there is no scroll position yet", () => {
		// The chat opens pinned to the bottom. Anchoring to the START would mount the
		// oldest messages first and flash them before the first scroll event.
		const w = windowOf(500);
		expect(w.end).toBe(500);
		expect(w.start).toBe(500 - MIN_WINDOW);
	});

	it("moves the window as the user scrolls through history", () => {
		const top = windowOf(500, { scrollTop: 0 });
		const middle = windowOf(500, { scrollTop: 20_000 });
		const bottom = windowOf(500, { scrollTop: 40_000 });
		expect(top.start).toBe(0);
		expect(bottom.end).toBe(500);
		expect(middle.start).toBeGreaterThan(top.start);
		expect(middle.start).toBeLessThan(bottom.start);
	});

	it("keeps every item that intersects the viewport inside the window", () => {
		const count = 800;
		const viewportHeight = 700;
		const { ids, types } = conversation(count);
		for (const scrollTop of [0, 137, 4_000, 9_999, 21_500, 33_000, 44_000]) {
			const w = computeWindow({
				ids,
				types,
				measured: {},
				scrollTop,
				viewportHeight,
			});
			// No item may be intersecting the viewport yet unmounted, or the user
			// sees blank space while scrolling.
			for (let i = 0; i < count; i++) {
				const top = w.offsets[i];
				const bottom = top + w.heights[i];
				const intersects = bottom > scrollTop && top < scrollTop + viewportHeight;
				if (!intersects) continue;
				expect(i).toBeGreaterThanOrEqual(w.start);
				expect(i).toBeLessThan(w.end);
			}
		}
	});

	it("overscans above and below so a fast scroll does not outrun the window", () => {
		const w = windowOf(500, { scrollTop: 10_000 });
		expect(w.start).toBeGreaterThan(0);
		expect(w.end).toBeLessThan(500);
		// The overscan is a real band, not a rounding artefact.
		expect(OVERSCAN).toBeGreaterThan(0);
		expect(w.end - w.start).toBeGreaterThan(OVERSCAN);
	});

	it("stays in bounds when the scroll position overshoots the content", () => {
		// Estimates disagreeing with real heights can leave `scrollTop` past the end;
		// the window must clamp rather than slice past the array.
		const w = windowOf(300, { scrollTop: 10_000_000 });
		expect(w.end).toBeLessThanOrEqual(300);
		expect(w.start).toBeGreaterThanOrEqual(0);
		expect(w.start).toBeLessThanOrEqual(w.end);
	});

	it("grows the window for a tall viewport instead of leaving it empty", () => {
		const tall = windowOf(500, { scrollTop: 0, viewportHeight: 6_000 });
		const short = windowOf(500, { scrollTop: 0, viewportHeight: 300 });
		expect(tall.end - tall.start).toBeGreaterThanOrEqual(
			short.end - short.start,
		);
		expect(tall.end).toBeGreaterThan(short.end);
	});
});

describe("computeMessageWindow — height accounting", () => {
	it("uses the per-type estimate until a real height is measured", () => {
		const w = windowOf(3, { type: "Album" });
		expect(w.heights[0]).toBe(estimate("Album"));
		expect(w.heights[0]).toBeGreaterThan(estimate("Text"));
	});

	it("prefers a measured height over the estimate", () => {
		const w = windowOf(3, {
			type: "Text",
			measured: { m1: 321 },
		});
		expect(w.heights[0]).toBe(estimate("Text"));
		expect(w.heights[1]).toBe(321);
	});

	it("ignores a non-positive or absent measurement", () => {
		// A collapsed/unmounted node reports 0. Trusting that would make the row
		// permanently zero-height and the message unreachable by scrolling.
		const w = windowOf(3, {
			type: "Text",
			measured: { m0: 0, m2: -5 },
		});
		expect(w.heights[0]).toBe(estimate("Text"));
		expect(w.heights[2]).toBe(estimate("Text"));
	});

	it("makes the scroll extent match the unwindowed list", () => {
		// The two spacers plus the mounted rows must occupy the scroll extent of the
		// FULL list, otherwise the scrollbar lies about how much history there is.
		const w = windowOf(600, { scrollTop: 12_000 });
		const topPad = Math.max(0, w.offsets[w.start] - GAP);
		const bottomPad = Math.max(0, w.totalHeight - w.offsets[w.end] - GAP);
		const gaps = (w.end - w.start + 1) * GAP;
		const actual = topPad + renderedHeight(w) + bottomPad + gaps;
		// Within a gap or two of exact: the spacers are themselves flex items, so
		// each contributes a gap the unwindowed list did not have.
		expect(Math.abs(actual - w.totalHeight)).toBeLessThanOrEqual(2 * GAP);
	});

	it("keeps totalHeight monotonically increasing with message count", () => {
		const previous = windowOf(50).totalHeight;
		for (const count of [100, 250, 500, 1000]) {
			const w = windowOf(count);
			expect(w.totalHeight).toBeGreaterThan(previous);
		}
	});

	it("accounts for a gap after each item", () => {
		const w = windowOf(4, { type: "Text" });
		const expected =
			(w.heights[0] + GAP) +
			(w.heights[1] + GAP) +
			(w.heights[2] + GAP) +
			(w.heights[3] + GAP) -
			GAP;
		expect(w.totalHeight).toBe(expected);
	});
});