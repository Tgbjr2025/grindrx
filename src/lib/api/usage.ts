// Anonymous usage telemetry + the stats it powers.
//
// On launch the app sends one fire-and-forget ping (an anonymous per-install id +
// the app version) so active-user counts can be aggregated server-side. The stats
// screen reads download counts (GitHub + Forgejo releases) and the active-user
// aggregate. All network goes through Rust commands (the WebView CSP blocks these
// hosts); see `src-tauri/src/api/rest.rs`.

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

import {
	type ActiveUsers,
	aggregateDownloads,
	type DownloadStats,
	parseActiveUsers,
} from "$lib/utils/stats";

const INSTALL_ID_KEY = "grindrx-install-id";

/** A stable anonymous id for this install (created once, stored locally). */
export function getInstallId(): string {
	try {
		let id = localStorage.getItem(INSTALL_ID_KEY);
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem(INSTALL_ID_KEY, id);
		}
		return id;
	} catch {
		// Storage unavailable — use an ephemeral id so the ping still counts (it
		// just won't dedupe against a prior session).
		return crypto.randomUUID();
	}
}

/** Record this install as active. Best-effort — never throws. */
export async function sendUsagePing(): Promise<void> {
	try {
		const version = await getVersion();
		await invoke("send_usage_ping", { id: getInstallId(), version });
	} catch (e) {
		// Telemetry must never break the app, so this still swallows the failure
		// — but it no longer swallows it SILENTLY: an empty catch here hid a
		// permanently broken aggregate (wrong command name, network blocked by
		// the WebView CSP, a Rust panic) behind a stats screen stuck at zero.
		// Only the error is logged. The install id is deliberately NOT: it is a
		// stable per-device identifier and does not belong in logcat, which any
		// app with READ_LOGS can read.
		console.warn("[GrindrX] usage ping failed:", e);
	}
}

/**
 * Decode a JSON body returned by a Rust command.
 *
 * These commands return a raw `String` that the Rust side `serde_json`s, so a
 * schema change or a truncated response arrives as a `SyntaxError` from
 * `JSON.parse` with no context — the stats screen then reported "failed to
 * load" for a reason nobody could act on. Re-throw with the endpoint and the
 * parse failure attached.
 */
function parseCommandJson<T>(raw: string, command: string): T {
	try {
		return JSON.parse(raw) as T;
	} catch (e) {
		throw new Error(`Malformed response from ${command}`, { cause: e });
	}
}

export async function fetchDownloadStats(): Promise<DownloadStats> {
	const raw = await invoke<string>("fetch_download_stats");
	return aggregateDownloads(parseCommandJson(raw, "fetch_download_stats"));
}

export async function fetchActiveUsers(): Promise<ActiveUsers> {
	const raw = await invoke<string>("fetch_active_users");
	return parseActiveUsers(parseCommandJson(raw, "fetch_active_users"));
}
