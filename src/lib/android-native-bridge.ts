import { addPluginListener } from "@tauri-apps/api/core";

import { backGestureEventHandlers } from "$lib/back-gesture-event.svelte";

const SAFE_AREA_SIDES = ["top", "bottom", "left", "right"] as const;
const IME_RESIZE_FALLBACK_MS = 150;

type SafeAreaSide = (typeof SAFE_AREA_SIDES)[number];

export type NativeInsets = Record<SafeAreaSide, number> & { ime: boolean };

let appliedImeVisible: boolean | undefined;
let deferredInsets: NativeInsets | undefined;
let deferredInsetsTimeout: ReturnType<typeof setTimeout> | undefined;

function readNativeInsets(): NativeInsets | undefined {
	const bridge = window.__AndroidInsets;
	if (!bridge) return undefined;
	return {
		top: bridge.top(),
		bottom: bridge.bottom(),
		left: bridge.left(),
		right: bridge.right(),
		ime: bridge.imeVisible?.() ?? false,
	};
}

function writeSafeAreaInsets(valueOf: (side: SafeAreaSide) => string) {
	const rootStyle = document.documentElement.style;
	for (const side of SAFE_AREA_SIDES) {
		rootStyle.setProperty(`--safe-area-${side}`, valueOf(side));
	}
}

function applyNativeInsets(insets: NativeInsets) {
	appliedImeVisible = insets.ime;
	writeSafeAreaInsets((side) => `${insets[side]}px`);
}

function cancelDeferredInsets() {
	window.removeEventListener("resize", applyDeferredInsets);
	clearTimeout(deferredInsetsTimeout);
	deferredInsets = undefined;
}

function applyDeferredInsets() {
	const insets = deferredInsets;
	cancelDeferredInsets();
	if (insets) applyNativeInsets(insets);
}

function deferInsetsUntilResize(insets: NativeInsets) {
	if (!deferredInsets) {
		window.addEventListener("resize", applyDeferredInsets);
		deferredInsetsTimeout = setTimeout(
			applyDeferredInsets,
			IME_RESIZE_FALLBACK_MS,
		);
	}
	deferredInsets = insets;
}

export function applyAndroidInsets(dispatch?: NativeInsets) {
	window.__reapplyInsets = applyAndroidInsets;
	const insets = dispatch ?? readNativeInsets();
	if (!insets) {
		writeSafeAreaInsets((side) => `env(safe-area-inset-${side}, 0px)`);
		return;
	}
	// The IME inset arrives from the plugin BEFORE the WebView has actually
	// resized, so applying it immediately makes `--safe-area-*` jump ahead of a
	// layout that is still settling; the resize event that follows is the moment
	// the real viewport height exists, so hold the insets until then. The timeout
	// is the fallback for a device that never resizes (hardware keyboard, or a
	// focus change that does not move the IME).
	//
	// This is a padding jump, NOT a covered input: MainActivity.kt already
	// shrinks the WebView by the IME height via `bottomMargin`.
	const imeFlipped =
		appliedImeVisible !== undefined && insets.ime !== appliedImeVisible;
	if (imeFlipped) {
		deferInsetsUntilResize(insets);
		return;
	}
	cancelDeferredInsets();
	applyNativeInsets(insets);
}

export function softKeyboardVisibility(): boolean | undefined {
	return window.__AndroidInsets?.imeVisible?.();
}

export function softKeyboardHidden({
	settleMs,
}: {
	settleMs: number;
}): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			window.removeEventListener("resize", done);
			clearTimeout(timeout);
			resolve();
		};
		const timeout = setTimeout(done, settleMs);
		window.addEventListener("resize", done);
	});
}

function runBackGestureHandlers(): boolean {
	for (const handler of [...backGestureEventHandlers].reverse()) {
		if (handler() !== true) return true;
	}
	return false;
}

export function applyBackGestureHandler() {
	window.__AndroidOnBackGesture = () => !runBackGestureHandlers();
}

export async function registerAndroidBackButtonListener() {
	await addPluginListener(
		"app",
		"back-button",
		({ canGoBack }: { canGoBack: boolean }) => {
			if (runBackGestureHandlers()) return;
			if (window.navigation?.canGoBack ?? canGoBack) history.back();
			else window.__AndroidBack?.moveTaskToBack();
		},
	);
}
