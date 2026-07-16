import { describe, expect, it } from "vitest";

import { linkifySegments } from "./linkify";

describe("linkifySegments", () => {
	it("plain text becomes a single text segment", () => {
		expect(linkifySegments("hey there")).toEqual([{ type: "text", value: "hey there" }]);
	});

	it("extracts a url in the middle of text", () => {
		expect(linkifySegments("check https://example.com/x now")).toEqual([
			{ type: "text", value: "check " },
			{ type: "url", value: "https://example.com/x" },
			{ type: "text", value: " now" },
		]);
	});

	it("strips trailing sentence punctuation off the url", () => {
		expect(linkifySegments("see https://a.com.")).toEqual([
			{ type: "text", value: "see " },
			{ type: "url", value: "https://a.com" },
			{ type: "text", value: "." },
		]);
	});

	it("handles multiple urls", () => {
		const segs = linkifySegments("http://a.com and https://b.com");
		expect(segs.filter((s) => s.type === "url").map((s) => s.value)).toEqual([
			"http://a.com",
			"https://b.com",
		]);
	});

	it("does not linkify bare domains or times", () => {
		expect(linkifySegments("meet at 5.30 on example.com")).toEqual([
			{ type: "text", value: "meet at 5.30 on example.com" },
		]);
	});

	it("does not treat javascript: as a link", () => {
		// URL_RE only matches http(s) — a javascript: string stays plain text.
		expect(linkifySegments("javascript:alert(1)")).toEqual([
			{ type: "text", value: "javascript:alert(1)" },
		]);
	});
});
