export function fromBase64(b64: string): Uint8Array {
	if (typeof Uint8Array.fromBase64 === "function") {
		return Uint8Array.fromBase64(b64);
	}
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Bytes -> base64.
 *
 * The fallback branch is CHUNKED (32 KiB at a time) rather than one
 * `String.fromCharCode(bytes[i])` per byte. The per-byte form is O(n) JS-engine
 * string concatenations, each of which reallocates and copies the whole
 * intermediate string — quadratic in practice. On the multi-MB images
 * `$lib/api/profile` uploads that "froze the WebView"; it also blew the argument
 * limit of a single spread call on a large buffer.
 *
 * Chunk size 0x8000 is the conventional safe bound for `String.fromCharCode`'s
 * argument list. Keep it a power of two and well under the spread limit.
 */
export function toBase64(bytes: Uint8Array): string {
	if (typeof bytes.toBase64 === "function") {
		return bytes.toBase64();
	}
	const CHUNK = 0x8000;
	let bin = "";
	for (let i = 0; i < bytes.byteLength; i += CHUNK) {
		bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(bin);
}

/**
 * `Blob` -> base64, via the same chunked encoder.
 *
 * This was a THIRD copy of the conversion: `$lib/api/profile` had one and
 * `$lib/api/audio` had another. Two implementations means one of them is
 * always the un-chunked slow one, so all callers go through `toBase64`.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
	return toBase64(new Uint8Array(await blob.arrayBuffer()));
}
