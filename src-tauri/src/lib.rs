mod api;
mod error;
mod state;
mod storage;

use tokio::sync::mpsc;

use crate::state::AppState;
use api::client::GrindrClient;
#[cfg(all(target_os = "macos", not(feature = "keychain")))]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    storage::init_keyring();

    let client = GrindrClient::new().ok();

    let (ws_tx, ws_rx) = mpsc::channel(64);

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_geolocation::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            client,
            ws_tx,
            ws_rx: tokio::sync::Mutex::new(Some(ws_rx)),
        })
        .invoke_handler(tauri::generate_handler![
            api::auth::login,
            api::auth::refresh_token,
            api::auth::logout,
            api::auth::auth_state,
            api::rest::request,
            api::ws::ws_send,
        ])
        .setup(|app| {
            #[cfg(all(target_os = "macos", not(feature = "keychain")))]
            storage::init_file_store(app.path().app_data_dir()?);
            api::ws::spawn_ws_task(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
