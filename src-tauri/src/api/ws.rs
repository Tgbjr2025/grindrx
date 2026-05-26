use std::sync::atomic::Ordering;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::{
    connect_async,
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

#[derive(Debug, Deserialize, Serialize)]
pub struct WsCommand {
    pub r#type: String,
    #[serde(rename = "ref")]
    pub ref_id: String,
    pub payload: Value,
}

pub fn spawn_ws_task(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        run_ws_loop(app).await;
    });
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
                sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
            }
        }
    }
}

async fn connect_and_run(app: &AppHandle, backoff: &mut Duration) -> WsOutcome {
    let state = app.state::<AppState>();

    // --- Build authorization header ---
    let authorization = match state.client() {
        Err(e) => return WsOutcome::Disconnected(e),
        Ok(c) => match c.authorization_header().await {
            Some(h) => h,
            None => return WsOutcome::Disconnected(AppError::Auth("Not logged in".to_owned())),
        },
    };

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

    let (ws_stream, _) = match timeout(CONNECT_TIMEOUT, connect_async(request)).await {
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

    app.emit("ws:connected", ()).ok();
    // Connection established — reset the outer-loop backoff so the next
    // disconnect (post-stable session) doesn't sleep the accumulated max.
    *backoff = Duration::from_secs(1);

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

    run_message_loop(&mut write, &mut read, cmd_rx, &our_profile_id, app).await
    // `guard` (and thus the receiver) is dropped here, releasing the lock.
}

async fn run_message_loop(
    write: &mut (impl SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
    read: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin),
    cmd_rx: &mut tokio::sync::mpsc::Receiver<WsCommand>,
    our_profile_id: &str,
    app: &AppHandle,
) -> WsOutcome {
    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.tick().await; // consume the immediate first tick

    // FIX 1: track pong state here instead of blocking read.next() in the heartbeat arm.
    // When true, the next heartbeat tick without a Pong means the connection is dead.
    let mut waiting_for_pong = false;

    loop {
        tokio::select! {
            msg = read.next() => match msg {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(val) = serde_json::from_str::<Value>(&text) {
                        if let Some(event_type) = val["type"].as_str() {
                            let safe_type = event_type.replace('.', "_");
                            app.emit(&format!("grindr:{safe_type}"), &val).ok();

                            if event_type == "chat.v1.message_sent" {
                                let state = app.state::<crate::state::AppState>();
                                if !state.is_foreground.load(Ordering::Relaxed) {
                                    // FIX 3: only notify if someone else sent this message
                                    let sender_id = val["payload"]["senderId"]
                                        .as_str()
                                        .unwrap_or("");
                                    if sender_id != our_profile_id {
                                        maybe_notify(app, &val);
                                    }
                                }
                            }
                        }
                    }
                }
                Some(Ok(Message::Ping(data))) => {
                    if let Err(e) = write.send(Message::Pong(data)).await {
                        return WsOutcome::Disconnected(AppError::Http(e.to_string()));
                    }
                }
                Some(Ok(Message::Pong(_))) => {
                    // FIX 1: clear the flag — pong arrived in the normal message loop.
                    waiting_for_pong = false;
                }
                Some(Ok(Message::Close(_))) | None => {
                    // FIX 2: server close → reconnect, not exit
                    return WsOutcome::Disconnected(AppError::Http(
                        "WS connection closed by server".to_owned(),
                    ));
                }
                Some(Err(e)) => {
                    return WsOutcome::Disconnected(AppError::Http(e.to_string()));
                }
                Some(Ok(_)) => {}
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
        }
    }
}

fn maybe_notify(app: &AppHandle, val: &Value) {
    let body = match val["payload"]["type"].as_str() {
        Some("Text") => val["payload"]["body"]["text"]
            .as_str()
            .unwrap_or("New message")
            .chars()
            .take(80)
            .collect::<String>(),
        Some("Image") => "Sent you a photo".to_owned(),
        Some("Album") | Some("ExpiringAlbum") | Some("ExpiringAlbumV2") => {
            "Shared an album".to_owned()
        }
        Some("Audio") => "Sent you a voice message".to_owned(),
        Some("Video") => "Sent you a video".to_owned(),
        _ => "New message".to_owned(),
    };

    app.notification()
        .builder()
        .title("GrindX")
        .body(&body)
        .channel_id("grindx_messages")
        .show()
        .ok();
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

    state
        .ws_tx
        .send(command)
        .await
        .map_err(|_| AppError::Http("WS not connected".to_owned()))
}
