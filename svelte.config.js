// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const projectVersion = JSON.parse(
	fs.readFileSync(path.join(rootDir, "./package.json"), "utf-8"),
).version;

const headersRsPath = path.join(rootDir, "./src-tauri/src/api/headers.rs");
const headersRs = fs.readFileSync(headersRsPath, "utf-8");

// These two constants are the ONLY place the app learns the Grindr client version
// it spoofs in its API User-Agent. They are scraped out of the Rust source with a
// regex, which is inherently fragile: rustfmt changing the spacing, or the constant
// being renamed or made `pub`, makes the match return undefined while the build
// still succeeds. That failure is invisible — the app would just ship a malformed
// `grindr3/;` in its User-Agent on every request. So fail LOUDLY and specifically
// instead. Run `bun run check` / `bun run build` after touching headers.rs.
//
// The real fix is a machine-readable source of truth (a `version.json` the Rust
// build script includes, or `tauri_build::get_version()` surfaced to JS) rather
// than text-scraping a .rs file. That is out of scope for this pass.
function scrapeRustConst(name) {
	const match = headersRs.match(
		new RegExp(String.raw`(?:pub\s+)?const\s+${name}\s*:\s*&str\s*=\s*"([^"]*)"\s*;`),
	);
	if (!match || !match[1]) {
		throw new Error(
			`[svelte.config] Could not read \`${name}\` from ${headersRsPath}.\n` +
				`  Expected a line like:  const ${name}: &str = "…";\n` +
				`  The app spoofs this value in its Grindr API User-Agent; a silent ` +
				`failure here ships a broken User-Agent with no build error.\n` +
				`  If the constant was renamed, re-made \`pub\`, or reformatted away ` +
				`from this shape, update the regex above to match — do NOT relax it to ` +
				`an empty default.`,
		);
	}
	return match[1];
}

const grindrApiVersion = scrapeRustConst("APP_VERSION");
const grindrApiBuildNumber = scrapeRustConst("BUILD_NUMBER");

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		experimental: {
			async: true,
		},
	},
	kit: {
		adapter: adapter({
			fallback: "index.html",
		}),
		alias: {
			$layout: "src/layout.css",
		},
		version: {
			name: `GrindrX/${projectVersion}\ngrindr3/${grindrApiVersion};${grindrApiBuildNumber}`,
		},
	},
};

export default config;
