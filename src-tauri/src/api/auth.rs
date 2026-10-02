use keyring_core::Entry;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;

use super::client::{GrindrClient, BASE_URL};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Session {
    pub email: String,
    pub expires_at: u64,
    pub profile_id: String,
    pub session_id: String,
    pub auth_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub profile_id: String,
    pub session_id: String,
    pub auth_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    pub token: Option<String>,
    pub geohash: Option<String>,
}

trait AuthRequest: Serialize {
    fn email(&self) -> &str;
}

impl AuthRequest for LoginRequest {
    fn email(&self) -> &str {
        &self.email
    }
}

impl AuthRequest for RefreshRequest {
    fn email(&self) -> &str {
        &self.email
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest {
    pub email: String,
    pub auth_token: String,
    pub token: Option<String>,
    pub geohash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub profile_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
struct JwtClaims {
    // FIX 6: JWT spec says exp is a NumericDate (JSON number). Some issuers
    // emit it as a float (e.g. 1234567890.0). Deserialising as u64 causes a
    // parse error in those cases; using f64 accepts both forms and we truncate
    // when storing.
    exp: f64,
}

impl LoginRequest {
    pub fn new(email: String, password: String) -> Self {
        Self {
            email,
            password,
            token: None,
            geohash: None,
        }
    }
}

impl RefreshRequest {
    pub fn new(email: String, auth_token: String) -> Self {
        Self {
            email,
            auth_token,
            token: None,
            geohash: None,
        }
    }
}

fn decode_session_jwt(token: &str) -> Result<JwtClaims, AppError> {
    // Signature verification is intentionally skipped. The real invariant is
    // NOT "the token is never re-transmitted" — it IS re-transmitted, as
    // `Authorization: Grindr3 <jwt>` on every REST call and on the WS
    // handshake. The actual invariant is that TLS to grindr.mobi is the entire
    // trust boundary and the token's authenticity was established by the
    // server that just issued it over that channel; this decode is an
    // unverified peek at a claim we already had every reason to trust. `exp` is
    // used only as a LOCAL CACHE HINT (when to refresh), so a forged value can
    // at worst cause a wasted refresh round-trip — never an auth bypass.
    // Do not use this to make a security decision.
    let data = jsonwebtoken::dangerous::insecure_decode::<JwtClaims>(token)
        .map_err(|e| AppError::Auth(format!("JWT decode failed: {e}")))?;

    Ok(data.claims)
}

pub struct AuthStorage;

impl AuthStorage {
    fn get_session_entry() -> Result<Entry, AppError> {
        Entry::new("open-grind", "session")
            .map_err(|e| AppError::CredentialStore(e.to_string()))
    }
    /// Read the session from the OS keystore.
    ///
    /// The keyring call is SYNCHRONOUS and on Android goes through JNI to the
    /// Keystore, which takes tens of milliseconds and can spike under load. It
    /// used to be called directly from `async fn`s with no `spawn_blocking`, so
    /// it stalled the shared runtime — including the WS loop and every in-flight
    /// API call. Worse, `authorization_header` calls this INSIDE the refresh
    /// critical section, so the stall was paid by every request queued behind the
    /// lock.
    pub async fn get_session() -> Result<Option<Session>, AppError> {
        tauri::async_runtime::spawn_blocking(Self::get_session_blocking)
            .await
            .map_err(|e| AppError::CredentialStore(format!("Keyring read task failed: {e}")))?
    }

    /// Synchronous keystore read, for the SYNC startup path only
    /// (`GrindrClient::new`, which runs in Tauri's `setup` hook). Everywhere
    /// else use the async `get_session` above.
    pub fn get_session_blocking() -> Result<Option<Session>, AppError> {
        let entry = Self::get_session_entry()?;
        let session_bytes = match entry.get_secret() {
            Ok(bytes) => bytes,
            Err(keyring_core::Error::NoEntry) => return Ok(None),
            Err(e) => return Err(AppError::CredentialStore(e.to_string())),
        };
        rmp_serde::decode::from_slice(&session_bytes)
            .map_err(|e| AppError::CredentialStore(e.to_string()))
            .map(Some)
    }
    pub fn set_session(session: &Session) -> Result<(), AppError> {
        let session_bytes = rmp_serde::encode::to_vec(session)
            .map_err(|e| AppError::CredentialStore(format!("Failed to encode session: {e}")))?;
        Self::get_session_entry()?
            .set_secret(&session_bytes)
            .map_err(|e| AppError::CredentialStore(e.to_string()))
    }
    /// Async keystore write, mirroring `get_session` above.
    ///
    /// `set_secret` is SYNCHRONOUS and on Android goes through JNI to the
    /// Keystore — tens of milliseconds, spiking under load. Called directly from
    /// `async fn`s it stalled the shared runtime, and the worst site was
    /// `authorization_header`, where it ran while `refresh_lock` was held, so
    /// every request queued behind that lock paid the stall.
    pub async fn set_session_async(session: Session) -> Result<(), AppError> {
        tauri::async_runtime::spawn_blocking(move || Self::set_session(&session))
            .await
            .map_err(|e| AppError::Auth(format!("Keyring write task failed: {e}")))?
    }
    pub fn delete_session() {
        match Self::get_session_entry() {
            Ok(entry) => {
                if let Err(e) = entry.delete_credential() {
                    if !matches!(e, keyring_core::Error::NoEntry) {
                        eprintln!("Warning: failed to delete keyring session entry: {e}");
                    }
                }
            }
            Err(e) => {
                eprintln!("Warning: failed to create keyring entry for deletion: {e}");
            }
        }
    }
    /// Async keystore delete, mirroring `get_session` above.
    ///
    /// Best-effort by design, exactly like the synchronous `delete_session` it
    /// wraps: that one logs and swallows every failure (there is nothing useful
    /// a caller could do at logout time), so this returns `()` and does not
    /// start returning `Result` just because it became async. The `JoinError` is
    /// dropped because the blocking task's own errors are already logged inside
    /// `delete_session` and a cancelled task also means "not deleted", which is
    /// the same outcome.
    pub async fn delete_session_async() {
        let _ = tauri::async_runtime::spawn_blocking(Self::delete_session).await;
    }
}

impl GrindrClient {
    async fn create_session(&self, body: &impl AuthRequest) -> Result<Session, AppError> {
        let session_resp: SessionResponse = self
            .request_json(reqwest::Method::POST, "/v8/sessions", Some(body))
            .await?;
        let claims = decode_session_jwt(&session_resp.session_id)?;

        let session = Session {
            email: body.email().to_owned(),
            profile_id: session_resp.profile_id.clone(),
            session_id: session_resp.session_id,
            auth_token: session_resp.auth_token,
            // FIX 6: truncate f64 → u64 (fractional seconds are irrelevant for expiry checks)
            //
            // But validate first. `f64 as u64` saturates, so a negative, NaN or
            // missing `exp` becomes 0 — which `authorization_header` reads as
            // "already expired". Every subsequent API call would then perform a
            // wasted refresh round-trip, forever. Reject the session at creation
            // rather than storing a permanently-expired one.
            expires_at: {
                if !claims.exp.is_finite() || claims.exp <= 0.0 {
                    return Err(AppError::Auth(
                        "Session token has no usable expiry".to_owned(),
                    ));
                }
                claims.exp as u64
            },
        };

        // B4: synchronous JNI keystore write — keep it off the async runtime.
        // Cloned because the caller still needs to return the session.
        //
        // NON-FATAL on purpose. This used to be `?`, which meant a keystore
        // hiccup made `create_session` fail AFTER the server had already minted
        // a valid session — so the caller never adopted it and kept using the
        // old, now-invalidated one, and (before the `CredentialStore` split) the
        // classifier read that as a rejected credential and wiped the session.
        // The minted session is the truth; saving it is bookkeeping. Losing it
        // only costs "you'll have to sign in again after a restart", which is a
        // far better failure than a forced sign-out.
        if let Err(e) = AuthStorage::set_session_async(session.clone()).await {
            eprintln!(
                "[GrindrX] Signed in but could not save the session to the keystore \
                 ({e}); you may have to sign in again after a restart."
            );
        }

        Ok(session)
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<LoginResult, AppError> {
        let body = LoginRequest::new(email.to_owned(), password.to_owned());
        let session = self.create_session(&body).await?;
        let profile_id = session.profile_id.clone();

        *self.session.write().await = Some(session);

        Ok(LoginResult { profile_id })
    }

    /// Trigger Grindr's password-reset email. This is intentionally
    /// unauthenticated: it's called from the logged-out reset screen, and the
    /// primary audience is users who created their Grindr account via a social
    /// provider (Google/Apple/Facebook) and therefore have no password. Setting
    /// one via this email is what lets them sign in to GrindrX (which is
    /// email+password only).
    pub async fn forgot_password(&self, email: &str) -> Result<(), AppError> {
        let http = self.http.read().await.clone();
        let body = ForgotPasswordRequest { email: email.to_owned() };

        let response = http
            .post(format!("{BASE_URL}/v3/users/forgot-password"))
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            // B3: the error body was read with `response.json()` and no cap.
            // Use the same capped reader as every other response path.
            let bytes =
                super::rest::stream_capped_body(response, super::rest::MAX_AUTH_RESPONSE_BYTES)
                    .await
                    .unwrap_or_default();
            let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
            return Err(AppError::Api {
                code: json.get("code").and_then(|c| c.as_i64()).unwrap_or(0),
                message: json
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Failed to send reset email")
                    .to_owned(),
            });
        }

        // Body (ForgotPwdEmailResponse) is intentionally ignored — success is
        // signalled by the 2xx status; Grindr returns a generic result here to
        // avoid account-existence enumeration.
        Ok(())
    }

    /// Public refresh — takes `refresh_lock` so callers from the Tauri command
    /// surface can't race the implicit refresh inside `authorization_header()`.
    /// Use `refresh_token_inner()` if the lock is already held.
    pub async fn refresh_token(&self) -> Result<LoginResult, AppError> {
        let _guard = self.refresh_lock.lock().await;

        // Another task may have refreshed while we waited; if the current
        // session is still valid for >60s, return its profile id directly
        // instead of consuming a refresh token unnecessarily.
        if let Some(s) = self.session.read().await.as_ref() {
            let now = chrono::Utc::now().timestamp().max(0) as u64;
            if s.expires_at > now + 60 {
                return Ok(LoginResult { profile_id: s.profile_id.clone() });
            }
        }

        self.refresh_token_inner().await
    }

    /// Inner refresh — caller MUST hold `refresh_lock`. Does the network call
    /// and updates the in-memory + keyring session.
    async fn refresh_token_inner(&self) -> Result<LoginResult, AppError> {
        let current = self.session.read().await;
        let session = current
            .as_ref()
            .ok_or_else(|| AppError::Auth("Not logged in".to_owned()))?;

        let body = RefreshRequest::new(session.email.clone(), session.auth_token.clone());

        drop(current);

        let session = self.create_session(&body).await?;
        let profile_id = session.profile_id.clone();
        // Adopt the freshly minted session. `create_session` has already
        // attempted the keystore write (non-fatally — see its comment), so there
        // is nothing to do about persistence here; doing it again would be a
        // second synchronous Keystore round trip inside the refresh lock.
        *self.session.write().await = Some(session);

        Ok(LoginResult { profile_id })
    }

    pub async fn authorization_header(&self) -> Option<String> {
        let expires_at = self
            .session
            .read()
            .await
            .as_ref()
            .map(|s| s.expires_at)
            .unwrap_or(0);

        // FIX 8: use .max(0) before cast to avoid wrapping on pre-epoch clocks
        if expires_at < (chrono::Utc::now().timestamp().max(0) as u64 + 60) {
            let _guard = self.refresh_lock.lock().await;

            let still_expired = self
                .session
                .read()
                .await
                .as_ref()
                .map(|s| s.expires_at)
                .unwrap_or(0)
                < (chrono::Utc::now().timestamp().max(0) as u64 + 60);

            if still_expired {
                if let Err(e) = self.refresh_token_inner().await {
                    // Only a REJECTED CREDENTIAL clears the session. The test used
                    // to be `AppError::Auth(_)`, which also matched every keystore
                    // and msgpack failure, so a transient Android Keystore
                    // contention — documented in this same file as taking tens of
                    // milliseconds and spiking under load — silently signed the
                    // user out mid-session and deleted their stored credential.
                    // Those are `AppError::CredentialStore` now.
                    //
                    // A transport failure or a 5xx is deliberately NOT fatal
                    // either: it says nothing about our token's validity, and
                    // clearing the session there would strand a user whose token
                    // is fine behind one flaky request.
                    //
                    // 403 is ALSO not fatal, and that is the change (2026-10-02).
                    // Cloudflare fronts the API and refuses requests with an HTML
                    // interstitial, and a 403 is what that refusal looks like —
                    // a WAF/infrastructure refusal, not a judgement about the
                    // token. Treating it as "your credential was rejected" deleted
                    // the user's session AND their stored credential, and since
                    // re-login posts to the same blocked host the app could not
                    // recover on its own. Verified: a Cloudflare HTML body fails
                    // to parse in `request_json`, so it already arrives as
                    // `code: 0` and never reached this branch — meaning the only
                    // way to get `code: 403` here is a genuine JSON error
                    // envelope. That is still not proof the TOKEN is bad (it can
                    // be a per-endpoint entitlement or region gate), and the
                    // cost of guessing wrong is permanent, so only a 401 — which
                    // is unambiguous — clears the session.
                    let auth_class = matches!(&e, AppError::Auth(_))
                        || matches!(&e, AppError::Api { code, .. } if *code == 401);
                    if auth_class {
                        eprintln!("[GrindrX] Token refresh rejected ({e}); clearing session.");
                        *self.session.write().await = None;
                        // B4: this runs while `refresh_lock` is held; a
                        // synchronous keystore delete here stalls every other
                        // task queued on that lock.
                        AuthStorage::delete_session_async().await;
                    } else {
                        eprintln!("[GrindrX] Token refresh failed: {e}. Continuing with potentially expired token.");
                    }
                }
            }
        }

        self.session
            .read()
            .await
            .as_ref()
            .map(|s| format!("Grindr3 {}", s.session_id))
    }
}

#[tauri::command]
pub async fn login(
    state: tauri::State<'_, AppState>,
    email: String,
    password: String,
) -> Result<LoginResult, AppError> {
    let result = state.client()?.login(&email, &password).await?;
    // Force any still-live WS connection (e.g. an account switch that never
    // called `logout`) to drop so it reconnects under the new session
    // instead of continuing to deliver the previous account's events.
    state.bump_ws_epoch();
    state.auth_notify.notify_one();
    Ok(result)
}

#[tauri::command]
pub async fn refresh_token(state: tauri::State<'_, AppState>) -> Result<LoginResult, AppError> {
    let result = state.client()?.refresh_token().await?;
    state.auth_notify.notify_one();
    Ok(result)
}

#[tauri::command]
pub async fn forgot_password(
    state: tauri::State<'_, AppState>,
    email: String,
) -> Result<(), AppError> {
    let email = email.trim();
    if email.is_empty() {
        return Err(AppError::Auth("Email is required".to_owned()));
    }
    state.client()?.forgot_password(email).await
}

#[tauri::command]
pub async fn logout(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    if let Ok(client) = state.client() {
        client.session.write().await.take();
    }
    AuthStorage::delete_session_async().await;
    // Drop any live WS connection immediately — without this the previous
    // account's realtime events/notifications keep flowing until the socket
    // naturally expires (Grindr session JWTs live up to 30 min).
    //
    // Bumping the epoch (rather than notifying a `Notify`) is what makes this
    // reliable: a `Notify` only wakes waiters registered at that instant, and
    // the connection task is not waiting during its backoff or its handshake,
    // so a logout in that window used to be silently dropped. See
    // `AppState::ws_epoch`.
    state.bump_ws_epoch();
    Ok(())
}

/// B5: `auth_state`'s return payload.
///
/// Was a bare `Option<u64>` profile id, which carried no way to tell "not
/// logged in" apart from "secure storage is broken and you will never be able
/// to log in". A keyring that never initialised leaves the app looking normal
/// while every login fails forever with an opaque `AppError::Auth`.
///
/// BREAKING IPC CHANGE: the frontend's `auth_state` response schema is a bare
/// `z.number().int().nonnegative().nullable()` and three call sites read the
/// result as a profile id. They must be updated to this object shape.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStateResponse {
    /// `Some` when a non-expired session is loaded.
    pub profile_id: Option<u64>,
    /// `Some(reason)` when secure storage is unusable. Non-`None` means login
    /// can never succeed in this process; show the reason and do NOT offer a
    /// plain "login failed" retry loop.
    pub keyring_error: Option<String>,
}

#[tauri::command]
pub async fn auth_state(state: tauri::State<'_, AppState>) -> Result<AuthStateResponse, AppError> {
    let keyring_error = state.keyring_error();
    let Ok(client) = state.client() else {
        return Ok(AuthStateResponse {
            profile_id: None,
            keyring_error,
        });
    };
    let session = client.session.read().await;
    Ok(AuthStateResponse {
        profile_id: session
            .as_ref()
            .and_then(|s| s.profile_id.parse::<u64>().ok()),
        keyring_error,
    })
}
