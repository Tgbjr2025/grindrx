import { invoke } from "@tauri-apps/api/core";

/**
 * Resolve a (possibly authenticated) Grindr CDN URL to a `data:` URL that the
 * WebView can render directly.
 *
 * Grindr chat/album media on `cdns.grindr.com` is served behind the account's
 * bearer token. A plain `<img src="https://cdns.grindr.com/...">` carries no
 * Authorization header, so the CDN returns 403 and the WebView paints a black
 * box. The Rust `fetch_authed_bytes` command re-fetches the bytes *with* the
 * auth header and hands back a base64 `data:` URL.
 *
 * Returns the resolved `data:` URL on success, or `null` on failure (after
 * logging the reason so on-device black boxes are diagnosable instead of
 * silent). Callers should fall back to the raw URL when this returns `null`.
 */
export async function resolveAuthedImage(url: string): Promise<string | null> {
	// Grindr serves media two different ways:
	//   - cdns.grindr.com/...              -> bearer-token gated, needs fetch_authed_bytes
	//   - *.cloudfront.net/...?Signature=  -> pre-signed URL, loads directly with NO auth
	// Routing a signed CloudFront URL through fetch_authed_bytes always fails (the Rust
	// SSRF allowlist only permits grindr.com/.mobi, and attaching our bearer token to a
	// third-party host would leak it). So only auth-fetch grindr hosts; return everything
	// else unchanged so the <img>/lightbox loads the signed URL directly.
	let host = "";
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		return url;
	}
	const needsAuthFetch =
		host === "cdns.grindr.com" ||
		host.endsWith(".grindr.com") ||
		host.endsWith(".grindr.mobi");
	if (!needsAuthFetch) return url;
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
	}
}
