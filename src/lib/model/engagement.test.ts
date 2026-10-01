import { describe, expect, it, vi } from "vitest";

import {
	engagementListSchema,
	engagementListShape,
	engagementProfileSchema,
} from "$lib/model/engagement";

const profileSchema = engagementListSchema(
	engagementProfileSchema,
	"viewed profile",
);

// The envelope tolerance is the part of WP-3 that exists ONLY because the
// pagination shape is unprobed, so each branch of it is pinned here. If a real
// response ever shows a different shape, the corresponding test below is the one
// to update — and the `shape` field is what tells you which one.
describe("engagementListSchema envelope tolerance", () => {
	it("reads a BARE ARRAY body and labels it 'array'", () => {
		const parsed = profileSchema.parse([
			{ profileId: 1, displayName: "Ada" },
			{ profileId: 2, displayName: null },
		]);

		expect(parsed.shape).toBe(engagementListShape.ARRAY);
		expect(parsed.entries).toHaveLength(2);
		expect(parsed.entries[0].profileId).toBe(1);
		expect(parsed.entries[1].profileId).toBe(2);
	});

	it("reads a WRAPPED body under an 'items' key", () => {
		const parsed = profileSchema.parse({ items: [{ profileId: 7 }] });

		expect(parsed.shape).toBe(engagementListShape.WRAPPED);
		expect(parsed.entries[0].profileId).toBe(7);
	});

	it("reads a wrapped body under ANY key — 'views', 'results' — not just 'items'", () => {
		// The wrapper key is DISCOVERED, never asserted, precisely because no
		// probe has established what it is called.
		for (const key of ["views", "results", "profiles", "rows"]) {
			const parsed = profileSchema.parse({ [key]: [{ profileId: 3 }] });
			expect(parsed.shape).toBe(engagementListShape.WRAPPED);
			expect(parsed.entries[0].profileId).toBe(3);
		}
	});

	it("finds the rows even when a scalar sibling comes first in key order", () => {
		const parsed = profileSchema.parse({
			nextPage: null,
			total: 12,
			views: [{ profileId: 5 }],
		});

		expect(parsed.entries[0].profileId).toBe(5);
	});

	it("treats a literal null body as no rows rather than throwing", () => {
		const parsed = profileSchema.parse(null);

		expect(parsed.shape).toBe(engagementListShape.NULL);
		expect(parsed.entries).toEqual([]);
	});

	it("treats an unrecognised body as empty instead of throwing the whole load", () => {
		// A wrong guess about the envelope must not blank a screen.
		const parsed = profileSchema.parse("nope");

		expect(parsed.entries).toEqual([]);
	});

	it("treats an object carrying no array at all as empty", () => {
		const parsed = profileSchema.parse({ total: 0, nextPage: 2 });

		expect(parsed.entries).toEqual([]);
	});
});

describe("engagementListSchema per-item tolerance", () => {
	it("drops ONE unparseable row and keeps the rest", () => {
		// The house policy ($lib/api/conversation, $lib/api/album): a single
		// drifted row must cost that row, not the whole list.
		const parsed = profileSchema.parse([
			{ profileId: 1 },
			{ profileId: "not-a-number" },
			{ profileId: 2 },
		]);

		expect(parsed.entries.map((e) => e.profileId)).toEqual([1, 2]);
	});

	it("drops a row whose profileId is null, which must never become profile 0", () => {
		// `z.coerce.number()` turns `null` into 0, which is the /profile/0 bug
		// fixed in v0.1.33. The inherited preprocess is what prevents it.
		const parsed = profileSchema.parse([{ profileId: null, displayName: "x" }]);

		expect(parsed.entries).toEqual([]);
	});

	it("keeps a row whose optional fields are all absent", () => {
		const parsed = profileSchema.parse([{ profileId: 9 }]);

		expect(parsed.entries).toHaveLength(1);
		expect(parsed.entries[0].displayName).toBeNull();
		expect(parsed.entries[0].engagedAt).toBeNull();
	});
});

describe("engagementProfileSchema field tolerance", () => {
	it("survives every optional field being re-typed by the server", () => {
		// `engagedAt`'s NAME is the one unverified guess in the file; `.catch()`
		// is what makes being wrong cost a field instead of the row.
		const parsed = engagementProfileSchema.parse({
			age: "thirty",
			distance: "far",
			displayName: 42,
			engagedAt: { nope: true },
			medias: "none",
			profileId: 4,
		});

		expect(parsed.profileId).toBe(4);
		expect(parsed.age).toBeNull();
		expect(parsed.distance).toBeNull();
		expect(parsed.displayName).toBeNull();
		expect(parsed.engagedAt).toBeNull();
		expect(parsed.medias).toBeNull();
	});

	it("accepts an epoch or an ISO string for engagedAt", () => {
		expect(engagementProfileSchema.parse({ engagedAt: 1750000000, profileId: 1 }).engagedAt).toBe(
			1750000000,
		);
		expect(
			engagementProfileSchema.parse({ engagedAt: "2026-09-30T12:00:00Z", profileId: 1 })
				.engagedAt,
		).toBe("2026-09-30T12:00:00Z");
	});

	it("requires a real positive profileId", () => {
		for (const bad of [0, -1, null, "", "abc", undefined]) {
			expect(engagementProfileSchema.safeParse({ profileId: bad }).success).toBe(false);
		}
	});
});

describe("log hygiene", () => {
	it("prefixes every log line with [GrindrX] and never names a profile id", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		try {
			profileSchema.parse([{ profileId: 12345, displayName: "nope" }]);
			profileSchema.parse({ views: [{ profileId: 12345 }] });

			const lines = [...warn.mock.calls, ...info.mock.calls].map((call) =>
				String(call[0]),
			);
			expect(lines.length).toBeGreaterThan(0);
			for (const line of lines) expect(line.startsWith("[GrindrX]")).toBe(true);
			// A dropped row is logged by issue, never by echoing the payload.
			expect(JSON.stringify(warn.mock.calls)).not.toContain("12345");
		} finally {
			warn.mockRestore();
			info.mockRestore();
		}
	});
});
