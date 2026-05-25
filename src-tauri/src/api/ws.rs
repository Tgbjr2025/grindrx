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
const PONG_TIMEOUT: Duration = Duration::from_secs(10);

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

        match connect_and_run(&app).await {
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

async fn connect_and_run(app: &AppHandle) -> WsOutcome {
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

    let (ws_stream, _) = match connect_async(request).await {
        Ok(s) => s,
        Err(e) => {
            return WsOutcome::Disconnected(AppError::Http(format!("WS connect failed: {e}")))
        }
    };

    app.emit("ws:connected", ()).ok();

    let (mut write, mut read) = ws_stream.split();

    // Borrow the receiver without consuming it (FIX 1).
    let mut guard = state.ws_rx.lock().await;
    let cmd_rx = match guard.as_mut() {
        Some(rx) => rx,
        None => {
            return WsOutcome::Disconnected(AppError::Http("WS already running".to_owned()))
        }
    };

    let session_id = match state.client() {
        Ok(c) => match c.session.read().await.as_ref().map(|s| s.session_id.clone()) {
            Some(id) => id,
            None => {
                return WsOutcome::Disconnected(AppError::Auth("Not logged in".to_owned()))
            }
        },
        Err(e) => return WsOutcome::Disconnected(e),
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

    run_message_loop(&mut write, &mut read, cmd_rx, &session_id, &our_profile_id, app).await
    // `guard` (and thus the receiver) is dropped here, releasing the lock.
}

async fn run_message_loop(
    write: &mut (impl SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
    read: &mut (impl StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin),
    cmd_rx: &mut tokio::sync::mpsc::Receiver<WsCommand>,
    session_id: &str,
    our_profile_id: &str,
    app: &AppHandle,
) -> WsOutcome {
    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.tick().await; // consume the immediate first tick

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
                    // Pong received — heartbeat confirmed alive, nothing to do.
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
                    let json = serde_json::json!({
                        "type": cmd.r#type,
                        "ref": cmd.ref_id,
                        "token": session_id,
                        "payload": cmd.payload,
                    });
                    if let Err(e) = write.send(Message::Text(json.to_string().into())).await {
                        return WsOutcome::Disconnected(AppError::Http(e.to_string()));
                    }
                }
                // FIX 2: channel closed → real shutdown, break the outer loop
                None => return WsOutcome::ChannelClosed,
            },

            // FIX 14: periodic heartbeat to survive Android Doze
            _ = heartbeat.tick() => {
                if let Err(e) = write.send(Message::Ping(vec![].into())).await {
                    return WsOutcome::Disconnected(AppError::Http(e.to_string()));
                }
                // Wait up to PONG_TIMEOUT for a Pong before treating as dead.
                match timeout(PONG_TIMEOUT, read.next()).await {
                    Ok(Some(Ok(Message::Pong(_)))) => {}
                    Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
                        return WsOutcome::Disconnected(AppError::Http(
                            "WS connection closed by server".to_owned(),
                        ));
                    }
                    Ok(Some(Err(e))) => {
                        return WsOutcome::Disconnected(AppError::Http(e.to_string()));
                    }
                    Err(_) => {
                        return WsOutcome::Disconnected(AppError::Http(
                            "WS heartbeat timeout — no pong received".to_owned(),
                        ));
                    }
                    Ok(Some(Ok(_))) => {} // other frame, ignore
                }
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
    state
        .ws_tx
        .send(command)
        .await
        .map_err(|_| AppError::Http("WS not connected".to_owned()))
}
