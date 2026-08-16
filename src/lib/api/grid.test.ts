import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/api/grid", () => ({
	getCascadeV3: vi.fn(),
}));

vi.mock("$lib/api/profile", () => ({
	getProfiles: vi.fn(),
}));

import { getCascadeV3 } from "$lib/api/grid";
import { getProfiles } from "$lib/api/profile";
import { cascadeV3QuerySchema } from "$lib/model/grid/cascade/query/v3";
import { Tribe } from "$lib/model/profile";
import { urlSearchParamsCodec } from "$lib/utils";

// getGrid/resolvePartialBatch live in the route module, not $lib/api — this
// file also covers them per the P7 plan (issue #2 regression + batching).
import {
	getGrid,
	type PartialGridProfile,
	resolvePartialBatch,
} from "../../routes/(protected)/(navbar)/(root)/grid";

const mockedGetCascadeV3 = vi.mocked(getCascadeV3);
const mockedGetProfiles = vi.mocked(getProfiles);

const NEARBY = "9q8yyk8ytpxr";
const EXPLORE = "dr5regy3zpst";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("cascadeV3QuerySchema query serialization (Tom issue #2 regression)", () => {
	// exploreGeoHash IS a declared field of gridQuerySchema, inherited by
	// cascadeQuerySchema/cascadeV3QuerySchema via `.shape` spreads (see finding
	// cas-4001-server-side-gate-not-client-bug) — it is NOT stripped. These
	// tests pin that so a future rename/removal of the field, or a codec change
	// that starts stripping unknown keys, fails loudly instead of silently
	// dropping "Explore other areas" from the wire.

	it("serializes exploreGeoHash into the encoded query when set", () => {
		const search = new URLSearchParams(
			urlSearchParamsCodec(cascadeV3QuerySchema).encode({
				nearbyGeoHash: NEARBY,
				exploreGeoHash: EXPLORE,
			}),
		).toString();

		expect(search).toContain(`exploreGeoHash=${EXPLORE}`);
	});

	it("omits exploreGeoHash from the encoded query when it is not set", () => {
		const search = new URLSearchParams(
			urlSearchParamsCodec(cascadeV3QuerySchema).encode({
				nearbyGeoHash: NEARBY,
			}),
		).toString();

		expect(search).not.toContain("exploreGeoHash");
	});

	it("encodes booleans, numbers and arrays the way the server expects", () => {
		const params = new URLSearchParams(
			urlSearchParamsCodec(cascadeV3QuerySchema).encode({
				nearbyGeoHash: NEARBY,
				onlineOnly: true,
				favorites: false,
				ageMin: 18,
				ageMax: 99,
				tribes: [Tribe.Jock, Tribe.Geek],
			}),
		);

		expect(params.get("onlineOnly")).toBe("true");
		expect(params.get("favorites")).toBe("false");
		expect(params.get("ageMin")).toBe("18");
		expect(params.get("ageMax")).toBe("99");
		expect(params.get("tribes")).toBe(`${Tribe.Jock},${Tribe.Geek}`);
	});

	it("decode() round-trips string and boolean fields back to the right types", () => {
		const encoded = urlSearchParamsCodec(cascadeV3QuerySchema).encode({
			nearbyGeoHash: NEARBY,
			exploreGeoHash: EXPLORE,
			onlineOnly: true,
		});

		const decoded = urlSearchParamsCodec(cascadeV3QuerySchema).decode(encoded);

		expect(decoded.nearbyGeoHash).toBe(NEARBY);
		expect(decoded.exploreGeoHash).toBe(EXPLORE);
		expect(decoded.onlineOnly).toBe(true);
	});

	it("guards that exploreGeoHash stays declared on cascadeV3QuerySchema", () => {
		expect(Object.keys(cascadeV3QuerySchema.shape)).toContain("exploreGeoHash");
	});
});

describe("getGrid partial-batch splitting (150-cap)", () => {
	function fullItem(profileId: number, overrides: Record<string, unknown> = {}) {
		return {
			type: "full_profile_v1",
			data: {
				profileId,
				displayName: `Profile ${profileId}`,
				distanceMeters: 100,
				photoMediaHashes: ["a".repeat(40)],
				unreadCount: 0,
				onlineUntil: null,
				...overrides,
			},
		};
	}

	function partialItem(profileId: number) {
		return { type: "partial_profile_v1", data: { profileId } };
	}

	// getGrid only reads a handful of fields off the (very large) real cascade
	// response type; casting a minimal synthetic response keeps these tests
	// focused on the batching logic instead of duplicating the full schema.
	function mockCascadeResponse(items: unknown[]) {
		mockedGetCascadeV3.mockResolvedValueOnce({
			items,
			nextPage: null,
			shuffled: false,
			hiddenProfiles: null,
			hiddenProfileInfo: null,
		} as unknown as Awaited<ReturnType<typeof getCascadeV3>>);
	}

	it("keeps full/partial ordering in items matching the response order", async () => {
		mockCascadeResponse([
			fullItem(9001),
			partialItem(1),
			partialItem(2),
			fullItem(9002),
		]);

		const result = await getGrid({ nearbyGeoHash: NEARBY });

		expect(result.items.map((i) => i.type)).toEqual([
			"full",
			"partial",
			"partial",
			"full",
		]);
		expect(result.items.map((i) => i.id)).toEqual([9001, 1, 2, 9002]);
		expect(result.items[0]).toEqual({
			type: "full",
			id: 9001,
			displayName: "Profile 9001",
			age: null,
			distance: 100,
			profilePhotosHashes: ["a".repeat(40)],
			unread: 0,
			onlineUntil: null,
		});
	});

	it("assigns batchIndex 0 to the first 150 partial items and starts a new batch at the 151st", async () => {
		const items = Array.from({ length: 151 }, (_, i) => partialItem(i + 1));
		mockCascadeResponse(items);

		const result = await getGrid({ nearbyGeoHash: NEARBY });

		const partials = result.items.filter(
			(i): i is PartialGridProfile => i.type === "partial",
		);
		expect(partials).toHaveLength(151);
		expect(partials[149].batchIndex).toBe(0); // the 150th partial item
		expect(partials[150].batchIndex).toBe(1); // the 151st -> new batch
		expect(result.partialBatches).toHaveLength(2);
		expect(result.partialBatches[0].batch).toHaveLength(150);
		expect(result.partialBatches[1].batch).toHaveLength(1);
	});

	it("splits exactly 300 partial items into two full 150-item batches", async () => {
		const items = Array.from({ length: 300 }, (_, i) => partialItem(i + 1));
		mockCascadeResponse(items);

		const result = await getGrid({ nearbyGeoHash: NEARBY });

		expect(result.partialBatches).toHaveLength(2);
		expect(result.partialBatches[0].batch).toHaveLength(150);
		expect(result.partialBatches[1].batch).toHaveLength(150);
		expect(result.partialBatches[0].batch[0].profileId).toBe(1);
		expect(result.partialBatches[1].batch[0].profileId).toBe(151);
	});
});

describe("resolvePartialBatch ordering", () => {
	function mockProfile(fields: {
		profileId: number;
		displayName?: string | null;
		age?: number | null;
		distance?: number | null;
		onlineUntil?: number | null;
		medias?: { mediaHash: string }[];
	}): Awaited<ReturnType<typeof getProfiles>>[number] {
		return {
			distance: fields.distance ?? null,
			profileImageMediaHash: null,
			isFavorite: false,
			lastViewed: null,
			seen: null,
			rightNow: "NOT_ACTIVE",
			sexualPosition: null,
			foundVia: null,
			profileId: fields.profileId,
			displayName: fields.displayName ?? null,
			onlineUntil: fields.onlineUntil ?? null,
			age: fields.age ?? null,
			showAge: true,
			showDistance: true,
			approximateDistance: false,
			lastChatTimestamp: null,
			isNew: false,
			lastUpdatedTime: 0,
			medias: (fields.medias ?? []).map((m) => ({
				mediaHash: m.mediaHash,
				type: 0,
				state: 0,
				reason: null,
				takenOnGrindr: null,
				createdAt: null,
			})),
			rightNowText: null,
			rightNowPosted: null,
			rightNowDistance: null,
			rightNowThumbnailUrl: null,
			rightNowFullImageUrl: null,
		};
	}

	it("returns resolved profiles in REQUEST order, dropping ids the server omitted", async () => {
		// Server returns them out of order and drops id 3 entirely.
		mockedGetProfiles.mockResolvedValueOnce([
			mockProfile({ profileId: 2, displayName: "Two", distance: 200 }),
			mockProfile({
				profileId: 1,
				displayName: "One",
				distance: 100,
				medias: [{ mediaHash: "b".repeat(40) }],
			}),
		]);

		const result = await resolvePartialBatch([3, 1, 2]);

		expect(result.map((p) => p.id)).toEqual([1, 2]);
		expect(result[0]).toEqual({
			type: "full",
			id: 1,
			displayName: "One",
			age: null,
			distance: 100,
			profilePhotosHashes: ["b".repeat(40)],
			unread: null,
			onlineUntil: null,
		});
	});

	it("calls getProfiles with the given ids and returns [] when none resolve", async () => {
		mockedGetProfiles.mockResolvedValueOnce([]);

		const result = await resolvePartialBatch([5, 6]);

		expect(mockedGetProfiles).toHaveBeenCalledWith([5, 6]);
		expect(result).toEqual([]);
	});
});
