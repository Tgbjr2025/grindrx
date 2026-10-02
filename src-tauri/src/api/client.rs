use reqwest::header::HeaderMap;
use reqwest::Client;
use serde::Serialize;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};

use crate::error::AppError;
use crate::state::AppState;

use super::auth::Session;
use super::headers::{build_default_headers, build_user_agent, DeviceInfo, DeviceStorage};

pub const BASE_URL: &str = "https://grindr.mobi";

/// Shared reqwest client construction, used both at startup and by
/// `rotate_api_params` (device-info rotation rebuilds the client with a fresh
/// User-Agent/headers).
///
/// Redirects are refused: this is the client `request_raw` and `upload_image`
/// attach the bearer `Authorization` header on, and reqwest's default policy
/// (follow up to 10 redirects) does not reliably strip that header across a
/// same-host https→http scheme downgrade. A 30x response from any grindr.mobi
/// endpoint — or an active MITM — could otherwise re-send the session token
/// to an unvetted/cleartext destination. The API bridge never legitimately
/// needs to follow a redirect; a 3xx now just surfaces as a non-2xx
/// `RawResponse` to the frontend.
fn build_http_client(headers: HeaderMap) -> Result<Client, reqwest::Error> {
    Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

pub struct GrindrClient {
    pub(super) http: RwLock<Client>,
    pub(super) session: RwLock<Option<Session>>,
    pub(super) refresh_lock: Mutex<()>,
    pub user_agent: RwLock<String>,
    /// B5: `Some(reason)` when secure storage could not be reached at startup.
    ///
    /// `storage::init_keyring` only `eprintln!`s when `Store::new()` fails, so
    /// `keyring_core::set_default_store` is never called and every `Entry::new`
    /// returns `NoStore` forever. The app starts normally and every login then
    /// fails with an opaque `AppError::Auth`. Recorded here at construction and
    /// surfaced by the `auth_state` command. Read before the client is moved
    /// into the `OnceLock`.
    pub keyring_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RotateResult {
    #[serde(rename = "user-agent")]
    pub user_agent: String,
    #[serde(rename = "l-device-info")]
    pub l_device_info: String,
}

impl GrindrClient {
    pub fn new() -> Result<Self, AppError> {
        let device = match DeviceStorage::load() {
            Ok(Some(d)) => d,
            Ok(None) => {
                let d = DeviceInfo::default();
                if let Err(e) = DeviceStorage::save(&d) {
                    eprintln!("[client] could not persist device info: {e}");
                }
                d
            }
            Err(e) => {
                eprintln!("[client] could not load device info, regenerating: {e}");
                DeviceInfo::default()
            }
        };
        let user_agent = build_user_agent(&device, "Free");
        let headers = build_default_headers(&device, &user_agent);
        // B5: stays `None` unless the keystore read below failed. `unused_mut` is
        // allowed because on macOS-without-keychain the cfg strips the only
        // assignment, leaving the binding immutable there.
        #[allow(unused_mut)]
        let mut keyring_error: Option<String> = None;

        // FIX 10: add request and connect timeouts so hung API calls don't freeze the app
        let http = build_http_client(headers)?;

        #[cfg(all(target_os = "macos", not(feature = "keychain")))]
        let session = None;
        #[cfg(not(all(target_os = "macos", not(feature = "keychain"))))]
        // `new()` is sync (Tauri `setup` hook), so use the blocking keystore
        // read here. Every other caller goes through the async wrapper.
        let session = match super::auth::AuthStorage::get_session_blocking() {
            Ok(s) => s,
            Err(e) => {
                // B5: do not stay silent. Without a default store this is
                // `NoStore` on every call and the user can never log in again
                // in this process — record it so `auth_state` can say so.
                eprintln!("[client] could not load session: {e}");
                keyring_error = Some(e.to_string());
                None
            }
        };

        // FIX 9 (revised 2026-10-02): an expired session must NOT be discarded if
        // it still carries a refresh token.
        //
        // The original version deleted any session whose `expires_at` had passed,
        // on the theory that a stale token is unusable. But `Session.auth_token`
        // is exactly what `authorization_header()` -> `refresh_token_inner()` ->
        // `create_session()` uses to mint a NEW session from the stored email +
        // token, and that path is already expiry-aware and already refuses to
        // clear on anything but a genuine 401. Deleting here threw that
        // credential away and forced a full re-login instead.
        //
        // Why that mattered, observed on a real device: the token expired, the app
        // restarted, and the user was signed out. Re-login POSTs to the same
        // `/v8/sessions` endpoint, which is fronted by a WAF that intermittently
        // refuses it — so the outcome was an app that worked, then stopped
        // working, then worked again depending on whether login got through. A
        // refresh would have been invisible to all of that.
        //
        // An expired session is now KEPT whenever there is something to refresh
        // with, and only discarded when it carries no token at all (the genuine
        // post-reinstall case this was written for).
        #[cfg(not(all(target_os = "macos", not(feature = "keychain"))))]
        let session = {
            let now = chrono::Utc::now().timestamp().max(0) as u64;
            match session {
                Some(ref s) if s.expires_at < now && s.auth_token.trim().is_empty() => {
                    eprintln!(
                        "[client] stored session is expired and has no refresh token \
                         (expires_at={}, now={}) — clearing",
                        s.expires_at, now
                    );
                    super::auth::AuthStorage::delete_session();
                    None
                }
                Some(ref s) if s.expires_at < now => {
                    // Expected, not an error: the first authenticated request will
                    // refresh it. Logged so a support log distinguishes this from a
                    // silent sign-out.
                    eprintln!(
                        "[client] stored session is expired (expires_at={}, now={}) \
                         — keeping it so the token can be refreshed",
                        s.expires_at, now
                    );
                    session
                }
                other => other,
            }
        };

        Ok(Self {
            http: RwLock::new(http),
            session: RwLock::new(session),
            refresh_lock: Mutex::new(()),
            user_agent: RwLock::new(user_agent),
            keyring_error,
        })
    }

    /// B9 (`reload_session`): the `#[allow(dead_code)]` is correct and the
    /// cfg still matches. This IS live on `target_os = "macos"` without the
    /// `keychain` feature: there `new()` hardcodes `session = None` (the file
    /// store in `storage.rs` is the credential backend, and reading it is a
    /// blocking keystore call that cannot happen in the sync constructor), so
    /// the only way the session reaches `GrindrClient` is this method, called
    /// from the `setup` hook in `lib.rs`. It is dead code on every other target,
    /// which is what the allow is for. Keep it and keep the allow.
    #[allow(dead_code)]
    pub async fn reload_session(&self) {
        match super::auth::AuthStorage::get_session().await {
            Ok(s) => *self.session.write().await = s,
            Err(e) => eprintln!("[client] reload_session: {e}"),
        }
    }
}

#[tauri::command]
pub async fn rotate_api_params(
    state: tauri::State<'_, AppState>,
) -> Result<RotateResult, AppError> {
    // B8: this is an unlimited synchronous-keystore-write primitive that any
    // WebView caller can invoke in a tight loop, each write costing tens of
    // milliseconds of JNI on Android. It SHOULD be rate-limited. A real limiter
    // needs per-caller state (a cooldown timestamp in `AppState`) and that
    // could not be compiled on the audit host, so it is NOT done here — treat
    // this as a known gap, not as an intentional omission.
    let client = state.client()?;

    let device = DeviceInfo::default();
    // B4: `DeviceStorage::save` is a synchronous keystore write. This is an
    // `async fn` on the shared runtime, so run it on the blocking pool. The
    // sibling call in `GrindrClient::new()` is left synchronous on purpose:
    // that constructor runs in Tauri's `setup` hook and cannot await.
    let persisted = tauri::async_runtime::spawn_blocking({
        let device = device.clone();
        move || DeviceStorage::save(&device)
    })
    .await
    .map_err(|e| AppError::Auth(format!("Keyring write task failed: {e}")))?;
    if let Err(e) = persisted {
        eprintln!("[client] could not persist rotated device info: {e}");
    }
    let user_agent = build_user_agent(&device, "Free");
    let headers = build_default_headers(&device, &user_agent);
    let http = build_http_client(headers.clone())?;

    *client.http.write().await = http;

    // FIX 6: return the newly generated values, not the old ones
    let new_ua = user_agent.clone();
    let new_device_info = headers
        .get("L-Device-Info")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    *client.user_agent.write().await = user_agent;

    // B8: the live WebSocket handshake still carries the OLD User-Agent, so REST
    // and WS would present two different device identities to Grindr for the
    // rest of the session. Bumping the epoch drops the socket (see
    // `AppState::ws_epoch`).
    //
    // The `auth_notify` wakeup is REQUIRED, not optional: `run_ws_loop` treats
    // this as `AppError::Auth` ("wait for the next login") and then blocks on
    // `auth_notify.notified()`. Bumping the epoch alone would drop the socket
    // and never bring it back for an already-logged-in user — turning a stale
    // User-Agent into a permanently dead WebSocket. This is the same pair
    // `login` uses. Epoch first, then notify, so the waiter observes the new
    // value.
    state.bump_ws_epoch();
    state.auth_notify.notify_one();

    Ok(RotateResult {
        user_agent: new_ua,
        l_device_info: new_device_info,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Regression test for the redirect-refusal hardening: the shared client
    /// (the one `request_raw`/`upload_image` attach the bearer Authorization
    /// header on) must never follow a redirect. A follow would re-send the
    /// session token to whatever host/scheme the 3xx `Location` points at.
    #[tokio::test]
    async fn shared_client_does_not_follow_redirects() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test listener");
        let addr = listener.local_addr().expect("local addr");

        // Bare-bones single-shot HTTP/1.1 server: accept one connection,
        // respond 302 pointing at an address nothing is listening on, then
        // close. If the client followed the redirect it would fail to
        // connect there instead of returning this 302 to the caller.
        let server = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let response = "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/unreachable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });

        let http = build_http_client(HeaderMap::new()).expect("build test client");

        let response = http
            .get(format!("http://{addr}/"))
            .send()
            .await
            .expect("request should succeed locally (redirect must not be followed)");

        assert_eq!(
            response.status().as_u16(),
            302,
            "client must return the 302 as-is instead of following Location"
        );

        server.join().expect("test server thread panicked");
    }
}
