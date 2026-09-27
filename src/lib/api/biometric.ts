// Thin wrapper over the Tauri biometric plugin (Android/iOS). All calls fail
// soft: on desktop/web, or a device without biometrics, these resolve to
// "unavailable"/false rather than throwing, so callers can treat biometrics as
// a best-effort convenience layered on top of the PIN.

import { authenticate, checkStatus } from "@tauri-apps/plugin-biometric";

export async function isBiometricAvailable(): Promise<boolean> {
	try {
		const status = await checkStatus();
		return status.isAvailable === true;
	} catch (e) {
		// A bare `return false` here was indistinguishable from "this device
		// genuinely has no biometrics": a missing plugin, a revoked permission,
		// or a plugin that always throws all looked like a working negative
		// answer. In an app-lock context that is the difference between "biometric
		// unlock is unavailable, use your PIN" and "the lock screen is unlocked
		// and nothing is wrong" — so the failure is reported.
		// Logs the error object only; never biometric data or a scan result.
		console.warn("[biometric] availability check failed:", e);
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
	} catch (e) {
		// Most of the time this is a genuine user cancel, which is a normal
		// `false`. But it is also what a revoked permission or a plugin that
		// always throws produces, and the caller is about to tell the user their
		// fingerprint "didn't work". Report the failure so a real capability
		// problem is visible in logcat. Only the error object is logged — never
		// the reason string, the scan result, or any biometric data.
		console.warn("[biometric] prompt failed:", e);
		return false;
	}
}
