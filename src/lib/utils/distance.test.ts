import { describe, expect, it } from "vitest";

import { formatDistance } from "$lib/utils/distance";

const METERS_PER_MILE = 1609.344;
const m = METERS_PER_MILE;

describe("formatDistance — imperial", () => {
	it("REGRESSION: does not render a nearby profile as \"0.0 mi\"", () => {
		// The imperial branch used to unconditionally do `miles.toFixed(1)`, so
		// anything inside ~150 m read "0.0 mi" while the same distance read
		// "30 m" in metric. A rounded-to-zero distance is a lie, not a rounding.
		expect(formatDistance(30, "mi")).toBe("98 ft");
		expect(formatDistance(30, "mi")).not.toBe("0.0 mi");
		expect(formatDistance(30, "km")).toBe("30 m");
	});

	it("mirrors the metric branch: sub-160.9 m is feet, above it is miles", () => {
		expect(formatDistance(0, "mi")).toBe("0 ft");
		expect(formatDistance(1, "mi")).toBe("3 ft");
		expect(formatDistance(160, "mi")).toBe("525 ft");
		// 0.1 mi is the cutoff.
		expect(formatDistance(m * 0.1, "mi")).toBe("0.1 mi");
		expect(formatDistance(m * 0.1 - 1, "mi")).toMatch(/ ft$/);
	});

	it("formats longer distances in miles to one decimal", () => {
		expect(formatDistance(m, "mi")).toBe("1.0 mi");
		expect(formatDistance(m * 5, "mi")).toBe("5.0 mi");
		expect(formatDistance(m * 12.34, "mi")).toBe("12.3 mi");
		expect(formatDistance(m * 100, "mi")).toBe("100.0 mi");
	});
});

describe("formatDistance — metric (unchanged control case)", () => {
	it("switches to whole metres below 1 km", () => {
		expect(formatDistance(0, "km")).toBe("0 m");
		expect(formatDistance(30, "km")).toBe("30 m");
		expect(formatDistance(999, "km")).toBe("999 m");
	});

	it("formats kilometres to one decimal from 1 km", () => {
		expect(formatDistance(1000, "km")).toBe("1.0 km");
		expect(formatDistance(1234, "km")).toBe("1.2 km");
	});
});

describe("formatDistance — the two units agree in magnitude", () => {
	it("the same distance reads as roughly the same magnitude in either unit", () => {
		// 0.0 mi vs 30 m is the exact inconsistency D12 reported. Any distance the
		// user can see in one unit must be non-zero in the other too.
		for (const meters of [1, 30, 100, 159, 161, 300, 900, 999]) {
			expect(formatDistance(meters, "mi")).not.toMatch(/^0\.0 mi$/);
			expect(formatDistance(meters, "km")).not.toMatch(/^0 m$/);
		}
	});

	it("rounds to whole units, never renders NaN or a negative distance", () => {
		for (const meters of [0, 1, 30, 160, 1000, 9999]) {
			for (const unit of ["km", "mi"] as const) {
				expect(formatDistance(meters, unit)).not.toMatch(/NaN|undefined/);
				expect(formatDistance(meters, unit)).not.toMatch(/^-/);
			}
		}
	});
});
