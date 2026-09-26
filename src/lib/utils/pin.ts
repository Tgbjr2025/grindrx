// Hashing primitives for the app-lock PIN.
//
// The PIN is never stored in the clear. We keep a random per-install salt and a
// PBKDF2-SHA-256 derivation of it (200k iterations).
//
// This used to be a single SHA-256 of `salt:pin`. For an app-lock that is a real
// weakness, not a theoretical one: a 4-digit PIN is 10,000 candidates, and that
// many single SHA-256 evaluations take well under a second on a GPU. The salt is
// stored in the same unencrypted WebView localStorage as the hash, so anyone who
// can read app storage (adb backup, a rooted device, a backup extract) could
// brute-force the PIN offline. PBKDF2 with a high iteration count makes that
// expensive enough to be a real cost rather than a rounding error.
//
// The iteration count is stored alongside the hash so it can be raised later and
// transparently upgraded on the next successful unlock.
export const PBKDF2_ITERATIONS = 200_000;
const HASH_BITS = 256;

/** 16 random bytes, hex-encoded. */
export function generateSalt(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

/**
 * PBKDF2-SHA-256 over `salt:pin`.
 *
 * `crypto.subtle.deriveBits` is the WebCrypto KDF; unlike `digest` it is
 * intentionally slow, which is the entire point. The PIN is imported as a
 * `TextEncoder` byte array rather than a raw key so short PINs are not
 * zero-padded into a fixed-length key the way a naive `importKey("raw", ...)`
 * with a PIN string would be on some engines.
 */
export async function hashPin(
	pin: string,
	salt: string,
	iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(`${salt}:${pin}`),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt: hexToBytes(salt) as unknown as BufferSource,
			iterations,
		},
		keyMaterial,
		HASH_BITS,
	);
	return bytesToHex(new Uint8Array(bits));
}

/** Length-independent, constant-time-ish comparison of two hex strings. */
export function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/** A PIN must be 4-8 digits. */
export function isValidPin(pin: string): boolean {
	return /^[0-9]{4,8}$/.test(pin);
}

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}
