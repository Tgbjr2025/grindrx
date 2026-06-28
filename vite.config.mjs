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

	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
}));
