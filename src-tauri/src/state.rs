use std::sync::atomic::{AtomicBool, AtomicU64};
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
    /// Monotonic session epoch, bumped by `logout` and `login`.
    ///
    /// This replaced a `Notify`, which was **lossy**: `notify_waiters()` only
    /// wakes waiters that are registered *at that instant* and stores no permit.
    /// The only waiter is the `select!` arm inside `run_message_loop`, which is
    /// not registered during the backoff sleep, the `authorization_header()`
    /// call, or the `connect_async` handshake (up to `CONNECT_TIMEOUT` = 15s).
    /// A logout landing in that window was silently dropped, so the socket
    /// completed the handshake with the **pre-logout** token and kept delivering
    /// the previous account's events and notifications.
    ///
    /// An epoch cannot be missed: the connection task snapshots it before
    /// connecting and compares again after the handshake returns, and again in
    /// the `select!` arm.
    pub ws_epoch: Arc<AtomicU64>,
    /// Wakeup hint only — the epoch above is the source of truth.
    ///
    /// The message loop blocks on this rather than polling, so a session change
    /// costs no CPU; but because correctness comes from comparing
    /// `ws_epoch` (and not from this notification arriving), a missed wakeup
    /// can delay teardown by at most one `select!` re-evaluation and can never
    /// cause a stale socket to keep delivering another account's events.
    pub ws_reset_notify: Arc<Notify>,
    /// true when the WebView is visible/active; false when app is backgrounded
    pub is_foreground: AtomicBool,
    /// Local notification preferences, pushed from the WebView via
    /// `set_notification_prefs` (Grindr has no server-side toggle for these).
    /// The Rust WS notifier reads these before posting an OS notification, so a
    /// disabled toggle actually suppresses the notification.
    ///
    /// These now default to **false**, and `prefs_loaded` gates the notifier
    /// until the WebView has pushed the real values. They used to default to
    /// `true` and were only corrected after the WebView's async file read
    /// completed, so a message arriving in that window produced a notification
    /// the user had explicitly turned off.
    pub notify_messages: AtomicBool,
    pub notify_taps: AtomicBool,
    /// Set once `set_notification_prefs` has been called at least once.
    pub prefs_loaded: AtomicBool,
}

impl AppState {
    pub fn client(&self) -> Result<&GrindrClient, AppError> {
        self.client.get().ok_or(AppError::NotInitialized)
    }

    /// Current session epoch.
    pub fn ws_epoch(&self) -> u64 {
        self.ws_epoch.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Invalidate any in-flight WS connection (logout, or an account switch via
    /// `login` without an explicit logout).
    ///
    /// Bump the epoch FIRST, then notify: a waiter that wakes must already be
    /// able to observe the new value.
    pub fn bump_ws_epoch(&self) {
        self.ws_epoch
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.ws_reset_notify.notify_waiters();
    }
}
