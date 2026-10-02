import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { sveltePhosphorOptimize } from "phosphor-svelte/vite";
import { defineConfig } from "vitest/config";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => ({
	// sveltePhosphorOptimize rewrites barrel `from "phosphor-svelte"` imports to
	// deep `phosphor-svelte/lib/Icon` imports at build time. phosphor-svelte has
	// no `sideEffects: false`, so without this the barrel can pull a large slice
	// of the icon set into the entry bundle. Must run before sveltekit().
	plugins: [sveltePhosphorOptimize(), sveltekit(), tailwindcss()],

	// Strip verbose console.* from production builds. On Android the WebView's
	// console goes to logcat (readable by any app with READ_LOGS, or over adb),
	// and these calls can carry message content, profile/conversation ids and
	// raw response bodies. console.warn/console.error are kept (low-volume,
	// error-level — schema-drift warnings, the scoped CAS-4001 diagnostic).
	esbuild: {
		pure:
			mode === "production"
				? ["console.log", "console.debug", "console.info", "console.trace"]
				: [],
	},

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},

	// Two test projects, added 2026-10-01. This project previously had ONE
	// `environment: "node"` config and therefore NO DOM at all, which is the
	// structural gap that let the v0.1.34, v0.1.36 and v0.1.38 visual
	// regressions ship through 510 green tests.
	//
	// `node` keeps every pre-existing test resolving and running exactly as
	// before — it is the same environment, the same glob, plus an exclusion.
	// `dom` opts files in by name (`*.dom.test.ts`) rather than by flipping the
	// global environment, so no existing test changes behaviour.
	//
	// `conditions: ["browser"]` is what makes `import { mount } from "svelte"`
	// resolve to the CLIENT build; without it Svelte resolves to the server
	// build and `mount` throws `lifecycle_function_unavailable`. Upstream
	// open-grind sets this globally (its `vite.config.mjs:13`), which would
	// re-resolve all 668 node tests too — deliberately not done here.
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "node",
					environment: "node",
					include: ["src/**/*.test.ts"],
					exclude: ["src/**/*.dom.test.ts"],
				},
			},
			{
				extends: true,
				resolve: { conditions: ["browser"] },
				test: {
					name: "dom",
					environment: "jsdom",
					include: ["src/**/*.dom.test.ts"],
				},
			},
		],
	},
}));
