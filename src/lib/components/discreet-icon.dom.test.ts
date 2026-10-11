/**
 * The discreet-icon regression.
 *
 * The `activity-alias` entries were dropped from AndroidManifest.xml and the
 * `__DiscreetMode` bridge was dropped from MainActivity.kt, while this very
 * component was left in the tree. It gates itself on `{#if available}`, where
 * `available` requires the bridge — so with both dependencies gone it rendered
 * NOTHING and the feature vanished with no error, no disabled toggle and no
 * message. A user who remembered the setting had no way to tell it was gone.
 *
 * DOM test (jsdom + browser resolve conditions) because the property that
 * matters is observable only in a rendered tree: whether the toggle APPEARS.
 * A source-grep guard on `DiscreetIconSetting.svelte` would pass against the
 * broken state, since the component was never edited — the Android side was.
 * That is why the manifest and Kotlin assertions are here too: a green DOM
 * test alone would be satisfied by a component that is simply never shown.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as svelte from "svelte";

import MANIFEST from "../../../src-tauri/gen/android/app/src/main/AndroidManifest.xml?raw";
import KOTLIN from "../../../src-tauri/gen/android/app/src/main/java/com/grindrx/app/MainActivity.kt?raw";

const TARGET =
	"$lib/../routes/(protected)/(navbar)/settings/(subpage)/app/DiscreetIconSetting.svelte";

let DiscreetIconSetting: import("svelte").Component;

beforeAll(async () => {
	// Dynamically, so the component and `mount` come from the same module
	// generation — see the equivalent note in telemetry-consent-dialog.dom.test.ts.
	DiscreetIconSetting = (await import(TARGET)).default;
});

let target: HTMLElement;
beforeEach(() => {
	target = document.createElement("div");
	document.body.append(target);
});
afterEach(() => {
	document.body.innerHTML = "";
	delete (window as unknown as Record<string, unknown>).__DiscreetMode;
});

describe("DiscreetIconSetting", () => {
	it("hides itself when no bridge is present", () => {
		const instance = svelte.mount(DiscreetIconSetting, { target });
		expect(document.body.textContent).not.toContain("Discreet app icon");
		void svelte.unmount(instance);
	});

	it("RENDERS the toggle when the bridge exists — the regression's whole point", async () => {
		(window as unknown as Record<string, unknown>).__DiscreetMode = {
			isDiscreet: () => true,
			setDiscreet: vi.fn(),
		};

		const instance = svelte.mount(DiscreetIconSetting, { target });
		// `available` is set in onMount, which runs after mount in a microtask.
		await svelte.tick();
		expect(document.body.textContent).toContain("Discreet app icon");
		void svelte.unmount(instance);
	});

	it("does not crash when the bridge throws", async () => {
		(window as unknown as Record<string, unknown>).__DiscreetMode = {
			isDiscreet: () => {
				throw new Error("no package manager");
			},
			setDiscreet: vi.fn(),
		};

		let instance: unknown;
		expect(() => {
			instance = svelte.mount(DiscreetIconSetting, { target });
		}).not.toThrow();
		await svelte.tick();
		expect(document.body.textContent).toContain("Discreet app icon");
		void svelte.unmount(instance as Parameters<typeof svelte.unmount>[0]);
	});
});

describe("the Android surface it depends on", () => {
	// @types/node is not a dependency, so `node:fs` does not type-check here.
	// Vite's `?raw` import gives the same text without pulling in a types
	// package for two assertions.
	const manifest = () => MANIFEST;
	const kotlin = () => KOTLIN;

	it("manifest declares both aliases", () => {
		const xml = manifest();
		expect(xml).toContain('android:name=".MainAlias"');
		expect(xml).toContain('android:name=".WeatherAlias"');
		expect(xml).toContain('android:targetActivity=".MainActivity"');
	});

	it("the weather alias ships DISABLED, so nobody gets a Weather icon by default", () => {
		const xml = manifest();
		const at = xml.indexOf('android:name=".WeatherAlias"');
		expect(at).toBeGreaterThan(-1);
		expect(xml.slice(at, at + 400)).toContain('android:enabled="false"');
	});

	it("MainActivity is not ALSO a launcher — that would give two home-screen icons", () => {
		const xml = manifest();
		const at = xml.indexOf('android:name=".MainActivity"');
		const block = xml.slice(Math.max(0, at - 500), at + 120);
		expect(block).not.toContain("android.intent.category.LAUNCHER");
	});

	it("the bridge is registered under the exact name the component probes for", () => {
		const kt = kotlin();
		expect(kt).toContain('"__DiscreetMode"');
		expect(kt).toContain("class DiscreetModeInterface");
		// Alias names must agree with the manifest or the toggle flips nothing.
		expect(kt).toContain("WeatherAlias");
		expect(kt).toContain("MainAlias");
	});
});