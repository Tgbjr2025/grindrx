import { describe, expect, it } from "vitest";

/**
 * A shipped regression guard, not a style rule.
 *
 * `@tauri-apps/plugin-opener`'s `openUrl` is BROKEN ON ANDROID: its JS binding
 * invokes `plugin:opener|open_url`, but tauri-plugin-opener 2.5.3's Android
 * implementation registers the command as `open` (`OpenerPlugin.kt`:
 * `@Command fun open`) while its desktop build registers `open_url`. The
 * capability grants `commands.allow = ["open_url"]` — a name Android does not
 * have — so the real command is not permitted either. Every call rejects, and
 * because the returned promise was never awaited the rejection was silent, so
 * the button just did nothing.
 *
 * This shipped as v0.1.34 AND v0.1.35 and was reported twice as "the Download
 * button does nothing". The Rust half of the fix (`open_external_url`, which
 * uses the plugin's Rust API and is correct on every platform) was verified
 * present in the shipped v0.1.35 .so the whole time — the fix had simply never
 * been applied to the one call site the report was about.
 *
 * So: one grep, as a test, so the omission cannot recur silently. Use
 * `openExternalUrl` from `$lib/api/open-url`.
 *
 * `import.meta.glob` is used rather than `node:fs` because the project has no
 * `@types/node`; pulling it in for a lint guard would be a dependency change.
 */
const files = import.meta.glob("/src/**/*.{ts,svelte}", {
	query: "?raw",
	import: "default",
	eager: true,
});

/** Drop comments so the explanatory notes in open-url.ts / Link.svelte don't trip this. */
function stripComments(code: string): string {
	return code
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const offenders: string[] = [];
for (const [path, raw] of Object.entries(files)) {
	if (/\.test\.ts$/.test(path)) continue;
	// `import.meta.glob` with `query`/`import` is typed as `unknown` by Vite's
	// ambient types when the `?raw` query is used, so narrow it here. Without
	// this the file shipped a `svelte-check` error, which is the same
	// "committed without a clean type-check" pattern this test exists to prevent.
	const code = stripComments(String(raw));
	if (/from\s+["']@tauri-apps\/plugin-opener["']/.test(code)) {
		offenders.push(`${path} (imports the plugin)`);
	}
	if (/(?<!\.)\bopenUrl\s*\(/.test(code)) {
		offenders.push(`${path} (calls openUrl)`);
	}
}

describe("no source file uses the Android-broken plugin opener", () => {
	it("has no imports of @tauri-apps/plugin-opener and no openUrl() calls", () => {
		expect(
			offenders,
			`These call sites use openUrl() from @tauri-apps/plugin-opener, which rejects on ` +
				`Android (its JS asks for "open_url", its Android build registers "open"). Use ` +
				`openExternalUrl from $lib/api/open-url instead:\n  ${offenders.join("\n  ")}`,
		).toEqual([]);
	});

	it("actually scanned a meaningful number of files", () => {
		// Guards against the glob silently matching nothing, which would make the
		// check above pass vacuously — the same hollow-test trap the audit found
		// in the image-cache suite.
		expect(Object.keys(files).length).toBeGreaterThan(50);
	});
});

describe("the replacement is actually reachable", () => {
	it("$lib/api/open-url invokes open_external_url", () => {
		expect(files["/src/lib/api/open-url.ts"]).toContain(
			'invoke<OpenUrlResult>("open_external_url"',
		);
	});

	it("UpdateBanner routes its Download button through openExternalUrl", () => {
		// The exact call site that shipped broken twice.
		const banner = files["/src/lib/components/UpdateBanner.svelte"];
		expect(banner).toContain("openExternalUrl");
		expect(banner).toContain("openRelease");
	});
});
