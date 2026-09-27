import { beforeEach, describe, expect, it, vi } from "vitest";

// `$lib/api/grid` had ZERO coverage: the existing `grid.test.ts` mocks
// `$lib/api/grid` itself, so neither `searchProfiles` nor `getCascadeV3` ever
// ran. This file drives the real module through a mocked `invoke`, so the
// path/query the client actually puts on the wire is asserted, not assumed.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { getCascadeV3, searchProfiles } from "$lib/api/grid";
import { fromBase64, toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);

// `nearbyGeoHash` is a 12-character geohash; this is a real one so the model's
// own validation accepts the query.
const GEOHASH = "9q8yyk8ytpxr";

function respond(status: number, bodyText: string): void {
	mockedInvoke.mockResolvedValueOnce(
		toBase64(encode({ status, body: new TextEncoder().encode(bodyText) })),
	);
}

/** The request line `fetchRest` last put on the wire. */
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

beforeEach(() => {
	vi.clearAllMocks();
});

describe("searchProfiles", () => {
	it("GETs /v7/search with the query encoded by the model's urlSearchParamsCodec", async () => {
		respond(200, JSON.stringify({ profiles: [] }));

		await searchProfiles({
			nearbyGeoHash: GEOHASH,
			profileTags: "bear",
			pageNumber: 2,
		});

		const request = lastRequest();
		expect(request.command).toBe("request");
		expect(request.method).toBe("GET");
		expect(request.path.startsWith("/v7/search?")).toBe(true);
		const params = new URLSearchParams(request.path.split("?")[1]);
		expect(params.get("nearbyGeoHash")).toBe(GEOHASH);
		expect(params.get("profileTags")).toBe("bear");
		expect(params.get("pageNumber")).toBe("2");
	});

	it("drops and logs a single drifted profile instead of throwing the whole search", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		respond(
			200,
			JSON.stringify({
				profiles: [
					{
						profileId: 1,
						displayName: "ok",
						age: 30,
						distance: 100,
						medias: null,
					},
					{ profileId: 2, age: "thirty" },
					{
						profileId: 3,
						displayName: "ok3",
						age: 31,
						distance: 200,
						medias: null,
					},
				],
			}),
		);

		const result = await searchProfiles({ nearbyGeoHash: GEOHASH });

		expect(result.profiles.map((p) => p.profileId)).toEqual([1, 3]);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("raises ApiHttpError carrying the cascade's bare CAS-4001 on a 2xx", async () => {
		respond(200, "CAS-4001");

		const err = await searchProfiles({ nearbyGeoHash: GEOHASH }).catch(
			(e: unknown) => e,
		);

		expect(err).toBeInstanceOf(Error);
		expect((err as { code?: unknown }).code).toBe("CAS-4001");
		expect((err as { status?: unknown }).status).toBe(200);
	});
});

describe("getCascadeV3", () => {
	it("GETs /v3/cascade with the query encoded by the model's urlSearchParamsCodec", async () => {
		respond(
			200,
			JSON.stringify({
				items: [],
				nextPage: null,
				shuffled: false,
				hiddenProfiles: [],
				hiddenProfileInfo: [],
			}),
		);

		await getCascadeV3({
			nearbyGeoHash: GEOHASH,
			onlineOnly: true,
			ageMin: 24,
			ageMax: 35,
		});

		const request = lastRequest();
		expect(request.command).toBe("request");
		expect(request.method).toBe("GET");
		expect(request.path.startsWith("/v3/cascade?")).toBe(true);
		const params = new URLSearchParams(request.path.split("?")[1]);
		expect(params.get("nearbyGeoHash")).toBe(GEOHASH);
		expect(params.get("onlineOnly")).toBe("true");
		expect(params.get("ageMin")).toBe("24");
	});

	it("drops an unrecognised cascade item rather than blanking the grid", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		respond(
			200,
			JSON.stringify({
				items: [
					{ type: "some_new_item_v9", data: {} },
					{
						type: "partial_profile_v1",
						data: {
							profileId: 9,
							onlineUntil: null,
							rightNow: null,
							unreadCount: 0,
							isVisiting: false,
							isPopular: false,
							upsellItemType: "x",
							"@type": "CascadeItemData$PartialProfileV1",
						},
					},
				],
				nextPage: null,
				shuffled: false,
				hiddenProfiles: [],
				hiddenProfileInfo: [],
			}),
		);

		const result = await getCascadeV3({ nearbyGeoHash: GEOHASH });

		expect(result.items).toHaveLength(1);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
