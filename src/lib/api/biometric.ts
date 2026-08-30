// Thin wrapper over the Tauri biometric plugin (Android/iOS). All calls fail
// soft: on desktop/web, or a device without biometrics, these resolve to
// "unavailable"/false rather than throwing, so callers can treat biometrics as
// a best-effort convenience layered on top of the PIN.

import { authenticate, checkStatus } from "@tauri-apps/plugin-biometric";

export async function isBiometricAvailable(): Promise<boolean> {
	try {
		const status = await checkStatus();
		return status.isAvailable === true;
	} catch {
		return false;
	}
}

/** Prompt for a fingerprint/face scan. Resolves true on success, false on
 * failure/cancel/unavailable. */
export async function promptBiometric(reason: string): Promise<boolean> {
	try {
		await authenticate(reason, {
			title: "Unlock GrindrX",
			// Don't offer the device PIN/pattern as a fallback — the app has its
			// own PIN screen behind this.
			allowDeviceCredential: false,
		});
		return true;
	} catch {
		return false;
	}
}
