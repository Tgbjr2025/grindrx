import { invoke } from "@tauri-apps/api/core";

/**
 * Resolve a (possibly authenticated) Grindr CDN URL to something the WebView can
 * render directly.
 *
 * Grindr chat/album media on `cdns.grindr.com` is served behind the account's
 * bearer token. A plain `<img src="https://cdns.grindr.com/...">` carries no
 * Authorization header, so the CDN returns 403 and the WebView paints a black
 * box. The Rust `fetch_authed_bytes` command re-fetches the bytes *with* the
 * auth header and hands back a base64 `data:` URL.
 *
 * Signed CloudFront URLs (`*.cloudfront.net/...?Signature=`) load directly with
 * no auth, and routing them through `fetch_authed_bytes` would both fail (the
 * Rust SSRF allowlist only permits grindr.com/.mobi) and leak our bearer token
 * to a third party — so those are returned unchanged.
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

// --- Concurrency limiter -----------------------------------------------------
// Opening an album or the shared-media gallery asks for many authed images at
// once. Each request streams up to 10 MB through the Rust bridge and decodes it,
// so firing them all concurrently spikes native memory + main-thread work and
// froze the WebView. Cap how many resolve at a time so a burst degrades into a
// progressive load instead of a freeze.
const MAX_CONCURRENT = 4;
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
	if (active < MAX_CONCURRENT) {
		active++;
		return Promise.resolve();
	}
	return new Promise((resolve) => waiters.push(resolve));
}

function release(): void {
	active--;
	const next = waiters.shift();
	if (next) {
		active++;
		next();
	}
}

// --- Object-URL cache --------------------------------------------------------
// Retain a compact `blob:` object URL per source URL instead of a multi-MB
// base64 `data:` string duplicated in every `<img src>` (a base64 payload is
// ~1.33x the binary size AND is held alongside the decoded bitmap — that
// retention is what drove the image-memory freeze). Map insertion order is the
// LRU recency order; evicting the oldest revokes its blob so total retained
// image memory stays bounded across a long session. Also dedups: the same URL
// requested by the cover, the thumbnail and the lightbox is fetched once.
const MAX_ENTRIES = 96;
const objectUrlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function remember(srcUrl: string, objectUrl: string): void {
	objectUrlCache.delete(srcUrl);
	objectUrlCache.set(srcUrl, objectUrl);
	while (objectUrlCache.size > MAX_ENTRIES) {
		const oldest = objectUrlCache.keys().next().value;
		if (oldest === undefined) break;
		const evicted = objectUrlCache.get(oldest);
		objectUrlCache.delete(oldest);
		if (evicted) {
			try {
				URL.revokeObjectURL(evicted);
			} catch {
				// already revoked / not an object URL — nothing to do
			}
		}
	}
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
	// Decode the base64 payload OFF the main thread via the resource loader.
	// The previous hand-rolled `atob` + per-byte loop ran synchronously on the UI
	// thread for every slide on album open — tens of millions of charCodeAt calls
	// that froze the WebView. `fetch()` on a data: URL does the decode in the
	// loader, not in JS. (Requires `data:` in the CSP connect-src.)
	return await (await fetch(dataUrl)).blob();
}

/**
 * Low-level: fetch authed bytes for a grindr-hosted URL and return the raw
 * `data:<mime>;base64,<payload>` string from Rust. Used by the upload re-encode
 * path, which needs the base64 payload rather than a blob handle. Non-grindr
 * hosts are returned unchanged; returns `null` on failure (after logging).
 */
export async function fetchAuthedDataUrl(url: string): Promise<string | null> {
	const kind = classifyHost(url);
	if (kind !== "auth") return url;
	await acquire();
	try {
		return await invoke<string>("fetch_authed_bytes", { url });
	} catch (error) {
		console.error(
			"[GrindrX] fetch_authed_bytes failed for",
			url.slice(0, 120),
			"-",
			error,
		);
		return null;
	} finally {
		release();
	}
}

/**
 * Resolve an image URL for display. Non-grindr hosts are returned unchanged;
 * grindr-hosted media is fetched with the bearer token and returned as a
 * bounded, deduped `blob:` object URL. Returns `null` on failure so callers can
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

	const task = (async () => {
		try {
			const dataUrl = await fetchAuthedDataUrl(url);
			if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
			try {
				const objectUrl = URL.createObjectURL(await dataUrlToBlob(dataUrl));
				remember(url, objectUrl);
				return objectUrl;
			} catch (error) {
				// Conversion failed — fall back to the data URL, which still renders.
				console.error(
					"[GrindrX] could not build object URL for",
					url.slice(0, 120),
					"-",
					error,
				);
				return dataUrl;
			}
		} finally {
			inflight.delete(url);
		}
	})();
	inflight.set(url, task);
	return task;
}
