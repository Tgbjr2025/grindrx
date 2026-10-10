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
 * It deliberately does NOT touch the fetch limiter (P2-004). Forcibly freeing
 * slots here would admit more concurrent fetches than the configured limit,
 * re-creating the memory spike the limiter exists to prevent; the in-flight
 * fetches hold their slots until they settle and release normally.
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
	// The limiter is module state too. Left un-reset, a slot leaked by an earlier
	// test would silently shrink the effective limit for every later one — and a
	// leak assertion would be measuring the previous test's leak, not this one.
	__resetImageFetchSemaphoreForTests();
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

// --- Image fetch concurrency limiter (P2-004) -------------------------------
//
// THE DEFECT THIS CLOSES. `MAX_ENTRIES` bounds how many blobs are RETAINED and
// `inflight` bounds how many fetches run for the SAME url. Neither bounds how
// many fetches run AT ALL. `CdnImage` (the grid), `ImageMessage`/`AlbumMessage`
// (chat) and `MediaGallery` (lightbox) all call `resolveAuthedImage` on mount,
// so opening a grid page or an album issued one `fetch_authed_bytes` IPC call
// per tile simultaneously. Each of those returns a multi-MB `ArrayBuffer` that
// is then wrapped in a Blob and an object URL, so N tiles meant N multi-MB
// buffers materialising on the WebView main thread at once, plus N concurrent
// calls saturating the Rust `reqwest` pool behind the Tauri IPC bridge. The
// symptoms are a memory spike and a stalled main thread on exactly the screens
// that render the most images — the opposite of what a photo grid should do.
//
// THE DEFAULT AND WHY IT IS 4.
//
//   * One grid page is roughly 12-20 tiles; an album opens several slides at
//     once. At 4 the whole first screen is in flight almost immediately, because
//     a typical tile fetch is far shorter than the 12s per-call timeout.
//   * Below ~3 the grid fills visibly slower than the network can deliver, and
//     the user perceives it as "scrolling is laggy".
//   * Above ~8 the multi-MB buffer spike returns and the main-thread stall that
//     motivated this limiter comes back with it.
//
// The honest ceiling: because each call keeps its existing 12s timeout, the
// worst case for a burst of N images is ceil(N / limit) * 12s. That is the price
// of bounded memory, and it is bounded on purpose — unbounded concurrency is not
// "fast", it is a stall with a worse tail.
const DEFAULT_MAX_CONCURRENT_FETCHES = 4;

/**
 * The effective cap on concurrent `fetch_authed_bytes` / `fetch_media_bytes`
 * calls. `Infinity` is a supported, documented setting meaning "never queue" —
 * that is the configuration in which the limiter is a true no-op.
 */
let maxConcurrentFetches: number = DEFAULT_MAX_CONCURRENT_FETCHES;

/**
 * Slots currently OCCUPIED — acquired, or transferred to a waiter that has not
 * yet resumed. Counting the hand-off is what makes the queue exact: see
 * {@link releaseFetchSlot}.
 */
let activeFetches = 0;

/** Callers waiting for a slot, in ARRIVAL order (strict FIFO). */
const fetchWaiters: SlotWaiter[] = [];

interface SlotWaiter {
	/**
	 * Take a slot and continue. Increments {@link activeFetches} SYNCHRONOUSLY,
	 * because the slot is transferred at this instant — before the waiter
	 * resumes on a later microtask.
	 */
	grant: () => void;
}

/**
 * Set the maximum number of concurrent image byte-fetches. Returns the limit
 * actually adopted, so a caller can log a value that was clamped.
 *
 * SAFETY: a limit below 1 is not "slower", it is a DEADLOCK — every fetch would
 * queue forever and no image in the app would ever render. There is no error to
 * surface at that point, so the value is clamped up to 1 rather than accepted.
 * `NaN` is treated the same way and falls back to the default, because
 * `activeFetches < NaN` is ALWAYS false — a `NaN` limit hangs the whole app
 * silently.
 */
export function setMaxConcurrentImageFetches(limit: number): number {
	if (limit === Number.POSITIVE_INFINITY) {
		maxConcurrentFetches = Number.POSITIVE_INFINITY;
	} else if (Number.isFinite(limit)) {
		maxConcurrentFetches = Math.max(1, Math.floor(limit));
	} else {
		maxConcurrentFetches = DEFAULT_MAX_CONCURRENT_FETCHES;
	}
	// Raising the limit must admit whoever is ALREADY waiting, not just whoever
	// arrives next.
	drainWaiters();
	return maxConcurrentFetches;
}

/** The limit currently in force. */
export function getMaxConcurrentImageFetches(): number {
	return maxConcurrentFetches;
}

/**
 * The signal a caller passes to abandon a fetch it no longer needs (e.g. a grid
 * tile scrolled out of view before its queued fetch started).
 *
 * NOTE ON SCOPE: this is plumbed through the low-level byte fetchers ONLY, and
 * deliberately NOT through `resolveAuthedImage`. That function de-duplicates
 * concurrent callers through the shared `inflight` map, so one caller's abort
 * would fail a DIFFERENT caller's identical fetch. A per-caller abort signal and
 * a shared in-flight promise are incompatible; the shared promise wins, because
 * breaking it would regress the de-dup that stops a thumbnail, a cover and a
 * lightbox from fetching the same photo three times.
 */
export class ImageFetchAbortedError extends Error {
	constructor() {
		super("image fetch aborted before it started");
		this.name = "AbortError";
	}
}

/**
 * Build the one-and-only release function for a slot.
 *
 * THE CONTRACT: exactly one `release()` per successful `acquireFetchSlot()`.
 * The `released` flag is what makes a double release harmless. That matters
 * because the mirror image of "a leaked slot" is "an over-released slot", which
 * would silently re-admit more concurrent fetches than the configured limit and
 * defeat the limiter entirely.
 */
function makeSlotRelease(): () => void {
	let released = false;
	return () => {
		if (released) return;
		released = true;
		releaseFetchSlot();
	};
}

/**
 * Hand a freed slot to the head of the queue, if anyone is waiting.
 *
 * The decrement and the hand-off are both SYNCHRONOUS, so `activeFetches` is
 * never observably below the limit: a new caller can only run after this
 * function returns, by which time the waiter has already been counted. Were
 * the wake deferred to a microtask instead, a caller arriving in that gap would
 * see a free slot, take it, and the woken waiter would then take a second one —
 * admitting limit+1.
 */
function releaseFetchSlot(): void {
	// `Math.max(0, …)` is defensive: after a test reset `activeFetches` is 0 and
	// an already-outstanding task still releases its slot. Real double-releases
	// are stopped by the `released` flag in {@link makeSlotRelease}.
	activeFetches = Math.max(0, activeFetches - 1);
	const next = fetchWaiters.shift();
	if (next !== undefined) next.grant();
}

/** Admit waiters while there is room. Called after the limit is RAISED. */
function drainWaiters(): void {
	while (fetchWaiters.length > 0 && activeFetches < maxConcurrentFetches) {
		fetchWaiters.shift()?.grant();
	}
}

/**
 * Take a fetch slot, or queue until one frees.
 *
 * A REJECTION here means no slot was ever taken, so the caller has nothing to
 * release. That is the only path out of this function that does not hand back a
 * release function, and it is why `acquireFetchSlot` is not called inside the
 * `try` whose `finally` releases.
 */
function acquireFetchSlot(signal?: AbortSignal): Promise<() => void> {
	// Already abandoned before we even queued: fail fast rather than occupy a
	// slot for a request nobody is waiting on.
	if (signal?.aborted === true) {
		return Promise.reject(new ImageFetchAbortedError());
	}

	// FAST PATH — under the limit. No queue, no deferral, no extra ordering: this
	// is the "limiter is a no-op" case, and it is taken SYNCHRONOUSLY so the task
	// starts on this tick exactly as it did before the limiter existed.
	if (activeFetches < maxConcurrentFetches) {
		activeFetches++;
		return Promise.resolve(makeSlotRelease());
	}

	// SLOW PATH — queue. Strict FIFO on arrival.
	//
	// WHY FIFO AND NOT "profile photos over thumbnails": `resolveAuthedImage`
	// receives a URL and nothing else — it cannot tell a 1024x1024 profile render
	// from a 320x320 thumbnail, because `CdnImage` resolves both through the
	// identical path. A priority scheme would therefore require changing call
	// sites, and any priority scheme is a starvation risk: with a continuous
	// arrival of low-priority thumbnails, a high-priority profile photo can wait
	// forever, which is a WORSE failure than a slightly late thumbnail. FIFO is
	// starvation-free by construction and needs no caller to change.
	return new Promise<() => void>((resolve, reject) => {
		let granted = false;

		const onAbort = (): void => {
			// Already running: the slot belongs to that task and is released by its
			// own `finally`. Aborting here must not double-hand the slot.
			if (granted) return;
			const index = fetchWaiters.indexOf(waiter);
			if (index >= 0) fetchWaiters.splice(index, 1);
			reject(new ImageFetchAbortedError());
		};

		const waiter: SlotWaiter = {
			grant: () => {
				granted = true;
				// The slot is transferred NOW, not when this waiter resumes: the
				// releaser already decremented, and `drainWaiters` relies on this
				// synchronous increment to avoid over-admitting.
				activeFetches++;
				signal?.removeEventListener("abort", onAbort);
				resolve(makeSlotRelease());
			},
		};

		signal?.addEventListener("abort", onAbort, { once: true });
		fetchWaiters.push(waiter);
	});
}

/** Test-only introspection: slots occupied right now. Must return to 0. */
export function __imageFetchSlotsInUse(): number {
	return activeFetches;
}

/** Test-only introspection: how many callers are queued for a slot. */
export function __imageFetchSlotsQueued(): number {
	return fetchWaiters.length;
}

/**
 * Reset the limiter to its default and free anyone queued. Tests only, for the
 * same reason `__resetAuthedImageCacheForTests` exists: this is module state,
 * and a leak assertion in one test is meaningless if a previous test leaked a
 * slot into it.
 *
 * Queued waiters are GRANTED (not rejected) so nothing is left hanging on a
 * promise that will never settle; their tasks proceed and release normally.
 */
export function __resetImageFetchSemaphoreForTests(): void {
	activeFetches = 0;
	maxConcurrentFetches = DEFAULT_MAX_CONCURRENT_FETCHES;
	const stranded = fetchWaiters.splice(0, fetchWaiters.length);
	for (const waiter of stranded) waiter.grant();
}

/**
 * Low-level: fetch authed bytes for a grindr-hosted URL as raw bytes plus a
 * sniffed MIME type. Used by the upload re-encode path (which needs the bytes,
 * not a blob handle). Returns null for non-grindr hosts or on failure.
 *
 * The whole body runs inside ONE limiter slot. The `finally` that releases it is
 * the reason a failed, timed-out or aborted fetch cannot leak a slot — a leaked
 * slot is permanent, and `limit` permanent leaks means the app eventually stops
 * loading ANY image for the rest of the process lifetime. That failure mode is
 * strictly worse than the unbounded concurrency this limiter was added to fix,
 * which is why it is pinned by tests rather than left to review.
 */
export async function fetchAuthedBytes(
	url: string,
	signal?: AbortSignal,
): Promise<{ buffer: ArrayBuffer; mime: string } | null> {
	// Host classification first: a non-authed URL returns immediately and must
	// never occupy a slot another image needs.
	if (classifyHost(url) !== "auth") return null;

	let release: (() => void) | undefined = undefined;
	try {
		// May REJECT when `signal` is already aborted — that happens BEFORE a slot
		// is taken, so the `finally` below must not run and nothing leaks.
		release = await acquireFetchSlot(signal);
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
		// An abort is a caller decision, not a fault: it is reported with the same
		// `null` as any other failure because these fetchers never throw. Callers
		// treat `null` as "fall back to the placeholder", which is exactly right
		// for a tile that has scrolled away.
		if (!(error instanceof ImageFetchAbortedError)) {
			console.error(
				"[GrindrX] fetch_authed_bytes failed for",
				url.slice(0, 120),
				"-",
				error,
			);
		}
		return null;
	} finally {
		// THE SLOT-RELEASE CONTRACT. Unconditional, and the LAST thing that
		// happens: success, `invoke` rejection, the 12s timeout, a decode throw
		// and an abort all land here. `release` is undefined only on the
		// never-acquired abort path, where the optional call is a no-op.
		// MUTATION-1: release removed
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
	signal?: AbortSignal,
): Promise<{ buffer: ArrayBuffer; mime: string } | null> {
	// Same limiter as `fetchAuthedBytes`: this is a multi-MB CDN byte fetch over
	// the same Rust bridge and the same connection pool, so leaving it unbounded
	// would leave a hole in the cap for any caller that reaches for signed media.
	// Holding a slot across only the FETCH (never across the re-encode or the
	// upload that follows) is what keeps this from serialising the whole upload.
	let release: (() => void) | undefined = undefined;
	try {
		release = await acquireFetchSlot(signal);
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
		// An abort is not a fault, so it is not logged as one — see the identical
		// branch in `fetchAuthedBytes`.
		if (!(error instanceof ImageFetchAbortedError)) {
			console.error(
				"[GrindrX] fetch_media_bytes failed for",
				url.slice(0, 120),
				"-",
				error,
			);
		}
		return null;
	} finally {
		// Same unconditional slot release as `fetchAuthedBytes`. See THE
		// SLOT-RELEASE CONTRACT above.
		release?.();
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
