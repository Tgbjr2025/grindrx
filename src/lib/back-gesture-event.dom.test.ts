/**
 * Runs in the `dom` vitest project (jsdom + browser resolve conditions), selected
 * by the `*.dom.test.ts` suffix — see `vite.config.mjs`.
 *
 * `dismissOnBackGesture` is a rune function (`$effect`), so it must be exercised
 * from inside a real component context — `getContext`/`setContext` throw
 * `lifecycle_outside_component` otherwise. Mounting a throwaway component is the
 * only honest way to test it.
 */
import { flushSync, mount, unmount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { afterEach, describe, expect, it } from "vitest";

import {
	backGestureEventHandlers,
	dismissOnBackGesture,
	setScreenLeaving,
} from "./back-gesture-event.svelte";

let cleanup: (() => void) | undefined;

afterEach(() => {
	if (cleanup) {
		cleanup();
		cleanup = undefined;
	}
	backGestureEventHandlers.clear();
});

// NOTE: returning a component from a component body does NOT mount it in Svelte
// 5 — the harness below therefore calls `dismissOnBackGesture` in the mounted
// component itself rather than nesting a child.
function mountComponent(
	component: Parameters<typeof mount>[0],
	props?: Record<string, unknown>,
) {
	const target = document.createElement("div");
	document.body.append(target);
	const instance = mount(component, { target, props });
	cleanup = () => {
		// `unmount` returns a Promise (it awaits outro transitions); these
		// components have none, so it settles immediately.
		void unmount(instance);
		target.remove();
	};
	return instance;
}

describe("backGestureEventHandlers", () => {
	it("starts empty and reflects additions", () => {
		expect(backGestureEventHandlers.size).toBe(0);
		const handler = () => false;
		backGestureEventHandlers.add(handler);
		expect(backGestureEventHandlers.size).toBe(1);
		backGestureEventHandlers.delete(handler);
		expect(backGestureEventHandlers.size).toBe(0);
	});
});

describe("dismissOnBackGesture", () => {
	it("registers a handler that dismisses and reports itself consumed", () => {
		let dismissed = 0;
		function Screen() {
			dismissOnBackGesture({
				active: () => true,
				dismiss: () => {
					dismissed++;
				},
			});
			return () => {};
		}

		mountComponent(Screen);
		flushSync();

		expect(backGestureEventHandlers.size).toBe(1);
		const handler = [...backGestureEventHandlers][0];
		expect(handler()).toBe(false);
		expect(dismissed).toBe(1);
	});

	it("removes its handler when the component is destroyed", () => {
		function Screen() {
			dismissOnBackGesture({ active: () => true, dismiss: () => {} });
			return () => {};
		}

		mountComponent(Screen);
		flushSync();
		expect(backGestureEventHandlers.size).toBe(1);

		cleanup?.();
		cleanup = undefined;

		expect(backGestureEventHandlers.size).toBe(0);
	});

	it("stays registered when the screen is present and active", () => {
		function Screen() {
			setScreenLeaving(() => false);
			dismissOnBackGesture({ active: () => true, dismiss: () => {} });
			return () => {};
		}

		mountComponent(Screen);
		flushSync();

		expect(backGestureEventHandlers.size).toBe(1);
	});

	// The reason the 5.55.5 shim exists. Upstream's `createContext` 3-tuple has
	// an `insideScreen` check because in Svelte < 5.57 `get` THROWS when the
	// context was never set. Copied onto the 2-tuple API without that check, a
	// screen with no `setScreenLeaving` ancestor would crash on mount.
	//
	// With no context set the screen is by definition NOT leaving, so the
	// handler registers normally — "no context" must mean "register", not
	// "bail". The assertion that matters is that mounting does not throw.
	it("does not throw, and registers normally, when no screen set the leaving context", () => {
		function Screen() {
			dismissOnBackGesture({ active: () => true, dismiss: () => {} });
			return () => {};
		}

		expect(() => mountComponent(Screen)).not.toThrow();
		flushSync();

		expect(backGestureEventHandlers.size).toBe(1);
	});

	it("does not register while the screen is leaving", () => {
		function Screen() {
			setScreenLeaving(() => true);
			dismissOnBackGesture({ active: () => true, dismiss: () => {} });
			return () => {};
		}

		mountComponent(Screen);
		flushSync();

		expect(backGestureEventHandlers.size).toBe(0);
	});

	// `SvelteSet.has` is tracked by `$effect`; a plain closure variable is not,
	// which is how the first version of this test passed vacuously.
	it("unregisters when active() turns false", () => {
		const active = new SvelteSet<string>();
		active.add("yes");
		function Screen() {
			dismissOnBackGesture({
				active: () => active.has("yes"),
				dismiss: () => {},
			});
			return () => {};
		}

		mountComponent(Screen);
		flushSync();
		expect(backGestureEventHandlers.size).toBe(1);

		active.delete("yes");
		flushSync();

		expect(backGestureEventHandlers.size).toBe(0);
	});

	it("re-registers when active() turns true again", () => {
		const active = new SvelteSet<string>();
		function Screen() {
			dismissOnBackGesture({
				active: () => active.has("yes"),
				dismiss: () => {},
			});
			return () => {};
		}

		mountComponent(Screen);
		flushSync();
		expect(backGestureEventHandlers.size).toBe(0);

		active.add("yes");
		flushSync();

		expect(backGestureEventHandlers.size).toBe(1);
	});

	it("does not register while the screen is leaving, then registers once it stays", () => {
		const leaving = new SvelteSet<string>();
		leaving.add("yes");
		function Screen() {
			setScreenLeaving(() => leaving.has("yes"));
			dismissOnBackGesture({ active: () => true, dismiss: () => {} });
			return () => {};
		}

		mountComponent(Screen);
		flushSync();
		expect(backGestureEventHandlers.size).toBe(0);

		leaving.delete("yes");
		flushSync();

		expect(backGestureEventHandlers.size).toBe(1);
	});
});
