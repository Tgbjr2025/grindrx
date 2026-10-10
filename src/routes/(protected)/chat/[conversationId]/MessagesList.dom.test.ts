/**
 * P1-005 — `MessagesList` renders a window, not the whole thread.
 *
 * Runs in the `dom` vitest project (jsdom + browser resolve conditions), selected
 * by the `*.dom.test.ts` suffix — see `vite.config.mjs`.
 *
 * `messages-window.test.ts` pins the window arithmetic. This file pins the part
 * only a mounted component can prove: that the component actually USES it, that a
 * long thread mounts a strict subset of its messages, and — the regression risk —
 * that a thread below the threshold mounts every message with no wrapper and no
 * spacer elements at all, i.e. the element tree is byte-for-byte what it was
 * before P1-005.
 *
 * ## What this cannot prove
 *
 * jsdom has no layout: `clientHeight` is 0, `scrollHeight` is 0, and setting
 * `scrollTop` fires no scroll event and moves nothing. So scroll anchoring, the
 * sticky "N new messages" pill, ResizeObserver-driven re-measurement and the
 * top-sentinel history pagination are all UNVERIFIED here — they need a real
 * browser, and this repo has no such harness. Do not read a green run of this
 * file as evidence that scrolling behaves.
 */
import { mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiResponseMessage } from "$lib/model/message";
import type { ConversationState } from "./conversation-state.svelte";
import MessagesList from "./MessagesList.svelte";
import { VIRTUALIZE_THRESHOLD } from "./MessagesList.svelte";

// ESLint cannot type-resolve a value imported from a `.svelte` module, so the
// threshold is aliased to a plain `number` before it reaches any call.
const THRESHOLD = VIRTUALIZE_THRESHOLD as number;

const OUR_PROFILE_ID = 7;
const THEIRS = 99;

/**
 * `IntersectionObserver` does not exist in jsdom, and `Message.svelte` uses it to
 * report reads on inbound messages. A no-op stub is enough: the read-reporting
 * path is out of scope here, and letting it throw would stop the component
 * mounting at all.
 */
class NoopIntersectionObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
	readonly root = null;
	readonly rootMargin = "";
	readonly thresholds: readonly number[] = [];
}

/** A conversation of `count` Text messages, oldest id `m-000`. */
function buildMessages(count: number): ApiResponseMessage[] {
	// `conversationState.messages` is newest-first (see `messages.ts` pagination
	// comments); `MessagesList` reverses it for display.
	return Array.from({ length: count }, (_, i) => {
		const age = count - 1 - i;
		return {
			type: "Text",
			body: { text: `message ${age}` },
			messageId: `m-${String(age).padStart(3, "0")}`,
			conversationId: "conversation-1",
			// Alternate senders so `getStackedMessages` does not collapse them into
			// one bubble group, and space them a minute apart for the same reason.
			senderId: i % 2 === 0 ? THEIRS : OUR_PROFILE_ID,
			timestamp: 1_710_000_000_000 + age * 60_000,
			unsent: false,
			reactions: [],
		} as unknown as ApiResponseMessage;
	});
}

function buildState(count: number): ConversationState {
	return {
		conversationId: "conversation-1",
		ourProfileId: OUR_PROFILE_ID,
		messages: buildMessages(count),
		loading: false,
		error: null,
		loadingMore: false,
		// `null` stops history pagination, which is what keeps the top sentinel —
		// and its IntersectionObserver — out of this test.
		pageKey: null,
		recipientReadTimestamp: null,
		refresh: () => Promise.resolve(),
		loadMore: () => Promise.resolve(true),
		reportRead: () => {},
		remove: () => ({ revert: () => {} }),
		reactTo: () => Promise.resolve("ok"),
		markMessageAsUnsent: () => ({ revert: () => {} }),
		retry: () => {},
	} as unknown as ConversationState;
}

/** Mounted messages carry this sr-only control (see `Message.svelte`). */
function countMessageActions(root: HTMLElement): number {
	return [...root.querySelectorAll("button")].filter(
		(button) => button.textContent?.trim() === "Message actions",
	).length;
}

let dispose: (() => void) | undefined;

function render(count: number): HTMLElement {
	const target = document.createElement("div");
	document.body.append(target);
	const component = mount(MessagesList, {
		target,
		props: { conversationState: buildState(count) },
	});
	dispose = () => {
		void unmount(component);
		target.remove();
	};
	return target;
}

// jsdom implements no scrolling and no layout: `scrollTo` does not exist, and
// `scrollHeight`/`clientHeight` are always 0. The component scrolls the list to
// the bottom on mount, so `scrollTo` must exist for it to mount at all. Installed
// at module scope rather than in `beforeEach` because the mount effect scrolls
// from a `tick().then(...)` continuation that can resolve AFTER `afterEach` has
// already restored the original prototype — which produced unhandled rejections.
// Typed as a plain record so these are property WRITES rather than unbound
// method references, which `no-unbound-method` rejects on the prototype access.
const elementPrototype = Element.prototype as unknown as Record<
	string,
	unknown
>;
elementPrototype.scrollTo ??= function scrollTo() {};
elementPrototype.scrollIntoView ??= function scrollIntoView() {};

beforeEach(() => {
	vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
});

afterEach(() => {
	vi.unstubAllGlobals();
	dispose?.();
	dispose = undefined;
});

describe("MessagesList windowed rendering", () => {
	it(`mounts far fewer than all ${THRESHOLD + 50} messages in a long thread`, () => {
		const target = render(THRESHOLD + 50);
		const mounted = target.querySelectorAll(
			'[data-testid="message-window-item"]',
		).length;
		expect(mounted).toBeGreaterThan(0);
		expect(mounted).toBeLessThan(THRESHOLD + 50);
	});

	it("renders every message in a thread below the threshold", () => {
		// The important regression guard: short conversations are the overwhelming
		// majority and must keep their original element tree — no measurement
		// wrapper, no spacers.
		const count = THRESHOLD;
		const target = render(count);
		expect(
			target.querySelectorAll('[data-testid="message-window-item"]').length,
		).toBe(0);
		expect(
			target.querySelector('[data-testid="messages-top-spacer"]'),
		).toBeNull();
		expect(
			target.querySelector('[data-testid="messages-bottom-spacer"]'),
		).toBeNull();
		expect(countMessageActions(target)).toBe(count);
	});

	it("pads above but not below, because the window reaches the newest message", () => {
		const target = render(THRESHOLD + 50);
		// The window is anchored to the END, so nothing is missing below it and there
		// is no bottom spacer — but everything above it is represented by the top
		// spacer, which is what keeps the scrollbar honest about the history the
		// user has not scrolled to yet.
		const top = target.querySelector('[data-testid="messages-top-spacer"]');
		expect(top).not.toBeNull();
		expect(top?.getAttribute("aria-hidden")).toBe("true");
		expect(top?.getAttribute("style")).toMatch(/height:\s*\d+px/);
		expect(
			Number(top?.getAttribute("style")?.replace(/\D+/g, "")),
		).toBeGreaterThan(0);
		expect(
			target.querySelector('[data-testid="messages-bottom-spacer"]'),
		).toBeNull();
	});

	it("anchors the initial window to the newest message", () => {
		// The chat opens pinned to the bottom; mounting the OLDEST messages first
		// would flash the start of the thread before the first scroll.
		const target = render(THRESHOLD + 50);
		const ids = [
			...target.querySelectorAll('[data-message-id]'),
		].map((node) => node.getAttribute("data-message-id"));
		expect(ids.at(-1)).toBe(`m-${String(THRESHOLD + 49).padStart(3, "0")}`);
		expect(ids).toHaveLength(new Set(ids).size);
	});

	it("keeps the newest messages rendered rather than the oldest", () => {
		const target = render(THRESHOLD + 50);
		const ids = [
			...target.querySelectorAll('[data-message-id]'),
		].map((node) => node.getAttribute("data-message-id"));
		expect(ids).not.toContain("m-000");
	});
});