import { beforeEach, describe, expect, it, vi } from "vitest";

// Importing $lib/api/album pulls in the $lib/api bridge (which references the
// Tauri `invoke`). The pure-helper tests below never hit the network, and the
// network tests drive the real `fetchRest` through a mocked `invoke`, so the
// core module is mocked once here and both halves stay honest — matching the
// sibling api tests (index.test.ts / profile.test.ts).
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import {
	addAlbumContentFromBytes,
	ALBUM_NAME_MAX_BYTES,
	buildAlbumNameBody,
	buildRemoveViewerBody,
	createAlbum,
	deleteAlbum,
	getAlbumContent,
	getAlbumViewers,
	getMyAlbums,
	parseAlbumViewerIds,
	removeAlbumContent,
	removeAlbumViewer,
	renameAlbum,
	shareAlbum,
	truncateToUtf8Bytes,
} from "$lib/api/album";
import { ApiHttpError } from "$lib/api/http";
import { fromBase64, toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);

const byteLength = (s: string) => new TextEncoder().encode(s).length;

describe("truncateToUtf8Bytes", () => {
	it("leaves short strings untouched", () => {
		expect(truncateToUtf8Bytes("hello", 255)).toBe("hello");
	});

	it("clamps ASCII to the byte budget", () => {
		expect(truncateToUtf8Bytes("aaaaa", 3)).toBe("aaa");
	});

	it("never splits a multi-byte codepoint", () => {
		// "😀" is 4 UTF-8 bytes. With a 5-byte budget only one fits, and the
		// second must be dropped whole — never cut into an invalid half.
		const result = truncateToUtf8Bytes("😀😀", 5);
		expect(result).toBe("😀");
		expect(byteLength(result)).toBeLessThanOrEqual(5);
	});

	it("returns empty when even the first codepoint overflows", () => {
		expect(truncateToUtf8Bytes("😀", 2)).toBe("");
	});
});

describe("buildAlbumNameBody", () => {
	it("wraps the name under albumName", () => {
		expect(buildAlbumNameBody("Beach trip")).toEqual({ albumName: "Beach trip" });
	});

	it("coerces non-string input to a string", () => {
		// The runtime can hand us a non-string (the API coerces too); guard it.
		expect(buildAlbumNameBody(42 as unknown as string)).toEqual({ albumName: "42" });
	});

	it("clamps to the documented 255-byte maximum", () => {
		const body = buildAlbumNameBody("x".repeat(300));
		expect(byteLength(body.albumName)).toBe(ALBUM_NAME_MAX_BYTES);
		expect(byteLength(body.albumName)).toBeLessThanOrEqual(ALBUM_NAME_MAX_BYTES);
	});

	it("allows an empty name", () => {
		expect(buildAlbumNameBody("")).toEqual({ albumName: "" });
	});
});

describe("buildRemoveViewerBody", () => {
	it("wraps the profile in the profiles array with shareId 0", () => {
		expect(buildRemoveViewerBody(999)).toEqual({
			profiles: [{ profileId: 999, shareId: 0 }],
		});
	});
});

describe("parseAlbumViewerIds", () => {
	it("extracts a clean list of ids", () => {
		expect(parseAlbumViewerIds({ profileIds: [1, 2, 3] })).toEqual([1, 2, 3]);
	});

	it("coerces stringified ids (Grindr sometimes sends longs as strings)", () => {
		expect(parseAlbumViewerIds({ profileIds: ["10", 20] })).toEqual([10, 20]);
	});

	it("drops entries that aren't coercible to an int, keeping the rest", () => {
		expect(
			parseAlbumViewerIds({ profileIds: [1, "nope", null, 2] }),
		).toEqual([1, 2]);
	});

	it("returns an empty array for a missing/blank profileIds field", () => {
		expect(parseAlbumViewerIds({})).toEqual([]);
		expect(parseAlbumViewerIds({ profileIds: [] })).toEqual([]);
	});

	it("returns an empty array for an unexpected/null payload", () => {
		expect(parseAlbumViewerIds(null)).toEqual([]);
		expect(parseAlbumViewerIds("garbage")).toEqual([]);
		expect(parseAlbumViewerIds({ profileIds: "not-an-array" })).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Network layer.
//
// Every album endpoint used to be untested, so the v0.1.33 `shareAlbum` fix —
// `POST /v4/albums/{id}/shares`, which is what actually GRANTS the recipient
// view access — could be reverted to the old broken `POST /v4/chat/message/send`
// reference path (documented in `shareAlbum`'s own doc comment) with nothing
// failing. These assert the exact method + path + body of each call.
//
// The frontend hands `fetchRest` a msgpack envelope that the Rust bridge
// decodes, so the assertions decode the payload that was actually sent rather
// than trusting the call site.
// ---------------------------------------------------------------------------

/** Queue a `fetchRest` response: status + raw body text. */
function respond(status: number, bodyText: string): void {
	mockedInvoke.mockResolvedValueOnce(
		toBase64(encode({ status, body: new TextEncoder().encode(bodyText) })),
	);
}

/** The `{ method, path, body }` envelope the last `invoke("request", …)` sent. */
function lastRequest(): {
	command: string;
	method: string;
	path: string;
	body: unknown;
} {
	const call = mockedInvoke.mock.calls.at(-1);
	if (!call) throw new Error("invoke was never called");
	const [command, args] = call as [string, { payload: string }];
	const envelope = decode(fromBase64(args.payload)) as {
		method: string;
		path: string;
		body: Uint8Array | null;
	};
	return {
		command,
		method: envelope.method,
		path: envelope.path,
		body: envelope.body === null ? null : decode(envelope.body),
	};
}

const ALBUM_DETAILS = {
	sharedCount: 0,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
};

const ALBUM_ITEM = {
	contentId: 11,
	contentType: "Photo",
	coverUrl: "https://cdn.example/c.jpg",
	statusId: 1,
	thumbUrl: "https://cdn.example/t.jpg",
	url: "https://cdn.example/u.jpg",
	processing: false,
	rejectionId: null,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("shareAlbum", () => {
	it("POSTs /v4/albums/{id}/shares with the { profiles: [{ profileId, expirationType }] } body", async () => {
		respond(200, "");

		await shareAlbum({ albumId: 777, profileId: 42, expirationType: "ONCE" });

		expect(lastRequest()).toMatchObject({
			command: "request",
			method: "POST",
			path: "/v4/albums/777/shares",
			body: { profiles: [{ profileId: 42, expirationType: "ONCE" }] },
		});
	});

	it("returns no messageId — the share auto-sends the album, reconciled over the WS", async () => {
		respond(200, "");
		await expect(
			shareAlbum({ albumId: 1, profileId: 2, expirationType: "INDEFINITE" }),
		).resolves.toBeUndefined();
	});

	it("raises ApiHttpError (not a raw-body Error) on a server rejection", async () => {
		respond(403, JSON.stringify({ code: 403, message: "Action not permitted" }));

		 
		const err = await shareAlbum({
			albumId: 1,
			profileId: 2,
			expirationType: "ONCE",
		}).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(ApiHttpError);
		expect((err as ApiHttpError).status).toBe(403);
	});
});

describe("removeAlbumViewer", () => {
	it("PUTs /v1/albums/{id}/unshares with the documented body, not the WIP /shares/remove route", async () => {
		respond(200, "");

		await removeAlbumViewer({ albumId: 555, profileId: 99 });

		const request = lastRequest();
		expect(request.method).toBe("PUT");
		expect(request.path).toBe("/v1/albums/555/unshares");
		expect(request.path).not.toContain("/shares/remove");
		expect(request.body).toEqual({ profiles: [{ profileId: 99, shareId: 0 }] });
	});

	it("keeps the viewer's profileId out of the error path/message", async () => {
		respond(403, "urn:gr:err:forbidden");

		const err = await removeAlbumViewer({
			albumId: 555,
			profileId: 99,
		}).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(ApiHttpError);
		expect((err as ApiHttpError).message).not.toContain("99");
	});
});

describe("getAlbumContent", () => {
	it("GETs the v2 viewing route", async () => {
		respond(
			200,
			JSON.stringify({
				albumId: 7,
				hasUnseenContent: false,
				albumName: "Trip",
				profileId: 5,
				albumViewable: true,
				...ALBUM_DETAILS,
				content: [ALBUM_ITEM],
			}),
		);

		const album = await getAlbumContent(7);

		expect(lastRequest()).toMatchObject({
			method: "GET",
			path: "/v2/albums/7",
		});
		expect(album.content).toHaveLength(1);
	});

	it("drops ONE drifted content item instead of throwing away the whole album", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		respond(
			200,
			JSON.stringify({
				albumId: 7,
				hasUnseenContent: false,
				albumName: "Trip",
				profileId: 5,
				albumViewable: true,
				...ALBUM_DETAILS,
				content: [
					ALBUM_ITEM,
					{ ...ALBUM_ITEM, contentId: 12, contentType: 99 },
					{ ...ALBUM_ITEM, contentId: 13 },
				],
			}),
		);

		const album = await getAlbumContent(7);

		expect(album.content.map((c) => c.contentId)).toEqual([11, 13]);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("accepts epoch-NUMBER createdAt/updatedAt (the server has been seen sending them)", async () => {
		respond(
			200,
			JSON.stringify({
				albumId: 7,
				hasUnseenContent: false,
				albumName: "Trip",
				profileId: 5,
				albumViewable: true,
				sharedCount: 0,
				createdAt: 1767225600,
				updatedAt: 1767225600,
				content: [],
			}),
		);

		const album = await getAlbumContent(7);
		expect(album.createdAt).toBe(1767225600);
	});
});

describe("getMyAlbums", () => {
	it("GETs the v1 management route and tolerates a drifted item per album", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		respond(
			200,
			JSON.stringify({
				albums: [
					{
						albumId: 1,
						albumName: "A",
						profileId: 5,
						albumViewable: true,
						hasUnseenContent: false,
						...ALBUM_DETAILS,
						content: [ALBUM_ITEM, { contentId: 2 }],
					},
				],
			}),
		);

		const { albums } = await getMyAlbums();

		expect(lastRequest()).toMatchObject({ method: "GET", path: "/v1/albums" });
		expect(albums).toHaveLength(1);
		expect(albums[0].content).toHaveLength(1);
		warn.mockRestore();
	});
});

describe("album management endpoints", () => {
	it("createAlbum POSTs /v2/albums with { albumName } and returns the new albumId", async () => {
		respond(200, JSON.stringify({ albumId: 31 }));

		await expect(createAlbum("Beach trip")).resolves.toEqual({ albumId: 31 });
		expect(lastRequest()).toMatchObject({
			method: "POST",
			path: "/v2/albums",
			body: { albumName: "Beach trip" },
		});
	});

	it("renameAlbum PUTs /v2/albums/{id}", async () => {
		respond(200, JSON.stringify({ albumId: 31, albumName: "Renamed" }));

		await expect(renameAlbum({ albumId: 31, name: "Renamed" })).resolves.toEqual({
			albumId: 31,
			albumName: "Renamed",
		});
		expect(lastRequest()).toMatchObject({
			method: "PUT",
			path: "/v2/albums/31",
			body: { albumName: "Renamed" },
		});
	});

	it("deleteAlbum DELETEs /v1/albums/{id}", async () => {
		respond(204, "");
		await expect(deleteAlbum(31)).resolves.toBeUndefined();
		expect(lastRequest()).toMatchObject({ method: "DELETE", path: "/v1/albums/31" });
	});

	it("removeAlbumContent DELETEs /v1/albums/{id}/content/{contentId}", async () => {
		respond(204, "");
		await expect(removeAlbumContent({ albumId: 31, contentId: 12 })).resolves
			.toBeUndefined();
		expect(lastRequest()).toMatchObject({
			method: "DELETE",
			path: "/v1/albums/31/content/12",
		});
	});

	it("getAlbumViewers GETs /v1/albums/{id}/shares and parses the ids", async () => {
		respond(200, JSON.stringify({ profileIds: [1, "2"] }));

		await expect(getAlbumViewers(31)).resolves.toEqual([1, 2]);
		expect(lastRequest()).toMatchObject({ path: "/v1/albums/31/shares" });
	});

	it("addAlbumContentFromBytes uses the dedicated upload_album_content command", async () => {
		// This endpoint is multipart-only, which the generic JSON bridge cannot
		// reach, so it must NOT go through `fetchRest`/`request`.
		mockedInvoke.mockResolvedValueOnce({
			status: 200,
			body: JSON.stringify({ contentId: 44, contentUrl: "https://cdn.example/x" }),
		});

		await expect(
			addAlbumContentFromBytes({
				albumId: 31,
				base64: "AAAA",
				mimeType: "image/jpeg",
			}),
		).resolves.toEqual({ contentId: 44 });

		expect(mockedInvoke).toHaveBeenCalledWith("upload_album_content", {
			albumId: 31,
			imageBase64: "AAAA",
			mimeType: "image/jpeg",
		});
	});

	it("addAlbumContentFromBytes treats a non-2xx as ApiHttpError", async () => {
		mockedInvoke.mockResolvedValueOnce({ status: 413, body: "payload too large" });

		const err = await addAlbumContentFromBytes({
			albumId: 31,
			base64: "AAAA",
			mimeType: "image/jpeg",
		}).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(ApiHttpError);
		expect((err as ApiHttpError).status).toBe(413);
	});
});
