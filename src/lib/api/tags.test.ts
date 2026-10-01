import { beforeEach, describe, expect, it, vi } from "vitest";

// Transport is mocked at the Tauri IPC boundary (`invoke`), exactly as
// `grid.api.test.ts` does, so the real `fetchRest` is exercised and nothing can
// reach the network. Nothing here calls the global `fetch`, and the last test
// asserts it is never touched.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { getProfileTags } from "$lib/api/tags";
import { fromBase64, toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);

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

/** The documented payload shape, from `profiles.md` § "Profile tags". */
const DOCUMENTED_RESPONSE = [
	{
		language: "en",
		categoryCollection: [
			{
				text: "Body type",
				possessiveText: null,
				tags: [
					{ tagId: 101, text: "Slim", key: "slim" },
					{ tagId: 102, text: "Athletic", key: "athletic" },
				],
			},
		],
	},
];

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getProfileTags", () => {
	it("GETs /v1/tags", async () => {
		respond(200, JSON.stringify(DOCUMENTED_RESPONSE));

		await getProfileTags();

		const request = lastRequest();
		expect(request.command).toBe("request");
		expect(request.method).toBe("GET");
		expect(request.path).toBe("/v1/tags");
	});

	it("parses the documented three-level shape", async () => {
		respond(200, JSON.stringify(DOCUMENTED_RESPONSE));

		const tags = await getProfileTags();

		expect(tags).toHaveLength(1);
		expect(tags[0].language).toBe("en");
		expect(tags[0].categoryCollection).toHaveLength(1);
		expect(tags[0].categoryCollection[0].text).toBe("Body type");
		expect(tags[0].categoryCollection[0].tags.map((t) => t.tagId)).toEqual([
			101, 102,
		]);
	});

	it("accepts a top-level array — there is no { tags } envelope", async () => {
		// Regression guard: an implementation that assumed an envelope would throw
		// here, which is the failure the docs' bare "Array of objects" describes.
		respond(200, JSON.stringify(DOCUMENTED_RESPONSE));

		await expect(getProfileTags()).resolves.toBeInstanceOf(Array);
	});

	it("keeps a category that omits the optional possessiveText", async () => {
		respond(
			200,
			JSON.stringify([
				{
					language: "en",
					categoryCollection: [
						{ text: "Body type", tags: [{ tagId: 1, text: "Slim", key: "s" }] },
					],
				},
			]),
		);

		const tags = await getProfileTags();

		expect(tags[0].categoryCollection[0].tags).toHaveLength(1);
	});

	it("drops and logs one unparseable tag instead of failing the whole fetch", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		respond(
			200,
			JSON.stringify([
				{
					language: "en",
					categoryCollection: [
						{
							text: "Body type",
							possessiveText: null,
							tags: [
								{ tagId: 101, text: "Slim", key: "slim" },
								{ tagId: "not-an-int", text: "Drifted", key: "d" },
							],
						},
					],
				},
			]),
		);

		const tags = await getProfileTags();

		expect(tags[0].categoryCollection[0].tags.map((t) => t.tagId)).toEqual([101]);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("drops an unparseable category but keeps the language group", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		respond(
			200,
			JSON.stringify([
				{
					language: "en",
					categoryCollection: [
						{ text: 42, tags: [] },
						{
							text: "Body type",
							possessiveText: "Body type's",
							tags: [{ tagId: 7, text: "Slim", key: "slim" }],
						},
					],
				},
			]),
		);

		const tags = await getProfileTags();

		expect(tags).toHaveLength(1);
		expect(tags[0].categoryCollection).toHaveLength(1);
		expect(tags[0].categoryCollection[0].tags[0].tagId).toBe(7);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("fails loudly when the root stops being an array (no silent empty list)", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		// An envelope key appearing would silently yield an empty picker if the
		// root were swallowed with `.catch([])`, which is indistinguishable from
		// "this account has no tags".
		respond(200, JSON.stringify({ tags: [] }));

		await expect(getProfileTags()).rejects.toThrow();
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("raises ApiHttpError on a non-2xx", async () => {
		respond(403, JSON.stringify({ code: "CAS-4001", message: "Forbidden" }));

		const err = (await getProfileTags().catch((e: unknown) => e)) as {
			status?: unknown;
			code?: unknown;
		};

		expect(err).toBeInstanceOf(Error);
		expect(err.status).toBe(403);
		expect(err.code).toBe("CAS-4001");
	});

	it("never calls the global fetch — transport goes through fetchRest only", async () => {
		const globalFetch = vi.fn();
		vi.stubGlobal("fetch", globalFetch);
		try {
			respond(200, JSON.stringify(DOCUMENTED_RESPONSE));

			await getProfileTags();

			expect(globalFetch).not.toHaveBeenCalled();
			expect(mockedInvoke).toHaveBeenCalledTimes(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
