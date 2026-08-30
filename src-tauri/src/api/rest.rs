use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use reqwest::redirect::Policy;
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::error::AppError;
use crate::state::AppState;

use super::client::GrindrClient;
use super::client::BASE_URL;
use super::headers::grindr_roles_header_value;

/// Returns true iff the host's eTLD+1 is `grindr.com` or `grindr.mobi`.
///
/// This correctly handles `attacker.com.grindr.mobi` (rejected — the
/// second-to-last label is `mobi`, not `grindr`) and trailing-dot tricks
/// (rejected — the empty label guard fires first).
fn is_allowed_grindr_host(host: &str) -> bool {
    let labels: Vec<&str> = host.split('.').collect();
    // Reject empty labels (trailing dot, double-dot, etc.)
    if labels.iter().any(|l| l.is_empty()) {
        return false;
    }
    let n = labels.len();
    if n < 2 {
        return false;
    }
    // eTLD+1 must be grindr.com or grindr.mobi — any subdomain depth is fine.
    labels[n - 2] == "grindr" && matches!(labels[n - 1], "com" | "mobi")
}

/// Returns true iff the host's eTLD+1 is `cloudfront.net`. Signed album media
/// is served from CloudFront (see docs/content/grindr-api/media/signed-cdn-files.md).
fn is_cloudfront_host(host: &str) -> bool {
    let labels: Vec<&str> = host.split('.').collect();
    if labels.iter().any(|l| l.is_empty()) {
        return false;
    }
    let n = labels.len();
    if n < 2 {
        return false;
    }
    labels[n - 2] == "cloudfront" && labels[n - 1] == "net"
}

/// Signed-CDN host allowlist for `fetch_media_bytes`: Grindr's own eTLD+1
/// (covers `cdns.grindr.com`) plus CloudFront, the documented host for signed
/// direct/album media that requires no bearer token.
fn is_allowed_media_host(host: &str) -> bool {
    is_allowed_grindr_host(host) || is_cloudfront_host(host)
}

/// Validate a relative API path passed in from the WebView before concatenating
/// it onto `BASE_URL`. A compromised WebView could otherwise smuggle a full URL
/// or path-traversal sequence and pivot the credentialed client at any endpoint.
fn is_safe_api_path(path: &str) -> bool {
    if !path.starts_with('/') {
        return false;
    }
    if path.contains("..") || path.contains('\\') || path.contains("://") {
        return false;
    }
    // First segment must look like an API version: vN or vN.M
    let first = path.trim_start_matches('/').split('/').next().unwrap_or("");
    if !first.starts_with('v') || first.len() < 2 {
        return false;
    }
    first[1..].chars().all(|c| c.is_ascii_digit() || c == '.')
}

#[derive(Serialize, Deserialize)]
pub struct RawResponse {
    pub status: u16,
    #[serde(with = "serde_bytes")]
    pub body: Vec<u8>,
}

/// Reject the base64-encoded IPC envelope above this size before any decode
/// work, and cap the decoded msgpack body the same way. Without a bound, a
/// compromised WebView could submit an arbitrarily large — or arbitrarily
/// deeply nested — payload through the generic `request`/`request_public`
/// bridge and drive unbounded allocation/recursion decoding it into
/// `serde_json::Value` (`rmp_serde` enforces no recursion limit of its own).
/// `upload_image` already caps real photo uploads at 30 MB; this bridge only
/// ever carries small JSON-ish command bodies, so 8 MB is generous headroom
/// while still bounding the attack.
const MAX_REQUEST_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;

impl GrindrClient {
    pub(super) async fn request_json<TReq, TResp>(
        &self,
        method: Method,
        path: &str,
        body: Option<&TReq>,
    ) -> Result<TResp, AppError>
    where
        TReq: Serialize + ?Sized,
        TResp: DeserializeOwned,
    {
        let http = self.http.read().await.clone();
        let mut request = http.request(method, format!("{BASE_URL}{path}"));

        if let Some(body) = body {
            request = request.json(body);
        }

        let response = request.send().await?;

        if !response.status().is_success() {
            let json: serde_json::Value = response.json().await.unwrap_or_default();
            return Err(AppError::Api {
                code: json.get("code").and_then(|c| c.as_i64()).unwrap_or(0) as i32,
                message: json
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error")
                    .to_owned(),
            });
        }

        response.json::<TResp>().await.map_err(Into::into)
    }

    async fn request_raw(
        &self,
        method: Method,
        path: &str,
        body: Option<Vec<u8>>,
    ) -> Result<RawResponse, AppError> {
        let authorization = self
            .authorization_header()
            .await
            .ok_or_else(|| AppError::Auth("Not logged in".to_owned()))?;

        let http = self.http.read().await.clone();
        let mut request = http
            .request(method, format!("{BASE_URL}{path}"))
            .header("Authorization", authorization)
            .header("L-Grindr-Roles", grindr_roles_header_value());

        if let Some(body) = body {
            if body.len() > MAX_REQUEST_PAYLOAD_BYTES {
                return Err(AppError::Http("Request body too large".to_owned()));
            }
            let json_body: serde_json::Value = rmp_serde::from_slice(&body)
                .map_err(|e| AppError::Http(format!("Failed to decode msgpack body: {e}")))?;
            request = request
                .header("Content-Type", "application/json")
                .json(&json_body);
        }

        let request = request.build().map_err(|e| AppError::Http(e.to_string()))?;

        #[cfg(debug_assertions)]
        {
            println!("=== OUTGOING REQUEST ===");
            println!("Method: {}", request.method());
            // Redact query string — any token passed via ?param= would otherwise
            // hit logcat in plaintext. Only the scheme/host/path are useful for debugging.
            let url = request.url();
            if url.query().is_some() {
                println!("URL:    {}://{}{} ?<redacted>", url.scheme(), url.host_str().unwrap_or(""), url.path());
            } else {
                println!("URL:    {}", url);
            }
            println!("Headers:");
            // FIX 7: only iterate request.headers() — default headers are already
            // merged into the built request by reqwest, so chaining default_headers
            // would print every default header twice.
            for (name, value) in request.headers() {
                // FIX 5: redact Authorization to prevent session token leaking to logcat
                if name.as_str().to_lowercase() == "authorization" {
                    println!("  {}: [REDACTED]", name);
                } else {
                    println!("  {}: {}", name, value.to_str().unwrap_or("<binary>"));
                }
            }
            if let Some(b) = request.body() {
                match b.as_bytes() {
                    Some(bytes) => println!("Body: {}", String::from_utf8_lossy(bytes)),
                    None => println!("Body: <streaming>"),
                }
            } else {
                println!("Body: <none>");
            }
            println!("========================");
        }

        let response = http.execute(request).await?;
        let status = response.status().as_u16();
        let body = response.bytes().await?.to_vec();

        Ok(RawResponse { status, body })
    }

    /// Like `request_raw`, but WITHOUT an Authorization header. For pre-session
    /// endpoints — account creation, forgot-password — that a logged-out user
    /// must reach. Routing those through `request_raw` fails at the auth guard
    /// with "Not logged in" before any network call, which the frontend then
    /// mis-handled as an auth redirect. This path lets the request hit the
    /// server and return its real status/body.
    async fn request_raw_unauthed(
        &self,
        method: Method,
        path: &str,
        body: Option<Vec<u8>>,
    ) -> Result<RawResponse, AppError> {
        let http = self.http.read().await.clone();
        let mut request = http.request(method, format!("{BASE_URL}{path}"));

        if let Some(body) = body {
            if body.len() > MAX_REQUEST_PAYLOAD_BYTES {
                return Err(AppError::Http("Request body too large".to_owned()));
            }
            let json_body: serde_json::Value = rmp_serde::from_slice(&body)
                .map_err(|e| AppError::Http(format!("Failed to decode msgpack body: {e}")))?;
            request = request
                .header("Content-Type", "application/json")
                .json(&json_body);
        }

        let request = request.build().map_err(|e| AppError::Http(e.to_string()))?;
        let response = http.execute(request).await?;
        let status = response.status().as_u16();
        let body = response.bytes().await?.to_vec();

        Ok(RawResponse { status, body })
    }
}

#[derive(Serialize)]
pub struct UploadImageResult {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub async fn upload_image(
    state: tauri::State<'_, AppState>,
    image_base64: String,
    mime_type: String,
) -> Result<UploadImageResult, AppError> {
    // Cap the inbound base64 payload at ~22 MB binary (30 MB base64) — without this,
    // a hostile WebView payload could OOM the Tauri process via STANDARD.decode.
    const MAX_IMAGE_BASE64: usize = 30 * 1024 * 1024;
    if image_base64.len() > MAX_IMAGE_BASE64 {
        return Err(AppError::Http("Image payload too large".to_owned()));
    }
    let bytes = STANDARD
        .decode(&image_base64)
        .map_err(|e| AppError::Http(format!("Failed to decode image base64: {e}")))?;

    let authorization = state
        .client()?
        .authorization_header()
        .await
        .ok_or_else(|| AppError::Auth("Not logged in".to_owned()))?;

    let http = state.client()?.http.read().await.clone();

    // Upload to the CHAT-MEDIA endpoint, not the legacy profile-images endpoint.
    //
    // `POST /v5/chat/media/upload` is the only endpoint that mints a real numeric
    // `mediaId` (`{ mediaId, mediaHash, url }`). The legacy
    // `/v3.1/me/profile/images` (and `/v4/me/profile`) return only a `mediaHash`,
    // and `POST /v4/chat/message/send` (type "Image") REQUIRES the numeric
    // `mediaId` -- sending a hash-only photo yields HTTP 400
    // (urn:gr:err:internal_error). See docs: grindr-api/users/profiles#upload-media.
    //
    // The body is the raw file bytes (NOT multipart); the doc requires a correct
    // `Content-Type` header describing the image.
    let response = http
        .post(format!("{BASE_URL}/v5/chat/media/upload?takenOnGrindr=false"))
        .header("Authorization", authorization)
        .header("L-Grindr-Roles", grindr_roles_header_value())
        .header("Content-Type", &mime_type)
        .body(bytes)
        .send()
        .await?;

    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();

    Ok(UploadImageResult { status, body })
}

// FIX 3: stream the body with a running counter so chunked responses with no
// Content-Length are also capped. `response.bytes()` would buffer everything
// before we could check the size. Shared by `fetch_authed_bytes` and
// `fetch_media_bytes`.
const MAX_FETCH_BYTES: usize = 10 * 1024 * 1024;

async fn stream_capped_body(
    response: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, AppError> {
    let mut body: Vec<u8> = Vec::with_capacity(8192);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Http(e.to_string()))?;
        if body.len() + chunk.len() > max_bytes {
            return Err(AppError::Http("Response too large".to_owned()));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Build a dedicated one-shot client that refuses redirects, for the
/// `fetch_authed_bytes`/`fetch_media_bytes` byte-fetch paths. Unlike the
/// shared client (see `client.rs::build_http_client`), this one carries no
/// default headers — the caller attaches whatever's appropriate per-request.
fn build_direct_fetch_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Http(format!("Failed to build fetch client: {e}")))
}

#[tauri::command]
pub async fn fetch_authed_bytes(
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<tauri::ipc::Response, AppError> {
    let authorization = state
        .client()?
        .authorization_header()
        .await
        .ok_or_else(|| AppError::Auth("Not logged in".to_owned()))?;

    // FIX 2: validate domain using eTLD+1 check, not ends_with.
    // `ends_with(".grindr.mobi")` would accept `attacker.com.grindr.mobi` if
    // that subdomain were ever registered; the helper below rejects it.
    {
        let parsed = reqwest::Url::parse(&url)
            .map_err(|_| AppError::Http("Invalid URL".to_owned()))?;
        // FIX 13: enforce https BEFORE attaching the Authorization header.
        // Without this, a caller-supplied `http://...grindr.com/...` URL would
        // send the user's Grindr session token in cleartext. (The host check
        // alone does not constrain the scheme.)
        if parsed.scheme() != "https" {
            return Err(AppError::Http(
                "Only https URLs are allowed for authed fetches".to_owned(),
            ));
        }
        let host = parsed.host_str().unwrap_or("");
        if !is_allowed_grindr_host(host) {
            return Err(AppError::Http(format!(
                "URL host '{}' is not an allowed Grindr domain",
                host
            )));
        }
    }

    // FIX 13 / redirect-refusal-incomplete: build a dedicated client that
    // refuses redirects. The host/scheme allowlist above only validates the
    // initial URL; a 30x redirect to an off-allowlist host (or to http://)
    // would otherwise re-send the Authorization header to an unvetted
    // destination — reqwest does NOT strip Authorization across cross-origin
    // redirects, so we must not follow any. If the dedicated builder fails,
    // refuse the fetch rather than silently falling back to the shared
    // (redirect-following) client — that fallback was the gap that let a
    // bearer-token-over-redirect leak through in the first place.
    let http = build_direct_fetch_client()?;

    let response = http
        .get(&url)
        .header("Authorization", authorization)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(AppError::Http(format!(
            "Image fetch failed with status {}",
            response.status()
        )));
    }

    let body = stream_capped_body(response, MAX_FETCH_BYTES).await?;

    // Return the RAW bytes over the IPC bridge as an ArrayBuffer, not a base64
    // `data:` URL. Base64 inflates the payload ~33% and — far worse on Android —
    // forced the WebView main thread to receive and re-parse a multi-MB string
    // per image, which froze the UI when an album opened several at once. The
    // frontend wraps these bytes in a Blob (content-type sniffed from the magic
    // bytes) and a `blob:` object URL.
    Ok(tauri::ipc::Response::new(body))
}

/// Fetch bytes for a signed-CDN media URL — CloudFront album media,
/// `cdns.grindr.com` public thumbnails — with NO Authorization header.
///
/// These URLs carry their own signature/expiry in the query string and are
/// not gated by the Grindr session bearer token; attaching one would be
/// pointless and (worse) an unnecessary place for the token to leak. This is
/// the path `prepareAuthedUrlForSend` uses for private-album photos:
/// `fetchAuthedBytes` only fetches grindr-hosted URLs and returns null for
/// CloudFront, which previously made "tap to send" on a private album photo
/// throw "Could not fetch the private photo to re-send it."
///
/// Same https-only + no-redirect + streamed-size-cap hardening as
/// `fetch_authed_bytes`, restricted to an explicit signed-CDN host allowlist
/// (`*.cloudfront.net`, plus anything already allowed for authed fetch) as
/// defense-in-depth against a compromised WebView using this command for SSRF.
#[tauri::command]
pub async fn fetch_media_bytes(url: String) -> Result<tauri::ipc::Response, AppError> {
    let parsed =
        reqwest::Url::parse(&url).map_err(|_| AppError::Http("Invalid URL".to_owned()))?;
    if parsed.scheme() != "https" {
        return Err(AppError::Http(
            "Only https URLs are allowed for media fetches".to_owned(),
        ));
    }
    let host = parsed.host_str().unwrap_or("");
    if !is_allowed_media_host(host) {
        return Err(AppError::Http(format!(
            "URL host '{}' is not an allowed media domain",
            host
        )));
    }

    let http = build_direct_fetch_client()?;

    let response = http.get(&url).send().await?;

    if !response.status().is_success() {
        return Err(AppError::Http(format!(
            "Media fetch failed with status {}",
            response.status()
        )));
    }

    let body = stream_capped_body(response, MAX_FETCH_BYTES).await?;

    Ok(tauri::ipc::Response::new(body))
}

/// Fetch the latest release JSON for the in-app update banner.
///
/// This is done natively rather than with a WebView `fetch()` because the
/// release API does not send `Access-Control-Allow-Origin`, so a browser fetch
/// from the `tauri.localhost` origin is blocked by CORS and the update check
/// silently fails. The URL is fixed (not caller-supplied), so there is no SSRF
/// surface, and no Authorization header is attached.
///
/// Points at THIS fork's public repo (`Tgbjr2025/grindrx`), not upstream
/// open-grind — the banner must surface GrindrX releases, and the returned JSON
/// carries `tag_name`, `html_url`, and `body` (the changelog shown as "what's
/// new"). GitHub's API requires a `User-Agent` header or it answers 403.
#[tauri::command]
pub async fn fetch_latest_release() -> Result<String, AppError> {
    const RELEASES_URL: &str =
        "https://api.github.com/repos/Tgbjr2025/grindrx/releases/latest";
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Http(e.to_string()))?;
    let response = http
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "GrindrX-UpdateCheck")
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(AppError::Http(format!(
            "release check failed with status {}",
            response.status()
        )));
    }
    Ok(response.text().await.unwrap_or_default())
}

/// Aggregate download stats source: fetches the GitHub + Forgejo release lists
/// (each a JSON array whose releases carry `assets[].download_count`) and returns
/// them wrapped as `{"github": <array-or-null>, "forgejo": <array-or-null>}`. The
/// summing is done in the frontend (`$lib/utils/stats`). Done natively because the
/// WebView CSP blocks these hosts; URLs are fixed (no SSRF); no auth header (public
/// repos). A failed or non-2xx fetch contributes `null` rather than failing the whole
/// call, so one source being down still yields the other.
#[tauri::command]
pub async fn fetch_download_stats() -> Result<String, AppError> {
    const GITHUB_URL: &str =
        "https://api.github.com/repos/Tgbjr2025/grindrx/releases?per_page=100";
    const FORGEJO_URL: &str =
        "https://git.dominusaxis.com/api/v1/repos/dominus/grindrx/releases?limit=50";
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Http(e.to_string()))?;

    async fn get_json(http: &reqwest::Client, url: &str, accept: &str) -> String {
        match http
            .get(url)
            .header("Accept", accept)
            .header("User-Agent", "GrindrX-Stats")
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                resp.text().await.unwrap_or_else(|_| "null".to_owned())
            }
            _ => "null".to_owned(),
        }
    }

    let github = get_json(&http, GITHUB_URL, "application/vnd.github+json").await;
    let forgejo = get_json(&http, FORGEJO_URL, "application/json").await;
    Ok(format!("{{\"github\":{github},\"forgejo\":{forgejo}}}"))
}

/// Fetch active-user stats from the telemetry aggregator (7-day window, broken out
/// by version). Returns the raw stats JSON (`active_1h/24h/7d`, `versions_24h`,
/// `total_known`). URL is fixed; no auth.
#[tauri::command]
pub async fn fetch_active_users() -> Result<String, AppError> {
    const STATS_URL: &str = "https://cam.dominusaxis.com/grindrx/stats";
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| AppError::Http(e.to_string()))?;
    let response = http
        .get(STATS_URL)
        .header("Accept", "application/json")
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(AppError::Http(format!(
            "active-users fetch failed with status {}",
            response.status()
        )));
    }
    Ok(response.text().await.unwrap_or_default())
}

/// Fire-and-forget anonymous usage ping so active-user counts can be aggregated.
/// Body is `{"id","v"}` — an anonymous per-install id + the app version, no PII.
/// URL is fixed. Inputs are sanitised to a safe charset before building the JSON
/// so this can't inject into the body. Caller swallows failures.
#[tauri::command]
pub async fn send_usage_ping(id: String, version: String) -> Result<(), AppError> {
    const PING_BASE: &str = "https://cam.dominusaxis.com/grindrx/ping";
    // The aggregator reads `id` and `v` from the QUERY STRING (not the body).
    // Sanitise to a URL-safe charset so no encoding is needed and nothing can be
    // injected into the query.
    fn sanitize(s: &str) -> String {
        s.chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
            .take(64)
            .collect()
    }
    let url = format!("{PING_BASE}?id={}&v={}", sanitize(&id), sanitize(&version));
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .connect_timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| AppError::Http(e.to_string()))?;
    http.post(url).send().await?;
    Ok(())
}

#[derive(Deserialize)]
struct RequestPayload {
    method: String,
    path: String,
    #[serde(with = "serde_bytes")]
    #[serde(default)]
    body: Option<Vec<u8>>,
}

#[tauri::command]
pub async fn request(
    state: tauri::State<'_, AppState>,
    payload: String,
) -> Result<String, AppError> {
    if payload.len() > MAX_REQUEST_PAYLOAD_BYTES {
        return Err(AppError::Http("Request payload too large".to_owned()));
    }
    let bytes = STANDARD
        .decode(&payload)
        .map_err(|e| AppError::Http(format!("Failed to decode base64 payload: {e}")))?;

    let payload: RequestPayload = rmp_serde::from_slice(&bytes)
        .map_err(|e| AppError::Http(format!("Failed to decode request payload: {e}")))?;

    let method = Method::from_str(&payload.method).map_err(|_| AppError::Api {
        code: 400,
        message: format!("Invalid method: {}", payload.method),
    })?;

    // Guard against an XSS-compromised WebView pivoting the credentialed client
    // at arbitrary endpoints or other hosts via `path`.
    if !is_safe_api_path(&payload.path) {
        return Err(AppError::Http(format!(
            "Invalid request path: {}",
            payload.path
        )));
    }

    let raw = state
        .client()?
        .request_raw(method, &payload.path, payload.body)
        .await?;

    let response_bytes =
        rmp_serde::encode::to_vec_named(&raw).map_err(|e| AppError::Http(e.to_string()))?;

    Ok(STANDARD.encode(&response_bytes))
}

/// Unauthenticated sibling of `request` for pre-session endpoints (account
/// creation, forgot-password). Same path-safety guard and msgpack envelope, but
/// no Authorization header — a logged-out caller must be able to reach these.
#[tauri::command]
pub async fn request_public(
    state: tauri::State<'_, AppState>,
    payload: String,
) -> Result<String, AppError> {
    if payload.len() > MAX_REQUEST_PAYLOAD_BYTES {
        return Err(AppError::Http("Request payload too large".to_owned()));
    }
    let bytes = STANDARD
        .decode(&payload)
        .map_err(|e| AppError::Http(format!("Failed to decode base64 payload: {e}")))?;

    let payload: RequestPayload = rmp_serde::from_slice(&bytes)
        .map_err(|e| AppError::Http(format!("Failed to decode request payload: {e}")))?;

    let method = Method::from_str(&payload.method).map_err(|_| AppError::Api {
        code: 400,
        message: format!("Invalid method: {}", payload.method),
    })?;

    if !is_safe_api_path(&payload.path) {
        return Err(AppError::Http(format!(
            "Invalid request path: {}",
            payload.path
        )));
    }

    let raw = state
        .client()?
        .request_raw_unauthed(method, &payload.path, payload.body)
        .await?;

    let response_bytes =
        rmp_serde::encode::to_vec_named(&raw).map_err(|e| AppError::Http(e.to_string()))?;

    Ok(STANDARD.encode(&response_bytes))
}
