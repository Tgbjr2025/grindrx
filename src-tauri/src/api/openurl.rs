use serde::Serialize;

use crate::error::AppError;

/// Result of an `open_external_url` attempt, returned to the WebView so the UI
/// can show a real error instead of failing silently.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenUrlResult {
    pub opened: bool,
    /// Present when `opened` is false. Safe to show to a user.
    pub error: Option<String>,
}

/// Open an `http(s)://` URL in the device's default handler.
///
/// # Why this command exists instead of `@tauri-apps/plugin-opener`
///
/// The plugin's **JavaScript** binding invokes `plugin:opener|open_url`, but
/// `tauri-plugin-opener` 2.5.3's **Android** implementation registers the command
/// as `open` (`OpenerPlugin.kt`: `@Command fun open`), while its desktop
/// implementation registers `open_url` (`src/commands.rs`: `pub async fn
/// open_url`). The crate's own CHANGELOG records this class of mobile breakage
/// being fixed once already ("Fix broken JS commands `opener.openPath` and
/// `opener.openUrl` on mobile").
///
/// Net effect on Android: **every `openUrl()` call rejects** — the update
/// banner's Download button, every tappable chat link, and the map link. The
/// capability compounds it by granting `commands.allow = ["open_url"]`, a
/// command name that does not exist on that platform, so `open` is not
/// permitted either.
///
/// This command calls the plugin's **Rust** API, which handles the platform
/// difference correctly — on mobile `OpenerExt::open_url` dispatches to
/// `run_mobile_plugin("open", ..)`. That path is correct on every platform.
///
/// It also fixes a security finding from the audit: the release URL came from
/// remote JSON and was handed straight to the opener with
/// `opener:allow-open-url` carrying **no scope**, so a `intent://` or `file://`
/// URL from a compromised feed would reach an Android `Intent`. The scheme is
/// now allow-listed here, in Rust, before anything is dispatched.
#[tauri::command]
pub async fn open_external_url(
    app: tauri::AppHandle,
    url: String,
) -> Result<OpenUrlResult, AppError> {
    use tauri_plugin_opener::OpenerExt;

    // Only ever hand an http(s) URL to the OS. Reject `intent:`, `file:`,
    // `content:`, `market:`, `javascript:` and anything else, so a hostile or
    // MITM'd release feed cannot launch an arbitrary exported component.
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Ok(OpenUrlResult {
            opened: false,
            error: Some("Only http and https links can be opened.".to_owned()),
        });
    }
    if trimmed.len() > 2048 {
        return Ok(OpenUrlResult {
            opened: false,
            error: Some("That link is too long to open.".to_owned()),
        });
    }

    match app.opener().open_url(trimmed.to_owned(), None::<String>) {
        Ok(()) => Ok(OpenUrlResult {
            opened: true,
            error: None,
        }),
        Err(e) => {
            // Typically ActivityNotFoundException: no app handles http(s).
            let msg = e.to_string();
            tracing_error(&msg);
            Ok(OpenUrlResult {
                opened: false,
                error: Some("No app on this device could open that link.".to_owned()),
            })
        }
    }
}

fn tracing_error(msg: &str) {
    eprintln!("[GrindrX] open_external_url failed: {msg}");
}
