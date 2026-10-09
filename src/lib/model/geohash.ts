import z from "zod";

/**
 * Geohash precision, and the unit bug this file used to hide.
 *
 * WHAT WE STORE
 * -------------
 * The cascade query sends `nearbyGeoHash` on EVERY grid request, and the chosen
 * location is persisted twice: to `preferences.data` (msgpack) and to
 * `localStorage["grindrx-explore-location"]`. A 12-character geohash resolves to
 * roughly a 2 m x 4 m cell — four more characters than anything in this app can
 * act on, transmitted on every request and written to disk forever.
 *
 * The app's own notion of "the user moved" compares 6-character cells and calls
 * that ~1 km (see the root `+page.svelte` GPS updater). 8 characters
 * (~19 m x 19 m) is three orders of magnitude finer than that threshold while
 * being a third of the bytes, so it is the stored/transmitted precision.
 *
 * WHY THE SCHEMA ACCEPTS 6..12 AND NOT EXACTLY ONE LENGTH
 * ---------------------------------------------------------
 * Shortening the schema to `.length(8)` would reject every hash already on a
 * user's disk (they'd have to re-pick a location) and would break callers that
 * legitimately hold a longer hash. The schema is therefore a RANGE: anything a
 * geohash can legitimately be still validates, and `encodeGeohash` (the only
 * producer we control) now emits 8.
 */
export const MIN_PRECISION = 6;
export const MAX_PRECISION = 12;
/** Precision used by `encodeGeohash` — i.e. persisted and transmitted. */
export const PERSISTED_PRECISION = 8;

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export const geohashSchema = z
	.string()
	.min(MIN_PRECISION)
	.max(MAX_PRECISION)
	.regex(/^[0-9b-hjkmnp-z]+$/);

/**
 * Encode a coordinate to a geohash.
 *
 * @param lat       latitude in degrees, -90..90 inclusive
 * @param lon       longitude in degrees, -180..180 inclusive
 * @param precision 6..12 characters; defaults to {@link PERSISTED_PRECISION}
 *
 * THROWS on a non-finite or out-of-range coordinate, or a bad precision.
 * This used to accept `(NaN, NaN)` and `(999, 999)` and return a perfectly
 * schema-valid 12-character hash, which was then persisted to disk and sent as
 * `nearbyGeoHash` on every cascade request — a silent, unrecoverable
 * "you are in the middle of the ocean" state. A GPS fix that is missing or
 * corrupt is a bug worth surfacing, not a location worth guessing.
 */
export function encodeGeohash(
	lat: number,
	lon: number,
	precision: number = PERSISTED_PRECISION,
): string {
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
		throw new RangeError(
			`encodeGeohash: non-finite coordinate (lat=${lat}, lon=${lon})`,
		);
	}
	if (lat < -90 || lat > 90) {
		throw new RangeError(`encodeGeohash: latitude ${lat} is outside -90..90`);
	}
	if (lon < -180 || lon > 180) {
		throw new RangeError(`encodeGeohash: longitude ${lon} is outside -180..180`);
	}
	if (
		!Number.isInteger(precision) ||
		precision < MIN_PRECISION ||
		precision > MAX_PRECISION
	) {
		throw new RangeError(
			`encodeGeohash: precision ${precision} is outside ${MIN_PRECISION}..${MAX_PRECISION}`,
		);
	}

	let latLo = -90,
		latHi = 90;
	let lonLo = -180,
		lonHi = 180;
	let hash = "";
	let bits = 0,
		bit = 0,
		even = true;

	while (hash.length < precision) {
		if (even) {
			const mid = (lonLo + lonHi) / 2;
			if (lon >= mid) {
				bits = (bits << 1) | 1;
				lonLo = mid;
			} else {
				bits = bits << 1;
				lonHi = mid;
			}
		} else {
			const mid = (latLo + latHi) / 2;
			if (lat >= mid) {
				bits = (bits << 1) | 1;
				latLo = mid;
			} else {
				bits = bits << 1;
				latHi = mid;
			}
		}
		even = !even;
		if (++bit === 5) {
			hash += BASE32[bits];
			bits = 0;
			bit = 0;
		}
	}
	return hash;
}

/**
 * Decode any geohash length (6..12) to its cell centre plus the half-extent of
 * the cell, so callers can render a "you are somewhere in here" box.
 */
export function decodeGeohash(hash: string): {
	lat: number;
	lon: number;
	latErr: number;
	lonErr: number;
} {
	let latLo = -90,
		latHi = 90;
	let lonLo = -180,
		lonHi = 180;
	let even = true;

	for (const ch of hash.toLowerCase()) {
		const idx = BASE32.indexOf(ch);
		if (idx < 0) throw new Error(`Invalid geohash char: ${ch}`);
		for (let b = 4; b >= 0; b--) {
			const bit = (idx >> b) & 1;
			if (even) {
				const mid = (lonLo + lonHi) / 2;
				if (bit) lonLo = mid;
				else lonHi = mid;
			} else {
				const mid = (latLo + latHi) / 2;
				if (bit) latLo = mid;
				else latHi = mid;
			}
			even = !even;
		}
	}
	return {
		lat: (latLo + latHi) / 2,
		lon: (lonLo + lonHi) / 2,
		latErr: (latHi - latLo) / 2,
		lonErr: (lonHi - lonLo) / 2,
	};
}
