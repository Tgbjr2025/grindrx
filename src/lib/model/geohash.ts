import z from "zod";

/**
 * Geohash precision, and the unit bug this file used to hide.
 *
 * WHAT WE STORE
 * -------------
 * The cascade query sends `nearbyGeoHash` on EVERY grid request, and the chosen
 * location is persisted twice: to `preferences.data` (msgpack) and to
 * `localStorage["grindrx-explore-location"]`.
 *
 * **The precision is 12 characters and the server requires it.** An earlier
 * build shipped 8 — see the `PERSISTED_PRECISION` doc below for the measurement
 * and why that was reverted. Do not shorten it.
 *
 * A 12-character geohash resolves to roughly a 2 m x 4 m cell. The app's own
 * notion of "the user moved" compares 6-character cells and calls that ~1 km
 * (see the root `+page.svelte` GPS updater), so the extra characters are finer
 * than the app's own movement threshold — but the cascade endpoint validates the
 * hash, and it rejected the short form outright.
 *
 * WHY THE SCHEMA ACCEPTS 6..12 AND NOT EXACTLY ONE LENGTH
 * ---------------------------------------------------------
 * Fixing the schema to `.length(12)` would reject hashes already on a user's
 * disk (they'd have to re-pick a location) and would break callers that
 * legitimately hold a longer or shorter hash — {@link coarsenGeohash} emits 6 on
 * purpose. The schema is therefore a RANGE, and the PRODUCER emits 12.
 */
export const MIN_PRECISION = 6;
export const MAX_PRECISION = 12;
/**
 * Precision used by `encodeGeohash` — i.e. persisted and transmitted.
 *
 * ⚠️ WAS 8. REVERTED TO 12 ON 2026-10-02 — THE SERVER REQUIRES 12.
 *
 * `5cda11f` ("GrindrX Audit Agent", 2026-09-27) shortened this from 12 to 8 on
 * the reasoning above: four characters the app cannot act on, a third of the
 * bytes. It was never probed against the API. It is **wrong**, and it broke the
 * single most-used screen in the app.
 *
 * Measured on a real device, 0.1.42 with response logging:
 *
 *     [GrindrX] GET /v3/cascade?nearbyGeoHash=dpg8ncgz -> HTTP 400 (129 bytes)
 *     body: {"type":"urn:gr:err:geo_hash_decode",
 *            "title":"Invalid location format","status":400,...}
 *
 * A 400, not a 403 — so this was never a WAF, a block, or a network fault. The
 * cascade endpoint rejects a hash below its required precision outright. The grid
 * has been dead since that commit and shipped broken in 0.1.40, whose device test
 * never opened the profile grid.
 *
 * Note the error envelope carries `type`/`title`/`status` but **no `code` field**,
 * which is why the user-facing message had no code in it
 * (`ApiHttpError.code === null` -> "Couldn't load profiles"). Do not "optimise"
 * this constant again without a probe.
 */
export const PERSISTED_PRECISION = 12;
/**
 * Precision used by {@link coarsenGeohash} — ~1.2 km x 0.6 km cells.
 *
 * Deliberately {@link MIN_PRECISION}, i.e. the coarsest length the app already
 * treats as "somewhere in here" (see the movement-threshold note above). A
 * third-party request is not worth a coordinate that fine.
 */
export const COARSENED_PRECISION = 6;

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export const geohashSchema = z
	.string()
	.min(MIN_PRECISION)
	.max(MAX_PRECISION)
	.regex(/^[0-9b-hjkmnp-z]+$/);

/**
 * Coarsen a geohash to its parent cell at `precision` (default
 * {@link COARSENED_PRECISION}).
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT OPTIONAL: the one third-party endpoint that
 * asks for a location (`GET /v3/assignment`, A/B bucket assignment) must not be
 * handed the stored 8-character hash. Truncating a geohash to fewer characters
 * yields the ENCLOSING cell — 6 characters is ~1.2 km x 0.6 km, the coarsest
 * length this app still considers a location at all (it is the same threshold
 * the GPS updater uses to decide "the user moved").
 *
 * Truncation rather than a snap-to-a-coarse-grid: it is exact, needs no
 * floating point, cannot drift, and is idempotent — coarsening a coarsened hash
 * returns it unchanged.
 *
 * THROWS on a hash {@link geohashSchema} rejects, or on a precision below
 * {@link MIN_PRECISION}. Refusing to send is the point: an unparseable location
 * is a bug to surface, never a guess to transmit.
 */
export function coarsenGeohash(
	hash: string,
	precision: number = COARSENED_PRECISION,
): string {
	if (!geohashSchema.safeParse(hash).success) {
		throw new RangeError(
			`coarsenGeohash: invalid geohash ${JSON.stringify(hash)}`,
		);
	}
	if (!Number.isInteger(precision) || precision < MIN_PRECISION) {
		throw new RangeError(
			`coarsenGeohash: precision ${precision} must be an integer >= ${MIN_PRECISION}`,
		);
	}
	return hash.slice(0, precision);
}

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
