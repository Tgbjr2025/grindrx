use reqwest::header::HeaderMap;
use reqwest::Client;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
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
    /// P1-008: single-flight gate for `rotate_api_params`. Held for the whole
    /// rotation (device regeneration -> keystore write -> client rebuild ->
    /// header swap -> epoch bump), so two callers can never interleave a swap
    /// of the device identity. The loser of the race does not spin here
    /// waiting for nothing: it gets the winner's `RotateResult` (see
    /// `rotate_generation`).
    ///
    /// It lives on the client and not on `AppState` next to
    /// `try_acquire_rotate_permit` because `AppState` is built with a struct
    /// literal in `lib.rs::run`, so a new field there is a cross-module edit
    /// for something that has nothing to do with `AppState`'s own state. The
    /// rotation mutates *this* object's headers, so this is also where the
    /// coherence check belongs: a `RotateResult` read out of `rotate_flight`
    /// is by construction the identity currently installed on `http` /
    /// `user_agent`.
    rotate_flight: Mutex<RotateSlot>,
    /// P1-008: the idempotency key. Monotonic counter of COMPLETED rotations.
    ///
    /// A caller snapshots this *before* it queues on `rotate_flight`; if, by
    /// the time it holds the gate, `rotate_flight.last` carries a HIGHER
    /// generation, then a rotation that began after this caller arrived has
    /// already finished, and this caller returns that result instead of
    /// starting a second one. That is the whole "idempotency key" mechanism:
    /// "give me the result of rotation N, or produce N+1".
    ///
    /// It is an atomic rather than a field of `RotateSlot` precisely because
    /// it must be readable WITHOUT the gate: reading it under the gate would
    /// block until the in-flight rotation finished and then hand the reader
    /// the winner's own generation, so every caller would conclude "no one
    /// rotated while I waited" and rotate again. Snapshot-then-queue is what
    /// makes the coalescing correct.
    rotate_generation: AtomicU64,
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

/// P1-008: state shared by every `rotate_api_params` caller while one of them
/// is rotating.
#[derive(Default)]
struct RotateSlot {
    /// The most recent COMPLETED rotation: `(generation, what it produced)`.
    ///
    /// Only successes are published, and only under `rotate_flight`. A caller
    /// that finds `generation > its own snapshot` therefore knows the rotation
    /// genuinely finished and its result is the one currently installed on the
    /// client — which is the value it is contractually required to return
    /// (FIX 6 in `rotate_api_params`: return the NEW values, not the old
    /// ones). A FAILED rotation publishes nothing, so a waiter falls through
    /// to the cooldown guard and is rejected exactly as it is today; there is
    /// no error to hand out, and inventing one would need `AppError: Clone`
    /// just to relabel it.
    last: Option<(u64, RotateResult)>,
}

impl RotateSlot {
    /// The generation and result of a rotation that COMPLETED after a caller
    /// which snapshotted the generation as `key` arrived — i.e. "coalesce onto
    /// this instead of rotating again". `None` means this caller is the one
    /// that has to do the work (or that whatever happened is older than its own
    /// arrival).
    fn completed_since(&self, key: u64) -> Option<(u64, &RotateResult)> {
        self.last
            .as_ref()
            .filter(|(generation, _)| *generation > key)
            .map(|(generation, result)| (*generation, result))
    }

    /// Publish a finished rotation. Must be called while holding `rotate_flight`
    /// and AFTER the new headers are installed, so a waiter can never observe
    /// a result that is not yet the identity the client is actually using.
    fn publish(&mut self, generation: u64, result: RotateResult) {
        self.last = Some((generation, result));
    }
}

#[derive(Debug, Clone, Serialize)]
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
            rotate_flight: Mutex::new(RotateSlot::default()),
            rotate_generation: AtomicU64::new(0),
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
    // NOTE: `state.client()` moved ABOVE the cooldown guard. It has to: the
    // single-flight key lives on the client. Behaviour delta is an error-code
    // swap in a doubly-broken state (client not yet constructed AND inside the
    // cooldown) — `NotInitialized` is the more accurate of the two, and neither
    // branch ever rotated anything.

    // --- P1-008: single-flight + idempotency key -----------------------------
    //
    // Before this, two concurrent callers produced: winner = new device
    // identity, loser = `Err("rotate_api_params rate limited: 60s cooldown")`,
    // raised by `try_acquire_rotate_permit`. The rate-limit guard prevented a
    // duplicate rotation but it could not tell the loser that a rotation
    // carrying exactly the answer it asked for had just completed — so the
    // user-visible result was a spurious failure toast next to a successful
    // one. Realistic trigger: the "Grindr blocks your requests" dialog fires
    // `rotate_api_params` while anything else in the app decides to rotate too,
    // and both land inside the same few milliseconds.
    //
    // Order matters and is the reverse of the guard's: snapshot the key ->
    // queue on the gate -> coalesce if someone beat us -> only then spend a
    // permit. A coalesced caller consumes no cooldown, so it cannot starve a
    // genuine rotation, and it never touches the keyring.
    let client = state.client()?;
    let idempotency_key = client.rotate_generation.load(Ordering::SeqCst);
    let mut slot = client.rotate_flight.lock().await;

    if let Some((generation, result)) = slot.completed_since(idempotency_key) {
        // A rotation that started after we arrived has already finished. Its
        // result IS the identity installed on the client right now, so this is
        // not a stale read — it is the correct answer, and the same one the
        // winner is about to receive.
        eprintln!(
            "[client] rotate_api_params: coalesced onto rotation gen {generation} \
             (my snapshot was {idempotency_key}); returning its result without \
             rotating and without spending a cooldown permit"
        );
        return Ok(result.clone());
    }

    // Rate limit: max 1 rotation per 60 seconds. This is still the outer bound
    // on how often a rotation may START; the single-flight above is what stops
    // callers fighting over it. (The old comment here claimed "with exponential
    // backoff after retries" — there is no retry loop and never was; a caller
    // that fails is simply told so. See the P1-008 audit on
    // `AppState::try_acquire_rotate_permit`.)
    state.try_acquire_rotate_permit()?;

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
    //
    // It is also what wakes a WebSocket that P1-004 parked: an exhausted
    // reconnect budget is replenished by the next `auth_notify` poke, so a
    // rotation doubles as a "the network changed, try again" signal.
    state.bump_ws_epoch();
    state.auth_notify.notify_one();

    let result = RotateResult {
        user_agent: new_ua,
        l_device_info: new_device_info,
    };

    // Publish LAST, under the gate we still hold: a caller waiting on
    // `rotate_flight` must not be able to observe a result for a rotation that
    // has not finished swapping `http`/`user_agent` yet, nor one whose epoch
    // bump has not happened. Bumping the generation here — after the work, not
    // before it — is what makes "started after I arrived" mean "completed
    // while I waited".
    let generation = client.rotate_generation.fetch_add(1, Ordering::SeqCst) + 1;
    slot.publish(generation, result.clone());
    eprintln!("[client] rotate_api_params: completed rotation gen {generation}");

    Ok(result)
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

    fn sample(id: &str) -> RotateResult {
        RotateResult {
            user_agent: format!("ua-{id}"),
            l_device_info: format!("di-{id}"),
        }
    }

    /// P1-008 acceptance criterion "idempotency key": a caller that snapshotted
    /// generation `k` and finds a rotation published at a HIGHER generation has
    /// already been served — it must return that result rather than rotate
    /// again. This is the exact decision `rotate_api_params` makes on the
    /// coalescing path.
    #[test]
    fn concurrent_caller_coalesces_onto_the_in_flight_rotation() {
        let mut slot = RotateSlot::default();

        // Nobody has rotated yet: this caller must do the work itself.
        assert!(slot.completed_since(0).is_none());

        // The winner finishes and publishes generation 1.
        slot.publish(1, sample("winner"));

        // The loser snapshotted the generation BEFORE the winner published, so
        // it coalesces onto the winner's result...
        let loser_key = 0;
        let coalesced = slot
            .completed_since(loser_key)
            .expect("a rotation that completed after the caller's arrival must satisfy it");

        // ...and receives the SAME values the winner returns, which are the
        // values now installed on the client (FIX 6: new values, not old).
        // Compared field-wise rather than with `assert_eq!` on the struct so
        // `RotateResult` does not need a `PartialEq` impl added to its public
        // derive list for the sake of a test.
        assert_eq!(coalesced.1.user_agent, "ua-winner");
        assert_eq!(coalesced.1.l_device_info, "di-winner");
        assert_eq!(coalesced.0, 1, "coalescing must report the generation it joined");
    }

    /// The complementary case: a caller that arrives AFTER the rotation
    /// completed snapshotted the NEW generation, so it is not coalesced and
    /// proceeds to the cooldown guard. Without the strict `>` this would return
    /// a stale answer forever and the cooldown would never fire.
    #[test]
    fn caller_arriving_after_completion_is_not_coalesced() {
        let mut slot = RotateSlot::default();
        slot.publish(1, sample("first"));
        assert!(
            slot.completed_since(1).is_none(),
            "arriving after the publish must not be treated as satisfied by it"
        );
        assert!(slot.completed_since(0).is_some(), "...but an earlier arrival must be");
    }

    /// A second, later rotation supersedes the first for callers that were
    /// waiting across both, and the slot never accumulates more than one result.
    #[test]
    fn newest_rotation_supersedes_the_previous_one() {
        let mut slot = RotateSlot::default();
        slot.publish(1, sample("first"));
        slot.publish(2, sample("second"));
        assert_eq!(slot.completed_since(0).unwrap().1.user_agent, "ua-second");
        assert_eq!(slot.completed_since(1).unwrap().1.user_agent, "ua-second");
        assert!(slot.completed_since(2).is_none());
    }
}
