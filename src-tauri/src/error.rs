use std::fmt;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    Http(String),
    /// The credential itself is bad: a rejected token, a malformed JWT, a
    /// session that is not there. `authorization_header` treats this as
    /// "re-login", and it is the ONLY class that should clear the session.
    Auth(String),
    /// A failure of the LOCAL credential store (Android Keystore / keyring) or of
    /// (de)serialising the session blob.
    ///
    /// This variant exists because those failures used to be reported as
    /// `AppError::Auth`, which made them indistinguishable from "the server
    /// rejected us" to the classifier in `authorization_header`. The consequence
    /// was real: a transient Keystore contention — which the auth module's own
    /// comments document as taking tens of milliseconds and spiking under load —
    /// cleared the in-memory session AND deleted the keyring entry, signing the
    /// user out mid-session. A storage hiccup is not a rejected credential and
    /// must never be treated as one.
    CredentialStore(String),
    Api {
        /// i64, not i32: a server `code` is a 64-bit value and truncating it
        /// with `as i32` wraps (4294967697 -> 401), which `authorization_header`
        /// then treats as an invalid session and DELETES the stored credential —
        /// a spurious forced logout from an integer overflow.
        code: i64,
        message: String,
    },
    NotInitialized,
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Http(msg) => write!(f, "HTTP error: {msg}"),
            AppError::Auth(msg) => write!(f, "Auth error: {msg}"),
            AppError::CredentialStore(msg) => {
                write!(f, "Credential store error: {msg}")
            }
            AppError::Api { code, message } => write!(f, "API error {code}: {message}"),
            AppError::NotInitialized => write!(f, "GrindrClient not initialized"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Http(e.to_string())
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}
