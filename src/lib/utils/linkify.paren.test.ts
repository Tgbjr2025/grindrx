// Paren handling in `linkifySegments`.
//
// This is a NEW file rather than an addition to `linkify.test.ts`, which is owned
// by another agent. Only the trailing-paren rule is covered here; everything else
// in `linkify.ts` is untouched.
import { describe, expect, it } from "vitest";

import { linkifySegments } from "$lib/utils/linkify";

/** Just the URL segments, for compact assertions. */
function urls(text: string): string[] {
	return linkifySegments(text)
		.filter((s) => s.type === "url")
		.map((s) => s.value);
}

describe("linkifySegments trailing parens", () => {
	// The single-trailing-paren case the ORIGINAL heuristic already handled:
	// the paren closes the URL's own unbalanced open, so it belongs to the URL.
	it("keeps a closing paren that balances the URL's own open paren", () => {
		expect(urls("see https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual([
			"https://en.wikipedia.org/wiki/Foo_(bar)",
		]);
	});

	// THE REGRESSION: a balanced-but-trailing URL. The old check was
	// `url.includes("(") && !url.slice(0, -1).includes(")")`, which is false here
	// (the char before the final `)` IS a `)`), so BOTH parens were stripped and
	// the link became the broken `…/Foo_(bar`.
	it("keeps only one paren on a balanced-but-trailing URL", () => {
		expect(urls("see https://en.wikipedia.org/wiki/Foo_(bar))")).toEqual([
			"https://en.wikipedia.org/wiki/Foo_(bar)",
		]);
	});

	it("still strips a sentence paren that closes nothing", () => {
		expect(urls("(see https://example.com/x)")).toEqual([
			"https://example.com/x",
		]);
	});

	it("keeps the balanced URL and leaves the surplus paren as text", () => {
		const segments = linkifySegments(
			"https://en.wikipedia.org/wiki/Foo_(bar))",
		);
		expect(segments).toEqual([
			{ type: "url", value: "https://en.wikipedia.org/wiki/Foo_(bar)" },
			{ type: "text", value: ")" },
		]);
	});

	it("handles a nested open paren with a trailing close", () => {
		expect(
			urls("https://en.wikipedia.org/wiki/Foo_(bar_(baz)) and more"),
		).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar_(baz))"]);
	});

	it("peels a trailing period after a balanced paren without eating the paren", () => {
		const segments = linkifySegments(
			"https://en.wikipedia.org/wiki/Foo_(bar).",
		);
		expect(segments).toEqual([
			{ type: "url", value: "https://en.wikipedia.org/wiki/Foo_(bar)" },
			{ type: "text", value: "." },
		]);
	});

	it("leaves a URL with no parens at all untouched", () => {
		expect(urls("go to https://example.com/page!")).toEqual([
			"https://example.com/page",
		]);
	});
});
