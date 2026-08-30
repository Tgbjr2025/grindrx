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
 * failure/cancel/unavailable.
 *
 * `allowDeviceCredential` offers the device PIN/pattern as a fallback in the OS
 * prompt. Pass true when biometrics are the SOLE app lock (so a sensor lockout
 * can't trap the user); pass false when the app's own PIN screen is the fallback. */
export async function promptBiometric(
	reason: string,
	allowDeviceCredential = false,
): Promise<boolean> {
	try {
		await authenticate(reason, {
			title: "Unlock GrindrX",
			allowDeviceCredential,
		});
		return true;
	} catch {
		return false;
	}
}
