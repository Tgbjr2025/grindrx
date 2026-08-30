import { describe, expect, it } from "vitest";

import { parseNote } from "$lib/api/favorites-notes";

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
