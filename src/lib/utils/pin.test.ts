import { describe, expect, it } from "vitest";

import {
	constantTimeEqual,
	generateSalt,
	hashPin,
	isValidPin,
	PBKDF2_ITERATIONS,
	sha256Hex,
} from "$lib/utils/pin";

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

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
	it("accepts 6-8 digit pins", () => {
		expect(isValidPin("123456")).toBe(true);
		expect(isValidPin("12345678")).toBe(true);
	});

	// The verifier is plaintext app storage, so the floor is the whole defence
	// against an offline sweep: 4 digits is 10,000 candidates.
	it("rejects 4- and 5-digit pins", () => {
		expect(isValidPin("1234")).toBe(false);
		expect(isValidPin("12345")).toBe(false);
	});

	it("rejects too long, or non-numeric", () => {
		expect(isValidPin("123456789")).toBe(false);
		expect(isValidPin("12a456")).toBe(false);
		expect(isValidPin("")).toBe(false);
	});
});

describe("sha256Hex (legacy v0.1.25-v0.1.32 digest)", () => {
	it("is the plain SHA-256 of the input, hex-encoded", async () => {
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode("salt:1234"),
		);
		expect(await sha256Hex("salt:1234")).toBe(bytesToHex(new Uint8Array(digest)));
		expect(await sha256Hex("salt:1234")).toMatch(/^[0-9a-f]{64}$/);
	});

	it("reproduces the legacy format exactly (SHA-256 of `${salt}:${pin}`)", async () => {
		const salt = "ab".repeat(16);
		// Independent recomputation of a plain SHA-256 over the same input.
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(`${salt}:1234`),
		);
		expect(await sha256Hex(`${salt}:1234`)).toBe(
			bytesToHex(new Uint8Array(digest)),
		);
		// ...and it is NOT a PBKDF2 digest, which is why a legacy install could
		// never be verified by the current verifier.
		expect(await sha256Hex(`${salt}:1234`)).not.toBe(await hashPin("1234", salt));
	});
});

// The PIN was a single SHA-256 of `salt:pin`, with the salt stored beside the
// hash. A 4-digit PIN is 10,000 candidates, which single SHA-256 evaluations
// exhaust well under a second on a GPU.
describe("hashPin is a real KDF", () => {
	it("derives a different digest for the same PIN under different salts", async () => {
		const a = await hashPin("1234", "aa".repeat(16));
		const b = await hashPin("1234", "bb".repeat(16));
		expect(a).not.toBe(b);
		expect(a).toHaveLength(64);
	});

	it("is deterministic for the same salt and PIN", async () => {
		const a = await hashPin("1234", "cc".repeat(16));
		const b = await hashPin("1234", "cc".repeat(16));
		expect(a).toBe(b);
	});

	it("produces a different digest from a plain SHA-256 of salt:pin", async () => {
		const salt = "dd".repeat(16);
		const ours = await hashPin("1234", salt);
		const plain = bytesToHex(
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:1234`)),
			),
		);
		expect(ours).not.toBe(plain);
	});

	it("verifies against a hash written with a different iteration count", async () => {
		// This is what lets an old install keep working AND get transparently
		// upgraded: the stored count is read back and the PIN re-derived at it.
		const salt = "ee".repeat(16);
		const weak = await hashPin("1234", salt, 1000);
		const strong = await hashPin("1234", salt, PBKDF2_ITERATIONS);
		expect(weak).not.toBe(strong);
		expect(await hashPin("1234", salt, 1000)).toBe(weak);
	});
});
