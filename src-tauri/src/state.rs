use std::sync::atomic::AtomicBool;
use std::sync::{Arc, OnceLock};
use tokio::sync::{mpsc, Notify};

use crate::api::client::GrindrClient;
use crate::api::ws::WsCommand;
use crate::error::AppError;

pub struct AppState {
    pub client: OnceLock<GrindrClient>,
    pub ws_tx: mpsc::Sender<WsCommand>,
    pub ws_rx: tokio::sync::Mutex<Option<mpsc::Receiver<WsCommand>>>,
    pub auth_notify: Arc<Notify>,
    /// Fired by `logout` (and `login`, to cover an account switch without an
    /// explicit logout) to force any live WS connection to drop immediately
    /// instead of continuing to deliver the previous account's realtime
    /// events/notifications until the socket naturally expires. See
    /// `api::ws::run_message_loop`'s `ws_reset` select! arm.
    pub ws_reset: Arc<Notify>,
    /// true when the WebView is visible/active; false when app is backgrounded
    pub is_foreground: AtomicBool,
    /// Local notification preferences, pushed from the WebView via
    /// `set_notification_prefs` (Grindr has no server-side toggle for these).
    /// The Rust WS notifier reads these before posting an OS notification, so a
    /// disabled toggle actually suppresses the notification. Default on.
    pub notify_messages: AtomicBool,
    pub notify_taps: AtomicBool,
}

impl AppState {
    pub fn client(&self) -> Result<&GrindrClient, AppError> {
        self.client.get().ok_or(AppError::NotInitialized)
    }
}
