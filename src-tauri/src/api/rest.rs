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

/// B6: validate a WebView-supplied `mime_type` before it is interpolated into a
/// hand-built multipart body. Accepts exactly `^image/[a-z0-9][a-z0-9.+-]{0,63}$`
/// — an `image/` prefix and a single lowercase MIME token, no parameters, no
/// whitespace, and therefore no CR/LF. Returns an owned `String` so the caller
/// interpolates a value that provably cannot terminate the header line.
///
/// Rejects rather than silently substituting a default: a wrong Content-Type
/// here is a caller bug worth surfacing, and the previous silent fallback to
/// `image/jpeg` hid exactly the CRLF payloads this exists to stop.
fn sanitize_image_mime(mime_type: &str) -> Result<String, AppError> {
    let Some(subtype) = mime_type.strip_prefix("image/") else {
        return Err(AppError::Http(format!(
            "Unsupported image content type: {mime_type:?}"
        )));
    };
    if subtype.is_empty() || subtype.len() > 64 {
        return Err(AppError::Http(format!(
            "Unsupported image content type: {mime_type:?}"
        )));
    }
    let mut chars = subtype.chars();
    // First character: alphanumeric only, so a subtype can never start with `.`
    // or `-` (which would be a malformed token, not an injection).
    if !chars.next().is_some_and(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::Http(format!(
            "Unsupported image content type: {mime_type:?}"
        )));
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-')) {
        return Err(AppError::Http(format!(
            "Unsupported image content type: {mime_type:?}"
        )));
    }
    Ok(mime_type.to_owned())
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
            // B3: was `response.json().await` with NO cap.
            let bytes = stream_capped_body(response, MAX_AUTH_RESPONSE_BYTES)
                .await
                .unwrap_or_default();
            let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
            // Keep the field i64 end-to-end. It used to be truncated with
            // `as i32`, which WRAPS: a server code of 4294967697 became 401,
            // and `authorization_header` treats 401/403 as "session invalid" and
            // DELETES the keyring session — a spurious forced logout from a
            // truncated integer.
            return Err(AppError::Api {
                code: json.get("code").and_then(|c| c.as_i64()).unwrap_or(0),
                message: json
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error")
                    .to_owned(),
            });
        }

        // B3: was `response.json::<TResp>().await` with NO cap. `from_slice`
        // needs an explicit error mapping: there is no `From<serde_json::Error>
        // for AppError`, so `Into::into` (which worked for `reqwest::Error`)
        // would not compile here.
        let bytes = stream_capped_body(response, MAX_AUTH_RESPONSE_BYTES).await?;
        serde_json::from_slice::<TResp>(&bytes)
            .map_err(|e| AppError::Http(format!("Failed to decode response body: {e}")))
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
            // Bound NESTING DEPTH, not just byte length: a 1-element array is one
            // byte, so an 8 MB body can be ~8M levels deep and overflow the
            // decoder's stack - which aborts the process rather than returning an
            // Err, so it cannot be handled at the call site. See `msgpack_depth`.
            crate::api::msgpack_depth::check_depth(&body, crate::api::msgpack_depth::MAX_DEPTH)
            	.map_err(AppError::Http)?;
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
                    // Bodies carry chat text, profile edits, taps and — via
                    // /v1/accounts and the password endpoints — the account
                    // password. `bun dev:android` on a real device wrote all of
                    // it to logcat while the Authorization header above was
                    // correctly redacted. Print the shape, not the content.
                    Some(bytes) => println!("Body: <{} bytes redacted>", bytes.len()),
                    None => println!("Body: <streaming>"),
                }
            } else {
                println!("Body: <none>");
            }
            println!("========================");
        }

        let response = http.execute(request).await?;
        let status = response.status().as_u16();
        // Cap the RESPONSE too. `MAX_FETCH_BYTES` was only applied to the
        // media paths, so this generic bridge — used for every API call — did
        // `response.bytes().await?` uncapped and then msgpack+base64 encoded the
        // result, peaking at 3-4x the response size. One unexpectedly large (or
        // deliberately inflated) response could OOM the process on a low-RAM
        // device. The cap is generous: real API responses are far smaller, and
        // media goes through the dedicated media commands.
        let body = stream_capped_body(response, MAX_API_RESPONSE_BYTES).await?;

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
            // Bound NESTING DEPTH, not just byte length: a 1-element array is one
            // byte, so an 8 MB body can be ~8M levels deep and overflow the
            // decoder's stack - which aborts the process rather than returning an
            // Err, so it cannot be handled at the call site. See `msgpack_depth`.
            crate::api::msgpack_depth::check_depth(&body, crate::api::msgpack_depth::MAX_DEPTH)
            	.map_err(AppError::Http)?;
            let json_body: serde_json::Value = rmp_serde::from_slice(&body)
            	.map_err(|e| AppError::Http(format!("Failed to decode msgpack body: {e}")))?;
            request = request
                .header("Content-Type", "application/json")
                .json(&json_body);
        }

        let request = request.build().map_err(|e| AppError::Http(e.to_string()))?;
        let response = http.execute(request).await?;
        let status = response.status().as_u16();
        // Cap the RESPONSE too. `MAX_FETCH_BYTES` was only applied to the
        // media paths, so this generic bridge — used for every API call — did
        // `response.bytes().await?` uncapped and then msgpack+base64 encoded the
        // result, peaking at 3-4x the response size. One unexpectedly large (or
        // deliberately inflated) response could OOM the process on a low-RAM
        // device. The cap is generous: real API responses are far smaller, and
        // media goes through the dedicated media commands.
        let body = stream_capped_body(response, MAX_API_RESPONSE_BYTES).await?;

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
        // B6: no `safe_mime` validation needed here (unlike
        // `upload_album_content`, which hand-builds a multipart body) —
        // reqwest turns this into a `HeaderValue`, and `HeaderValue` rejects
        // CR/LF, so a hostile `mime_type` cannot inject a header. Note this
        // command also carries `audio/*` uploads, so the `image/` requirement
        // must not be copied here.
        .header("Content-Type", &mime_type)
        .body(bytes)
        .send()
        .await?;

    let status = response.status().as_u16();
    // B3: was `response.text().await` with NO cap on any upload path.
    let body =
        String::from_utf8_lossy(&stream_capped_body(response, MAX_UPLOAD_RESPONSE_BYTES).await?)
            .into_owned();

    Ok(UploadImageResult { status, body })
}

/// Add raw image bytes to an album: `POST /v1/albums/{albumId}/content`.
///
/// This exists because the generic `request` bridge CANNOT do this job. Every
/// body that crosses `request` is msgpack-decoded and re-sent as
/// `application/json`, so a `multipart/form-data` endpoint is unreachable from
/// the WebView. `addAlbumContent` in the frontend therefore had to upload the
/// bytes to the CHAT media store and then POST a JSON `{mediaId, mediaHash}`
/// reference to a multipart-only endpoint — which fails, and orphans an
/// undeletable copy of the photo in the chat media store on every attempt.
///
/// The documented shape is multipart with the raw file under the field `content`
/// (response `{ contentId, contentUrl }`). `boundary` must be unique enough not
/// to appear in the payload; the bytes are image data, so a fixed
/// application/octet-stream boundary is safe in practice, and the filename is
/// fixed rather than derived from user input so it cannot inject a header.
#[tauri::command]
pub async fn upload_album_content(
    state: tauri::State<'_, AppState>,
    album_id: u64,
    image_base64: String,
    mime_type: String,
) -> Result<UploadImageResult, AppError> {
    const MAX_IMAGE_BASE64: usize = 30 * 1024 * 1024;
    if image_base64.len() > MAX_IMAGE_BASE64 {
        return Err(AppError::Http("Image payload too large".to_owned()));
    }
    let bytes = STANDARD
        .decode(&image_base64)
        .map_err(|e| AppError::Http(format!("Failed to decode image base64: {e}")))?;

    // B6: this string comes from the WebView and is interpolated into a
    // hand-built multipart body below. The old `starts_with("image/")` check let
    // `image/jpeg\r\n\r\n--boundary\r\nContent-Disposition: ...` through, which
    // injects an extra part into an AUTHENTICATED
    // `POST /v1/albums/{id}/content` (e.g. to forge a second part or a field).
    // Require exactly `image/` followed by a short lowercase MIME token.
    // No new dependency: a hand-rolled char-class check, matching the style of
    // `is_safe_api_path` above.
    let safe_mime = sanitize_image_mime(&mime_type)?;

    let authorization = state
        .client()?
        .authorization_header()
        .await
        .ok_or_else(|| AppError::Auth("Not logged in".to_owned()))?;

    let http = state.client()?.http.read().await.clone();

    let boundary = "----GrindrXAlbumBoundary7f3a1c9e";
    let mut body: Vec<u8> = Vec::with_capacity(bytes.len() + 256);
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"content\"; filename=\"photo\"\r\n",
    );
    body.extend_from_slice(format!("Content-Type: {safe_mime}\r\n\r\n").as_bytes());
    body.extend_from_slice(&bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let url = format!("{BASE_URL}/v1/albums/{album_id}/content");
    let response = http
        .post(url)
        .header("Authorization", authorization)
        .header("L-Grindr-Roles", grindr_roles_header_value())
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await?;

    let status = response.status().as_u16();
    // B3: was `response.text().await` with NO cap on any upload path.
    let body =
        String::from_utf8_lossy(&stream_capped_body(response, MAX_UPLOAD_RESPONSE_BYTES).await?)
            .into_owned();

    Ok(UploadImageResult { status, body })
}

/// Upload bytes to the LEGACY profile-media endpoint so they can be referenced
/// by `primaryImageHash` / `secondaryImageHashes` on
/// `PUT /v3/me/profile/images`.
///
/// Why this exists: `upload_image` targets `POST /v5/chat/media/upload`, the
/// only endpoint that mints a numeric `mediaId`, but it returns a **signed /
/// private** 64-char hash. The profile-photos endpoint documents its hashes as
/// **public** 40-char CDN files, so a chat-media hash is not a valid
/// `primaryImageHash`. This command hits `POST /v4/media/upload`, which returns
/// the public `hash`.
///
/// `thumbCoords` is a RectF serialised as `y2,x1,x2,y1` in the query string and
/// MUST describe a square region (`y2-y1 == x2-x1`): the server accepts a
/// non-square crop without complaint but then SILENTLY DROPS the image when it
/// is later referenced from `PUT /v3/me/profile/images`. We therefore pass the
/// largest centred square inside the image's real dimensions, computed by the
/// caller, so the crop is square by construction.
///
/// Returns the raw response body — the caller validates the `hash` shape.
#[tauri::command]
pub async fn upload_profile_image(
    state: tauri::State<'_, AppState>,
    image_base64: String,
    mime_type: String,
    width: u32,
    height: u32,
) -> Result<UploadImageResult, AppError> {
    // Same inbound cap as `upload_image` (~22 MB binary) so a hostile WebView
    // payload cannot OOM the process through STANDARD.decode.
    const MAX_IMAGE_BASE64: usize = 30 * 1024 * 1024;
    if image_base64.len() > MAX_IMAGE_BASE64 {
        return Err(AppError::Http("Image payload too large".to_owned()));
    }
    if width == 0 || height == 0 {
        return Err(AppError::Http(
            "Image dimensions are required to compute a square thumbnail crop".to_owned(),
        ));
    }
    let bytes = STANDARD
        .decode(&image_base64)
        .map_err(|e| AppError::Http(format!("Failed to decode image base64: {e}")))?;

    // Largest centred square that fits inside the image.
    let side = width.min(height);
    let x1 = (width - side) / 2;
    let y1 = (height - side) / 2;
    let x2 = x1 + side;
    let y2 = y1 + side;
    // RectF order is y2,x1,x2,y1 (see docs/content/grindr-api/users/profiles.md#RectF).
    let thumb_coords = format!("{y2},{x1},{x2},{y1}");

    let authorization = state
        .client()?
        .authorization_header()
        .await
        .ok_or_else(|| AppError::Auth("Not logged in".to_owned()))?;

    let http = state.client()?.http.read().await.clone();

    // `takenOnGrindr` is documented for the v4 endpoint. Query values are
    // numeric-only by construction, so no escaping concern.
    let url = format!(
        "{BASE_URL}/v4/media/upload?thumbCoords={thumb_coords}&takenOnGrindr=false"
    );
    let response = http
        .post(url)
        .header("Authorization", authorization)
        .header("L-Grindr-Roles", grindr_roles_header_value())
        // B6: safe without a `safe_mime` check (unlike `upload_album_content`,
        // which hand-builds a multipart body) because reqwest validates this as a
        // `HeaderValue`, which rejects CR/LF.
        .header("Content-Type", &mime_type)
        .body(bytes)
        .send()
        .await?;

    let status = response.status().as_u16();
    // B3: was `response.text().await` with NO cap on any upload path.
    let body =
        String::from_utf8_lossy(&stream_capped_body(response, MAX_UPLOAD_RESPONSE_BYTES).await?)
            .into_owned();

    Ok(UploadImageResult { status, body })
}

// FIX 3: stream the body with a running counter so chunked responses with no
// Content-Length are also capped. `response.bytes()` would buffer everything
// before we could check the size. Shared by `fetch_authed_bytes` and
// `fetch_media_bytes`.
const MAX_FETCH_BYTES: usize = 10 * 1024 * 1024;

/// Cap for a single API response body coming back through the generic
/// `request` bridge. Large media never travels this path (it uses
/// `fetch_authed_bytes` / `fetch_media_bytes`, capped at `MAX_FETCH_BYTES`),
/// so this only needs to accommodate big JSON/msgpack payloads.
const MAX_API_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

/// B3: cap for the JSON bodies read on the AUTH path (`request_json`, which
/// backs `login` and `refresh_token`, and the `forgot_password` error body).
/// These are small, fixed-shape JSON documents; 1 MiB is orders of magnitude
/// more than any real one. `request_json` is `pub(super)`, so this cap is too
/// (used by `api::auth`).
pub(super) const MAX_AUTH_RESPONSE_BYTES: usize = 1024 * 1024;

/// B3: cap for an upload command's response body. The requests are capped at
/// ~22 MB of image bytes but the RESPONSE is a small JSON receipt
/// (`{mediaId, mediaHash, url}` / `{contentId, contentUrl}`). 32 MiB is kept
/// to preserve the previous unbounded behaviour's tolerance rather than to be
/// justified by real payloads.
const MAX_UPLOAD_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

/// B3: cap for the fixed-URL release / stats / telemetry fetches. These return
/// small JSON documents; 256 KiB is generous (the GitHub releases list with
/// `per_page=100` plus full changelog bodies is the largest, and is ~100s of KiB
/// at most). Keeps a hostile or misconfigured upstream from streaming forever
/// into a mobile process.
const MAX_PUBLIC_JSON_BYTES: usize = 256 * 1024;

/// Read a response body with a hard byte cap, including for chunked responses
/// that declare no `Content-Length`. `response.bytes()` would buffer everything
/// before the size could be checked. Shared by every non-media response path.
pub(super) async fn stream_capped_body(
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
        // B3: refuse redirects. This request carries no Authorization header, so
        // there is no token to leak, but following a 30x from a fixed third-party
        // URL into an unbounded body is exactly what the caps below exist to stop.
        .redirect(Policy::none())
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
    // B3: was `response.text().await` with NO cap.
    Ok(
        String::from_utf8_lossy(&stream_capped_body(response, MAX_PUBLIC_JSON_BYTES).await?)
            .into_owned(),
    )
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
        // B3: refuse redirects — see `fetch_latest_release`.
        .redirect(Policy::none())
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
                // B3: was `resp.text().await` with NO cap.
                match stream_capped_body(resp, MAX_PUBLIC_JSON_BYTES).await {
                    Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                    Err(_) => "null".to_owned(),
                }
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
        // B3: refuse redirects — see `fetch_latest_release`.
        .redirect(Policy::none())
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
    // B3: was `response.text().await` with NO cap.
    Ok(
        String::from_utf8_lossy(&stream_capped_body(response, MAX_PUBLIC_JSON_BYTES).await?)
            .into_owned(),
    )
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
        // B3: refuse redirects — see `fetch_latest_release`.
        .redirect(Policy::none())
        .build()
        .map_err(|e| AppError::Http(e.to_string()))?;
    http.post(url).send().await?;
    Ok(())
}

/// B7: HTTP verbs the generic `request`/`request_public` bridges will forward.
///
/// `Method::from_str` accepts ANY token, so without this a compromised WebView
/// could drive DELETE/PATCH/TRACE/arbitrary custom verbs at any `vN/...` path
/// on grindr.mobi while the bridge attaches the user's bearer token. The Grindr
/// API only needs these five; anything else is a bug or an attack.
const ALLOWED_BRIDGE_METHODS: [Method; 5] = [
    Method::GET,
    Method::POST,
    Method::PUT,
    Method::PATCH,
    Method::DELETE,
];

/// Parse and authorise the caller-supplied verb. Same error style as the
/// neighbouring path guard.
fn parse_bridge_method(method: &str) -> Result<Method, AppError> {
    let parsed = Method::from_str(method).map_err(|_| AppError::Api {
        code: 400,
        message: format!("Invalid method: {method}"),
    })?;
    if !ALLOWED_BRIDGE_METHODS.contains(&parsed) {
        return Err(AppError::Api {
            code: 405,
            message: format!("HTTP method not allowed: {method}"),
        });
    }
    Ok(parsed)
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

    // Same stack-overflow guard as the request bridges above: the byte cap does
    // not bound nesting depth.
    crate::api::msgpack_depth::check_depth(&bytes, crate::api::msgpack_depth::MAX_DEPTH)
    	.map_err(AppError::Http)?;
    let payload: RequestPayload = rmp_serde::from_slice(&bytes)
    	.map_err(|e| AppError::Http(format!("Failed to decode request payload: {e}")))?;

    // B7: `Method::from_str` accepts any token, so this also enforces the
    // verb allow-list. Same error shape as the `is_safe_api_path` guard below.
    let method = parse_bridge_method(&payload.method)?;

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

    // Same stack-overflow guard as the request bridges above: the byte cap does
    // not bound nesting depth.
    crate::api::msgpack_depth::check_depth(&bytes, crate::api::msgpack_depth::MAX_DEPTH)
    	.map_err(AppError::Http)?;
    let payload: RequestPayload = rmp_serde::from_slice(&bytes)
    	.map_err(|e| AppError::Http(format!("Failed to decode request payload: {e}")))?;

    let method = parse_bridge_method(&payload.method)?;

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
