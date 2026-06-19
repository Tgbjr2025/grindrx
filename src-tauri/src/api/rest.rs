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

#[tauri::command]
pub async fn fetch_authed_bytes(
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<String, AppError> {
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

    // FIX 13: build a dedicated client that refuses redirects. The host/scheme
    // allowlist above only validates the initial URL; a 30x redirect to an
    // off-allowlist host (or to http://) would otherwise re-send the
    // Authorization header to an unvetted destination. reqwest does NOT strip
    // Authorization across cross-origin redirects, so we must not follow any.
    let base = state.client()?.http.read().await.clone();
    let http = match reqwest::Client::builder()
        .redirect(Policy::none())
        // Match the shared client's timeouts so this path doesn't hang
        // indefinitely on a half-open CDN connection.
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        // Fall back to the shared client if the dedicated builder fails for any
        // reason; behavior is unchanged from before this fix in that case.
        Err(_) => base,
    };

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

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_owned();

    // FIX 3: stream the body with a running counter so chunked responses with
    // no Content-Length are also capped. `response.bytes()` would buffer
    // everything before we could check the size.
    const MAX_BYTES: usize = 10 * 1024 * 1024;
    let mut body: Vec<u8> = Vec::with_capacity(8192);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Http(e.to_string()))?;
        if body.len() + chunk.len() > MAX_BYTES {
            return Err(AppError::Http("Response too large".to_owned()));
        }
        body.extend_from_slice(&chunk);
    }

    let b64 = STANDARD.encode(&body);
    Ok(format!("data:{};base64,{}", content_type, b64))
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
