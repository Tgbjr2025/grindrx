use reqwest::Client;
use tokio::sync::{Mutex, RwLock};

use crate::error::AppError;

use super::auth::Session;
use super::headers::{build_default_headers, build_user_agent, DeviceInfo};

pub const BASE_URL: &str = "https://grindr.mobi";

pub struct GrindrClient {
    pub(super) http: Client,
    pub(super) session: RwLock<Option<Session>>,
    pub(super) refresh_lock: Mutex<()>,
    pub user_agent: String,
}

impl GrindrClient {
    pub fn new() -> Result<Self, AppError> {
        let device = DeviceInfo::default();
        let user_agent = build_user_agent(&device, "Free");
        let headers = build_default_headers(&device, &user_agent);

        let http = Client::builder().default_headers(headers).build()?;

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

        Ok(Self {
            http,
            session: RwLock::new(session),
            refresh_lock: Mutex::new(()),
            user_agent,
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
