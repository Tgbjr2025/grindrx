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

pub struct GrindrClient {
    pub(super) http: RwLock<Client>,
    pub(super) default_headers: RwLock<HeaderMap>,
    pub(super) session: RwLock<Option<Session>>,
    pub(super) refresh_lock: Mutex<()>,
    pub user_agent: RwLock<String>,
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

        // FIX 10: add request and connect timeouts so hung API calls don't freeze the app
        let http = Client::builder()
            .default_headers(headers.clone())
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()?;

        #[cfg(all(target_os = "macos", not(feature = "keychain")))]
        let session = None;
        #[cfg(not(all(target_os = "macos", not(feature = "keychain"))))]
        let session = match super::auth::AuthStorage::get_session() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[client] could not load session: {e}");
                None
            }
        };

        // FIX 9: discard sessions that are already expired so the app prompts re-login
        // rather than silently continuing with a stale token (common after Android reinstall).
        #[cfg(not(all(target_os = "macos", not(feature = "keychain"))))]
        let session = {
            let now = chrono::Utc::now().timestamp().max(0) as u64;
            match session {
                Some(ref s) if s.expires_at < now => {
                    eprintln!(
                        "[client] stored session is expired (expires_at={}, now={}) — clearing",
                        s.expires_at, now
                    );
                    super::auth::AuthStorage::delete_session();
                    None
                }
                other => other,
            }
        };

        Ok(Self {
            http: RwLock::new(http),
            default_headers: RwLock::new(headers),
            session: RwLock::new(session),
            refresh_lock: Mutex::new(()),
            user_agent: RwLock::new(user_agent),
        })
    }

    #[allow(dead_code)]
    pub async fn reload_session(&self) {
        match super::auth::AuthStorage::get_session() {
            Ok(s) => *self.session.write().await = s,
            Err(e) => eprintln!("[client] reload_session: {e}"),
        }
    }
}

#[tauri::command]
pub async fn rotate_api_params(
    state: tauri::State<'_, AppState>,
) -> Result<RotateResult, AppError> {
    let client = state.client()?;

    let device = DeviceInfo::default();
    if let Err(e) = DeviceStorage::save(&device) {
        eprintln!("[client] could not persist rotated device info: {e}");
    }
    let user_agent = build_user_agent(&device, "Free");
    let headers = build_default_headers(&device, &user_agent);
    let http = Client::builder()
        .default_headers(headers.clone())
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .build()?;

    *client.http.write().await = http;
    *client.default_headers.write().await = headers.clone();

    // FIX 6: return the newly generated values, not the old ones
    let new_ua = user_agent.clone();
    let new_device_info = headers
        .get("L-Device-Info")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    *client.user_agent.write().await = user_agent;

    Ok(RotateResult {
        user_agent: new_ua,
        l_device_info: new_device_info,
    })
}
