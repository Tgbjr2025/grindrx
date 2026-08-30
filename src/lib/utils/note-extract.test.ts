import { describe, expect, it } from "vitest";

import { buildNoteText, extractNoteFields } from "$lib/utils/note-extract";

describe("extractNoteFields — phone", () => {
	it("finds common US phone formats and normalizes them", () => {
		expect(extractNoteFields(["call me 415-867-5309"]).phoneNumber).toBe("(415) 867-5309");
		expect(extractNoteFields(["(212) 555-0199 anytime"]).phoneNumber).toBe("(212) 555-0199");
		expect(extractNoteFields(["+1 305 555 0142"]).phoneNumber).toBe("(305) 555-0142");
		expect(extractNoteFields(["my # is 3055550142"]).phoneNumber).toBe("(305) 555-0142");
	});

	it("returns null when there's no phone", () => {
		expect(extractNoteFields(["hey what's up"]).phoneNumber).toBeNull();
	});

	it("does not match a group starting with 0 or 1 (not a real area/prefix)", () => {
		expect(extractNoteFields(["order 100 200 3000"]).phoneNumber).toBeNull();
	});
});

describe("extractNoteFields — address", () => {
	it("finds a street address", () => {
		expect(extractNoteFields(["I'm at 123 Main Street"]).address).toBe("123 Main Street");
		expect(extractNoteFields(["come to 45 Oak Ave apt 2"]).address).toContain("45 Oak Ave");
	});

	it("captures city/state/zip when present", () => {
		const a = extractNoteFields(["550 Market St, San Francisco, CA 94104"]).address;
		expect(a).toContain("550 Market St");
	});

	it("returns null with no address", () => {
		expect(extractNoteFields(["see you soon"]).address).toBeNull();
	});
});

describe("extractNoteFields — names", () => {
	it("extracts introduced names", () => {
		expect(extractNoteFields(["hey I'm Alex"]).names).toEqual(["Alex"]);
		expect(extractNoteFields(["my name is Jordan Lee"]).names).toEqual(["Jordan Lee"]);
		expect(extractNoteFields(["this is Sam"]).names).toContain("Sam");
	});

	it("skips stopwords that follow the trigger", () => {
		expect(extractNoteFields(["I'm Not sure", "I'm Looking"]).names).toEqual([]);
	});

	it("dedupes repeated names", () => {
		expect(extractNoteFields(["I'm Alex", "call me Alex"]).names).toEqual(["Alex"]);
	});
});

describe("buildNoteText", () => {
	it("builds a note from extracted fields", () => {
		const note = buildNoteText("", {
			names: ["Alex"],
			phoneNumber: "(415) 867-5309",
			address: "123 Main Street",
		});
		expect(note).toContain("Name: Alex");
		expect(note).toContain("Address: 123 Main Street");
	});

	it("merges into existing text without duplicating lines", () => {
		const existing = "Name: Alex\nmet at the gym";
		const note = buildNoteText(existing, {
			names: ["Alex"],
			phoneNumber: null,
			address: "123 Main Street",
		});
		expect(note).toBe("Name: Alex\nmet at the gym\nAddress: 123 Main Street");
	});

	it("returns existing unchanged when nothing new", () => {
		expect(buildNoteText("hello", { names: [], phoneNumber: null, address: null })).toBe("hello");
	});
});
