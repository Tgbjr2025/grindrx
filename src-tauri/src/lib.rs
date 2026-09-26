mod api;
mod error;
mod state;
mod storage;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::Manager;
use tokio::sync::{mpsc, Notify};

use crate::state::AppState;
use api::client::GrindrClient;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	#[cfg(debug_assertions)]
	let devtools = tauri_plugin_devtools::init();

    let (ws_tx, ws_rx) = mpsc::channel(64);
    let auth_notify = Arc::new(Notify::new());
    let ws_reset_notify = Arc::new(Notify::new());

    let mut builder = tauri::Builder::default();

	#[cfg(debug_assertions)]
    {
        builder = builder.plugin(devtools);
    }

	// Biometric unlock is a mobile-only capability (Android/iOS).
	#[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_biometric::init());
    }

	#[tauri::command]
    fn set_foreground(state: tauri::State<'_, AppState>, foreground: bool) {
        state.is_foreground.store(foreground, Ordering::Relaxed);
    }

	#[tauri::command]
    fn set_notification_prefs(state: tauri::State<'_, AppState>, messages: bool, taps: bool) {
        // Mark loaded BEFORE storing the values, so the notifier never observes
        // "prefs known" alongside a stale default.
        state.prefs_loaded.store(true, std::sync::atomic::Ordering::SeqCst);
        state.notify_messages.store(messages, Ordering::Relaxed);
        state.notify_taps.store(taps, Ordering::Relaxed);
    }

	builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_geolocation::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            client: OnceLock::new(),
            ws_tx,
            ws_rx: tokio::sync::Mutex::new(Some(ws_rx)),
            auth_notify,
            ws_epoch: Arc::new(AtomicU64::new(0)),
            ws_reset_notify,
            is_foreground: AtomicBool::new(true),
            // Default OFF until the WebView pushes the real values, so a
            // message arriving during startup cannot fire a notification the
            // user had explicitly disabled. See AppState::prefs_loaded.
            notify_messages: AtomicBool::new(false),
            notify_taps: AtomicBool::new(false),
            prefs_loaded: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            api::auth::login,
            api::auth::refresh_token,
            api::auth::forgot_password,
            api::auth::logout,
            api::auth::auth_state,
            api::rest::request,
            api::rest::request_public,
            api::rest::upload_image,
            api::rest::upload_profile_image,
            api::rest::upload_album_content,
            api::rest::fetch_authed_bytes,
            api::rest::fetch_media_bytes,
            api::rest::fetch_latest_release,
            api::rest::fetch_download_stats,
            api::rest::fetch_active_users,
            api::rest::send_usage_ping,
            set_foreground,
            set_notification_prefs,
            api::ws::ws_connect,
            api::ws::ws_send,
            api::client::rotate_api_params,
        ])
        .setup(|app| {
            #[cfg(all(target_os = "macos", not(feature = "keychain")))]
            storage::init_file_store(app.path().app_data_dir()?);

            storage::init_keyring();

            // A silent failure here is a total, undiagnosable outage: the
            // OnceLock stays empty and EVERY subsequent command returns
            // "GrindrClient not initialized" with nothing in logcat. Log both the
            // construction error and the fact that the store already had a value.
            match GrindrClient::new() {
                Ok(client) => {
                    if app.state::<AppState>().client.set(client).is_err() {
                        eprintln!("[lib] GrindrClient already initialised; keeping existing client.");
                    }
                }
                Err(e) => {
                    eprintln!("[lib] GrindrClient init FAILED: {e} - every API call will fail until relaunch.");
                }
            }

            #[cfg(all(target_os = "macos", not(feature = "keychain")))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<AppState>();
                    if let Ok(client) = state.client() {
                        client.reload_session().await;
                        if client.authorization_header().await.is_some() {
                            state.auth_notify.notify_one();
                        }
                    }
                });
            }
            api::ws::spawn_ws_task(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
