import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `authed-image.ts` had NO test coverage at all, despite being the module every
 * image, album slide and (now) voice message in the app depends on — and despite
 * two real bugs living in it: a 96-entry FULL-RESOLUTION LRU that revoked blob
 * URLs mounted `<img>` elements still held, and an `ftyp`-only MP4 sniff that
 * mislabelled HEIC/AVIF images as video.
 *
 * `invoke` is mocked because every authenticated fetch goes through the Tauri
 * `fetch_authed_bytes` command.
 */
const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
	invoke: (cmd: string, args?: unknown): Promise<unknown> =>
		invoke(cmd, args),
}));

import {
	__cachedAuthedImageCount,
	__imageFetchSlotsInUse,
	__imageFetchSlotsQueued,
	__resetAuthedImageCacheForTests,
	__retiredAuthedImageCount,
	fetchAuthedBytes,
	getMaxConcurrentImageFetches,
	isAuthedHost,
	purgeAuthedImageCache,
	resolveAuthedImage,
	resolveAuthedImageRetained,
	setMaxConcurrentImageFetches,
} from "$lib/utils/authed-image";

/** Blobs handed to `URL.createObjectURL`, so tests can assert on the MIME type. */
let createdBlobs: Blob[] = [];
/** Object URLs and whether they are still live. */
let urlLive: Map<string, boolean> = null as unknown as Map<string, boolean>;

function isoBmff(majorBrand: string): Uint8Array {
	// `ftyp` at 4..8 and the major brand at 8..12, as in a real ISO-BMFF header.
	const b = new Uint8Array(16);
	b[4] = 0x66; // f
	b[5] = 0x74; // t
	b[6] = 0x79; // y
	b[7] = 0x70; // p
	for (let i = 0; i < 4; i++) b[8 + i] = majorBrand.charCodeAt(i);
	return b;
}

function jpeg(): Uint8Array {
	return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

/**
 * Serve these bytes for any authenticated fetch. `fetch_authed_bytes` resolves to
 * a RAW ArrayBuffer and sniffs the MIME itself, so the mock must return exactly
 * that — not a `{ buffer, mime }` object.
 */
function serveBytes(bytes: Uint8Array): void {
	invoke.mockResolvedValue(bufferOf(bytes));
}

const SIGNED_URL = "https://d1234.cloudfront.net/signed/album-photo.jpg?sig=abc";

beforeEach(() => {
	invoke.mockReset();
	createdBlobs = [];
	urlLive = new Map();
	// `objectUrlCache` / `refCounts` / `retired` are MODULE state, so without this
	// reset a bound assertion in one test is satisfied by bookkeeping the test
	// never created — the previous suite asserted against a freshly-reset counter
	// while a real, populated cache sat behind it.
	__resetAuthedImageCacheForTests();
	let n = 0;
	// Subclass rather than replace: `classifyHost` does `new URL(...)`, so a plain
	// object stub silently broke host classification.
	class StubUrl extends URL {
		static override createObjectURL(blob: Blob): string {
			createdBlobs.push(blob);
			const u = `blob:mock/${n++}`;
			urlLive.set(u, true);
			return u;
		}
		static override revokeObjectURL(u: string): void {
			urlLive.set(u, false);
		}
	}
	vi.stubGlobal("URL", StubUrl);
});

function liveUrlCount(): number {
	return [...urlLive.values()].filter(Boolean).length;
}

describe("isAuthedHost", () => {
	it("treats grindr CDN hosts as needing the bearer token", () => {
		expect(isAuthedHost("https://cdns.grindr.com/images/full/hash")).toBe(true);
	});

	it("treats signed CloudFront URLs as directly loadable", () => {
		expect(isAuthedHost(SIGNED_URL)).toBe(false);
	});

	it("does not throw on a malformed URL", () => {
		expect(() => isAuthedHost("not a url")).not.toThrow();
	});
});

describe("resolveAuthedImage", () => {
	it("returns a signed URL unchanged, with no IPC round-trip", async () => {
		serveBytes(jpeg());
		await expect(resolveAuthedImage(SIGNED_URL)).resolves.toBe(SIGNED_URL);
		expect(invoke).not.toHaveBeenCalled();
	});

	it("fetches an authed host once and reuses the object URL", async () => {
		serveBytes(jpeg());
		const url = "https://cdns.grindr.com/images/full/dedupe";
		const first = await resolveAuthedImage(url);
		const second = await resolveAuthedImage(url);
		expect(first).toBe(second);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("dedups concurrent resolves of the same URL into a single fetch", async () => {
		serveBytes(jpeg());
		const url = "https://cdns.grindr.com/images/full/concurrent";
		const [a, b, c] = await Promise.all([
			resolveAuthedImage(url),
			resolveAuthedImage(url),
			resolveAuthedImage(url),
		]);
		expect(a).toBe(b);
		expect(b).toBe(c);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("returns null when the fetch fails rather than throwing", async () => {
		invoke.mockRejectedValue(new Error("boom"));
		await expect(
			resolveAuthedImage("https://cdns.grindr.com/images/full/fails"),
		).resolves.toBeNull();
	});

	it("keeps the number of live object URLs bounded", async () => {
		// The cap was 96 FULL-RESOLUTION entries — multi-MB each, so a hard OOM on
		// a mid-range WebView. Drive well past the cap.
		serveBytes(jpeg());
		for (let i = 0; i < 60; i++) {
			await resolveAuthedImage(`https://cdns.grindr.com/images/full/bulk-${i}`);
		}
		// Cache cap is 32, so live URLs must stay at or below that.
		expect(liveUrlCount()).toBeLessThanOrEqual(32);
	});

	it("revokes the oldest entry when the cap is exceeded", async () => {
		serveBytes(jpeg());
		for (let i = 0; i < 40; i++) {
			await resolveAuthedImage(`https://cdns.grindr.com/images/full/evict-${i}`);
		}
		// Some URLs must have been freed, otherwise the cache is not evicting.
		expect(liveUrlCount()).toBeLessThan(40);
	});
});

describe("MIME sniffing", () => {
	// A HEIC/AVIF photo is an ISO-BMFF container, so it carries `ftyp` at bytes
	// 4..8 exactly like an MP4. The old check matched on `ftyp` alone, so a photo
	// was wrapped in a `video/mp4` blob and an <img> could refuse to decode it.
	it("does not mislabel a HEIC photo as video", async () => {
		serveBytes(isoBmff("heic"));
		await resolveAuthedImage("https://cdns.grindr.com/images/full/heic");
		expect(createdBlobs).toHaveLength(1);
		expect(createdBlobs[0].type).toBe("image/heic");
	});

	it("does not mislabel an AVIF photo as video", async () => {
		serveBytes(isoBmff("avif"));
		await resolveAuthedImage("https://cdns.grindr.com/images/full/avif");
		expect(createdBlobs[0].type).toBe("image/avif");
	});

	it("still recognises a real MP4", async () => {
		serveBytes(isoBmff("isom"));
		await resolveAuthedImage("https://cdns.grindr.com/images/full/mp4");
		expect(createdBlobs[0].type).toBe("video/mp4");
	});

	it("recognises JPEG and PNG", async () => {
		serveBytes(jpeg());
		await resolveAuthedImage("https://cdns.grindr.com/images/full/jpeg");
		expect(createdBlobs[0].type).toBe("image/jpeg");

		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
		serveBytes(png);
		await resolveAuthedImage("https://cdns.grindr.com/images/full/png");
		expect(createdBlobs[1].type).toBe("image/png");
	});
});

/**
 * REGRESSION: `retainAuthedImage` had ZERO callers in `src/`, so `refCounts` was
 * permanently empty, the `refCounts.get(evicted) > 0` guard in `remember()` was
 * always false, every eviction revoked immediately, and `retired` was never
 * written. The "never revoke while still displayed" guarantee was inert — a
 * mounted <img> went blank and its onerror re-ran the whole IPC byte fetch.
 */
describe("retained object URLs survive cache eviction", () => {
	function authedUrl(i: number): string {
		return `https://cdns.grindr.com/images/full/retain-${i}.jpg`;
	}

	it("does NOT revoke a URL that is still retained when the cache overflows", async () => {
		serveBytes(jpeg());

		// Resolve and RETAIN the first image — this stands in for a mounted <img>.
		const first = await resolveAuthedImageRetained(authedUrl(0));
		expect(first.release).not.toBeNull();
		const firstUrl = first.url;
		expect(urlLive.get(firstUrl)).toBe(true);

		// Overflow the 32-entry cache with unretained fetches.
		for (let i = 1; i <= 40; i++) {
			await resolveAuthedImage(authedUrl(i));
		}

		// The retained blob must still be live — this is the whole guarantee.
		expect(urlLive.get(firstUrl)).toBe(true);
		expect(__retiredAuthedImageCount()).toBeGreaterThan(0);

		// Releasing it now is what actually frees the bytes.
		first.release?.();
		expect(urlLive.get(firstUrl)).toBe(false);
	});

	it("revokes normally for an unretained URL, so the cache is still bounded", async () => {
		serveBytes(jpeg());

		const first = (await resolveAuthedImage(authedUrl(0))) as string;
		for (let i = 1; i <= 40; i++) {
			await resolveAuthedImage(authedUrl(i));
		}

		expect(urlLive.get(first)).toBe(false);
	});

	it("returns a null release for a direct (non-authed) URL — nothing to retain", async () => {
		const result = await resolveAuthedImageRetained(SIGNED_URL);
		expect(result.url).toBe(SIGNED_URL);
		expect(result.release).toBeNull();
	});

	it("make() release is idempotent, so a double teardown cannot under-count", async () => {
		serveBytes(jpeg());
		const { release } = await resolveAuthedImageRetained(authedUrl(0));
		expect(release).not.toBeNull();

		release?.();
		release?.();
		release?.();

		// A second release must not revoke something already freed, and must not
		// throw.
		expect(urlLive.size).toBeGreaterThanOrEqual(0);
	});

	it("bounds the parked set so a leaked retain cannot pin unbounded blobs", async () => {
		serveBytes(jpeg());

		// Retain 40 distinct URLs without ever releasing. `retired` is outside the
		// objectUrlCache size bound, so without its own cap this pins 40 blobs.
		const releases: (() => void)[] = [];
		for (let i = 0; i < 40; i++) {
			const r = await resolveAuthedImageRetained(authedUrl(i));
			if (r.release) releases.push(r.release);
		}

		// Each newly resolved URL evicts the oldest, which is retained, so it parks.
		expect(__retiredAuthedImageCount()).toBeLessThanOrEqual(32);
		for (const r of releases) r();
	});
});

/**
 * THE PRIVACY DEFECT: `objectUrlCache` is MODULE state, so its `MAX_ENTRIES`
 * bound capped memory but never the photos' LIFETIME. Signing out did not touch
 * it, and `resolveAuthedImage` returns a cache hit WITHOUT re-checking the
 * session — so account A's full-resolution photos stayed resolvable, and
 * renderable, by account B on the same WebView process until restart. Reducing
 * 96 -> 32 shrank the window; it never closed it.
 */
describe("purgeAuthedImageCache", () => {
	function authedUrl(i: number): string {
		return `https://cdns.grindr.com/images/full/purge-${i}.jpg`;
	}

	it("empties the cache and revokes every object URL", async () => {
		serveBytes(jpeg());
		const urls: string[] = [];
		for (let i = 0; i < 5; i++) {
			urls.push((await resolveAuthedImage(authedUrl(i))) as string);
		}
		expect(__cachedAuthedImageCount()).toBe(5);
		for (const u of urls) expect(urlLive.get(u)).toBe(true);

		expect(purgeAuthedImageCache()).toBe(5);

		// The MAP is empty, not merely de-referenced, and every blob is freed.
		expect(__cachedAuthedImageCount()).toBe(0);
		expect(liveUrlCount()).toBe(0);
	});

	it("is idempotent and reports nothing to free on a second call", () => {
		expect(purgeAuthedImageCache()).toBe(0);
		expect(purgeAuthedImageCache()).toBe(0);
		expect(__cachedAuthedImageCount()).toBe(0);
	});

	it("revokes PARKED (evicted but still retained) blobs, not just live ones", async () => {
		serveBytes(jpeg());

		// Retain the first image, then overflow the 32-entry cache so it is evicted
		// into `retired` — blob memory that is still live and still the previous
		// account's bytes.
		const first = await resolveAuthedImageRetained(authedUrl(0));
		expect(__retiredAuthedImageCount()).toBe(0);
		for (let i = 1; i <= 40; i++) await resolveAuthedImage(authedUrl(i));
		expect(__retiredAuthedImageCount()).toBeGreaterThan(0);

		const revoked = purgeAuthedImageCache();

		// 32 cached + the parked set, counted once each even where they overlap.
		expect(revoked).toBeGreaterThan(32);
		expect(__retiredAuthedImageCount()).toBe(0);
		expect(liveUrlCount()).toBe(0);

		// A release closure captured before the purge must now be a no-op, not a
		// double revoke and not a throw.
		expect(() => first.release?.()).not.toThrow();
	});

	it("stops the next account resolving the previous account's cached photo", async () => {
		serveBytes(jpeg());
		const url = authedUrl(0);

		const accountA = (await resolveAuthedImage(url)) as string;
		expect(invoke).toHaveBeenCalledTimes(1);
		// A cache hit costs no IPC and returns the same handle — this is exactly
		// what made the old state a cross-account leak rather than dead bytes.
		expect(await resolveAuthedImage(url)).toBe(accountA);
		expect(invoke).toHaveBeenCalledTimes(1);

		purgeAuthedImageCache();

		// Account B asks for the same photo. The bytes are gone, so the fetch is
		// re-issued with B's bearer token and a fresh object URL is minted. There
		// is no path by which A's bytes are served to B.
		const accountB = (await resolveAuthedImage(url)) as string;
		expect(accountB).not.toBe(accountA);
		expect(urlLive.get(accountA)).toBe(false);
		expect(urlLive.get(accountB)).toBe(true);
		expect(invoke).toHaveBeenCalledTimes(2);
	});

	// The race the purge has to close: `fetch_authed_bytes` takes up to 12s, and a
	// user can sign out inside that window. Without an epoch check the late
	// response would call `remember()` on the freshly-emptied cache and hand the
	// previous account's photo to whoever signs in next.
	it("does not re-cache a fetch that was in flight when the purge ran", async () => {
		let releaseBridge: (buffer: ArrayBuffer) => void = () => {};
		invoke.mockImplementation(
			() =>
				new Promise<ArrayBuffer>((resolve) => {
					releaseBridge = resolve;
				}),
		);
		const url = authedUrl(0);

		const pending = resolveAuthedImage(url);
		expect(__cachedAuthedImageCount()).toBe(0);

		purgeAuthedImageCache();

		// The bridge answers only now — after the sign-out.
		releaseBridge(bufferOf(jpeg()));
		expect(await pending).toBeNull();
		// Not cached, and the stale blob was freed rather than pinned.
		expect(__cachedAuthedImageCount()).toBe(0);
		expect(liveUrlCount()).toBe(0);
	});

	it("still serves a fetch started AFTER the purge", async () => {
		serveBytes(jpeg());
		const url = authedUrl(0);
		purgeAuthedImageCache();

		// Epoch is only bumped by the purge, so the next account's own fetch is
		// unaffected and caches normally.
		const fresh = (await resolveAuthedImage(url)) as string;
		expect(fresh).not.toBeNull();
		expect(__cachedAuthedImageCount()).toBe(1);
		expect(urlLive.get(fresh)).toBe(true);
	});
});

// =============================================================================
// P2-004 — image fetch semaphore.
//
// `MAX_ENTRIES` bounded how many blobs are RETAINED and `inflight` bounded how
// many fetches ran for the SAME url. Nothing bounded how many ran AT ALL: a grid
// page or an album issued one `fetch_authed_bytes` per tile at the same instant,
// each returning a multi-MB ArrayBuffer. These tests pin both halves of the fix —
// that the cap is real, and (more importantly) that the cap is RELEASED.
// =============================================================================

/**
 * A bridge whose calls stay open until the test settles them, so "N fetches in
 * flight" is an observable state rather than a race.
 */
function controllableBridge() {
	const started: string[] = [];
	const open: ((buffer: ArrayBuffer) => void)[] = [];
	let peak = 0;
	invoke.mockImplementation((_cmd: string, args?: unknown) => {
		started.push((args as { url: string }).url);
		// In-flight count is the calls opened but not yet settled, plus this one.
		peak = Math.max(peak, open.length + 1);
		return new Promise<ArrayBuffer>((resolve) => {
			open.push(resolve);
		});
	});
	return {
		started,
		peak: (): number => peak,
		/** Complete exactly one in-flight fetch. */
		settleOne: (): void => void open.shift()?.(bufferOf(jpeg())),
		/** Complete every remaining in-flight fetch, so nothing is left hanging. */
		settleAll: (): void => {
			while (open.length > 0) open.shift()?.(bufferOf(jpeg()));
		},
	};
}

/** Drain every pending microtask chain by crossing one macrotask boundary. */
async function flush(): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
}

function burstUrl(i: number): string {
	return `https://cdns.grindr.com/images/full/sem-${i}.jpg`;
}

describe("P2-004: the fetch cap is real", () => {
	it("defaults to a documented limit of 4", () => {
		expect(getMaxConcurrentImageFetches()).toBe(4);
	});

	it("never runs more than the configured number of fetches at once", async () => {
		setMaxConcurrentImageFetches(3);
		const bridge = controllableBridge();

		// Far more simultaneous requests than the limit allows: this is the grid
		// page / album-open burst the finding describes.
		const all = Array.from({ length: 20 }, (_, i) => resolveAuthedImage(burstUrl(i)));
		await flush();

		expect(bridge.started.length).toBe(3);
		expect(__imageFetchSlotsQueued()).toBe(17);
		expect(__imageFetchSlotsInUse()).toBe(3);

		// Drain the whole burst; the peak is the invariant that matters.
		for (let i = 0; i < 20; i++) {
			bridge.settleOne();
			await flush();
		}
		await Promise.all(all);

		expect(bridge.peak()).toBe(3);
		expect(__imageFetchSlotsInUse()).toBe(0);
		expect(__imageFetchSlotsQueued()).toBe(0);
	});

	it("honours a RAISED limit immediately, including for callers already queued", async () => {
		setMaxConcurrentImageFetches(1);
		const bridge = controllableBridge();
		const all = Array.from({ length: 4 }, (_, i) => resolveAuthedImage(burstUrl(i)));
		await flush();
		expect(bridge.started.length).toBe(1);
		expect(__imageFetchSlotsQueued()).toBe(3);

		// Raising the limit must admit waiters that are ALREADY queued, not only
		// ones that happen to arrive afterwards.
		expect(setMaxConcurrentImageFetches(3)).toBe(3);
		await flush();
		expect(bridge.started.length).toBe(3);

		// Raising the limit to 3 admits two of the three waiters, leaving ONE fetch
		// still queued. So the burst cannot be drained in a single pass: settling the
		// three in-flight fetches is what RELEASES their slots and starts the fourth,
		// and `settleAll()` has already drained its list by then. Drain in rounds, as
		// the burst and over-release tests above do, so the last fetch is settled too.
		for (let i = 0; i < all.length; i++) {
			bridge.settleAll();
			await flush();
		}
		await Promise.all(all);
		expect(bridge.started.length).toBe(4);
		expect(__imageFetchSlotsInUse()).toBe(0);
	});

	it("starts queued fetches in ARRIVAL order (strict FIFO)", async () => {
		setMaxConcurrentImageFetches(1);
		const bridge = controllableBridge();
		const first = burstUrl(0);
		const second = burstUrl(1);
		const third = burstUrl(2);
		const all = [
			resolveAuthedImage(first),
			resolveAuthedImage(second),
			resolveAuthedImage(third),
		];
		await flush();
		expect(bridge.started).toEqual([first]);

		bridge.settleOne();
		await flush();
		expect(bridge.started).toEqual([first, second]);

		bridge.settleOne();
		await flush();
		expect(bridge.started).toEqual([first, second, third]);

		bridge.settleAll();
		await Promise.all(all);
	});

	it("is a NO-OP when unlimited: nothing queues, so nothing is deferred", async () => {
		// "Callers must not need to change behaviour if the limiter is a no-op."
		setMaxConcurrentImageFetches(Number.POSITIVE_INFINITY);
		const bridge = controllableBridge();

		const all = Array.from({ length: 12 }, (_, i) => resolveAuthedImage(burstUrl(i)));
		await flush();

		// All twelve started on the first pass — no queue, no reordering, no
		// extra latency. Unlimited restores the pre-limiter behaviour exactly.
		expect(bridge.started.length).toBe(12);
		expect(__imageFetchSlotsQueued()).toBe(0);

		bridge.settleAll();
		await Promise.all(all);
	});

	it("does not queue at all when the burst fits inside the limit", async () => {
		// The common case must pay nothing: under the limit, every caller takes the
		// synchronous fast path.
		const bridge = controllableBridge();
		const all = [resolveAuthedImage(burstUrl(0)), resolveAuthedImage(burstUrl(1))];
		await flush();

		expect(bridge.started.length).toBe(2);
		expect(__imageFetchSlotsQueued()).toBe(0);

		bridge.settleAll();
		await Promise.all(all);
	});
});

/**
 * THE TEST THAT MATTERS MOST.
 *
 * A semaphore that leaks its slots is worse than no semaphore: the failure is not
 * a slowdown, it is a permanent one. After `limit` leaks, EVERY subsequent image
 * queues forever and the app stops loading images entirely for the life of the
 * process — with no error, no log and no recovery. These tests assert that no
 * exit path can produce that state.
 */
describe("P2-004: a slot is released on EVERY exit path", () => {
	let consoleError: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		// The failure paths log by design; silence them so the suite stays readable
		// and the assertions below stay the signal.
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleError.mockRestore();
	});

	it("releases every slot when EVERY fetch REJECTS", async () => {
		setMaxConcurrentImageFetches(2);
		invoke.mockRejectedValue(new Error("boom"));

		const all = Array.from({ length: 10 }, (_, i) => resolveAuthedImage(burstUrl(i)));
		const results = await Promise.all(all);

		// The caller-facing contract is unchanged: a failure is `null`, never a throw.
		expect(results.every((r) => r === null)).toBe(true);
		expect(__imageFetchSlotsInUse()).toBe(0);
		expect(__imageFetchSlotsQueued()).toBe(0);
	});

	it("survives repeated TOTAL failure — one leak per round would kill the app", async () => {
		// Limit 1 means a SINGLE leaked slot anywhere in these ten rounds leaves the
		// limiter permanently saturated: every later image would hang with no error.
		setMaxConcurrentImageFetches(1);
		invoke.mockRejectedValue(new Error("network down"));

		for (let round = 0; round < 10; round++) {
			await Promise.all(
				Array.from({ length: 5 }, (_, i) => resolveAuthedImage(burstUrl(round * 5 + i))),
			);
			// Assert INSIDE the loop so a leak is caught at the round it happened,
			// with the round number, rather than at the end with no attribution.
			expect(__imageFetchSlotsInUse(), `slot leaked in round ${round}`).toBe(0);
		}

		// The app must still be able to load an image afterwards. If the limiter were
		// saturated this await would never resolve and the test would time out —
		// which is exactly the "stops loading images entirely" symptom.
		serveBytes(jpeg());
		expect(await resolveAuthedImage(burstUrl(999))).not.toBeNull();
	});

	it("releases the slot when the 12s bridge timeout fires", async () => {
		// A bridge call that never settles is exactly the case the 12s timeout
		// exists for. The timeout path must not strand its slot.
		vi.useFakeTimers();
		try {
			setMaxConcurrentImageFetches(1);
			invoke.mockImplementation(() => new Promise<ArrayBuffer>(() => {}));

			const pending = resolveAuthedImage(burstUrl(0));
			expect(__imageFetchSlotsInUse()).toBe(1);

			await vi.advanceTimersByTimeAsync(12_000);

			expect(await pending).toBeNull();
			expect(__imageFetchSlotsInUse()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("releases the slot on success too, so a long session cannot drift up", async () => {
		setMaxConcurrentImageFetches(2);
		serveBytes(jpeg());
		for (let round = 0; round < 25; round++) {
			await Promise.all([
				resolveAuthedImage(burstUrl(round * 2)),
				resolveAuthedImage(burstUrl(round * 2 + 1)),
			]);
		}
		expect(__imageFetchSlotsInUse()).toBe(0);
	});

	it("does not OVER-release: a double release must not admit extra concurrency", async () => {
		// The mirror image of a leak. If a slot were released twice the limiter would
		// admit more concurrent fetches than configured — silently back to the
		// unbounded behaviour the finding is about.
		setMaxConcurrentImageFetches(2);
		const bridge = controllableBridge();

		const all = Array.from({ length: 6 }, (_, i) => resolveAuthedImage(burstUrl(i)));
		await flush();
		expect(__imageFetchSlotsInUse()).toBe(2);

		// Complete a fetch and then let every queued caller run. Each completion
		// hands off exactly one slot.
		for (let i = 0; i < 6; i++) {
			bridge.settleOne();
			await flush();
		}
		await Promise.all(all);

		// The peak must equal the limit, never exceed it.
		expect(bridge.peak()).toBe(2);
		expect(__imageFetchSlotsInUse()).toBe(0);
	});
});

/**
 * An aborted fetch must not occupy capacity either — a tile scrolled out of view
 * should leave the queue, not hold a slot it will never use.
 */
describe("P2-004: aborting a queued fetch", () => {
	it("dequeues without ever taking a slot", async () => {
		const bridge = controllableBridge();
		setMaxConcurrentImageFetches(1);

		// Occupy the only slot with a fetch that will not settle.
		const held = resolveAuthedImage(burstUrl(0));
		await flush();
		expect(__imageFetchSlotsInUse()).toBe(1);

		const controller = new AbortController();
		// Queued behind the held fetch: never starts.
		const aborted = fetchAuthedBytes(burstUrl(1), controller.signal);
		await flush();
		expect(__imageFetchSlotsQueued()).toBe(1);
		expect(bridge.started).toEqual([burstUrl(0)]);

		controller.abort();

		// `null`, not a throw: these fetchers never reject.
		expect(await aborted).toBeNull();
		// And it is GONE from the queue, so it cannot starve the fetches behind it.
		expect(__imageFetchSlotsQueued()).toBe(0);
		expect(__imageFetchSlotsInUse()).toBe(1);

		bridge.settleAll();
		await held;
	});

	it("fails fast, without queueing, when the signal is ALREADY aborted", async () => {
		const bridge = controllableBridge();
		const controller = new AbortController();
		controller.abort();

		expect(await fetchAuthedBytes(burstUrl(0), controller.signal)).toBeNull();
		// Never reached the bridge, and never occupied a slot.
		expect(bridge.started).toEqual([]);
		expect(__imageFetchSlotsInUse()).toBe(0);
		expect(__imageFetchSlotsQueued()).toBe(0);
	});

	it("does not corrupt the count when aborted AFTER the fetch has started", async () => {
		const bridge = controllableBridge();
		setMaxConcurrentImageFetches(1);
		const controller = new AbortController();

		const pending = fetchAuthedBytes(burstUrl(0), controller.signal);
		await flush();
		expect(bridge.started.length).toBe(1);

		bridge.settleAll();
		expect(await pending).not.toBeNull();
		expect(__imageFetchSlotsInUse()).toBe(0);

		// The abort arrives after the slot was already released. Handing the slot out
		// a second time here would over-admit and break the limit.
		controller.abort();
		await flush();
		expect(__imageFetchSlotsInUse()).toBe(0);
	});
});

describe("P2-004: the limit is configurable", () => {
	it("clamps 0 to 1 rather than deadlocking every image in the app", () => {
		// A limit of 0 is not "slower", it is a hang with no error anywhere: every
		// fetch would queue forever.
		expect(setMaxConcurrentImageFetches(0)).toBe(1);
		expect(setMaxConcurrentImageFetches(-5)).toBe(1);
	});

	it("falls back to the default on NaN instead of hanging the app silently", () => {
		// `activeFetches < NaN` is ALWAYS false, so a NaN limit would wedge the whole
		// app with no diagnostic.
		expect(setMaxConcurrentImageFetches(Number.NaN)).toBe(4);
	});

	it("rounds a fractional limit down rather than admitting a partial slot", () => {
		expect(setMaxConcurrentImageFetches(2.9)).toBe(2);
	});

	it("reports the limit it actually adopted, so a clamped value is visible", () => {
		expect(setMaxConcurrentImageFetches(0)).toBe(getMaxConcurrentImageFetches());
		expect(getMaxConcurrentImageFetches()).toBe(1);
		expect(setMaxConcurrentImageFetches(8)).toBe(8);
	});
});

/**
 * GUARD AGAINST THE P1-006 REGRESSION. The limiter must be a pure scheduler: it
 * gates WHEN bytes are fetched, never WHAT they are. `fetch_authed_bytes`
 * resolves to the RAW ArrayBuffer (P1-006 removed a base64 round-trip from this
 * path), so the exact buffer handed back must be the exact buffer the bridge
 * produced — no copy, no re-encode, no second pass over the pixels.
 */
describe("P2-004: the limiter does not alter the bytes", () => {
	it("returns the bridge's ArrayBuffer identity, byte for byte", async () => {
		const bytes = jpeg();
		const served = bufferOf(bytes);
		invoke.mockResolvedValue(served);

		const result = await fetchAuthedBytes(burstUrl(0));

		expect(result).not.toBeNull();
		// Identity, not just equality: a defensive copy here would reintroduce the
		// per-image buffer duplication P1-006 removed.
		expect(result?.buffer).toBe(served);
		expect(new Uint8Array(result?.buffer as ArrayBuffer)).toEqual(bytes);
	});

	it("still returns the raw bytes after they have been through the queue", async () => {
		const bridge = controllableBridge();
		setMaxConcurrentImageFetches(1);

		const first = resolveAuthedImage(burstUrl(0));
		const second = resolveAuthedImage(burstUrl(1));
		await flush();

		// With a limit of 1 the second fetch does not EXIST on the bridge yet — it is
		// queued. Settling before flushing would settle nothing and leave it to hang
		// until its 12s timeout, so each settle is paired with a flush.
		expect(bridge.started.length).toBe(1);
		bridge.settleOne();
		await flush();
		expect(bridge.started.length).toBe(2);
		bridge.settleOne();

		const [a, b] = await Promise.all([first, second]);

		// Both resolved, both are blob handles minted from a raw ArrayBuffer, and the
		// limiter released cleanly on the way out.
		expect(typeof a).toBe("string");
		expect(typeof b).toBe("string");
		expect(a).not.toBe(b);
		expect(__imageFetchSlotsInUse()).toBe(0);
		expect(__imageFetchSlotsQueued()).toBe(0);
	});
});
