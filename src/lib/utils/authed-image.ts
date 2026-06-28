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

// --- Concurrency limiter -----------------------------------------------------
// Opening an album or the shared-media gallery asks for many authed images at
// once. Cap how many resolve at a time so a burst degrades into a progressive
// load instead of saturating the bridge.
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
// Retain a compact `blob:` object URL per source URL. Map insertion order is the
// LRU recency order; evicting the oldest revokes its blob so total retained
// image memory stays bounded across a long session. Also dedups: the cover,
// thumbnail and lightbox of the same image fetch once.
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
	if (
		b.length >= 12 &&
		b[4] === 0x66 &&
		b[5] === 0x74 &&
		b[6] === 0x79 &&
		b[7] === 0x70
	) {
		return "video/mp4";
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
	await acquire();
	try {
		const buffer = await invoke<ArrayBuffer>("fetch_authed_bytes", { url });
		return { buffer, mime: sniffMime(new Uint8Array(buffer)) };
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

	const task = (async () => {
		try {
			const result = await fetchAuthedBytes(url);
			if (!result) return null;
			const objectUrl = URL.createObjectURL(
				new Blob([result.buffer], { type: result.mime }),
			);
			remember(url, objectUrl);
			return objectUrl;
		} finally {
			inflight.delete(url);
		}
	})();
	inflight.set(url, task);
	return task;
}
