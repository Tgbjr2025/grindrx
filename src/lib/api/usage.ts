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
	} catch {
		// ignore — telemetry is best-effort
	}
}

export async function fetchDownloadStats(): Promise<DownloadStats> {
	const raw = await invoke<string>("fetch_download_stats");
	return aggregateDownloads(JSON.parse(raw));
}

export async function fetchActiveUsers(): Promise<ActiveUsers> {
	const raw = await invoke<string>("fetch_active_users");
	return parseActiveUsers(JSON.parse(raw));
}
