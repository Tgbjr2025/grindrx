import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

import { encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";

import { getFavoriteNote, parseNote } from "$lib/api/favorites-notes";
import { toBase64 } from "$lib/base64";

const mockedInvoke = vi.mocked(invoke);

function respond(status: number, bodyText: string): void {
	mockedInvoke.mockResolvedValueOnce(
		toBase64(encode({ status, body: new TextEncoder().encode(bodyText) })),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("parseNote tolerance", () => {
	it("passes through a well-formed note payload", () => {
		expect(parseNote({ notes: "Met at the gym", phoneNumber: "555-0100" })).toEqual({
			notes: "Met at the gym",
			phoneNumber: "555-0100",
		});
	});

	it("defaults both fields to empty strings for an empty object (nonexistent note)", () => {
		expect(parseNote({})).toEqual({ notes: "", phoneNumber: "" });
	});

	it("defaults a missing phoneNumber to an empty string", () => {
		expect(parseNote({ notes: "just a note" })).toEqual({
			notes: "just a note",
			phoneNumber: "",
		});
	});

	it("coerces null / wrong-typed fields down to empty strings", () => {
		expect(parseNote({ notes: null, phoneNumber: 12345 })).toEqual({
			notes: "",
			phoneNumber: "",
		});
	});

	it("returns empty strings for a null or non-object body", () => {
		expect(parseNote(null)).toEqual({ notes: "", phoneNumber: "" });
		expect(parseNote(undefined)).toEqual({ notes: "", phoneNumber: "" });
		expect(parseNote("not json")).toEqual({ notes: "", phoneNumber: "" });
	});

	it("ignores unrelated extra fields (e.g. counterpartyId)", () => {
		expect(
			parseNote({ notes: "hi", phoneNumber: "", counterpartyId: 987 }),
		).toEqual({ notes: "hi", phoneNumber: "" });
	});
});

describe("getFavoriteNote distinguishes 'no note' from 'unreadable response'", () => {
	it("returns the saved note", async () => {
		respond(200, JSON.stringify({ notes: "Met at the gym", phoneNumber: "555" }));
		await expect(getFavoriteNote(42)).resolves.toEqual({
			notes: "Met at the gym",
			phoneNumber: "555",
		});
	});

	it("reads a genuinely EMPTY body as 'no note saved'", async () => {
		respond(200, "");
		await expect(getFavoriteNote(42)).resolves.toEqual({
			notes: "",
			phoneNumber: "",
		});
	});

	it("reads the server's {} (nonexistent note) as 'no note saved'", async () => {
		respond(200, "{}");
		await expect(getFavoriteNote(42)).resolves.toEqual({
			notes: "",
			phoneNumber: "",
		});
	});

	it("THROWS on an unparseable body instead of reporting a blank note", async () => {
		// This is the data-loss path: the old `catch { data = {} }` made a WAF
		// interstitial indistinguishable from "no note", so the UI showed an
		// empty note for a note the server still had, and the user's next PUT
		// overwrote it permanently.
		respond(200, "<html><body>proxy error</body></html>");

		await expect(getFavoriteNote(42)).rejects.toThrow();
	});

	it("THROWS on a non-2xx so the caller cannot mistake it for an empty note", async () => {
		respond(500, "internal error");

		await expect(getFavoriteNote(42)).rejects.toThrow();
	});
});
