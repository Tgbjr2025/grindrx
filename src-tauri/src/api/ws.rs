use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};

use crate::error::AppError;
use crate::state::AppState;

const WS_URL: &str = "wss://grindr.mobi/v1/ws";
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(45);
/// Cap the TCP+TLS+WS handshake. Without this, a half-open connection
/// (common on Android Doze / captive portals) wedges the reconnect loop forever.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Base of the reconnect ladder: the delay before the first retry, and the
/// value the ladder is reset to once a connection proves itself (see
/// `note_liveness`). Named because `run_ws_loop` now reads the *current* value
/// of the ladder to tell "no penalty accrued yet" from "we have been failing".
const INITIAL_BACKOFF: Duration = Duration::from_secs(1);

/// P1-004: ceiling on the base backoff ladder. The ladder doubles from
/// `INITIAL_BACKOFF`; without a ceiling an outage that lasts long enough walks
/// it into the hours and the socket never returns within the process lifetime.
/// This is the cap the register asks for. Note the ladder is jittered *before*
/// it is slept (see `jitter`), so an actual sleep at the ceiling lands in
/// 0.8x..1.2x of this value, i.e. 48..72s — the ceiling bounds the ladder, the
/// jitter is deliberately allowed to spill past it, because spreading a fleet
/// that is recovering from one server blip is worth more than a hard wall-clock
/// bound (that is the whole reason `jitter` exists).
const MAX_BACKOFF: Duration = Duration::from_secs(60);

/// P1-004: how many CONSECUTIVE failed connection cycles the loop will spend
/// before it gives up and parks. Default 10, which at the ladder above is
/// 1+2+4+8+16+32+60*4 = 303s of base backoff (~4..6 min with jitter) — long
/// enough to ride out a tunnel, a captive portal or an Android Doze window,
/// short enough that a genuinely dead endpoint stops burning radio + battery
/// for the rest of the session. Override per-process with the env var below.
const DEFAULT_MAX_RECONNECT_ATTEMPTS: u32 = 10;

/// P1-004: operator override for `DEFAULT_MAX_RECONNECT_ATTEMPTS`. `0` means
/// UNBOUNDED, which restores the pre-fix infinite-retry behaviour for anyone
/// who needs it (field debug on a device that legitimately stays offline for
/// hours) without a rebuild. Parsed once per process.
const MAX_RECONNECT_ATTEMPTS_ENV: &str = "GRINDX_WS_MAX_RECONNECT_ATTEMPTS";

/// Terminal event emitted when the reconnect budget is exhausted, so the
/// frontend can surface "the socket gave up" instead of leaving the user with a
/// permanently greyed-out connection status and no explanation.
///
/// Payload shape (stable — the WebView is the only consumer and it is not
/// written yet):
/// ```json
/// { "attempts": 10, "maxAttempts": 10, "backoffSecs": 60,
///   "lastError": "HTTP error: WS connection closed by server" }
/// ```
/// `maxAttempts` is always a number: the event cannot fire on the unbounded
/// setting, because there is nothing to exhaust. `backoffSecs` is the ladder
/// value at the moment of giving up, not the next sleep (there is no next
/// sleep — the loop is parked). Recovery is external: a `login`, a
/// `ws_connect` invoke, or a `rotate_api_params` (all three poke `auth_notify`)
/// replenishes the budget and restarts the ladder.
const RECONNECT_EXHAUSTED_EVENT: &str = "ws:reconnect_exhausted";

/// B2: body used instead of the real content while the app lock is engaged.
/// Must carry no user content — it is rendered on a locked screen.
const LOCKED_NOTIFICATION_BODY: &str = "Open GrindrX to see your new activity";

/// Outcome of `run_message_loop` / `connect_and_run`.
/// Distinguishes a clean shutdown (command channel closed) from a
/// transient disconnect (server close or network error) so the outer
/// loop knows whether to reconnect or exit.
#[derive(Debug)]
enum WsOutcome {
    /// The command-sender side was dropped — no point reconnecting.
    ChannelClosed,
    /// Server sent a close frame or the connection dropped — should reconnect.
    Disconnected(AppError),
}

#[derive(Debug, Deserialize)]
pub struct WsCommand {
    pub r#type: String,
    /// Incoming commands from the WebView arrive as `ref_id`, but the outgoing
    /// frame must use `ref`. The previous `#[serde(rename = "ref")]` with no
    /// alias made the IPC deserializer require `ref`, so EVERY `ws_send` call
    /// failed with `missing field 'ref'` -> `InvalidArgs`. It was latent only
    /// because the frontend never called `ws.send()`; it is a landmine for the
    /// first typing/tap feature. The rename was only ever needed for the
    /// outgoing frame, which is hand-built with `serde_json::json!` and never
    /// used this type's `Serialize` impl (hence `Serialize` is now removed).
    #[serde(rename = "ref", alias = "ref_id")]
    pub ref_id: String,
    pub payload: Value,
}

pub fn spawn_ws_task(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        run_ws_loop(app).await;
    });
}

/// Scale a backoff duration by a random factor in the range 0.8 to 1.2.
fn jitter(d: Duration) -> Duration {
    let factor = 0.8 + rand::random::<f64>() * 0.4;
    d.mul_f64(factor)
}

/// P1-004: the reconnect budget, resolved once per process.
/// `Some(n)` = stop after `n` consecutive failures, `None` = unbounded.
/// An unparseable value falls back to the default rather than silently
/// disabling the cap: a typo in a debug env var must not quietly reintroduce
/// the infinite retry loop this was added to stop.
fn max_reconnect_attempts() -> Option<u32> {
    static BUDGET: OnceLock<Option<u32>> = OnceLock::new();
    *BUDGET.get_or_init(|| {
        parse_max_reconnect_attempts(std::env::var(MAX_RECONNECT_ATTEMPTS_ENV).ok().as_deref())
    })
}

/// Pure half of `max_reconnect_attempts`, split out so the "what does a bad
/// value do" decision is testable without mutating the real process
/// environment (which `OnceLock` would freeze for every later test).
fn parse_max_reconnect_attempts(raw: Option<&str>) -> Option<u32> {
    match raw {
        None => Some(DEFAULT_MAX_RECONNECT_ATTEMPTS),
        Some(raw) => match raw.trim().parse::<u32>() {
            // Explicit opt-out back to the pre-fix infinite retry.
            Ok(0) => None,
            Ok(n) => Some(n),
            // Empty string, a negative number, "ten", a trailing "s" — all of
            // these mean the operator believes they configured something. Fall
            // back to the default and say so, rather than treating the cap as
            // disabled.
            Err(_) => {
                eprintln!(
                    "[ws] ignoring {MAX_RECONNECT_ATTEMPTS_ENV}={raw:?} (not a non-negative \
                     integer); using default {DEFAULT_MAX_RECONNECT_ATTEMPTS}"
                );
                Some(DEFAULT_MAX_RECONNECT_ATTEMPTS)
            }
        },
    }
}

/// P1-004: how many consecutive failed connection cycles the loop may spend
/// before it gives up, and whether it is currently parked.
///
/// Kept as a type rather than two loose locals in `run_ws_loop` because the
/// acceptance criterion is "max attempts configured", and this is the thing
/// that makes that claim checkable rather than asserted.
struct ReconnectBudget {
    /// `None` = unbounded (operator opt-out via the env var).
    max: Option<u32>,
    attempts: u32,
    /// True between giving up and the next external wake. The loop parks on
    /// `auth_notify.notified()` while set, WITHOUT the self-`notify_one()` the
    /// retry path uses, so it cannot wake itself — the budget is only ever
    /// replenished by something outside this task.
    parked: bool,
}

impl ReconnectBudget {
    fn new(max: Option<u32>) -> Self {
        Self {
            max,
            attempts: 0,
            parked: false,
        }
    }

    /// The connection that just ended carried real traffic, so what we are
    /// looking at is the FIRST failure of a new outage rather than the tail of
    /// an old one. Without this, an app that reconnects successfully every few
    /// hours (exactly what a backgrounded phone on a flaky network does) would
    /// eventually park itself for good on a cumulative count.
    fn note_live_connection(&mut self) {
        self.attempts = 0;
    }

    /// `NotInitialized` / `Auth`: there is nothing to connect with *yet*. Not a
    /// transport failure, so not charged — the loop parks on `auth_notify`
    /// until a login arrives, and counting these would let one session's missing
    /// credential exhaust a later session's budget.
    fn note_auth_wait(&mut self) {
        self.attempts = 0;
    }

    /// Something outside this task poked `auth_notify` while we were parked
    /// (a `login`, a `ws_connect` invoke, or a `rotate_api_params`). All three
    /// mean "try again", with a full budget and a reset ladder.
    fn replenish(&mut self) {
        self.attempts = 0;
        self.parked = false;
    }

    /// Charge one failed connection cycle. Returns true when the budget is
    /// spent and the loop must park. Saturating so a `u32::MAX` budget cannot
    /// wrap into "attempts = 0" and hand itself a free retry.
    fn charge_failure(&mut self) -> bool {
        self.attempts = self.attempts.saturating_add(1);
        let spent = matches!(self.max, Some(max) if self.attempts >= max);
        if spent {
            self.parked = true;
        }
        spent
    }

    fn attempts(&self) -> u32 {
        self.attempts
    }

    fn is_parked(&self) -> bool {
        self.parked
    }
}

/// A live frame from the server is the only evidence that a connection is
/// healthy, so it is the single place that both resets the ladder and marks
/// the connection as having proven itself. `stable` is read back by
/// `run_ws_loop` to decide whether a later disconnect starts a NEW outage
/// (fresh budget) or continues the current one.
fn note_liveness(backoff: &mut Duration, stable: &mut bool) {
    *backoff = INITIAL_BACKOFF;
    *stable = true;
}

async fn run_ws_loop(app: AppHandle) {
    let state = app.state::<AppState>();
    let mut backoff = INITIAL_BACKOFF;

    // P1-004: this loop used to be `loop { connect; sleep(jitter(backoff)); backoff =
    // min(backoff*2, 30s) }` with no counter anywhere, so a dead endpoint meant one
    // wakeup every 30s for the entire life of the process — and `ws:disconnected`
    // was re-emitted on every one of them, which is indistinguishable from a
    // momentary blip to the frontend. The loop is now bounded and says so.
    let max_attempts = max_reconnect_attempts();
    match max_attempts {
        Some(n) => eprintln!(
            "[ws] reconnect budget: {n} consecutive attempts, backoff ceiling {}s \
             (set {MAX_RECONNECT_ATTEMPTS_ENV}=0 for unbounded)",
            MAX_BACKOFF.as_secs()
        ),
        None => eprintln!(
            "[ws] {MAX_RECONNECT_ATTEMPTS_ENV}=0: reconnect attempts are UNBOUNDED \
             (pre-P1-004 behaviour)"
        ),
    }

    let mut budget = ReconnectBudget::new(max_attempts);

    loop {
        state.auth_notify.notified().await;

        if budget.is_parked() {
            // Reaching here means `auth_notify` fired, and the parked loop never
            // notifies itself — so this is a login, a `ws_connect` invoke, or a
            // `rotate_api_params`.
            budget.replenish();
            backoff = INITIAL_BACKOFF;
            eprintln!("[ws] reconnect budget replenished by an external wake — retrying");
        }

        // Did the connection that is ending right now carry real traffic?
        let mut stable = false;

        match connect_and_run(&app, &mut backoff, &mut stable).await {
            WsOutcome::ChannelClosed => {
                // Command sender dropped — application is shutting down.
                break;
            }
            WsOutcome::Disconnected(e @ (AppError::NotInitialized | AppError::Auth(_))) => {
                eprintln!("[ws] auth error, waiting for login: {e}");
                app.emit("ws:disconnected", ()).ok();
                backoff = INITIAL_BACKOFF;
                budget.note_auth_wait();
            }
            WsOutcome::Disconnected(e) => {
                eprintln!("[ws] error: {e}");
                app.emit("ws:disconnected", ()).ok();

                if stable {
                    budget.note_live_connection();
                }

                if budget.charge_failure() {
                    let attempts = budget.attempts();
                    eprintln!(
                        "[ws] giving up after {attempts} consecutive reconnect attempts \
                         (last error: {e}); parked until login / ws_connect / rotation"
                    );
                    app.emit(
                        RECONNECT_EXHAUSTED_EVENT,
                        serde_json::json!({
                            "attempts": attempts,
                            "maxAttempts": max_attempts,
                            "backoffSecs": backoff.as_secs(),
                            "lastError": e.to_string(),
                        }),
                    )
                    .ok();
                    // NO `auth_notify.notify_one()` here — that call is what
                    // makes this loop retry itself, and calling it here would
                    // resurrect the infinite loop this budget exists to stop.
                    continue;
                }

                state.auth_notify.notify_one();
                // Jitter the backoff. A deterministic 1->2->4 ladder means a fleet
                // disconnected by one server blip retries in lockstep and hammers
                // the server again the instant it recovers. +/-20% randomises it.
                let jittered = jitter(backoff);
                sleep(jittered).await;
                backoff = (backoff * 2).min(MAX_BACKOFF);
            }
        }
    }
}

async fn connect_and_run(
    app: &AppHandle,
    backoff: &mut Duration,
    stable: &mut bool,
) -> WsOutcome {
    let state = app.state::<AppState>();

    // Snapshot the session epoch BEFORE we start using credentials. Everything
    // below (token fetch, backoff, the up-to-15s handshake) happens under this
    // snapshot; if the epoch moves while we are connecting, the token we captured
    // and the socket we are about to open both belong to a session that no
    // longer exists, and we must bail rather than emit `ws:connected` and start
    // delivering another account's events.
    let connect_epoch = state.ws_epoch();

    // --- Build authorization header ---
    let authorization = match state.client() {
        Err(e) => return WsOutcome::Disconnected(e),
        Ok(c) => match c.authorization_header().await {
            Some(h) => h,
            None => return WsOutcome::Disconnected(AppError::Auth("Not logged in".to_owned())),
        },
    };

    // Re-check after the (potentially slow) token fetch/refresh.
    if state.ws_epoch() != connect_epoch {
        return WsOutcome::Disconnected(AppError::Auth("Session ended".to_owned()));
    }

    let mut request = match WS_URL.into_client_request() {
        Ok(r) => r,
        Err(e) => {
            return WsOutcome::Disconnected(AppError::Http(format!(
                "Failed to build WS request: {e}"
            )))
        }
    };

    {
        let headers = request.headers_mut();
        let auth_hv = match HeaderValue::from_str(&authorization) {
            Ok(v) => v,
            Err(e) => {
                return WsOutcome::Disconnected(AppError::Http(format!(
                    "Invalid auth header: {e}"
                )))
            }
        };
        headers.insert("Authorization", auth_hv);

        let ua = match state.client() {
            Ok(c) => c.user_agent.read().await.clone(),
            Err(e) => return WsOutcome::Disconnected(e),
        };
        let ua_hv = match HeaderValue::from_str(&ua) {
            Ok(v) => v,
            Err(e) => {
                return WsOutcome::Disconnected(AppError::Http(format!(
                    "Invalid user-agent: {e}"
                )))
            }
        };
        headers.insert("User-Agent", ua_hv);
    }

    // Cap frame/message size. tungstenite's defaults are 16 MiB frame / 64 MiB
    // message, and every text frame is JSON-parsed into a Value and re-emitted
    // to the WebView, so a single large frame is a large allocation plus a large
    // IPC payload. Real chat frames are tiny.
    // `WebSocketConfig` is `#[non_exhaustive]`, so it cannot be built with a
    // struct literal (not even with `..Default::default()`); start from
    // `default()` and assign the fields.
    let mut ws_config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default();
    ws_config.max_message_size = Some(1024 * 1024);
    ws_config.max_frame_size = Some(1024 * 1024);

    let (ws_stream, _) = match timeout(
        CONNECT_TIMEOUT,
        // 4 args: (request, config, disable_nagle, connector). `false` matches
        // the `disable_nagle` that plain `connect_async` used before the frame
        // cap was added, and `None` keeps the crate's default TLS connector.
        connect_async_tls_with_config(request, Some(ws_config), false, None),
    )
    .await
    {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            return WsOutcome::Disconnected(AppError::Http(format!("WS connect failed: {e}")))
        }
        Err(_) => {
            return WsOutcome::Disconnected(AppError::Http(format!(
                "WS connect timed out after {}s",
                CONNECT_TIMEOUT.as_secs()
            )))
        }
    };

    // The handshake can take up to CONNECT_TIMEOUT (15s). A `logout` or account
    // switch during that window invalidates the token we just used, so check the
    // epoch BEFORE announcing the connection and before the message loop starts
    // emitting frames. This is the case the old `Notify` silently dropped.
    if state.ws_epoch() != connect_epoch {
        return WsOutcome::Disconnected(AppError::Auth("Session ended".to_owned()));
    }

    app.emit("ws:connected", ()).ok();
    // FIX (ws-backoff-reset-on-handshake): do NOT reset backoff here. A
    // successful handshake is not evidence the connection is healthy — a
    // server that accepts then immediately closes (app-layer auth rejection,
    // load-shedding) would defeat exponential backoff if every handshake
    // reset it to 1s. Backoff is instead reset once the connection proves
    // itself alive, on the first frame actually received from the server
    // (see run_message_loop below).

    let (mut write, mut read) = ws_stream.split();

    // Borrow the receiver without consuming it (FIX 1).
    let mut guard = state.ws_rx.lock().await;
    let cmd_rx = match guard.as_mut() {
        Some(rx) => rx,
        None => {
            return WsOutcome::Disconnected(AppError::Http("WS already running".to_owned()))
        }
    };

    let our_profile_id = match state.client() {
        Ok(c) => c
            .session
            .read()
            .await
            .as_ref()
            .map(|s| s.profile_id.clone())
            .unwrap_or_default(),
        Err(_) => String::new(),
    };

    run_message_loop(&mut write, &mut read, cmd_rx, &our_profile_id, app, backoff, stable).await
    // `guard` (and thus the receiver) is dropped here, releasing the lock.
}

async fn run_message_loop(
    write: &mut (impl SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
    read: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin),
    cmd_rx: &mut tokio::sync::mpsc::Receiver<WsCommand>,
    our_profile_id: &str,
    app: &AppHandle,
    backoff: &mut Duration,
    stable: &mut bool,
) -> WsOutcome {
    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.tick().await; // consume the immediate first tick

    // FIX 1: track pong state here instead of blocking read.next() in the heartbeat arm.
    // When true, the next heartbeat tick without a Pong means the connection is dead.
    let mut waiting_for_pong = false;

    // ws-not-torn-down-on-logout: the session epoch this connection was opened
    // under. `logout`/`login` bump it, and any mismatch means this socket is
    // stale (or belongs to a previous account), so we drop it.
    //
    // An epoch rather than a `Notify` because `notify_waiters()` only wakes
    // waiters registered at that instant and stores no permit — a logout during
    // the backoff sleep or the 15s connect handshake was silently dropped and
    // the socket then ran on with the pre-logout token.
    let state = app.state::<AppState>();
    let connected_epoch = state.ws_epoch();
    let ws_reset_notify = state.ws_reset_notify.clone();

    loop {
        // B1: the epoch is the ONLY thing that makes this socket stale, and it
        // must be checked unconditionally. The `ws_reset_notify` arm below is a
        // *lossy* wakeup: `Notify::notify_waiters()` stores no permit, so a
        // `logout`/`login` that lands while this task is running another arm
        // (JSON parse + `app.emit` + a platform notification, or a burst of
        // inbound frames) never wakes it. Without this check the socket stays
        // up, keeps emitting the previous account's `grindr:*` events to the
        // WebView, and keeps posting that account's message previews to the
        // notification shade until the server happens to close the socket.
        if state.ws_epoch() != connected_epoch {
            return WsOutcome::Disconnected(AppError::Auth("Session ended".to_owned()));
        }

        // `biased` with the read arm first: a Pong already sitting in the queue
        // MUST be seen before the heartbeat tick declares the connection dead.
        // `tokio::select!` otherwise picks a ready branch at RANDOM, so a Pong
        // landing in the same poll iteration as the tick could be ignored and a
        // perfectly healthy connection torn down (then fully reconnected).
        tokio::select! {
            biased;
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        // ws-backoff-reset-on-handshake: a real frame from the
                        // server (not just a completed handshake) is what proves
                        // the connection is stable — reset here, not on connect.
                        // P1-004: same signal replenishes the reconnect budget.
                        note_liveness(backoff, stable);
                        if let Ok(val) = serde_json::from_str::<Value>(&text) {
                            if let Some(event_type) = val["type"].as_str() {
                                let safe_type = event_type.replace('.', "_");
                                app.emit(&format!("grindr:{safe_type}"), &val).ok();

                                // Background notifications. The WS loop keeps running while the
                                // app is backgrounded — the Android foreground service keeps the
                                // process (and thus this tokio task) alive — so we post system
                                // notifications for message/tap events the user hasn't seen.
                                if !app
                                    .state::<crate::state::AppState>()
                                    .is_foreground
                                    .load(Ordering::Relaxed)
                                {
                                    // Only notify if someone ELSE sent this. senderId can arrive as
                                    // a JSON string or number depending on the event shape; handle
                                    // both so our own actions never self-notify.
                                    let sender_is_self = match &val["payload"]["senderId"] {
                                        Value::String(s) => s.as_str() == our_profile_id,
                                        Value::Number(n) => n.to_string() == our_profile_id,
                                        _ => false,
                                    };
                                    if !sender_is_self {
                                        match event_type {
                                            "chat.v1.message_sent" => maybe_notify_message(app, &val),
                                            "tap.v1.tap_sent" => maybe_notify_tap(app, &val),
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        // The server pinging us is real bidirectional traffic too.
                        note_liveness(backoff, stable);
                        if let Err(e) = write.send(Message::Pong(data)).await {
                            return WsOutcome::Disconnected(AppError::Http(e.to_string()));
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {
                        // A Pong answering our own heartbeat Ping is the "first
                        // successful heartbeat round-trip" stability signal.
                        note_liveness(backoff, stable);
                        // FIX 1: clear the flag — pong arrived in the normal message loop.
                        waiting_for_pong = false;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        // FIX 2: server close → reconnect, not exit. Deliberately
                        // NOT a backoff-reset point — a Close (possibly the very
                        // first frame, i.e. accept-then-close) is the disconnect
                        // itself, not evidence of a stable connection.
                        return WsOutcome::Disconnected(AppError::Http(
                            "WS connection closed by server".to_owned(),
                        ));
                    }
                    Some(Err(e)) => {
                        return WsOutcome::Disconnected(AppError::Http(e.to_string()));
                    }
                    Some(Ok(_)) => {
                        // Any other frame kind (e.g. Binary) still proves liveness.
                        note_liveness(backoff, stable);
                    }
                }

                // B1: re-check AFTER the frame work. Handling one frame is not
                // instantaneous (JSON parse, `app.emit` into the WebView, and a
                // platform notification), and a `logout` landing in that window
                // has already been emitted to the WebView and already posted to
                // the shade. Dropping here bounds that to a single frame
                // instead of "until the server closes the socket".
                if state.ws_epoch() != connected_epoch {
                    return WsOutcome::Disconnected(AppError::Auth("Session ended".to_owned()));
                }
            },

            cmd = cmd_rx.recv() => match cmd {
                Some(cmd) => {
                    // Re-read the current session_id on every send. A mid-session
                    // token refresh (via authorization_header) updates state.session
                    // but a one-shot snapshot would keep sending the now-invalid id.
                    let current_session_id = match app.state::<AppState>().client() {
                        Ok(c) => match c.session.read().await.as_ref().map(|s| s.session_id.clone()) {
                            Some(id) => id,
                            None => {
                                return WsOutcome::Disconnected(AppError::Auth(
                                    "Session cleared during WS loop".to_owned(),
                                ))
                            }
                        },
                        Err(e) => return WsOutcome::Disconnected(e),
                    };
                    let json = serde_json::json!({
                        "type": cmd.r#type,
                        "ref": cmd.ref_id,
                        "token": current_session_id,
                        "payload": cmd.payload,
                    });
                    if let Err(e) = write.send(Message::Text(json.to_string().into())).await {
                        return WsOutcome::Disconnected(AppError::Http(e.to_string()));
                    }
                }
                // FIX 2: channel closed → real shutdown, break the outer loop
                None => return WsOutcome::ChannelClosed,
            },

            // FIX 1 + Android Doze: periodic heartbeat.
            // Send a Ping and set the flag. If the flag is ALREADY set when the
            // timer fires again, that means no Pong arrived in a full interval —
            // treat the connection as dead. Real messages (including Pong) are
            // handled in the read arm above and are never dropped.
            _ = heartbeat.tick() => {
                if waiting_for_pong {
                    return WsOutcome::Disconnected(AppError::Http(
                        "WS heartbeat timeout — no pong received".to_owned(),
                    ));
                }
                if let Err(e) = write.send(Message::Ping(vec![].into())).await {
                    return WsOutcome::Disconnected(AppError::Http(e.to_string()));
                }
                waiting_for_pong = true;
            }

            // ws-not-torn-down-on-logout: the session changed under us
            // (`logout`, or `login` for an account switch) — drop this socket
            // rather than keep emitting the previous session's events. The
            // outer loop (run_ws_loop) treats AppError::Auth as "wait for the
            // next login", which is exactly what we want here.
            _ = ws_reset_notify.notified() => {
                // Wakeup hint only; the epoch decides. A stale wakeup is a no-op.
                if state.ws_epoch() != connected_epoch {
                    return WsOutcome::Disconnected(AppError::Auth(
                        "Session ended".to_owned(),
                    ));
                }
            }
        }
    }
}

/// Build a short, human-readable preview for a `chat.v1.message_sent` payload.
fn message_preview(val: &Value) -> String {
    match val["payload"]["type"].as_str() {
        Some("Text") => val["payload"]["body"]["text"]
            .as_str()
            .unwrap_or("New message")
            .chars()
            .take(80)
            .collect::<String>(),
        Some("Image") | Some("ExpiringImage") => "Sent you a photo".to_owned(),
        Some("Album") | Some("ExpiringAlbum") | Some("ExpiringAlbumV2") => {
            "Shared an album".to_owned()
        }
        Some("Audio") => "Sent you a voice message".to_owned(),
        Some("Video") | Some("PrivateVideo") | Some("NonExpiringVideo") => {
            "Sent you a video".to_owned()
        }
        Some("Gaymoji") => "Sent you a Gaymoji".to_owned(),
        Some("Giphy") => "Sent you a GIF".to_owned(),
        Some("Location") => "Shared a location".to_owned(),
        _ => "New message".to_owned(),
    }
}

/// Posts a system notification for an incoming chat message.
///
/// `chat.v1.message_sent` payload is a Message (see docs messaging/messages):
/// it carries `conversationId` and a numeric `senderId` but no display name,
/// so the title is the app name. The conversationId is appended to the body's
/// hidden tail and (more importantly) emitted so the frontend deep-link handler
/// can route a tap to /chat/{conversationId}.
fn maybe_notify_message(app: &AppHandle, val: &Value) {
    let state = app.state::<crate::state::AppState>();
    // B2 LOCK GATE: an engaged app lock means the device is very likely locked
    // too, and Android renders a notification's `body` in full on the lock
    // screen. Do not leak chat text. Do not remove without first setting the
    // `grindx_messages` channel to VISIBILITY_PRIVATE/SECRET.
    if state.is_locked() {
        return;
    }
    // Stay silent until the WebView has pushed the real preferences. They used
    // to default to `true` in Rust and were corrected only after an async file
    // read, so a message arriving during startup fired a notification the user
    // had explicitly turned off.
    if !state.prefs_loaded.load(Ordering::SeqCst) {
        return;
    }
    if !state.notify_messages.load(Ordering::Relaxed) {
        return;
    }
    let body = message_preview(val);
    let conversation_id = val["payload"]["conversationId"].as_str().unwrap_or("");

    post_notification(app, "GrindrX", &body, conversation_id);
}

/// Posts a system notification for an incoming tap (`tap.v1.tap_sent`).
/// The tap payload includes `senderDisplayName`, so we can use it as the title.
fn maybe_notify_tap(app: &AppHandle, val: &Value) {
    let state = app.state::<crate::state::AppState>();
    // B2 LOCK GATE: same as `maybe_notify_message` — the tap title is the
    // sender's display name, which is also user content. Do not remove.
    if state.is_locked() {
        return;
    }
    if !state.prefs_loaded.load(Ordering::SeqCst) {
        return;
    }
    if !state.notify_taps.load(Ordering::Relaxed) {
        return;
    }
    let title = val["payload"]["senderDisplayName"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or("GrindrX");
    // Taps don't belong to a conversation; route a tap to the taps screen.
    post_notification(app, title, "sent you a tap", "");
}

/// Shared notification poster. Uses the existing `grindx_messages` Android
/// channel created in MainActivity. Also emits a `notification:posted` event so
/// the (foreground) webview / a deep-link handler can record the target
/// conversation; the native tap routing is handled in MainActivity via the
/// notification intent's `conversationId` extra (see REPORT — needs frontend wiring).
///
/// B2 LOCK GATE (defence in depth): both callers already early-return while the
/// app lock is engaged, but this is the one function that actually posts, so the
/// gate is repeated here — a future caller that forgets it still cannot put chat
/// text on a locked screen. Do not remove.
///
/// Visibility is deliberately NOT set here: `tauri-plugin-notification`'s
/// `NotificationBuilder` has no `visibility()` setter (verified in 2.3.3 — it
/// exists only on `ChannelBuilder`), so per-notification visibility is not
/// reachable from Rust. The `grindx_messages` channel in
/// `MainActivity.createNotificationChannel()` must be created with
/// `setVisibility(Notification.VISIBILITY_PRIVATE)`; that is a Kotlin change and
/// is tracked as a required follow-up.
fn post_notification(app: &AppHandle, title: &str, body: &str, conversation_id: &str) {
    let body = if app.state::<AppState>().is_locked() {
        LOCKED_NOTIFICATION_BODY
    } else {
        body
    };
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .channel_id("grindx_messages")
        .show()
        .ok();

    if !conversation_id.is_empty() {
        app.emit(
            "notification:posted",
            serde_json::json!({ "conversationId": conversation_id }),
        )
        .ok();
    }
}

#[tauri::command]
pub async fn ws_connect(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    // FIX 7: use async read() to avoid silently returning None while a write lock is held
    let has_session = match state.client() {
        Ok(c) => c.session.read().await.is_some(),
        Err(_) => false,
    };

    if has_session {
        state.auth_notify.notify_one();
    }
    Ok(())
}

#[tauri::command]
pub async fn ws_send(
    state: tauri::State<'_, AppState>,
    command: WsCommand,
) -> Result<(), AppError> {
    // FIX 4: reject the command immediately if no session exists — prevents
    // queuing messages against an unauthenticated / unconnected socket and
    // giving false Ok back to the caller.
    let _ = state
        .client()?
        .session
        .read()
        .await
        .as_ref()
        .ok_or_else(|| AppError::Auth("Not logged in".to_owned()))?;

    // The channel is bounded (64) and its receiver lives for the process
    // lifetime, so `send` never returns Err and the old "WS not connected"
    // error path was unreachable. With the socket down through a backoff (P1-004
    // raised the ceiling to `MAX_BACKOFF`, 60s) plus connect attempts, the 65th
    // command would await forever and the Tauri IPC promise would never settle
    // — a hung `await invoke("ws_send")` with no error and no timeout. Bound it,
    // and surface the timeout instead of hanging.
    const WS_SEND_TIMEOUT: Duration = Duration::from_secs(5);
    match tokio::time::timeout(WS_SEND_TIMEOUT, state.ws_tx.send(command)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err(AppError::Http("WS not connected".to_owned())),
        Err(_) => Err(AppError::Http(
            "WS send timed out — the socket is not accepting commands".to_owned(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// P1-004 acceptance criterion "max attempts configured": the loop must
    /// actually stop, and it must stop AT the configured number rather than
    /// one short or one long.
    #[test]
    fn budget_parks_exactly_at_the_configured_attempt_count() {
        let mut budget = ReconnectBudget::new(Some(3));
        assert!(!budget.charge_failure(), "attempt 1 of 3 must retry");
        assert!(!budget.charge_failure(), "attempt 2 of 3 must retry");
        assert!(budget.charge_failure(), "attempt 3 of 3 must park");
        assert_eq!(budget.attempts(), 3);
        assert!(budget.is_parked());
    }

    /// The default must be a real bound, not a token value. This is the
    /// regression guard for the actual defect: the pre-fix loop had NO counter
    /// and re-emitted `ws:disconnected` forever.
    #[test]
    fn default_budget_is_bounded_and_generous() {
        let mut budget = ReconnectBudget::new(Some(DEFAULT_MAX_RECONNECT_ATTEMPTS));
        for i in 1..DEFAULT_MAX_RECONNECT_ATTEMPTS {
            assert!(
                !budget.charge_failure(),
                "must not park before attempt {DEFAULT_MAX_RECONNECT_ATTEMPTS} (parked at {i})"
            );
        }
        assert!(budget.charge_failure());
    }

    /// The opt-out really is opt-out, and it is the ONLY way to get unbounded
    /// behaviour — a bad env value must not be able to produce it.
    #[test]
    fn env_var_controls_the_bound() {
        assert_eq!(parse_max_reconnect_attempts(None), Some(DEFAULT_MAX_RECONNECT_ATTEMPTS));
        assert_eq!(parse_max_reconnect_attempts(Some("0")), None, "0 = unbounded opt-out");
        assert_eq!(parse_max_reconnect_attempts(Some("7")), Some(7));
        assert_eq!(parse_max_reconnect_attempts(Some(" 7 ")), Some(7), "whitespace tolerated");
        // Garbage in must not silently disable the cap.
        for bad in ["", "  ", "-1", "ten", "10s", "1e3"] {
            assert_eq!(
                parse_max_reconnect_attempts(Some(bad)),
                Some(DEFAULT_MAX_RECONNECT_ATTEMPTS),
                "{bad:?} must fall back to the default bound, never to unbounded"
            );
        }

        let mut unbounded = ReconnectBudget::new(parse_max_reconnect_attempts(Some("0")));
        for _ in 0..10_000 {
            assert!(!unbounded.charge_failure());
        }
        assert!(!unbounded.is_parked());
    }

    /// A connection that carried traffic means the NEXT failure starts a new
    /// outage. Without this the count is cumulative over the whole process
    /// lifetime and a phone that reconnects fine all day eventually parks.
    #[test]
    fn live_traffic_replenishes_the_budget() {
        let mut budget = ReconnectBudget::new(Some(3));
        budget.charge_failure();
        budget.charge_failure();
        budget.note_live_connection();
        assert!(!budget.charge_failure(), "post-liveness failure is attempt 1 of 3");
        assert_eq!(budget.attempts(), 1);
    }

    /// An auth wait is not a transport failure and must not be charged —
    /// otherwise a signed-out hour burns the budget of the session that follows.
    #[test]
    fn auth_wait_is_not_charged() {
        let mut budget = ReconnectBudget::new(Some(2));
        budget.charge_failure();
        budget.note_auth_wait();
        assert_eq!(budget.attempts(), 0);
        assert!(!budget.charge_failure());
    }

    /// After parking, the budget is replenished ONLY by an external wake. This
    /// is the mechanism that makes the loop stop: while parked, `run_ws_loop`
    /// skips its own `auth_notify.notify_one()`, so nothing inside the task can
    /// wake it.
    #[test]
    fn parked_budget_needs_an_external_wake_to_restart() {
        let mut budget = ReconnectBudget::new(Some(1));
        assert!(budget.charge_failure());
        assert!(budget.is_parked());
        budget.replenish();
        assert!(!budget.is_parked());
        assert_eq!(budget.attempts(), 0);
    }

    /// A `u32::MAX` budget must not be able to wrap its own counter into a
    /// free retry — `saturating_add` is what prevents that.
    #[test]
    fn attempt_counter_cannot_wrap() {
        let mut budget = ReconnectBudget::new(Some(u32::MAX));
        budget.attempts = u32::MAX - 1;
        // Reaches the configured ceiling, so the budget IS spent here.
        assert!(budget.charge_failure());
        assert_eq!(budget.attempts(), u32::MAX);
        assert!(budget.is_parked());

        // The failure that must not happen: a further charge wrapping the
        // counter back to 0, which would both un-park the loop and reset the
        // count — an unbounded retry loop wearing a u32::MAX disguise.
        budget.replenish();
        budget.attempts = u32::MAX;
        budget.charge_failure();
        assert_eq!(
            budget.attempts(),
            u32::MAX,
            "counter must saturate at u32::MAX, never wrap to 0"
        );
    }

    /// Backoff ladder acceptance criterion: the base never exceeds the ceiling.
    /// Replays the exact expression in `run_ws_loop` (it is not extracted to a
    /// helper precisely to keep the loop readable — this test is what stops the
    /// two from drifting apart silently).
    #[test]
    fn backoff_ladder_is_capped() {
        let mut backoff = INITIAL_BACKOFF;
        for _ in 0..64 {
            assert!(
                backoff <= MAX_BACKOFF,
                "ladder base {backoff:?} escaped MAX_BACKOFF {MAX_BACKOFF:?}"
            );
            backoff = (backoff * 2).min(MAX_BACKOFF);
        }
        assert_eq!(backoff, MAX_BACKOFF);
    }

    /// Jitter may spill past the ceiling by up to 20% (documented in
    /// `MAX_BACKOFF`); it must never exceed that, and it must never invert the
    /// ladder into a zero-length sleep.
    #[test]
    fn jitter_stays_within_its_documented_band() {
        for _ in 0..1_000 {
            let j = jitter(MAX_BACKOFF);
            assert!(
                j >= MAX_BACKOFF.mul_f64(0.8) && j <= MAX_BACKOFF.mul_f64(1.2),
                "jitter(MAX_BACKOFF) = {j:?} outside the documented 0.8x..1.2x band"
            );
            assert!(jitter(INITIAL_BACKOFF) > Duration::ZERO);
        }
    }
}
