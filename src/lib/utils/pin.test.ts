import { describe, expect, it } from "vitest";

import { constantTimeEqual, generateSalt, hashPin, isValidPin } from "$lib/utils/pin";

describe("hashPin", () => {
	it("is deterministic for the same pin + salt", async () => {
		const salt = "abcd1234";
		const a = await hashPin("1234", salt);
		const b = await hashPin("1234", salt);
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
	});

	it("differs for a different pin", async () => {
		const salt = "abcd1234";
		expect(await hashPin("1234", salt)).not.toBe(await hashPin("1235", salt));
	});

	it("differs for the same pin under a different salt", async () => {
		expect(await hashPin("1234", "saltA")).not.toBe(await hashPin("1234", "saltB"));
	});
});

describe("generateSalt", () => {
	it("returns 32 hex chars (16 bytes) and varies between calls", () => {
		const a = generateSalt();
		const b = generateSalt();
		expect(a).toMatch(/^[0-9a-f]{32}$/);
		expect(a).not.toBe(b);
	});
});

describe("constantTimeEqual", () => {
	it("is true for equal strings and false otherwise", () => {
		expect(constantTimeEqual("deadbeef", "deadbeef")).toBe(true);
		expect(constantTimeEqual("deadbeef", "deadbee0")).toBe(false);
		expect(constantTimeEqual("short", "longer")).toBe(false);
	});
});

describe("isValidPin", () => {
	it("accepts 4-8 digit pins", () => {
		expect(isValidPin("1234")).toBe(true);
		expect(isValidPin("12345678")).toBe(true);
	});

	it("rejects too short, too long, or non-numeric", () => {
		expect(isValidPin("123")).toBe(false);
		expect(isValidPin("123456789")).toBe(false);
		expect(isValidPin("12a4")).toBe(false);
		expect(isValidPin("")).toBe(false);
	});
});
