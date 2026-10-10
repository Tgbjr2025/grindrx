import { invoke } from "@tauri-apps/api/core";
import z from "zod";

import { fetchRest } from "$lib/api";
import { toBase64 } from "$lib/base64";
import {
	mediaHashPrivateSchema,
	mediaHashPublicSchema,
} from "$lib/model/media";
import {
	type Profile,
	profileRightNowSchema,
	profileSchema,
	profileShortSchema,
} from "$lib/model/profile";
import {
	fetchAuthedBytes,
	fetchMediaBytes,
	isAuthedHost,
} from "$lib/utils/authed-image";

const profileResponseSchema = z.object({
	profiles: z.array(profileSchema).length(1),
});

const profilesCache = new Map<
	number,
	{ profile: Profile; updatedAt: number }
>();

export function clearProfileCache(profileId: number) {
	profilesCache.delete(profileId);
}

export function clearAllProfileCaches() {
	myProfileCache = null;
	profilesCache.clear();
	// The minted-mediaId cache is the one profile-side cache that is PERSISTED, so
	// dropping only the in-memory maps left a signed CDN URL (bearer-equivalent
	// for its ~15 min lifetime) and the user's photo mediaHashes in localStorage
	// across a sign-out.
	clearMediaIdCache();
}

const inflight = new Map<number, Promise<Profile>>();

export async function getProfile(profileId: number) {
	const cached = profilesCache.get(profileId);
	if (cached && Date.now() - cached.updatedAt < 1000 * 60) {
		return cached.profile;
	}
	// FIX 12 — in-flight dedup: return existing promise for concurrent callers
	const existing = inflight.get(profileId);
	if (existing) return existing;

	const promise = (async () => {
		try {
			const res = await fetchRest(`/v7/profiles/${profileId}`, { method: "GET" });
			if (res.status >= 400) {
				throw new Error(`HTTP ${res.status}: ${res.text().slice(0, 200)}`);
			}
			// FIX 11 — use jsonParsed() to get Cloudflare block detection
			const data = res.jsonParsed(profileResponseSchema);
			const profile = data.profiles[0];
			profilesCache.set(profileId, { profile, updatedAt: Date.now() });
			return profile;
		} finally {
			inflight.delete(profileId);
		}
	})();

	inflight.set(profileId, promise);
	return promise;
}

const getProfilesProfileSchema = z.object({
	...profileShortSchema.shape,
	...profileRightNowSchema.shape,
});

// Parse each profile independently. Grindr drifts this schema regularly, and a
// single malformed record in a /v3/profiles batch (up to 150 ids) would
// otherwise throw the whole response and leave every one of those grid tiles
// stuck as a skeleton. Mirror the tolerant per-item parse used by the v3
// cascade: drop + log the bad ones, keep the rest.
const getProfilesResponseSchema = z.object({
	profiles: z.array(z.unknown()).transform((raw) =>
		raw.flatMap((p) => {
			const result = getProfilesProfileSchema.safeParse(p);
			if (result.success) return [result.data];
			console.warn("[GrindrX] dropping unparseable profile", {
				issue: result.error.issues[0],
			});
			return [];
		}),
	),
});

export async function getProfiles(
	profileIds: number[],
): Promise<z.infer<typeof getProfilesResponseSchema>["profiles"]> {
	if (profileIds.length === 0) return [];
	const profiles = await fetchRest("/v3/profiles", {
		method: "POST",
		body: {
			targetProfileIds: profileIds,
		},
	}).then((res) => res.jsonParsed(getProfilesResponseSchema).profiles);
	// NOTE: do NOT write these into `profilesCache`. That cache is read by
	// getProfile() and typed as a full `Profile`; these are SHORT grid profiles
	// (missing aboutMe/tribes/lookingFor/socials). Caching them here made
	// getProfile() return a truncated record for ~60s after a grid load, blanking
	// the profile detail view. The grid consumes the returned array directly.
	return profiles;
}

let myProfileCache: {
	profile: z.infer<typeof getProfilesResponseSchema>["profiles"][0];
	updatedAt: number;
} | null = null;

export async function getMyProfile() {
	if (myProfileCache && Date.now() - myProfileCache.updatedAt < 1000 * 60) {
		return myProfileCache.profile;
	}
	const profile = await fetchRest("/v4/me/profile").then(
		(res) => res.jsonParsed(getProfilesResponseSchema).profiles[0],
	);
	// /v4/me/profile sometimes omits medias for self — backfill from the images endpoint
	if (profile.medias.length === 0) {
		try {
			const { medias } = await getProfileUploadedPhotos();
			profile.medias = medias.map((m) => ({
				mediaHash: m.mediaHash,
				type: m.type,
				state: m.state,
				reason: null,
				takenOnGrindr: null,
				createdAt: m.createdAt ?? null,
			}));
		} catch {
			// best-effort
		}
	}
	myProfileCache = { profile, updatedAt: Date.now() };
	return profile;
}

// A single uploaded profile photo. Grindr's profile endpoints now return only a
// public `mediaHash` (40-char) — NO numeric `mediaId`. The chat-send endpoint
// (`POST /v4/chat/message/send`, type "Image") requires a numeric `mediaId`,
// which is only minted by the chat-media upload endpoint. So a saved photo
// carries just its hash; the numeric id is obtained at send time by re-uploading
// the photo's bytes (see `prepareSavedPhotoForSend`).
const profilePhotoSchema = z.object({
	mediaHash: mediaHashPublicSchema,
	type: z.number().int(),
	state: z.number().int(),
	createdAt: z.number().nonnegative().nullable().optional(),
});

export type ProfilePhoto = z.infer<typeof profilePhotoSchema>;

/**
 * The user's saved profile photos, used to populate the "My Photos" picker.
 *
 * Sourced from the legacy `/v3.1/me/profile/images` endpoint, which returns only
 * `{ mediaHash, type, state }` — no numeric `mediaId`. That's fine: to *send* a
 * saved photo we re-upload its bytes to the chat-media endpoint to mint a fresh
 * numeric `mediaId` (see `prepareSavedPhotoForSend`), so the picker only needs
 * the hash to render thumbnails.
 */
export async function getProfileUploadedPhotos(): Promise<{
	medias: ProfilePhoto[];
}> {
	const medias = await fetchRest("/v3.1/me/profile/images").then((res) =>
		res.jsonParsed(z.object({ medias: z.array(profilePhotoSchema) })).medias,
	);
	return { medias };
}

// `POST /v5/chat/media/upload` response shape: `{ mediaId, mediaHash, url }`.
// This is the only endpoint that returns a chat-usable numeric `mediaId`.
// See docs: grindr-api/users/profiles#upload-media.
const uploadResponseSchema = z.object({
	mediaId: z.number().int().nonnegative(),
	// The chat-media endpoint mints a signed (64-char) private hash.
	mediaHash: z.union([mediaHashPrivateSchema, mediaHashPublicSchema]),
	url: z.url(),
});

export type UploadedMedia = z.infer<typeof uploadResponseSchema>;

// --- Minted-mediaId cache ----------------------------------------------------
// Sending a saved profile photo or a private album photo mints a chat-usable
// numeric `mediaId` by re-uploading the image bytes (see
// `prepareSavedPhotoForSend`/`prepareAuthedUrlForSend` below). That mint result
// is reusable — Grindr doesn't invalidate a minted mediaId on a timer, only the
// SIGNED URL expires (~15 min) — so re-sending the same photo N times shouldn't
// re-download + re-upload N times. Cache the mint keyed by a stable source key
// (the public mediaHash for saved photos, the album contentId for private
// photos) and persist it to localStorage — the value is not secret, just a
// numeric id + a signed URL — so it survives app restarts, matching the pattern
// used by `explore-location.svelte.ts`.
const MEDIAID_CACHE_KEY = "grindrx-mediaid-cache";

function loadMediaIdCache(): Map<string, UploadedMedia> {
	if (typeof localStorage === "undefined") return new Map();
	try {
		const raw = localStorage.getItem(MEDIAID_CACHE_KEY);
		if (!raw) return new Map();
		const parsed = z.record(z.string(), uploadResponseSchema).safeParse(JSON.parse(raw));
		if (!parsed.success) return new Map();
		return new Map(Object.entries(parsed.data));
	} catch {
		return new Map();
	}
}

const mediaIdCache = loadMediaIdCache();

function persistMediaIdCache(): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(
			MEDIAID_CACHE_KEY,
			JSON.stringify(Object.fromEntries(mediaIdCache)),
		);
	} catch (err) {
		console.error("[GrindrX] Failed to persist media id cache:", err);
	}
}

/**
 * Drop a cached minted mediaId for `key` (the public mediaHash for a saved
 * photo, or the album contentId for a private photo). Call this when the
 * chat-send endpoint rejects a mediaId as invalidated (HTTP 400) so the next
 * send re-mints instead of retrying the same stale id forever.
 */
export function invalidateCachedMediaId(key: string): void {
	if (mediaIdCache.delete(key)) persistMediaIdCache();
}

/**
 * Drop every cached minted mediaId, in memory AND in localStorage.
 *
 * The persisted value pairs the user's photo mediaHashes with SIGNED CloudFront
 * URLs, which are bearer-equivalent for their ~15 minute lifetime, so it must
 * not survive a sign-out. Idempotent, and safe to call when the cache was never
 * populated.
 */
export function clearMediaIdCache(): void {
	mediaIdCache.clear();
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(MEDIAID_CACHE_KEY);
	} catch (err) {
		console.error("[GrindrX] Failed to clear media id cache:", err);
	}
}

/**
 * Convert a byte array to a base64 string without stalling the main thread.
 *
 * Delegates to `$lib/base64`'s `toBase64` rather than keeping a second encoder
 * here. Two encoders means one of them is always the un-chunked slow one — that
 * is exactly what `$lib/base64` says it exists to stop, and this copy was the
 * one it had not yet absorbed. Behaviour is byte-identical (both spellings were
 * verified against each other for a full 0..255 byte sweep, a buffer spanning
 * several 32 KiB chunk boundaries, and a non-zero-`byteOffset` subarray view);
 * the shared one is strictly better because it takes the engine's native
 * `Uint8Array.prototype.toBase64` when the WebView has it, which produces the
 * base64 string without materialising the intermediate binary string at all.
 * That intermediate is the size of the *inflated* payload — ~30 MB for a
 * 22 MB photo — so on a WebView with the native encoder this deletes a
 * full-size transient allocation from the upload path rather than chunking it.
 *
 * ## Why the upload crosses the bridge as base64 at all (P1-006)
 *
 * The remediation register recorded "double base64 round-trip (33% x 2)" here.
 * It was measured against this tree and does NOT reproduce: every upload path
 * performs exactly ONE encode (here) and ONE decode
 * (`STANDARD.decode` in `src-tauri/src/api/rest.rs`, immediately before
 * `reqwest` gets the raw bytes for the HTTP body). The +33% is paid once, on
 * the IPC hop, and never on the wire to Grindr.
 *
 * The round trip that DID cost 33% twice was the DOWNLOAD direction — the old
 * `fetch_authed_bytes` returned a `data:` URL, so raw bytes were base64'd in
 * Rust, then base64'd AGAIN inside the `data:` URL, then parsed apart by the
 * WebView. That was fixed before this finding was filed; see the comment on
 * `fetch_authed_bytes` in `rest.rs`.
 *
 * Removing the remaining single encode is not possible without making things
 * worse, and the obvious "fix" is actively harmful on this app's primary
 * target. Tauri v2 has no raw-bytes channel from the WebView to a command on
 * Android — `InvokeBody::Raw` is documented as unsupported there, and Tauri
 * explicitly recommends a base64 `String` OVER passing the bytes as a JSON
 * number array. See `profile.media-upload.test.ts`, which pins the one-encode
 * invariant so a future change cannot quietly double it.
 */
export function bytesToBase64(bytes: Uint8Array): string {
	return toBase64(bytes);
}

/**
 * Upload raw image bytes to the chat-media endpoint and return the minted
 * `{ mediaId, mediaHash, url }`. Shared by the new-gallery-photo path and the
 * saved-photo re-upload path.
 */
async function uploadImageBytes(
	imageBase64: string,
	mimeType: string,
): Promise<UploadedMedia> {
	const result = await invoke<{ status: number; body: string }>("upload_image", {
		imageBase64,
		mimeType: mimeType || "image/jpeg",
	});

	// Grindr responds 200/201 on success
	if (result.status >= 400) {
		throw new Error(`Upload failed (${result.status}): ${result.body}`);
	}

	let json: unknown;
	try {
		json = JSON.parse(result.body);
	} catch {
		throw new Error(`Unexpected upload response: ${result.body.slice(0, 200)}`);
	}

	const parsed = uploadResponseSchema.safeParse(json);
	if (!parsed.success) {
		throw new Error(
			`Upload response missing mediaId/mediaHash: ${result.body.slice(0, 200)}`,
		);
	}
	return parsed.data;
}

/**
 * Upload a freshly-picked gallery `File` to the chat-media endpoint. Returns the
 * minted media, including the numeric `mediaId` the chat-send endpoint requires.
 */
const MAX_UPLOAD_EDGE = 1920;

/** JPEG quality for every re-encode. Unchanged from the original downscale. */
const REENCODE_QUALITY = 0.85;

// --- Byte-level metadata stripping -------------------------------------------
//
// The canvas re-encode in `downscaleImage` is the PRIMARY sanitizer: a canvas
// writes a brand-new file, so no EXIF/IPTC/XMP survives it. That is the whole
// point of routing an image through canvas.toBlob(), and it costs nothing while
// we are already resampling.
//
// It cannot be used in two situations, and neither is allowed to mean "upload
// the raw camera bytes":
//
//  1. Animated GIFs. A canvas captures a single frame, so re-encoding would
//     silently flatten an animation into a still. Stripping the metadata blocks
//     in place preserves every frame, the frame delays and the loop count.
//  2. The defensive failure paths (no 2d context, toBlob returned null, decode
//     threw). These are exactly the moments where falling back to raw bytes
//     would quietly put a GPS tag on Grindr's servers.
//
// So both fall through to the byte-level stripper below, which deletes the
// metadata containers and copies pixel data through verbatim.

/**
 * Index just past a GIF sub-block chain (a run of `len`-prefixed blocks ended
 * by a zero-length one). Returns -1 if the chain is truncated.
 */
function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
	let i = start;
	while (i < bytes.length) {
		const size = bytes[i];
		i += size + 1;
		if (size === 0) return i;
	}
	return -1;
}

/** The NUL-padded application identifier of a GIF Application extension. */
function gifAppIdentifier(bytes: Uint8Array, start: number): string {
	let id = "";
	for (let i = 0; i < 11; i++) {
		const byte = bytes[start + i];
		if (byte === undefined || byte === 0) break;
		id += String.fromCharCode(byte);
	}
	return id;
}

/**
 * Drop the JPEG segments that carry metadata: EXIF/XMP (APP1), JUMBF (APP11),
 * IPTC/Photoshop (APP13) and comments (COM). Those are where GPS coordinates,
 * camera model and capture timestamps live.
 *
 * APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe colour transform)
 * are deliberately KEPT — they hold no personal data, and some decoders need
 * them to render the correct colours. Everything from SOS onward is entropy
 * coded and is copied through untouched.
 *
 * Returns null (never a partial rewrite) if the segment walk hits anything it
 * does not recognise, so a malformed file falls back to the caller's default.
 */
function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	const out = [0xff, 0xd8]; // SOI
	let i = 2;
	while (i < bytes.length) {
		if (bytes[i] !== 0xff) return null;
		const marker = bytes[i + 1];
		if (marker === undefined) return null;
		// EOI — copy whatever is left and stop.
		if (marker === 0xd9) {
			for (let k = i; k < bytes.length; k++) out.push(bytes[k]);
			return Uint8Array.from(out);
		}
		// Standalone markers (TEM, RSTn) carry no length field.
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			out.push(0xff, marker);
			i += 2;
			continue;
		}
		const len = (bytes[i + 2] << 8) | bytes[i + 3];
		if (len < 2 || i + 2 + len > bytes.length) return null;
		const end = i + 2 + len;
		const isMetadata =
			marker === 0xfe || // COM
			(marker >= 0xe1 && marker <= 0xef && marker !== 0xe2 && marker !== 0xee);
		if (!isMetadata) {
			for (let k = i; k < end; k++) out.push(bytes[k]);
		}
		i = end;
		// SOS: the entropy-coded scan follows the segment and runs to the next
		// real marker. Copy the remainder verbatim rather than trying to parse
		// it — there is nothing left to strip past this point.
		if (marker === 0xda) {
			for (let k = i; k < bytes.length; k++) out.push(bytes[k]);
			return Uint8Array.from(out);
		}
	}
	return null;
}

/**
 * Drop the GIF blocks that carry metadata: the Comment extension, and any
 * Application extension that is not a looping directive. XMP lives in an
 * Application extension, so that is where a GIF's EXIF-equivalent hides.
 *
 * NETSCAPE2.0 and ANIMEXTS1.0 are KEPT — they carry the loop count, so
 * dropping them would change playback from looping to single-shot. Frame
 * descriptors, local colour tables, the Graphic Control extension (frame delay
 * + transparency) and the trailer are all copied through byte for byte, so the
 * animation is untouched.
 *
 * Returns null on any unrecognised block rather than risking a corrupted GIF.
 */
function stripGifMetadata(bytes: Uint8Array): Uint8Array | null {
	if (bytes.length < 14) return null;
	const header = String.fromCharCode(...bytes.subarray(0, 6));
	if (header !== "GIF87a" && header !== "GIF89a") return null;
	const out = Array.from(bytes.subarray(0, 13)); // header + screen descriptor
	let i = 13;
	while (i < bytes.length) {
		const block = bytes[i];
		if (block === 0x3b) {
			out.push(0x3b); // trailer
			return Uint8Array.from(out);
		}
		if (block === 0x00) {
			i++; // stray block terminator
			continue;
		}
		if (block === 0x21) {
			const label = bytes[i + 1];
			if (label === undefined) return null;
			// An Application extension carries an 11-byte identifier plus a 3-byte
			// auth code BEFORE its sub-block chain; every other extension type
			// goes straight into sub-blocks.
			const isApp = label === 0xff;
			const appId = isApp ? gifAppIdentifier(bytes, i + 2) : "";
			const keep =
				label !== 0xfe && // Comment extension
				(!isApp || appId === "NETSCAPE2.0" || appId === "ANIMEXTS1.0");
			const end = skipGifSubBlocks(bytes, i + (isApp ? 16 : 2));
			if (end < 0) return null;
			if (keep) {
				for (let k = i; k < end; k++) out.push(bytes[k]);
			}
			i = end;
			continue;
		}
		if (block === 0x2c) {
			const packed = bytes[i + 9];
			if (packed === undefined) return null;
			const lctSize = packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
			if (i + 10 + lctSize > bytes.length) return null;
			out.push(0x2c);
			for (let k = i + 1; k < i + 10 + lctSize; k++) out.push(bytes[k]);
			// `i` now sits on the LZW minimum code size byte, which is itself
			// part of the frame and MUST be copied — the sub-block chain starts
			// one byte later.
			i += 10 + lctSize;
			const end = skipGifSubBlocks(bytes, i + 1);
			if (end < 0) return null;
			for (let k = i; k < end; k++) out.push(bytes[k]);
			i = end;
			continue;
		}
		return null; // unrecognised block — refuse to rewrite
	}
	return null; // ran off the end without a trailer
}

/**
 * Remove metadata containers from image bytes WITHOUT re-encoding pixels.
 *
 * Returns the input unchanged for any container it cannot safely rewrite, so
 * the worst case is the pre-existing behaviour (upload the file as picked)
 * rather than a corrupted image.
 */
/**
 * Strip eXIf and iTXt metadata chunks from PNG bytes.
 * PNG chunks: length(4) + type(4) + data + crc(4). We remove eXIf and iTXt chunks.
 * Returns null on parse error (caller should fall back to original bytes).
 */
function stripPngMetadata(bytes: Uint8Array): Uint8Array | null {
	// PNG signature: 89 50 4E 47 0D 0A 1A 0A
	if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a) {
		return null;
	}
	let out = new Uint8Array(bytes.slice(0, 8)); // keep signature
	let i = 8;
	while (i + 8 <= bytes.length) {
		const length = (bytes[i] << 24) | (bytes[i+1] << 16) | (bytes[i+2] << 8) | bytes[i+3];
		if (i + 12 + length > bytes.length) return null;
		const chunkType = String.fromCharCode(bytes[i+4], bytes[i+5], bytes[i+6], bytes[i+7]);
		const chunkEnd = i + 12 + length;
		// Skip eXIf (EXIF in PNG) and iTXt/zTXt/tEXt (text) chunks
		if (chunkType === "eXIf" || chunkType === "iTXt" || chunkType === "zTXt" || chunkType === "tEXt") {
			// Skip this chunk entirely (don't copy to output)
		} else {
			// Copy chunk: length + type + data + crc
			const newOut = new Uint8Array(out.length + 12 + length);
			newOut.set(out);
			newOut.set(bytes.slice(i, chunkEnd), out.length);
			out = newOut;
		}
		i = chunkEnd;
		if (chunkType === "IEND") break;
	}
	return out;
}

/**
 * Strip EXIF chunk from WebP bytes.
 * WebP RIFF format: RIFF + size + WEBP + chunks (VP8/VP8L + optional EXIF/ICCP/XMP)
 * Returns null on parse error.
 */
function stripWebPMetadata(bytes: Uint8Array): Uint8Array | null {
	// RIFF header: "RIFF" + fileSize(4) + "WEBP"
	if (bytes.length < 12) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "RIFF" ||
	    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== "WEBP") {
		return null;
	}
	// Simple approach: remove EXIF chunk if found
	// Chunks: FourCC(4) + size(4) + data + padding(1 if odd)
	let i = 12;
	const outChunks: Uint8Array[] = [];
	while (i + 8 <= bytes.length) {
		const fourcc = String.fromCharCode(bytes[i], bytes[i+1], bytes[i+2], bytes[i+3]);
		const size = view.getUint32(i+4, true); // little-endian
		if (i + 8 + size > bytes.length) return null;
		const paddedSize = size + (size & 1);
		const chunkEnd = i + 8 + paddedSize;
		// Skip EXIF chunk
		if (fourcc !== "EXIF") {
			outChunks.push(bytes.slice(i, chunkEnd));
		}
		i = chunkEnd;
	}
	// Reconstruct
	const totalSize = outChunks.reduce((sum, c) => sum + c.length, 0);
	const out = new Uint8Array(12 + totalSize);
	out.set(bytes.slice(0, 12));
	let offset = 12;
	for (const chunk of outChunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	// Update RIFF size
	const newRiffSize = totalSize + 4; // WEBP + chunks
	view.setUint32(4, newRiffSize, true);
	return out;
}

/**
 * Remove metadata containers from image bytes WITHOUT re-encoding pixels.
 *
 * Returns the input unchanged for any container it cannot safely rewrite, so
 * the worst case is the pre-existing behaviour (upload the file as picked)
 * rather than a corrupted image.
 */
/**
 * The byte signature every EXIF payload starts with: `Exif\0\0`.
 *
 * This is defined by the TIFF/Exif specification itself, and it is what the
 * payload looks like wherever it is stored — as a JPEG APP1 segment, as a TIFF
 * header, or as a standalone item inside an ISO-BMFF container. That last case
 * is the one that matters here: in HEIF/AVIF the Exif data is a separate ITEM
 * addressed through the `iinf`/`iloc` boxes, not a contiguous span, so it cannot
 * be found by box arithmetic.
 */
const EXIF_PAYLOAD_SIGNATURE = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] as const;

/**
 * True when the payload carries an EXIF block, and therefore may carry GPS.
 *
 * Deliberately a raw scan rather than a parse: it has to work on a container
 * whose internal structure we cannot safely rewrite, so the only reliable
 * signal is the signature the Exif spec mandates.
 *
 * The false-positive direction is "finds Exif\0\0 in pixel data", which can only
 * make us refuse an image that happened to be safe. That is the correct way to
 * be wrong here — this function gates whether a location leak is possible, and
 * the whole point is that we never get that wrong silently.
 */
export function containsExifPayload(bytes: Uint8Array): boolean {
	const limit = bytes.length - EXIF_PAYLOAD_SIGNATURE.length;
	if (limit < 0) return false;
	outer: for (let i = 0; i <= limit; i++) {
		if (bytes[i] !== EXIF_PAYLOAD_SIGNATURE[0]) continue;
		for (let j = 1; j < EXIF_PAYLOAD_SIGNATURE.length; j++) {
			if (bytes[i + j] !== EXIF_PAYLOAD_SIGNATURE[j]) continue outer;
		}
		return true;
	}
	return false;
}

/**
 * Remove metadata containers from an upload payload, in place.
 *
 * Returns `null` when the container carries an EXIF payload we cannot remove
 * without corrupting the image. The caller MUST treat `null` as "do not
 * upload" rather than falling back to the original bytes — returning the input
 * untouched is how a GPS coordinate reaches the server in an app whose entire
 * reason to exist is not leaking them.
 */
export function stripImageMetadata(
	bytes: Uint8Array,
	mimeType: string,
): Uint8Array | null {
	switch (mimeType) {
		case "image/jpeg":
			return stripJpegMetadata(bytes) ?? bytes;
		case "image/gif":
			return stripGifMetadata(bytes) ?? bytes;
		case "image/png":
			return stripPngMetadata(bytes) ?? bytes;
		case "image/webp":
			return stripWebPMetadata(bytes) ?? bytes;
		default: {
			// HEIF/AVIF and any other ISO-BMFF-family container.
			//
			// These CANNOT be rewritten byte-wise. The Exif payload is an item
			// located through `iinf`/`iloc` inside the `meta` box, so it is not a
			// contiguous span and splicing it out by box arithmetic yields a file
			// most decoders reject; deleting the whole `meta` box is worse still,
			// because HEIF requires it to describe the primary image at all.
			//
			// So the honest options are: let it through when there is provably
			// nothing to leak, and refuse when there is.
			if (containsExifPayload(bytes)) return null;
			return bytes;
		}
	}
}

/**
 * Downscale a picked/captured image before upload so we never store (and then
 * decode/render) a full ~12MP camera photo. Decoding a multi-megapixel image on
 * the WebView main thread froze the app; capping the longest edge keeps inline
 * bubbles, the lightbox, and the recipient cheap.
 *
 * Every non-GIF image is re-encoded through a canvas — INCLUDING ones already
 * at or below MAX_UPLOAD_EDGE — because that re-encode is what strips EXIF,
 * IPTC and XMP. Previously only oversized images were redrawn, so every
 * photo at 1920px or under was uploaded with its GPS coordinates, camera model
 * and capture timestamp intact.
 *
 * Animated GIFs are not re-encoded (a canvas captures one frame, which would
 * flatten the animation) but ARE metadata-stripped in place, so they keep their
 * frames, frame delays and loop count while losing any XMP/comment payload.
 * If the canvas path is unavailable for any reason the byte-level stripper is
 * used rather than falling back to the raw file, so a metadata failure can
 * never turn into a GPS leak. The one case that is REFUSED rather than
 * rewritten is a container carrying an EXIF payload we cannot excise without
 * corrupting the image — see `stripImageMetadata`.
 *
 * Always reports the true pixel `width`/`height` of whatever bytes are being
 * returned: the profile-photos upload has to declare a square `thumbCoords`
 * crop, and a wrong dimension there makes the server silently drop the image.
 */
async function downscaleImage(
	file: File,
): Promise<{ base64: string; mimeType: string; width: number; height: number }> {
	const dimensionsOf = async (): Promise<{ width: number; height: number }> => {
		try {
			const bitmap = await createImageBitmap(file);
			const size = { width: bitmap.width, height: bitmap.height };
			bitmap.close();
			return size;
		} catch {
			// Unknown dimensions — Rust rejects a zero crop, which surfaces as a
			// clear error rather than a silently dropped photo.
			return { width: 0, height: 0 };
		}
	};
	/**
	 * Upload payload for the paths that cannot safely re-encode: the file's own
	 * bytes with the metadata containers removed in place.
	 *
	 * `stripImageMetadata` returns `null` for a container that carries an EXIF
	 * payload we cannot remove without corrupting the image (HEIF/AVIF, where the
	 * Exif data is a separate `iloc`-addressed item rather than a contiguous
	 * segment). `null` is a hard refusal, not a soft warning: the alternative is
	 * uploading the file with its GPS coordinates attached, and a photo the user
	 * can simply re-pick is a far better outcome than that.
	 */
	const stripped = async () => {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const sanitized = stripImageMetadata(bytes, file.type || "image/jpeg");
		if (!sanitized) {
			throw new Error(
				"This photo carries location data in a format we cannot remove " +
					"without damaging the image, so it was not uploaded. Saving a " +
					"copy as JPEG or PNG and picking that instead keeps the photo and " +
					"drops the location.",
			);
		}
		return {
			base64: bytesToBase64(sanitized),
			mimeType: file.type || "image/jpeg",
			...(await dimensionsOf()),
		};
	};
	// GIF: exempt from re-encoding, NOT from sanitization.
	if (file.type === "image/gif") return stripped();
	try {
		const bitmap = await createImageBitmap(file);
		const longest = Math.max(bitmap.width, bitmap.height);
		// scale of 1 for anything already within budget: it still goes through
		// the canvas below, it just is not resampled.
		const scale = longest <= MAX_UPLOAD_EDGE ? 1 : MAX_UPLOAD_EDGE / longest;
		const w = Math.round(bitmap.width * scale);
		const h = Math.round(bitmap.height * scale);
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			bitmap.close();
			return stripped();
		}
		ctx.drawImage(bitmap, 0, 0, w, h);
		bitmap.close();
		// PNG keeps its format so transparency survives; everything else becomes
		// JPEG, exactly as the oversize downscale path always has.
		const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
		const blob = await new Promise<Blob | null>((res) =>
			canvas.toBlob((b) => res(b), mimeType, REENCODE_QUALITY),
		);
		if (!blob) return stripped();
		const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
		return { base64, mimeType: blob.type || mimeType, width: w, height: h };
	} catch {
		return stripped();
	}
}

/**
 * Prepare a picked image for upload: downscaled, EXIF-stripped, base64.
 *
 * Exported so the album path reuses exactly the same preprocessing as the
 * profile/chat paths rather than uploading raw camera bytes (and raw EXIF,
 * including GPS) to a different endpoint.
 */
export async function prepareImageForUpload(
	file: File,
): Promise<{ base64: string; mimeType: string; width: number; height: number }> {
	return downscaleImage(file);
}

export async function uploadProfileImage(file: File): Promise<UploadedMedia> {
	const { base64, mimeType } = await downscaleImage(file);
	return uploadImageBytes(base64, mimeType);
}

// --- Profile photos (add / set primary / reorder) ----------------------------
//
// Previously the app could only DELETE a profile photo
// (`DELETE /v3/me/profile/images`). `POST /v3/me/profile/images` (upload) and
// `PUT /v3/me/profile/images` (set primary + secondaries) were never called from
// anywhere, so there was no way to add a photo or choose your main picture.
//
// Why a second upload path: `uploadProfileImage` targets
// `POST /v5/chat/media/upload`, the only endpoint that mints a numeric `mediaId`
// — but it returns a SIGNED 64-char hash. The profile-photos endpoints take
// PUBLIC 40-char hashes, so a chat-media hash is not a valid `primaryImageHash`.
// `upload_profile_photo` posts to the legacy `POST /v4/media/upload` instead,
// which returns the public hash.

const profileUploadResponseSchema = z.object({
	// The public CDN hash to feed to `primaryImageHash` / `secondaryImageHashes`.
	hash: mediaHashPublicSchema,
});

/** `POST /v4/media/upload` response — only the public `hash` is needed. */
export async function uploadProfilePhoto(file: File): Promise<string> {
	const { base64, mimeType, width, height } = await downscaleImage(file);
	const result = await invoke<{ status: number; body: string }>(
		"upload_profile_image",
		{ imageBase64: base64, mimeType, width, height },
	);
	if (result.status < 200 || result.status >= 300) {
		throw new Error(`HTTP ${result.status}: ${result.body.slice(0, 200)}`);
	}
	const parsed = profileUploadResponseSchema.safeParse(asJson(result.body));
	if (!parsed.success) {
		throw new Error(
			`Profile photo upload returned no usable public hash: ${result.body.slice(0, 200)}`,
		);
	}
	return parsed.data.hash;
}

function asJson(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		return null;
	}
}

/** Max secondary photos the API accepts (docs: `secondaryImageHashes`, max 5). */
export const MAX_SECONDARY_PROFILE_PHOTOS = 5;

/**
 * Replace the profile's photo set. `PUT /v3/me/profile/images`, a plain JSON
 * body, so it goes through `fetchRest` like any other call.
 *
 * Two documented traps, both handled here:
 *  - `primaryImageHash` set while `secondaryImageHashes` is `null` is a 400.
 *    Always send `[]`, never `null`.
 *  - Repeating the primary inside `secondaryImageHashes` is silently dropped,
 *    and a repeating secondary is saved as-is. De-duplicate defensively.
 */
export async function setProfilePhotos({
	primaryImageHash,
	secondaryImageHashes,
}: {
	primaryImageHash: string | null;
	secondaryImageHashes: string[];
}): Promise<void> {
	const primary = primaryImageHash;
	const seen = new Set<string>();
	if (primary) seen.add(primary);
	const secondary: string[] = [];
	for (const hash of secondaryImageHashes) {
		if (seen.has(hash)) continue;
		seen.add(hash);
		secondary.push(hash);
		if (secondary.length >= MAX_SECONDARY_PROFILE_PHOTOS) break;
	}
	const res = await fetchRest("/v3/me/profile/images", {
		method: "PUT",
		// Never `null` for secondaryImageHashes — see above.
		body: { primaryImageHash: primary, secondaryImageHashes: secondary },
	});
	if (res.status >= 400) {
		throw new Error(`HTTP ${res.status}: ${res.text().slice(0, 200)}`);
	}
}

/**
 * Mint a chat-usable numeric `mediaId` for an already-saved profile photo.
 *
 * Saved photos (the "My Photos" tab) only carry a public `mediaHash` — Grindr's
 * profile endpoints no longer expose a numeric `mediaId`, and there is no
 * documented endpoint that converts a saved hash into a chat-usable id directly.
 * The documented path is therefore: fetch the saved image bytes from the public
 * CDN (with auth), then re-upload them to `POST /v5/chat/media/upload` to mint a
 * fresh `{ mediaId, mediaHash, url }`. See docs:
 * grindr-api/media/public-cdn-files (profile images) and
 * grindr-api/users/profiles#upload-media.
 *
 * Cached by the public `mediaHash` (see "Minted-mediaId cache" above) — a
 * second send of the same saved photo reuses the previously minted id instead
 * of re-fetching + re-uploading.
 */
export async function prepareSavedPhotoForSend(
	mediaHash: string,
): Promise<UploadedMedia> {
	// Pull the full-resolution profile image (largest reliably-available size).
	const cdnUrl = `https://cdns.grindr.com/images/profile/1024x1024/${mediaHash}`;
	return prepareAuthedUrlForSend(cdnUrl, "saved photo", mediaHash);
}

/**
 * Mint a chat-usable numeric `mediaId` for a private (album) photo, or any
 * other authenticated/signed CDN URL that needs re-uploading to send in chat.
 *
 * Album content carries a signed CDN `url` but no numeric `mediaId`, and the
 * chat-send endpoint requires one — same constraint as saved profile photos.
 * The URL may be either grindr-hosted (bearer-token gated, e.g.
 * `cdns.grindr.com`) or a signed direct/CDN host (e.g. CloudFront album
 * media) — those don't accept (and don't need) a bearer token, since the
 * signature in the query string is the auth. Branch on the host and fetch
 * with the right helper, then re-upload through `POST /v5/chat/media/upload`
 * to mint a fresh `{ mediaId, mediaHash, url }`.
 *
 * Pass `cacheKey` (e.g. the source mediaHash or album `contentId`) to reuse a
 * previously minted id instead of re-fetching + re-uploading on every send.
 */
export async function prepareAuthedUrlForSend(
	url: string,
	what = "photo",
	cacheKey?: string,
): Promise<UploadedMedia> {
	if (cacheKey !== undefined) {
		const cached = mediaIdCache.get(cacheKey);
		if (cached) return cached;
	}
	const fetched = isAuthedHost(url)
		? await fetchAuthedBytes(url)
		: await fetchMediaBytes(url);
	if (!fetched) {
		throw new Error(`Could not fetch the ${what} to re-send it.`);
	}
	const imageBase64 = bytesToBase64(new Uint8Array(fetched.buffer));
	const minted = await uploadImageBytes(imageBase64, fetched.mime);
	if (cacheKey !== undefined) {
		mediaIdCache.set(cacheKey, minted);
		persistMediaIdCache();
	}
	return minted;
}
