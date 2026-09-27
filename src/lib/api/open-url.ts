import { invoke } from "@tauri-apps/api/core";

export type OpenUrlResult = { opened: boolean; error: string | null };

/**
 * Open an http(s) URL in the device's default handler.
 *
 * WHY THIS EXISTS — do not "simplify" it back to `openUrl` from
 * `@tauri-apps/plugin-opener`:
 *
 * That plugin's JS binding invokes `plugin:opener|open_url`, but
 * tauri-plugin-opener 2.5.3's **Android** implementation registers the command
 * as `open` (its desktop build registers `open_url`). The capability grants
 * `commands.allow = ["open_url"]`, which does not exist on Android, so `open` is
 * not permitted either. The net result on a phone is that **every `openUrl()`
 * call rejects** — the update banner's Download button, every tappable chat
 * link, and the map link all silently do nothing, because the rejection was
 * never caught.
 *
 * The plugin's **Rust** API handles the platform difference correctly (on mobile
 * it dispatches to `run_mobile_plugin("open", ..)`), so this command goes
 * through that instead. It also enforces the https-only allow-list in Rust,
 * which is what stops a hostile release feed from feeding an `intent://` or
 * `file://` URL to an Android `Intent`.
 *
 * Returns `{opened:false, error}` instead of throwing, so callers can surface
 * something. Never swallow the failure again — a button that does nothing and
 * says nothing is indistinguishable from a broken app.
 */
export async function openExternalUrl(url: string): Promise<OpenUrlResult> {
	try {
		return await invoke<OpenUrlResult>("open_external_url", { url });
	} catch (e) {
		return {
			opened: false,
			error: e instanceof Error ? e.message : "Could not open that link.",
		};
	}
}
