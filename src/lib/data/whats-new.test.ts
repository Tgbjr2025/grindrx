import { describe, expect, it } from "vitest";

import { highlightsFor, VERSION_HIGHLIGHTS } from "$lib/data/whats-new";

const VERSIONS = [
	"0.1.25",
	"0.1.26",
	"0.1.27",
	"0.1.28",
	"0.1.29",
	"0.1.30",
	"0.1.31",
	"0.1.32",
	"0.1.33",
];

describe("VERSION_HIGHLIGHTS", () => {
	it("has a real entry for every version from 0.1.25 up", () => {
		// A missing entry falls back to a generic "Bug fixes and improvements.",
		// which is how a whole release's worth of fixes ends up invisible in-app.
		for (const v of VERSIONS) {
			expect(highlightsFor(v), `missing highlights for ${v}`).not.toEqual([
				"Bug fixes and improvements.",
			]);
		}
	});

	it("falls back to the generic message only for a genuinely unknown version", () => {
		expect(highlightsFor("0.0.1")).toEqual(["Bug fixes and improvements."]);
	});

	it("keeps entries in descending version order", () => {
		const keys = Object.keys(VERSION_HIGHLIGHTS);
		const sorted = [...keys].sort((a, b) =>
			b.localeCompare(a, undefined, { numeric: true }),
		);
		expect(keys).toEqual(sorted);
	});

	it("never names a non-Android platform — this app ships as an APK only", () => {
		// A release note about an iPhone reaching an Android-only app's What's-New
		// card is nonsense to a reader, and it shipped once already.
		for (const [version, lines] of Object.entries(VERSION_HIGHLIGHTS)) {
			for (const line of lines) {
				expect(line, `${version}: ${line}`).not.toMatch(/iphone|ipad|\bios\b/i);
			}
		}
	});

	it("keeps each highlight to a single readable line", () => {
		for (const [version, lines] of Object.entries(VERSION_HIGHLIGHTS)) {
			for (const line of lines) {
				expect(line, `${version}: ${line}`).not.toContain("\n");
				expect(line.length, `${version}: ${line}`).toBeLessThan(200);
			}
		}
	});
});
