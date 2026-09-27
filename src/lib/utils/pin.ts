// Hashing primitives for the app-lock PIN.
//
// The PIN is never stored in the clear. We keep a random per-install salt and a
// PBKDF2-SHA-256 derivation of it (200k iterations).
//
// THREAT MODEL — read this before "tuning" the iteration count.
//
// The verifier is plaintext WebView localStorage sitting beside the salt (see
// `$lib/app-data/app-lock.svelte`), so anyone who can extract app storage —
// adb backup, a rooted device, a stolen device, a WebView XSS — takes the salt
// and hash offline and sweeps the PIN space at their own speed. PBKDF2-SHA-256
// at 200k measures ~116 ms per candidate on one core, so the 10,000 candidates
// of a 4-digit PIN cost ~19 min single-core and *seconds* on a GPU. The KDF
// therefore raises the price of an offline sweep by three-plus orders of
// magnitude over the plain SHA-256 it replaced, but it does NOT make one
// infeasible — do not read 200k as "safe".
//
// The controls that actually hold are, in order:
//   1. the 6-digit minimum PIN (1,000,000 candidates ≈ 32 h single-core, and
//      still GPU-feasible in principle, hence also 2 and 3);
//   2. the online failure backoff in `app-lock.svelte.ts` — the real rate
//      limit, since it bounds attempts through the UI rather than through a
//      dump of storage;
//   3. the gates in `PinLockSetting.svelte` that require the current PIN before
//      the lock is changed or removed at all.
// A verifier that is genuinely unbrute-forceable has to live outside
// JS-reachable storage (Rust / Stronghold); that is a native change, not a
// tuning change, and the iteration count is not a substitute for it.
//
// The iteration count is stored alongside the hash so it can be raised later and
// transparently upgraded on the next successful unlock. Installs written before
// that key existed (v0.1.25–v0.1.32) stored a plain `SHA-256(salt:pin)` with no
// count at all — see `sha256Hex` and `verifyPin`.
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

/**
 * Plain `SHA-256(data)`, lowercase hex.
 *
 * Exists ONLY to verify a PIN written by a pre-PBKDF2 build (v0.1.25–v0.1.32),
 * which stored `SHA-256(`${salt}:${pin}`)` with no iteration count — a digest
 * the current verifier can never reproduce, which is why those installs locked
 * their owners out. Never use this for a new PIN: see the threat-model note at
 * the top of this file.
 */
export async function sha256Hex(data: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(data),
	);
	return bytesToHex(new Uint8Array(digest));
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

/**
 * A PIN must be 6-8 digits.
 *
 * The floor is 6, not 4: the verifier is in plaintext app storage, so the only
 * thing standing between an attacker with a storage dump and the PIN is the size
 * of the search space. 4 digits is 10,000 candidates — a GPU sweep of seconds.
 * 6 digits is 1,000,000, a 100x increase on top of the KDF. An already-set
 * shorter PIN still unlocks (nothing here gates verification), so this only
 * applies when setting or changing one.
 */
export function isValidPin(pin: string): boolean {
	return /^[0-9]{6,8}$/.test(pin);
}

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}
