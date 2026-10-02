/**
 * Runs in the `dom` vitest project (jsdom + browser resolve conditions), selected
 * by the `*.dom.test.ts` suffix — see `vite.config.mjs`.
 *
 * android-native-bridge reads `window.__AndroidInsets`, `document.documentElement.style` and
 * listens for `resize`, so it needs a DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NativeInsets } from "./android-native-bridge";

const IME_RESIZE_FALLBACK_MS = 150;

// `appliedImeVisible` / `deferredInsets` are MODULE-level state, and the IME
// deferral branches on the previously-applied value. A fresh module per test is
// the only way to test "first IME open" vs "IME close" without tests passing by
// accident of ordering.
async function load() {
	vi.resetModules();
	const bridge = await import("./android-native-bridge");
	const events = await import("./back-gesture-event.svelte");
	return { ...bridge, backGestureEventHandlers: events.backGestureEventHandlers };
}

function insets(overrides: Partial<NativeInsets> = {}): NativeInsets {
	return { top: 0, bottom: 0, left: 0, right: 0, ime: false, ...overrides };
}

function installBridge(values: Partial<NativeInsets> = {}) {
	const resolved = insets(values);
	window.__AndroidInsets = {
		top: () => resolved.top,
		bottom: () => resolved.bottom,
		left: () => resolved.left,
		right: () => resolved.right,
		imeVisible: () => resolved.ime,
	};
	return resolved;
}

function safeArea(side: string): string {
	return document.documentElement.style.getPropertyValue(`--safe-area-${side}`);
}

beforeEach(() => {
	document.documentElement.removeAttribute("style");
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	delete window.__AndroidInsets;
	delete window.__AndroidBack;
	delete window.__AndroidOnBackGesture;
	document.documentElement.removeAttribute("style");
});

describe("applyAndroidInsets", () => {
	it("falls back to CSS env() insets when no native bridge exists", async () => {
		const { applyAndroidInsets } = await load();

		applyAndroidInsets();

		expect(safeArea("top")).toBe("env(safe-area-inset-top, 0px)");
		expect(safeArea("bottom")).toBe("env(safe-area-inset-bottom, 0px)");
		expect(safeArea("left")).toBe("env(safe-area-inset-left, 0px)");
		expect(safeArea("right")).toBe("env(safe-area-inset-right, 0px)");
	});

	it("writes native pixel insets when the bridge reports them", async () => {
		const { applyAndroidInsets } = await load();
		installBridge({ top: 44, bottom: 24 });

		applyAndroidInsets();

		expect(safeArea("top")).toBe("44px");
		expect(safeArea("bottom")).toBe("24px");
	});

	it("applies a dispatched payload, which is what the Kotlin side sends", async () => {
		const { applyAndroidInsets } = await load();

		applyAndroidInsets(insets({ top: 96, bottom: 12 }));

		expect(safeArea("top")).toBe("96px");
		expect(safeArea("bottom")).toBe("12px");
	});

	// The reason this module defers at all. The Kotlin side reports the new
	// inset BEFORE the WebView has resized, so applying immediately makes
	// `--safe-area-*` jump ahead of the layout that is still settling.
	// NOTE: the keyboard is NOT hidden by this — `MainActivity.kt` already
	// shrinks the WebView by the IME height via `bottomMargin`, in BOTH this fork
	// and upstream. This is about avoiding a padding jump, not a covered input.
	it("holds the new insets back when the IME opens, until the resize lands", async () => {
		const { applyAndroidInsets } = await load();
		applyAndroidInsets(insets({ top: 44 }));
		installBridge({ top: 44, bottom: 300, ime: true });

		applyAndroidInsets();

		// Not yet applied — the pre-keyboard value still stands.
		expect(safeArea("bottom")).toBe("0px");

		window.dispatchEvent(new Event("resize"));

		expect(safeArea("bottom")).toBe("300px");
	});

	it("applies the deferred insets on the timeout when no resize ever arrives", async () => {
		const { applyAndroidInsets } = await load();
		applyAndroidInsets(insets({ top: 44 }));
		installBridge({ top: 44, bottom: 300, ime: true });
		applyAndroidInsets();
		expect(safeArea("bottom")).toBe("0px");

		vi.advanceTimersByTime(IME_RESIZE_FALLBACK_MS);

		expect(safeArea("bottom")).toBe("300px");
	});

	it("keeps only the latest insets while deferring", async () => {
		const { applyAndroidInsets } = await load();
		applyAndroidInsets(insets({ top: 44 }));
		installBridge({ bottom: 300, ime: true });
		applyAndroidInsets();
		installBridge({ bottom: 340, ime: true });
		applyAndroidInsets();

		vi.advanceTimersByTime(IME_RESIZE_FALLBACK_MS);

		expect(safeArea("bottom")).toBe("340px");
	});

	it("applies immediately when the IME visibility has not flipped", async () => {
		const { applyAndroidInsets } = await load();
		applyAndroidInsets(insets({ top: 44, bottom: 24, ime: false }));

		// Same IME state, different geometry (rotation) — nothing to wait for.
		applyAndroidInsets(insets({ top: 24, bottom: 44, ime: false }));

		expect(safeArea("top")).toBe("24px");
		expect(safeArea("bottom")).toBe("44px");
	});

	// The deferral is SYMMETRIC — an IME close defers too, not just an open.
	// Upstream treats any visibility flip the same way, and it self-heals: closing
	// the keyboard always resizes the WebView, and the 150ms timeout is the
	// backstop. Pinned here because it reads like a bug until you check.
	it("defers the IME close as well, then applies it on resize", async () => {
		const { applyAndroidInsets } = await load();
		applyAndroidInsets(insets({ bottom: 300, ime: true }));

		applyAndroidInsets(insets({ bottom: 24, ime: false }));
		expect(safeArea("bottom")).toBe("300px");

		window.dispatchEvent(new Event("resize"));
		expect(safeArea("bottom")).toBe("24px");
	});

	it("recovers a stale IME-close inset via the timeout if no resize arrives", async () => {
		const { applyAndroidInsets } = await load();
		applyAndroidInsets(insets({ bottom: 300, ime: true }));
		applyAndroidInsets(insets({ bottom: 24, ime: false }));

		vi.advanceTimersByTime(IME_RESIZE_FALLBACK_MS);

		expect(safeArea("bottom")).toBe("24px");
	});

	it("applies the first ever IME open without waiting, having nothing to compare", async () => {
		const { applyAndroidInsets } = await load();

		// No prior application, so `appliedImeVisible` is undefined and there is
		// no "flip" to detect. Pins that documented first-run behaviour.
		applyAndroidInsets(insets({ bottom: 300, ime: true }));

		expect(safeArea("bottom")).toBe("300px");
	});
});

describe("soft keyboard visibility", () => {
	it("reports undefined when the bridge is absent", async () => {
		const { softKeyboardVisibility } = await load();

		expect(softKeyboardVisibility()).toBeUndefined();
	});

	it("reports the native IME state when the bridge exposes it", async () => {
		const { softKeyboardVisibility } = await load();
		installBridge({ ime: true });

		expect(softKeyboardVisibility()).toBe(true);
	});

	it("does not throw on a bridge without imeVisible", async () => {
		const { softKeyboardVisibility } = await load();
		window.__AndroidInsets = {
			top: () => 0,
			bottom: () => 0,
			left: () => 0,
			right: () => 0,
		};

		expect(softKeyboardVisibility()).toBeUndefined();
	});
});

describe("softKeyboardHidden", () => {
	it("resolves on resize", async () => {
		const { softKeyboardHidden } = await load();
		const hidden = softKeyboardHidden({ settleMs: 1_000 });

		window.dispatchEvent(new Event("resize"));

		await expect(hidden).resolves.toBeUndefined();
	});

	it("resolves after the settle timeout when no resize arrives", async () => {
		const { softKeyboardHidden } = await load();
		const hidden = softKeyboardHidden({ settleMs: 200 });

		vi.advanceTimersByTime(200);

		await expect(hidden).resolves.toBeUndefined();
	});

	it("removes its own resize listener so it cannot leak", async () => {
		const { softKeyboardHidden } = await load();
		const added = vi.spyOn(window, "addEventListener");
		const removed = vi.spyOn(window, "removeEventListener");

		const hidden = softKeyboardHidden({ settleMs: 100 });
		vi.advanceTimersByTime(100);
		await hidden;

		const resizeAdds = added.mock.calls.filter(([type]) => type === "resize");
		const resizeRemoves = removed.mock.calls.filter(
			([type]) => type === "resize",
		);
		expect(resizeRemoves.length).toBe(resizeAdds.length);
		added.mockRestore();
		removed.mockRestore();
	});
});

describe("applyBackGestureHandler", () => {
	// The handler contract is inverted from what it looks like: a handler
	// returning `false` has CONSUMED the gesture (`dismissOnBackGesture` returns
	// false after dismissing). Returning `true` declines it and the next handler
	// is tried. `__AndroidOnBackGesture` returns true when nothing consumed it,
	// which is what tells Kotlin it may navigate.
	it("reports unhandled when no handler is registered", async () => {
		const { applyBackGestureHandler } = await load();
		applyBackGestureHandler();

		expect(window.__AndroidOnBackGesture?.()).toBe(true);
	});

	it("reports handled when a dismiss handler consumes the gesture", async () => {
		const { applyBackGestureHandler, backGestureEventHandlers } = await load();
		backGestureEventHandlers.add(() => false);
		applyBackGestureHandler();

		expect(window.__AndroidOnBackGesture?.()).toBe(false);
	});

	it("passes the gesture on when a handler declines it", async () => {
		const { applyBackGestureHandler, backGestureEventHandlers } = await load();
		backGestureEventHandlers.add(() => true);
		applyBackGestureHandler();

		expect(window.__AndroidOnBackGesture?.()).toBe(true);
	});

	// Topmost-first: the most recently added overlay must be offered the gesture
	// before an older one underneath it.
	it("offers the gesture to the most recently added handler first", async () => {
		const { applyBackGestureHandler, backGestureEventHandlers } = await load();
		const order: string[] = [];
		backGestureEventHandlers.add(() => {
			order.push("under");
			return true;
		});
		backGestureEventHandlers.add(() => {
			order.push("top");
			return false;
		});
		applyBackGestureHandler();

		expect(window.__AndroidOnBackGesture?.()).toBe(false);
		expect(order).toEqual(["top"]);
	});

	it("falls through to the next handler when the top one declines", async () => {
		const { applyBackGestureHandler, backGestureEventHandlers } = await load();
		const order: string[] = [];
		backGestureEventHandlers.add(() => {
			order.push("under");
			return false;
		});
		backGestureEventHandlers.add(() => {
			order.push("top");
			return true;
		});
		applyBackGestureHandler();

		expect(window.__AndroidOnBackGesture?.()).toBe(false);
		expect(order).toEqual(["top", "under"]);
	});
});
