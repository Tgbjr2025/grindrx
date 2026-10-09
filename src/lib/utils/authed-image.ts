import { invoke } from "@tauri-apps/api/core";

/**
 * Resolve a (possibly authenticated) Grindr CDN URL to something the WebView can
 * render directly.
 *
 * Grindr chat/album media on `cdns.grindr.com` is bearer-token gated, so a plain
 * `<img src>` gets a 403 black box. The Rust `fetch_authed_bytes` command
 * re-fetches the bytes with the auth header. It returns the RAW bytes as an
 * ArrayBuffer (NOT a base64 `data:` URL): base64 inflates the payload ~33% and,
 * worse, made the WebView main thread receive + re-parse a multi-MB string per
 * image — opening an album of several froze the UI. We wrap the bytes in a
 * `blob:` object URL instead.
 *
 * Signed CloudFront URLs load directly with no auth, so those are returned
 * unchanged.
 */

function classifyHost(url: string): "auth" | "direct" | "invalid" {
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		return "invalid";
	}
	if (
		host === "cdns.grindr.com" ||
		host.endsWith(".grindr.com") ||
		host.endsWith(".grindr.mobi")
	) {
		return "auth";
	}
	return "direct";
}

/**
 * True when `url` is a grindr-hosted URL that requires the bearer token
 * (`fetchAuthedBytes`), as opposed to a signed direct/CDN URL (e.g.
 * CloudFront album media) that is self-authenticating via its query-string
 * signature and should go through `fetchMediaBytes` instead. Exported so
 * callers that need re-uploadable bytes (e.g. `prepareAuthedUrlForSend`) can
 * pick the right fetcher.
 */
export function isAuthedHost(url: string): boolean {
	return classifyHost(url) === "auth";
}

// --- Object-URL cache --------------------------------------------------------
// Retain a compact `blob:` object URL per source URL. Map insertion order is the
// LRU recency order; evicting the oldest frees its blob so total retained image
// memory stays bounded across a long session. Also dedups: the cover,
// thumbnail and lightbox of the same image fetch once.
//
// `MAX_ENTRIES` was 96, i.e. up to 96 FULL-RESOLUTION photos retained at once
// (multi-MB each) — a hard OOM on a mid-range WebView. It is now a much smaller
// working set; full-resolution bytes are only fetched on demand (lightbox), not
// for inline bubbles.
const MAX_ENTRIES = 32;
const objectUrlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
// How many live consumers currently hold each object URL. Without this,
// eviction revoked a blob that a MOUNTED <img> was still displaying, so the
// element went blank and its onerror handler re-ran the whole IPC byte fetch —
// a flash-and-refetch storm every time you scrolled past the cache size.
const refCounts = new Map<string, number>();
// Evicted-but-still-referenced URLs, revoked once their last consumer releases.
const retired = new Map<string, string>();
// `retired` is outside the `objectUrlCache` size bound, so a caller that retains
// and never releases could pin unbounded blob memory for the process lifetime.
// Cap it: past this many parked blobs, sacrifice the oldest referenced entry
// (its <img> may briefly blank and re-fetch) rather than leak. A correct caller
// releases promptly and never reaches this.
const MAX_RETIRED = MAX_ENTRIES;
// Bumped by {@link purgeAuthedImageCache}. A `fetch_authed_bytes` that is still
// in flight when the purge lands must NOT re-insert the signed-out account's
// photo into the freshly-emptied cache, so every fetch records the epoch it
// started under and drops its bytes if the epoch moved. Without this the purge
// has a race window equal to the slowest media fetch (up to the 12s timeout),
// which is exactly the window a user double-signs-out/in through.
let cacheEpoch = 0;

/**
 * Retain a resolved object URL for as long as the caller needs it, and get a
 * release function to call from an `$effect`/teardown. Callers MUST release, or
 * the entry is never revoked (bounded by `MAX_ENTRIES` for the cache, but a
 * leaked blob is not freed).
 *
 * Prefer {@link resolveAuthedImageRetained}, which returns the release function
 * next to the URL so the two cannot be separated at the call site.
 */
export function retainAuthedImage(objectUrl: string): () => void {
	refCounts.set(objectUrl, (refCounts.get(objectUrl) ?? 0) + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const next = (refCounts.get(objectUrl) ?? 1) - 1;
		if (next <= 0) {
			refCounts.delete(objectUrl);
			// If it was evicted while still referenced, now is the time to free it.
			const parked = retired.get(objectUrl);
			if (parked !== undefined) {
				retired.delete(objectUrl);
				try {
					URL.revokeObjectURL(parked);
				} catch {
					// already revoked / not an object URL — nothing to do
				}
			}
		} else {
			refCounts.set(objectUrl, next);
		}
	};
}

/** Revoke a parked blob, swallowing the "already revoked" case. */
function revokeQuietly(objectUrl: string): void {
	try {
		URL.revokeObjectURL(objectUrl);
	} catch {
		// already revoked / not an object URL — nothing to do
	}
}

function remember(srcUrl: string, objectUrl: string): void {
	objectUrlCache.delete(srcUrl);
	objectUrlCache.set(srcUrl, objectUrl);
	while (objectUrlCache.size > MAX_ENTRIES) {
		const oldest = objectUrlCache.keys().next().value;
		if (oldest === undefined) break;
		const evicted = objectUrlCache.get(oldest);
		objectUrlCache.delete(oldest);
		if (evicted === undefined) continue;
		// Only revoke immediately when nothing is displaying it. Otherwise park
		// it until the last consumer releases.
		if ((refCounts.get(evicted) ?? 0) > 0) {
			retired.set(evicted, evicted);
			continue;
		}
		revokeQuietly(evicted);
	}
	// Keep the parked set bounded (see MAX_RETIRED).
	while (retired.size > MAX_RETIRED) {
		const oldest = retired.keys().next().value;
		if (oldest === undefined) break;
		retired.delete(oldest);
		refCounts.delete(oldest);
		revokeQuietly(oldest);
	}
}

/**
 * Forget every retained authenticated blob and REVOKE its object URL.
 *
 * WHY THIS EXISTS: `objectUrlCache` is module state with a process lifetime, so
 * its bound (32 full-resolution photos) capped MEMORY but never the photos'
 * LIFETIME. Signing out did not touch it, so account A's photos stayed
 * resolvable — and, because `resolveAuthedImage` returns the cached object URL
 * without re-checking the session, actually DISPLAYABLE — to account B on the
 * same process, until the WebView was restarted. That is a cross-account privacy
 * leak, not a memory issue, and lowering `MAX_ENTRIES` never addressed it.
 *
 * This is the real purge that the sign-out flow needs; `__resetAuthedImageCacheForTests`
 * is not a substitute (it drops the bookkeeping without freeing a single byte).
 * Wired into `purgeAccountLocalData`.
 *
 * Revokes EVERY object URL we are holding, including the `retired` parked set —
 * a parked blob is still live blob memory and still points at the previous
 * account's bytes — then clears the map, the in-flight de-dup table and the
 * ref-counts, so a stale `release()` closure from an unmounted `<img>` is a
 * harmless no-op instead of a double revoke.
 *
 * Returns how many object URLs were revoked, so the caller can log a purge that
 * actually had something to free (a silent `0` is how a broken wiring hides).
 * Idempotent, and safe to call when the cache was never populated.
 */
export function purgeAuthedImageCache(): number {
	// A Set, because the same object URL can be in `objectUrlCache` (still
	// displayable) and in `retired` (evicted but pinned by a retain) — revoking
	// twice is harmless but would report a wrong count.
	const held = new Set<string>([...objectUrlCache.values(), ...retired.values()]);
	// Bump FIRST: any fetch already awaiting the bridge is now provably stale and
	// will free its own bytes instead of remembering them.
	cacheEpoch++;
	objectUrlCache.clear();
	inflight.clear();
	refCounts.clear();
	retired.clear();
	for (const objectUrl of held) revokeQuietly(objectUrl);
	return held.size;
}

/**
 * Reset every module-level cache. Tests only: `objectUrlCache` is module
 * state, so without this a bound assertion in one test is satisfied by
 * bookkeeping the test never created (a freshly-reset counter reporting a
 * stale real cache as within budget).
 *
 * Deliberately does NOT revoke or bump `cacheEpoch`: it exists to isolate tests
 * from each other, and revoking would make the revocation assertions in the
 * purge tests order-dependent. {@link purgeAuthedImageCache} is the function
 * that frees bytes.
 */
export function __resetAuthedImageCacheForTests(): void {
	objectUrlCache.clear();
	inflight.clear();
	refCounts.clear();
	retired.clear();
}

/** Test-only introspection: how many object URLs are currently parked. */
export function __retiredAuthedImageCount(): number {
	return retired.size;
}

/**
 * Test-only introspection: how many source URLs currently have a retained
 * object URL. Zero after a purge proves the map itself was emptied, not just
 * that its entries were revoked.
 */
export function __cachedAuthedImageCount(): number {
	return objectUrlCache.size;
}

/** ISO-BMFF major brands that are genuinely video containers. */
const VIDEO_BRANDS = new Set([
	"isom",
	"iso2",
	"iso4",
	"iso5",
	"iso6",
	"mp41",
	"mp42",
	"avc1",
	"dash",
	"M4V ",
	"M4VP",
	"mmp4",
	"MSNV",
	"qt  ",
]);

/** ISO-BMFF major brands that are IMAGES despite living in the same container. */
const IMAGE_BRANDS = new Set([
	"heic",
	"heix",
	"hevc",
	"heim",
	"heis",
	"hevm",
	"hevs",
	"mif1",
	"msf1",
	"avif",
	"avis",
]);

/**
 * Sniff an image/video MIME from the leading magic bytes. `<img>` sniffs image
 * bytes regardless, but a correct type matters for the `<video>` element used by
 * album video slides.
 */
function sniffMime(b: Uint8Array): string {
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
		return "image/jpeg";
	}
	if (
		b.length >= 8 &&
		b[0] === 0x89 &&
		b[1] === 0x50 &&
		b[2] === 0x4e &&
		b[3] === 0x47
	) {
		return "image/png";
	}
	if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
		return "image/gif";
	}
	if (
		b.length >= 12 &&
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50
	) {
		return "image/webp";
	}
	// ISO-BMFF family check. `ftyp` sits at bytes 4..8 of EVERY ISO base-media
	// container — including HEIC, HEIF and AVIF, which are IMAGES. The previous
	// check matched on `ftyp` alone, so a HEIC photo was wrapped in a
	// `video/mp4` blob and an `<img>` could refuse to decode it.
	//
	// The MAJOR BRAND lives at bytes 8..12, so check that against the brands that
	// are actually video.
	if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
		const majorBrand = String.fromCharCode(b[8], b[9], b[10], b[11]);
		if (VIDEO_BRANDS.has(majorBrand)) return "video/mp4";
		// heic/heix/mif1/msf1/avif are still images, not videos.
		if (IMAGE_BRANDS.has(majorBrand)) {
			return majorBrand.startsWith("avif") ? "image/avif" : "image/heic";
		}
		// Unknown ISO-BMFF brand: fall through rather than guess "video".
	}
	if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
		return "video/webm";
	}
	return "application/octet-stream";
}

/**
 * Low-level: fetch authed bytes for a grindr-hosted URL as raw bytes plus a
 * sniffed MIME type. Used by the upload re-encode path (which needs the bytes,
 * not a blob handle). Returns null for non-grindr hosts or on failure.
 */
export async function fetchAuthedBytes(
	url: string,
): Promise<{ buffer: ArrayBuffer; mime: string } | null> {
	if (classifyHost(url) !== "auth") return null;
	try {
		// Hard timeout so a stuck bridge call can never hang album-load forever.
		// Clear the timer once the fetch settles so it doesn't dangle per call.
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const buffer = await Promise.race([
				invoke<ArrayBuffer>("fetch_authed_bytes", { url }),
				new Promise<ArrayBuffer>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("fetch_authed_bytes timed out")),
						12000,
					);
				}),
			]);
			return { buffer, mime: sniffMime(new Uint8Array(buffer)) };
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		console.error(
			"[GrindrX] fetch_authed_bytes failed for",
			url.slice(0, 120),
			"-",
			error,
		);
		return null;
	}
}

/**
 * Low-level: fetch bytes for a signed/direct CDN URL (e.g. a CloudFront album
 * photo) WITHOUT the Grindr bearer token. Signed CDN URLs are
 * self-authenticating via their query-string signature, so attaching
 * Authorization would be both unnecessary and a needless token exposure to a
 * third-party host — `fetch_authed_bytes` refuses these hosts outright (see
 * `classifyHost`/`isAuthedHost`). The Rust `fetch_media_bytes` command
 * allowlists the signed-CDN hosts (CloudFront + cdns.grindr.com) to prevent
 * SSRF. Used by the album re-upload path, which needs raw bytes (not a blob
 * handle) to hand to the chat-media upload. Returns null on failure — mirrors
 * `fetchAuthedBytes`.
 */
export async function fetchMediaBytes(
	url: string,
): Promise<{ buffer: ArrayBuffer; mime: string } | null> {
	try {
		// Hard timeout so a stuck bridge call can never hang album-load forever.
		// Clear the timer once the fetch settles so it doesn't dangle per call.
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const buffer = await Promise.race([
				invoke<ArrayBuffer>("fetch_media_bytes", { url }),
				new Promise<ArrayBuffer>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("fetch_media_bytes timed out")),
						12000,
					);
				}),
			]);
			return { buffer, mime: sniffMime(new Uint8Array(buffer)) };
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		console.error(
			"[GrindrX] fetch_media_bytes failed for",
			url.slice(0, 120),
			"-",
			error,
		);
		return null;
	}
}

/**
 * Resolve an image URL for display. Non-grindr hosts are returned unchanged;
 * grindr-hosted media is fetched with the bearer token and returned as a
 * bounded, deduped `blob:` object URL. Returns null on failure so callers can
 * fall back to the raw URL.
 */
export async function resolveAuthedImage(url: string): Promise<string | null> {
	const kind = classifyHost(url);
	if (kind !== "auth") return url;

	const cached = objectUrlCache.get(url);
	if (cached) {
		remember(url, cached); // mark recently used
		return cached;
	}
	const pending = inflight.get(url);
	if (pending) return pending;

	// Pinned for the lifetime of this fetch; see the `cacheEpoch` check below.
	const epoch = cacheEpoch;
	const task = (async () => {
		try {
			const result = await fetchAuthedBytes(url);
			if (!result) return null;
			const objectUrl = URL.createObjectURL(
				new Blob([result.buffer], { type: result.mime }),
			);
			// A purge landed while these bytes were in flight. They were fetched
			// with the SIGNED-OUT session's bearer token, so remembering them would
			// hand the next account the previous account's photo — the exact leak
			// `purgeAuthedImageCache` exists to close. Free them and report failure
			// so the caller falls back as it does for any other fetch failure.
			if (epoch !== cacheEpoch) {
				revokeQuietly(objectUrl);
				return null;
			}
			remember(url, objectUrl);
			return objectUrl;
		} finally {
			inflight.delete(url);
		}
	})();
	inflight.set(url, task);
	return task;
}

/**
 * {@link resolveAuthedImage} plus a retain, returned TOGETHER so the release
 * function cannot be dropped at a call site.
 *
 * This exists because `retainAuthedImage` had zero callers: the ref-count that
 * stops cache eviction revoking a blob a mounted `<img>` is still displaying
 * was dead code, so every eviction revoked immediately and scrolling past the
 * cache size produced a blank image whose `onerror` re-ran the whole IPC byte
 * fetch. Returning the pair together makes the correct call shape the default.
 *
 * `release` is idempotent and must be called from the consumer's teardown.
 * `release` is null when `url` was not an authed host (nothing to retain).
 */
export async function resolveAuthedImageRetained(
	url: string,
): Promise<{ url: string; release: (() => void) | null }> {
	const resolved = await resolveAuthedImage(url);
	if (resolved === null) return { url, release: null };
	// Only blob: object URLs are ours to retain/revoke. A passthrough of a
	// signed or direct URL has no lifecycle to manage.
	if (!resolved.startsWith("blob:")) return { url: resolved, release: null };
	return { url: resolved, release: retainAuthedImage(resolved) };
}
