import { describe, expect, it } from "vitest";

/**
 * Static contract guard for `$lib/api/audio`'s `url`.
 *
 * WHY A STATIC TEST: the defect this pins is the ABSENCE of a fallback plus the
 * presence of a specific error. Both are cheap to assert on the source, and this
 * repo already has that precedent — `cdn-image-layout.guard.test.ts` is a static
 * guard over `CdnImage.svelte` for exactly the same reason (a DOM environment
 * could assert it more strongly, but the guard is the cheap dependency-free
 * subset that stops the regression).
 *
 * The behavioural half — that the send is actually REFUSED — lives in
 * `audio.test.ts`, which drives `uploadAudioBlob` through a mocked `invoke`. This
 * file exists for the thing that test cannot see: that somebody later "helpfully"
 * re-adds a synthesized URL, or swaps in a different invented path shape.
 *
 * ## What the server actually returns
 *
 * `uploadAudioBlob` uploads through the `upload_image` Tauri command, which POSTs
 * to `/v5/chat/media/upload` (`src-tauri/src/api/rest.rs`). The documented
 * response is `{ mediaId, mediaHash, url }`
 * (`docs/content/grindr-api/users/profiles.md`), and chat media is served from
 * SIGNED CLOUDFRONT:
 *
 *   /{uploaderProfileId}/{mediaHash}?Expires=…&Signature=…&Key-Pair-Id=…
 *
 * (`docs/content/grindr-api/media/signed-cdn-files.md`). The `Signature` and
 * `Key-Pair-Id` are server-minted, so the URL cannot be rebuilt from `mediaHash`
 * — which is why the docs say to read the `url` property. The audio hash is also
 * 64 chars (private/SHA-256) where the public image path wants 40
 * (`docs/content/grindr-api/media/index.md`). Hence: no fallback, fail loudly.
 */

/**
 * Read through Vite's `?raw` glob rather than `node:fs` — the project has no
 * `@types/node`, so importing `node:fs`/`node:path` or touching `process` fails
 * `svelte-check`. `cdn-image-layout.guard.test.ts` documents the same choice.
 */
const RAW_TS = import.meta.glob("/src/**/*.ts", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

function sourceEndingWith(suffix: string): string | undefined {
	const key = Object.keys(RAW_TS).find((p) => p.endsWith(suffix));
	return key === undefined ? undefined : RAW_TS[key];
}

/** The raw source of `$lib/api/audio`. */
function audioSource(): string {
	const src = sourceEndingWith("lib/api/audio.ts");
	// Without this, a rename would make every assertion below vacuously true —
	// the exact failure mode `cdn-image-layout.guard.test.ts` guards against.
	expect(src, "$lib/api/audio.ts not found — assertions below would be vacuous").toBeDefined();
	return src ?? "";
}

/** The `return { … }` object literal `uploadAudioBlob` builds. */
function uploadReturnObject(): string {
	const src = audioSource();
	const start = src.lastIndexOf("return {");
	expect(start, "uploadAudioBlob's return object not found").toBeGreaterThan(-1);
	return src.slice(start);
}

/**
 * The source with whole-line comments removed.
 *
 * This file's header DOCUMENTS the defect by naming the bad URL it removed, so a
 * naive `not.toMatch(/cdns\.grindr\.com/)` would fail on the explanation itself.
 * Comment lines carry no behaviour, so the "never synthesizes a URL" assertions
 * are made against code only. A trailing comment after a statement is kept,
 * since that line IS code.
 */
function codeWithoutComments(src: string): string {
	return src
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
		})
		.join("\n");
}

describe("$lib/api/audio url contract", () => {
	it("exists", () => {
		expect(audioSource()).not.toBe("");
	});

	it("never synthesizes a CDN URL", () => {
		const code = codeWithoutComments(audioSource());
		// Any hand-built CDN URL in this module is a guess about a server contract
		// that cannot be determined from the codebase. `mediaHash` alone does not
		// address chat media.
		expect(code).not.toMatch(/https?:\/\/cdns\.grindr\.com/);
		expect(code).not.toMatch(/https?:\/\/d2wxe7lth7kp8g\.cloudfront\.net/);
		// Nor a template literal that assembles a host out of a hash.
		expect(code).not.toMatch(/\$\{[^}]*mediaHash[^}]*\}/);
	});

	it("passes the server's url through unchanged rather than substituting one", () => {
		const returned = codeWithoutComments(uploadReturnObject());
		expect(returned).toMatch(/url:\s*parsed\.data\.url\s*,/);
		// A `??`/`||` on `url` is the exact shape of the old invalid fallback.
		expect(returned).not.toMatch(/url:[^,]*(\?\?|\|\|)/);
	});

	it("refuses explicitly when the response carries no url", () => {
		const code = codeWithoutComments(audioSource());
		expect(code).toMatch(/parsed\.data\.url === undefined/);
		expect(code).toMatch(/parsed\.data\.url === null/);
		expect(code).toMatch(/missing `url`/);
	});

	it("keeps the reasoning in the source, so the next author can check it", () => {
		const src = audioSource();
		// The three facts that make a fallback impossible: signed CDN, hash class,
		// server-minted signature. If a future edit removes the fallback, the
		// reasoning must stay to explain why it cannot come back.
		expect(src).toMatch(/cloudfront/i);
		expect(src).toMatch(/Key-Pair-Id/);
		expect(src).toMatch(/64-char|64 character/i);
	});

	it("types the returned url as required, matching audioMessageSchema", () => {
		// `audioMessageSchema` in `$lib/model/message` types `url` as a required
		// `z.url()`, so `UploadedAudio.url` cannot be optional or nullable either.
		const src = audioSource();
		expect(src).toMatch(/export type UploadedAudio = \{[\s\S]*?\burl:\s*string;/);
	});

	it("does not reintroduce a TODO admitting the url is unverified", () => {
		expect(audioSource()).not.toMatch(/TODO\(verify against a live device\)/);
	});
});