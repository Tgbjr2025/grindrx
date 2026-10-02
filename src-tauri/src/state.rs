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
    /// connecting, compares again after the handshake returns, and the message
    /// loop compares it as the FIRST statement of every iteration and again
    /// after each inbound frame is handled. See `api::ws::run_message_loop`.
    pub ws_epoch: Arc<AtomicU64>,
    /// Wakeup hint only — the epoch above is the source of truth.
    ///
    /// `Notify::notify_waiters()` wakes only the waiters registered at that
    /// instant and stores NO permit, so a bump that lands while the loop is
    /// running another arm (JSON parse + `app.emit` + a platform notification,
    /// or a burst of inbound frames) is LOST as a wakeup. That is why
    /// `run_message_loop` checks `ws_epoch` unconditionally rather than relying
    /// on this notification: the comparison, not the wakeup, is what makes a
    /// stale socket drop. Losing the wakeup costs latency only — teardown then
    /// happens on the next loop iteration, which is bounded by the next inbound
    /// frame or, worst case, by `HEARTBEAT_INTERVAL` (45s) of silence.
    ///
    /// Long-term fix: replace this with a `watch::Sender<u64>` carrying the
    /// epoch, so a bump is a value change that cannot be lost. NOT done here
    /// because it is a structural refactor of the select! and cannot be
    /// compiled on the audit host.
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
    /// true while the in-app lock (PIN/biometric) is engaged. Pushed from the
    /// WebView via `set_app_locked`.
    ///
    /// The Rust WS notifier reads this before posting an OS notification. An
    /// engaged lock means the device may well be locked too, and Android
    /// renders a notification's `body` verbatim on the lock screen unless the
    /// channel is VISIBILITY_PRIVATE — so chat text would be exposed to anyone
    /// holding the phone. Relaxes alongside the other notifier gates.
    ///
    /// Defaults to `false` (unlocked) to match `is_foreground`; the WebView
    /// pushes the real value on launch and on every lock/unlock.
    pub locked: AtomicBool,
    /// Why secure storage is unusable, if `init_keyring` left no default store.
    ///
    /// Without this surfaced, the app starts normally and EVERY login then fails
    /// forever at `set_session` with an opaque `AppError::Auth`. Written once at
    /// startup from `GrindrClient::new` and reported by the `auth_state`
    /// command so the frontend can show something actionable. `Mutex` not
    /// `RwLock`/`OnceLock`: written once at startup, read rarely, and the value
    /// is small. Locking never panics (poison is recovered with `into_inner`)
    /// because a panic here would only turn a surfaced error into a crash.
    /// `pub(crate)` because `AppState` is built with a struct literal in
    /// `lib.rs`; all access still goes through the methods below.
    pub(crate) keyring_error: std::sync::Mutex<Option<String>>,
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

    /// Whether the in-app lock is engaged. Read by the notification path
    /// before any user content reaches the OS notification shade.
    pub fn is_locked(&self) -> bool {
        self.locked.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Called from the `set_app_locked` command.
    pub fn set_locked(&self, locked: bool) {
        self.locked
            .store(locked, std::sync::atomic::Ordering::Relaxed);
    }

    /// Record a secure-storage failure. First writer wins: the store is only
    /// initialised once per process, so a later success must not erase the
    /// original diagnosis.
    pub fn set_keyring_error(&self, message: String) {
        let mut slot = self
            .keyring_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if slot.is_none() {
            *slot = Some(message);
        }
    }

    /// `Some(reason)` when secure storage is unusable and every login will fail.
    pub fn keyring_error(&self) -> Option<String> {
        self.keyring_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}
