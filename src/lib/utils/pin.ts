// Hashing primitives for the app-lock PIN.
//
// The PIN is never stored in the clear: we keep a random per-install salt and
// the SHA-256 of `salt:pin`. That's enough to gate casual access to an unlocked
// phone (the threat model for an app-lock); it is not a KDF and is not meant to
// resist an offline brute force of a 4-6 digit PIN by someone who has already
// extracted app storage.

/** 16 random bytes, hex-encoded. */
export function generateSalt(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
}

export async function hashPin(pin: string, salt: string): Promise<string> {
	const data = new TextEncoder().encode(`${salt}:${pin}`);
	const digest = await crypto.subtle.digest("SHA-256", data);
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

/** A PIN must be 4-8 digits. */
export function isValidPin(pin: string): boolean {
	return /^[0-9]{4,8}$/.test(pin);
}

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}
