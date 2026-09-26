use std::fmt;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    Http(String),
    Auth(String),
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
