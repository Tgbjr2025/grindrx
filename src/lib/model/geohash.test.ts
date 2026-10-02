import { describe, expect, it } from "vitest";

import {
	COARSENED_PRECISION,
	coarsenGeohash,
	decodeGeohash,
	encodeGeohash,
	geohashSchema,
	MAX_PRECISION,
	MIN_PRECISION,
	PERSISTED_PRECISION,
} from "$lib/model/geohash";

describe("geohashSchema", () => {
	it("accepts the 8-char hash encodeGeohash now produces", () => {
		expect(geohashSchema.safeParse(encodeGeohash(51.5074, -0.1278)).success).toBe(
			true,
		);
	});

	it("still accepts a legacy 12-char hash already on a user's disk", () => {
		// Shortening the schema to .length(8) would reject every hash written by
		// an earlier build, and there is no migration path that recovers it.
		expect(geohashSchema.safeParse("9q8yyk8ytpxr").success).toBe(true);
	});

	it("rejects a hash shorter than the 6-char movement threshold", () => {
		expect(geohashSchema.safeParse("9q8yy").success).toBe(false);
	});

	it("rejects a hash longer than 12 characters", () => {
		expect(geohashSchema.safeParse("9q8yyk8ytpxrabc").success).toBe(false);
	});

	it("rejects characters outside the geohash base32 alphabet", () => {
		// a, i, l and o are excluded from base32.
		expect(geohashSchema.safeParse("9q8yyk8ytpxa").success).toBe(false);
	});
});

describe("encodeGeohash — precision", () => {
	// REGRESSION (2026-10-02). This test used to assert 8, locking in the bug:
	//   [GrindrX] GET /v3/cascade?nearbyGeoHash=dpg8ncgz -> HTTP 400
	//   {"type":"urn:gr:err:geo_hash_decode","title":"Invalid location format"}
	// The cascade endpoint REQUIRES 12. A green suite asserted the wrong value
	// because the test was written from the same unverified premise as the code.
	it("emits 12 characters, which is what the cascade endpoint requires", () => {
		expect(PERSISTED_PRECISION).toBe(12);
		expect(encodeGeohash(51.5074, -0.1278)).toHaveLength(12);
	});

	it("a shorter hash is a prefix of the 12-char hash, so cells still nest", () => {
		// Kept, inverted: shortening must be a PREFIX, not a different hash, so a
		// coarser cell always encloses the finer one. This is what makes the
		// stale-8-char repair in the GPS updater sound.
		const short = encodeGeohash(51.5074, -0.1278, 8);
		const long = encodeGeohash(51.5074, -0.1278, 12);
		expect(long.startsWith(short)).toBe(true);
	});

	it("accepts an explicit precision across the whole legal range", () => {
		for (let p = MIN_PRECISION; p <= MAX_PRECISION; p++) {
			expect(encodeGeohash(51.5074, -0.1278, p)).toHaveLength(p);
		}
	});
});

describe("encodeGeohash — coordinate validation (D16)", () => {
	it("THROWS on NaN instead of returning a schema-valid hash", () => {
		// Previously returned "000000000000", which satisfied geohashSchema, was
		// persisted to preferences.data and sent as nearbyGeoHash forever.
		expect(() => encodeGeohash(Number.NaN, Number.NaN)).toThrow(RangeError);
	});

	it("throws on a non-finite latitude with a finite longitude", () => {
		expect(() => encodeGeohash(Number.NaN, 0)).toThrow(RangeError);
		expect(() => encodeGeohash(0, Number.NaN)).toThrow(RangeError);
		expect(() => encodeGeohash(Number.POSITIVE_INFINITY, 0)).toThrow(RangeError);
	});

	it("throws on out-of-range coordinates", () => {
		expect(() => encodeGeohash(999, 999)).toThrow(RangeError);
		expect(() => encodeGeohash(91, 0)).toThrow(RangeError);
		expect(() => encodeGeohash(-91, 0)).toThrow(RangeError);
		expect(() => encodeGeohash(0, 181)).toThrow(RangeError);
		expect(() => encodeGeohash(0, -181)).toThrow(RangeError);
	});

	it("accepts the exact range boundaries", () => {
		expect(() => encodeGeohash(90, 180)).not.toThrow();
		expect(() => encodeGeohash(-90, -180)).not.toThrow();
	});

	it("throws on a nonsensical precision", () => {
		expect(() => encodeGeohash(0, 0, 1)).toThrow(RangeError);
		expect(() => encodeGeohash(0, 0, 13)).toThrow(RangeError);
		expect(() => encodeGeohash(0, 0, 8.5)).toThrow(RangeError);
	});
});

describe("decodeGeohash", () => {
	it("round-trips an encoded coordinate to within the cell", () => {
		const lat = 51.5074;
		const lon = -0.1278;
		const decoded = decodeGeohash(encodeGeohash(lat, lon));
		expect(Math.abs(decoded.lat - lat)).toBeLessThanOrEqual(decoded.latErr);
		expect(Math.abs(decoded.lon - lon)).toBeLessThanOrEqual(decoded.lonErr);
	});

	it("decodes a legacy 12-char hash to a cell inside its 8-char parent", () => {
		const decoded = decodeGeohash("9q8yyk8ytpxr");
		const parent = decodeGeohash("9q8yyk8y");
		// A 12-char cell is strictly contained in the 8-char cell that prefixes it,
		// so a legacy hash and its shortened form must agree to within the parent's
		// half-extent. This is what makes the migration lossless.
		expect(Math.abs(decoded.lat - parent.lat)).toBeLessThanOrEqual(parent.latErr);
		expect(Math.abs(decoded.lon - parent.lon)).toBeLessThanOrEqual(parent.lonErr);
		expect(decoded.latErr).toBeLessThan(parent.latErr);
	});

	it("throws on a character outside the base32 alphabet", () => {
		expect(() => decodeGeohash("9q8yyk8ytpxa")).toThrow();
	});
});

describe("coarsenGeohash", () => {
	it("returns the enclosing cell, and that cell is strictly larger", () => {
		const hash = encodeGeohash(51.5074, -0.1278);
		const coarse = coarsenGeohash(hash);

		expect(coarse).toHaveLength(COARSENED_PRECISION);
		expect(coarse).toBe(hash.slice(0, COARSENED_PRECISION));
		// Truncation returns the PARENT cell, so it must enclose the original —
		// this is the property that makes it a coarsening rather than a different
		// location.
		const fine = decodeGeohash(hash);
		const parent = decodeGeohash(coarse);
		expect(Math.abs(fine.lat - parent.lat)).toBeLessThanOrEqual(parent.latErr);
		expect(Math.abs(fine.lon - parent.lon)).toBeLessThanOrEqual(parent.lonErr);
		expect(parent.latErr).toBeGreaterThan(fine.latErr);
	});

	it("coarsens a legacy 12-char hash already on disk", () => {
		expect(coarsenGeohash("9q8yyk8ytpxr")).toBe("9q8yyk");
	});

	it("leaves a hash already at the coarse precision alone", () => {
		expect(coarsenGeohash("9q8yyk")).toBe("9q8yyk");
	});

	it("is idempotent — coarsening twice changes nothing", () => {
		const once = coarsenGeohash("9q8yyk8ytpxr");
		expect(coarsenGeohash(once)).toBe(once);
	});

	it("honours an explicit precision", () => {
		expect(coarsenGeohash("9q8yyk8ytpxr", 8)).toBe("9q8yyk8y");
	});

	it("throws rather than transmitting an unparseable hash", () => {
		expect(() => coarsenGeohash("not-a-geohash!")).toThrow(RangeError);
		expect(() => coarsenGeohash("9q8")).toThrow(RangeError);
		expect(() => coarsenGeohash("")).toThrow(RangeError);
	});

	it("throws on a precision below the movement threshold", () => {
		expect(() => coarsenGeohash("9q8yyk8y", 4)).toThrow(RangeError);
		expect(() => coarsenGeohash("9q8yyk8y", 6.5)).toThrow(RangeError);
	});
});
