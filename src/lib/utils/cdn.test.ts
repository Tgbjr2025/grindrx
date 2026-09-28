import { describe, expect, it } from "vitest";

import { isPublicMediaHash, publicCdnUrl } from "$lib/utils/cdn";

/**
 * The one place a public CDN URL is built, replacing fourteen hand-written
 * template literals.
 */
describe("publicCdnUrl", () => {
	const HASH = "53bf423966e49affd4786207f159eba913365c5f";

	it("builds the documented thumb path", () => {
		expect(publicCdnUrl(HASH)).toBe(
			`https://cdns.grindr.com/images/thumb/320x320/${HASH}`,
		);
	});

	it("builds the documented profile path for the larger render", () => {
		expect(publicCdnUrl(HASH, "profile")).toBe(
			`https://cdns.grindr.com/images/profile/1024x1024/${HASH}`,
		);
	});

	it.each([
		["null", null],
		["undefined", undefined],
		["empty string", ""],
		["a private 64-char signed hash", "a".repeat(64)],
		["a 39-char truncation", HASH.slice(0, 39)],
		["a 41-char value", `${HASH}0`],
		["non-hex characters", "z".repeat(40)],
	])("returns null for %s rather than building a URL", (_label, value) => {
		expect(publicCdnUrl(value as string | null)).toBeNull();
	});

	it("accepts uppercase hex, because the app's own hash schema does", () => {
		// `mediaHashPublicSchema` is `z.hex().length(40)` and zod v4's `hex()`
		// matches `[0-9a-fA-F]`. This helper deliberately does not second-guess
		// the shared schema: if that one is ever tightened, this follows it.
		// (A server returning uppercase would 404 at the CDN — a rendering
		// failure, not a security one.)
		const upper = "53BF423966E49AFFD4786207F159EBA913365C5F";
		expect(publicCdnUrl(upper)).toBe(
			`https://cdns.grindr.com/images/thumb/320x320/${upper}`,
		);
	});

	it("refuses a hash carrying path or query characters", () => {
		// The hash lands in the URL PATH. A `/`, `?` or `#` would change which
		// resource is requested on an allow-listed host — a request-redirect
		// primitive built out of a server-supplied field.
		for (const injected of [
			`${HASH}/../../admin`,
			`${HASH}?sig=forged`,
			`${HASH}#frag`,
			`../${HASH}`,
		]) {
			expect(publicCdnUrl(injected)).toBeNull();
		}
	});

	it("never emits the literal strings 'undefined' or 'null' in a path", () => {
		for (const value of [null, undefined, "", "null", "undefined"]) {
			const url = publicCdnUrl(value);
			expect(url === null || !url.includes("undefined")).toBe(true);
			expect(url === null || !url.includes("/null")).toBe(true);
		}
	});
});

describe("isPublicMediaHash", () => {
	it("accepts a 40-char lowercase hex hash", () => {
		expect(isPublicMediaHash("53bf423966e49affd4786207f159eba913365c5f")).toBe(true);
	});

	it("rejects a 64-char private hash, which needs a signed URL not this path", () => {
		expect(isPublicMediaHash("a".repeat(64))).toBe(false);
	});

	it("rejects non-strings without throwing", () => {
		for (const value of [null, undefined, 42, {}, []]) {
			expect(isPublicMediaHash(value)).toBe(false);
		}
	});
});
