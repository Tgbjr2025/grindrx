import { beforeEach, describe, expect, it, vi } from "vitest";

// Transport is mocked at the Tauri IPC boundary (`invoke`), the same way
// `hide.test.ts` and `tags.test.ts` do it, so the real `fetchRest` path encoding
// is exercised while nothing can reach the network. The last test asserts the
// global `fetch` is never touched.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { getAssignments } from "$lib/api/assignment";
import { fromBase64, toBase64 } from "$lib/base64";
import {
	COARSENED_PRECISION,
	coarsenGeohash,
	encodeGeohash,
} from "$lib/model/geohash";

const mockedInvoke = vi.mocked(invoke);

/** The stored hash this app persists and transmits for the cascade query. */
const STORED_GEOHASH = encodeGeohash(51.5074, -0.1278); // London, 8 chars
/** A legacy 12-character hash that may still be on disk. */
const PRECISE_GEOHASH = "9q8yyk8ytpxr";

/** The documented payload, from `analytics/assignments.md`. */
const DOCUMENTED_RESPONSE = {
	assignments: [
		{
			key: "ai-consent-2026",
			value: "off",
			payload: { minVersion: 7 },
			type: "FEATURE_FLAG",
		},
		{
			key: "grid-ordering",
			value: "Test",
			payload: { cohorts: ["a", "b"] },
			type: "EXPERIMENT",
		},
	],
};

function respond(status: number, bodyText: string): void {
	mockedInvoke.mockResolvedValueOnce(
		toBase64(encode({ status, body: new TextEncoder().encode(bodyText) })),
	);
}

/** The query string `fetchRest` last put on the wire. */
function lastRequest(): { command: string; method: string; path: string } {
	const call = mockedInvoke.mock.calls.at(-1);
	if (!call) throw new Error("invoke was never called");
	const [command, args] = call as [string, { payload: string }];
	const envelope = decode(fromBase64(args.payload)) as {
		method: string;
		path: string;
	};
	return { command, method: envelope.method, path: envelope.path };
}

/** The `geohash` query parameter of the last request. */
function sentGeohash(): string {
	const path = lastRequest().path;
	return new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("geohash") ?? "";
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getAssignments", () => {
	// THE POINT OF THIS PACKAGE. If the coarsening is ever removed "for
	// consistency with nearbyGeoHash", these fail — which is the intent.
	describe("geohash coarsening", () => {
		it("sends the COARSENED geohash, never the stored input", async () => {
			respond(200, JSON.stringify(DOCUMENTED_RESPONSE));

			await getAssignments({ geohash: STORED_GEOHASH });

			const sent = sentGeohash();
			expect(sent).toBe(coarsenGeohash(STORED_GEOHASH));
			expect(sent).not.toBe(STORED_GEOHASH);
			expect(sent).toHaveLength(COARSENED_PRECISION);
			// The sent value is a prefix of the stored one, i.e. the enclosing
			// cell rather than a different or interpolated location.
			expect(STORED_GEOHASH.startsWith(sent)).toBe(true);
			// And nothing anywhere in the request line carries the full hash.
			expect(lastRequest().path).not.toContain(STORED_GEOHASH);
		});

		it("coarsens a legacy 12-character hash too", async () => {
			respond(200, JSON.stringify(DOCUMENTED_RESPONSE));

			await getAssignments({ geohash: PRECISE_GEOHASH });

			const sent = sentGeohash();
			expect(sent).toBe(PRECISE_GEOHASH.slice(0, COARSENED_PRECISION));
			expect(sent).not.toBe(PRECISE_GEOHASH);
			expect(lastRequest().path).not.toContain(PRECISE_GEOHASH);
		});

		it("refuses to send an invalid geohash — fails before any request", async () => {
			await expect(
				getAssignments({ geohash: "not-a-geohash!" }),
			).rejects.toThrow(RangeError);
			expect(mockedInvoke).not.toHaveBeenCalled();
		});

		it("refuses a hash too short to coarsen rather than padding it", async () => {
			await expect(getAssignments({ geohash: "9q8yy" })).rejects.toThrow(
				RangeError,
			);
			expect(mockedInvoke).not.toHaveBeenCalled();
		});
	});

	describe("request", () => {
		it("GETs /v3/assignment with the geohash as a query parameter", async () => {
			respond(200, JSON.stringify(DOCUMENTED_RESPONSE));

			await getAssignments({ geohash: STORED_GEOHASH });

			const request = lastRequest();
			expect(request.command).toBe("request");
			expect(request.method).toBe("GET");
			expect(request.path.startsWith("/v3/assignment?")).toBe(true);
			expect(request.path).toContain("geohash=");
		});

		it("never calls the global fetch — transport goes through fetchRest only", async () => {
			const globalFetch = vi.fn();
			vi.stubGlobal("fetch", globalFetch);
			try {
				respond(200, JSON.stringify(DOCUMENTED_RESPONSE));

				await getAssignments({ geohash: STORED_GEOHASH });

				expect(globalFetch).not.toHaveBeenCalled();
				expect(mockedInvoke).toHaveBeenCalledTimes(1);
			} finally {
				vi.unstubAllGlobals();
			}
		});
	});

	describe("response parsing", () => {
		it("parses the documented key/value/payload/type rows", async () => {
			respond(200, JSON.stringify(DOCUMENTED_RESPONSE));

			const assignments = await getAssignments({ geohash: STORED_GEOHASH });

			expect(assignments).toHaveLength(2);
			expect(assignments[0]).toEqual(DOCUMENTED_RESPONSE.assignments[0]);
			expect(assignments[1]?.key).toBe("grid-ordering");
		});

		it("accepts a row with no payload or type", async () => {
			respond(
				200,
				JSON.stringify({ assignments: [{ key: "k", value: "on" }] }),
			);

			const assignments = await getAssignments({ geohash: STORED_GEOHASH });

			expect(assignments).toEqual([
				{ key: "k", value: "on", payload: undefined, type: undefined },
			]);
		});

		it("accepts an explicitly null payload and type", async () => {
			respond(
				200,
				JSON.stringify({
					assignments: [{ key: "k", value: "on", payload: null, type: null }],
				}),
			);

			const assignments = await getAssignments({ geohash: STORED_GEOHASH });

			expect(assignments[0]?.payload).toBeNull();
			expect(assignments[0]?.type).toBeNull();
		});

		it("keeps a feature-flag payload's nested values untouched", async () => {
			respond(200, JSON.stringify(DOCUMENTED_RESPONSE));

			const assignments = await getAssignments({ geohash: STORED_GEOHASH });

			expect(assignments[0]?.payload).toEqual({ minVersion: 7 });
		});

		it("drops an unparseable row and logs it instead of failing the load", async () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			respond(
				200,
				JSON.stringify({
					assignments: [
						{ key: "good", value: "on" },
						{ value: "on" },
						{ key: "also-good", value: "off" },
					],
				}),
			);

			const assignments = await getAssignments({ geohash: STORED_GEOHASH });

			expect(assignments.map((a) => a.key)).toEqual(["good", "also-good"]);
			expect(warn).toHaveBeenCalled();
			expect(warn.mock.calls.flat().join(" ")).toContain("[GrindrX]");
			warn.mockRestore();
		});

		it("returns an empty list for a documented-but-empty assignment set", async () => {
			respond(200, JSON.stringify({ assignments: [] }));

			await expect(
				getAssignments({ geohash: STORED_GEOHASH }),
			).resolves.toEqual([]);
		});

		it("fails on a missing assignments envelope rather than silently returning []", async () => {
			// An empty list is indistinguishable from "not in any experiment", so
			// envelope drift must be loud. This is the deliberate asymmetry with
			// the per-row tolerance above.
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			respond(200, JSON.stringify({ flags: [] }));

			await expect(
				getAssignments({ geohash: STORED_GEOHASH }),
			).rejects.toThrow();
			error.mockRestore();
		});
	});

	describe("failure reporting", () => {
		it("raises ApiHttpError on a non-2xx, carrying the status and server code", async () => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			respond(403, JSON.stringify({ code: "CAS-4001", message: "Forbidden" }));

			const err = await getAssignments({
				geohash: STORED_GEOHASH,
			}).catch((e: unknown) => e);

			expect(err).toBeInstanceOf(Error);
			expect((err as { status?: unknown }).status).toBe(403);
			expect((err as { code?: unknown }).code).toBe("CAS-4001");
			error.mockRestore();
		});

		it("keeps the geohash OUT of the thrown, user-facing message", async () => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			respond(403, JSON.stringify({ code: "CAS-4001", message: "Forbidden" }));

			const err = (await getAssignments({ geohash: PRECISE_GEOHASH }).catch(
				(e: unknown) => e,
			)) as { message: string };

			// `ApiHttpError.message` interpolates the path it is given, so only
			// the BASE path may be passed to `throwForStatus`. A location must
			// never reach a toast.
			expect(err.message).toContain("/v3/assignment");
			expect(err.message).not.toContain("geohash=");
			expect(err.message).not.toContain(PRECISE_GEOHASH);
			error.mockRestore();
		});

		it("logs the real request path to the console so it is still diagnosable", async () => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			respond(500, JSON.stringify({ code: "CAS-5000", message: "Server error" }));

			await getAssignments({ geohash: STORED_GEOHASH }).catch(() => undefined);

			const logged = error.mock.calls.flat().join(" ");
			expect(logged).toContain(`/v3/assignment?geohash=`);
			expect(logged).toContain(coarsenGeohash(STORED_GEOHASH));
			expect(logged).toContain("[GrindrX]");
			error.mockRestore();
		});
	});
});