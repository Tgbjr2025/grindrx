use std::sync::atomic::Ordering;
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

async fn run_ws_loop(app: AppHandle) {
    let state = app.state::<AppState>();
    let mut backoff = Duration::from_secs(1);

    loop {
        state.auth_notify.notified().await;

        match connect_and_run(&app, &mut backoff).await {
            WsOutcome::ChannelClosed => {
                // Command sender dropped — application is shutting down.
                break;
            }
            WsOutcome::Disconnected(e @ (AppError::NotInitialized | AppError::Auth(_))) => {
                eprintln!("[ws] auth error, waiting for login: {e}");
                app.emit("ws:disconnected", ()).ok();
                backoff = Duration::from_secs(1);
            }
            WsOutcome::Disconnected(e) => {
                eprintln!("[ws] error: {e}");
                app.emit("ws:disconnected", ()).ok();
                state.auth_notify.notify_one();
                // Jitter the backoff. A deterministic 1->2->4 ladder means a fleet
                // disconnected by one server blip retries in lockstep and hammers
                // the server again the instant it recovers. +/-20% randomises it.
                let jittered = jitter(backoff);
                sleep(jittered).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
            }
        }
    }
}

async fn connect_and_run(app: &AppHandle, backoff: &mut Duration) -> WsOutcome {
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

    run_message_loop(&mut write, &mut read, cmd_rx, &our_profile_id, app, backoff).await
    // `guard` (and thus the receiver) is dropped here, releasing the lock.
}

async fn run_message_loop(
    write: &mut (impl SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
    read: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin),
    cmd_rx: &mut tokio::sync::mpsc::Receiver<WsCommand>,
    our_profile_id: &str,
    app: &AppHandle,
    backoff: &mut Duration,
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
        // `biased` with the read arm first: a Pong already sitting in the queue
        // MUST be seen before the heartbeat tick declares the connection dead.
        // `tokio::select!` otherwise picks a ready branch at RANDOM, so a Pong
        // landing in the same poll iteration as the tick could be ignored and a
        // perfectly healthy connection torn down (then fully reconnected).
        tokio::select! {
            biased;
            msg = read.next() => match msg {
                Some(Ok(Message::Text(text))) => {
                    // ws-backoff-reset-on-handshake: a real frame from the
                    // server (not just a completed handshake) is what proves
                    // the connection is stable — reset here, not on connect.
                    *backoff = Duration::from_secs(1);
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
                    *backoff = Duration::from_secs(1);
                    if let Err(e) = write.send(Message::Pong(data)).await {
                        return WsOutcome::Disconnected(AppError::Http(e.to_string()));
                    }
                }
                Some(Ok(Message::Pong(_))) => {
                    // A Pong answering our own heartbeat Ping is the "first
                    // successful heartbeat round-trip" stability signal.
                    *backoff = Duration::from_secs(1);
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
                    *backoff = Duration::from_secs(1);
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
fn post_notification(app: &AppHandle, title: &str, body: &str, conversation_id: &str) {
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
    // error path was unreachable. With the socket down through a 30s backoff
    // plus connect attempts, the 65th command would await forever and the
    // Tauri IPC promise would never settle — a hung `await invoke("ws_send")`
    // with no error and no timeout. Bound it, and surface the timeout instead
    // of hanging.
    const WS_SEND_TIMEOUT: Duration = Duration::from_secs(5);
    match tokio::time::timeout(WS_SEND_TIMEOUT, state.ws_tx.send(command)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err(AppError::Http("WS not connected".to_owned())),
        Err(_) => Err(AppError::Http(
            "WS send timed out — the socket is not accepting commands".to_owned(),
        )),
    }
}
