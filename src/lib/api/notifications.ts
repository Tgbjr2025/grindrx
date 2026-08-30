// Local notification preferences (Grindr exposes no server-side toggle for
// these). The values live in the local preferences store; the Rust WS notifier
// can't read that store directly, so we push the current values into AppState
// via the `set_notification_prefs` command — on launch and whenever a toggle
// changes — and the notifier reads them before posting an OS notification.

import { invoke } from "@tauri-apps/api/core";

import { getPreferences } from "$lib/app-data/preferences.svelte";

export async function syncNotificationPrefs(): Promise<void> {
	try {
		const { notifyMessages, notifyTaps } = await getPreferences();
		await invoke("set_notification_prefs", {
			messages: notifyMessages,
			taps: notifyTaps,
		});
	} catch (e) {
		console.error("[GrindrX] Failed to sync notification prefs", e);
	}
}
