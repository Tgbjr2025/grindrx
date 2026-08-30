import { describe, expect, it } from "vitest";

import { isNewer, parseSemver } from "$lib/utils/version";

describe("parseSemver", () => {
	it("parses a bare version", () => {
		expect(parseSemver("0.1.25")).toEqual([0, 1, 25]);
	});

	it("strips a leading v (any case)", () => {
		expect(parseSemver("v0.1.25")).toEqual([0, 1, 25]);
		expect(parseSemver("V2.3.4")).toEqual([2, 3, 4]);
	});

	it("ignores a pre-release or build suffix", () => {
		expect(parseSemver("v0.1.25-rc1")).toEqual([0, 1, 25]);
		expect(parseSemver("1.2.3+build.7")).toEqual([1, 2, 3]);
	});

	it("defaults missing or non-numeric components to 0", () => {
		expect(parseSemver("1.2")).toEqual([1, 2, 0]);
		expect(parseSemver("garbage")).toEqual([0, 0, 0]);
		expect(parseSemver("")).toEqual([0, 0, 0]);
	});
});

describe("isNewer", () => {
	it("detects a newer patch, minor, and major", () => {
		expect(isNewer("0.1.25", "0.1.24")).toBe(true);
		expect(isNewer("0.2.0", "0.1.99")).toBe(true);
		expect(isNewer("1.0.0", "0.9.9")).toBe(true);
	});

	it("is false for an equal or older version", () => {
		expect(isNewer("0.1.24", "0.1.24")).toBe(false);
		expect(isNewer("0.1.23", "0.1.24")).toBe(false);
		expect(isNewer("0.0.9", "0.1.0")).toBe(false);
	});

	it("compares a v-prefixed tag against a bare running version", () => {
		expect(isNewer("v0.1.25", "0.1.24")).toBe(true);
		expect(isNewer("v0.1.24", "0.1.24")).toBe(false);
	});

	it("treats a pre-release tag by its numeric core", () => {
		// A pre-release of a higher version still reads as newer here (we don't
		// gate on pre-release ordering — the release feed only serves finals).
		expect(isNewer("v0.1.25-rc1", "0.1.24")).toBe(true);
	});
});
