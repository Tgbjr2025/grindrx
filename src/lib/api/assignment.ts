import z from "zod";

import { fetchRest } from "$lib/api";
import { throwForStatus } from "$lib/api/http";
import { coarsenGeohash } from "$lib/model/geohash";

// Grindr assignment endpoints (docs/content/grindr-api/analytics/assignments.md):
//
//   GET /v3/assignment?geohash={geohash}   the user's A/B bucket assignments
//                                          (FEATURE_FLAG / EXPERIMENT rows)
//
// ⚠️ **UNPROBED — READ BEFORE TRUSTING.** Nothing in this file has been called
// against a live server. `api.grindr.com` is currently refusing TLS handshakes,
// so no probe was possible and no response was ever seen. The path and the row
// shape below are transcribed from the vendored documentation and the spec's
// endpoint table; they are NOT a transcript of a real response. A probe with a
// real session may still show that the row shape or the `assignments` envelope
// key differs. Same standing as the already-shipped `hide.ts`, `view.ts` and
// `report.ts` unverified paths.
//
// WHY THE GEOFHASH IS COARSENED — this is the privacy behaviour, not an
// optimisation. The stored location is an 8-character hash (~19 m), and sending
// that to a feature-flag endpoint would hand a third-party service a
// house-precise position in exchange for an A/B bucket the app does not
// currently consume. `coarsenGeohash` (`$lib/model/geohash`) truncates to the
// enclosing 6-character cell (~1.2 km x 0.6 km) — the coarsest length the app
// still considers a location, and the same threshold the GPS updater uses to
// decide "the user moved". THE RAW HASH MUST NOT BE SENT. `assignment.test.ts`
// asserts that, because this is the one line here that would leak if someone
// "simplified" it away.
//
// WHY THERE IS NO CACHE AND NO UI: this module is a lookup, nothing more. The
// spec rates WP-8 low value ("do it last or not at all"), so no caller surface
// was built and no TTL cache was invented — inventing a cache duration is a
// guess about server-side behaviour, and a stale flag is worse than no flag.
// Add a caller before adding a cache.
//
// ERROR REPORTING: `throwForStatus` receives the BASE path, never the request
// path. The request path here carries the `?geohash=` query, and
// `ApiHttpError.message` interpolates the path it is handed — so passing the
// full path would put a location in a user-facing toast. The query never
// reaches the error; the coarse hash goes to the console via `logRealPath`.

const ASSIGNMENTS_PATH = "/v3/assignment";

/** Log the real request path (with the coarse hash) — console only. */
function logRealPath(geohash: string, status: number): void {
	console.error(
		`[GrindrX] Failed to load assignments (HTTP ${status}).`,
		`${ASSIGNMENTS_PATH}?geohash=${geohash}`,
	);
}

/**
 * One assignment row. `payload` is documented as an arbitrary object and `type`
 * as `"FEATURE_FLAG"` / `"EXPERIMENT"`, so `payload` is a record of unknowns and
 * `type` is a free string: inventing an enum from two documented examples would
 * drop every row the server adds later. `value` is the thing a caller acts on
 * (`"on"` / `"off"` / `"Test"`), so it is required rather than defaulted —
 * a flag with no value cannot be evaluated.
 */
const assignmentSchema = z.object({
	key: z.string(),
	value: z.string(),
	payload: z.record(z.string(), z.unknown()).nullish(),
	type: z.string().nullish(),
});

export type Assignment = z.infer<typeof assignmentSchema>;

/**
 * Parse each row independently and drop + log the ones that fail, the house rule
 * for list endpoints (`conversationsSchema` in `$lib/api/conversation`,
 * `tolerantArray` in `$lib/api/album`, `dropUnparseable` in `$lib/api/tags`).
 * A/B buckets are additive server-side: one unrecognised row must not blank the
 * whole list.
 *
 * The ENVELOPE is deliberately not swallowed — `assignments` missing entirely is
 * a contract change worth failing on, because an empty list is indistinguishable
 * from "this account is in no experiment", and a silent `[]` would hide it.
 */
const assignmentsResponseSchema = z.object({
	assignments: z.array(z.unknown()).transform((raw) =>
		raw.flatMap((entry) => {
			const result = assignmentSchema.safeParse(entry);
			if (result.success) return [result.data];
			console.warn("[GrindrX] dropping unparseable assignment", {
				key: (entry as { key?: unknown } | null)?.key,
				issue: result.error.issues[0],
			});
			return [];
		}),
	),
});

/**
 * Read this account's A/B bucket assignments. `GET /v3/assignment`.
 *
 * @param geohash the STORED hash (6..12 characters, per `geohashSchema`). It is
 *   coarsened here before it is sent — pass the real one in, never a
 *   pre-coarsened value by habit, because the guarantee that the raw hash never
 *   leaves the device is this function's job.
 *
 * Throws `ApiHttpError` on a non-2xx, carrying the status and server code and
 * the BASE path only — never the `?geohash=` query. Throws `RangeError` if the
 * hash is not a valid geohash: refusing is the correct behaviour for an
 * unparseable location, and it means a bad input fails BEFORE any request.
 */
export async function getAssignments({
	geohash,
}: {
	geohash: string;
}): Promise<Assignment[]> {
	const coarse = coarsenGeohash(geohash);
	const response = await fetchRest(
		`${ASSIGNMENTS_PATH}?${new URLSearchParams({ geohash: coarse }).toString()}`,
	);
	// BASE path only, never the path above: `ApiHttpError.message` interpolates
	// it and that message reaches a user-facing toast.
	if (response.status >= 400) logRealPath(coarse, response.status);
	throwForStatus(response, ASSIGNMENTS_PATH);
	return response.jsonParsed(assignmentsResponseSchema).assignments;
}