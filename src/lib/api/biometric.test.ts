import { beforeEach, describe, expect, it, vi } from "vitest";

// E12: `biometric.ts` had `catch { return false; }` on both entry points, which
// made a missing plugin, a revoked permission, and a plugin that always throws
// indistinguishable from a genuine "no biometrics on this device". In an
// app-lock context that is the difference between "use your PIN instead" and
// "the lock screen is fine" — a real capability failure that was invisible.
vi.mock("@tauri-apps/plugin-biometric", () => ({
	BiometryType: { None: 0, TouchID: 1, FaceID: 2, Iris: 3 },
	authenticate: vi.fn(),
	checkStatus: vi.fn(),
}));

import {
	authenticate,
	BiometryType,
	checkStatus,
} from "@tauri-apps/plugin-biometric";

import { isBiometricAvailable, promptBiometric } from "$lib/api/biometric";

const mockedAuthenticate = vi.mocked(authenticate);
const mockedCheckStatus = vi.mocked(checkStatus);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("isBiometricAvailable", () => {
	it("returns true for an available sensor", async () => {
		mockedCheckStatus.mockResolvedValueOnce({
			isAvailable: true,
			biometryType: BiometryType.FaceID,
		});
		await expect(isBiometricAvailable()).resolves.toBe(true);
	});

	it("returns false for a genuinely unavailable sensor, without warning", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mockedCheckStatus.mockResolvedValueOnce({
			isAvailable: false,
			biometryType: BiometryType.None,
		});
		await expect(isBiometricAvailable()).resolves.toBe(false);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("WARNS when the check itself throws (revoked permission / missing plugin)", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mockedCheckStatus.mockRejectedValueOnce(new Error("plugin not found"));

		await expect(isBiometricAvailable()).resolves.toBe(false);
		expect(warn).toHaveBeenCalled();
		// The error object is logged; no biometric data.
		expect(warn.mock.calls[0]?.[0]).toContain("[biometric]");
		warn.mockRestore();
	});
});

describe("promptBiometric", () => {
	it("returns true after a successful prompt", async () => {
		mockedAuthenticate.mockResolvedValueOnce();
		await expect(promptBiometric("Unlock GrindrX")).resolves.toBe(true);
	});

	it("returns false and warns when the prompt throws", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mockedAuthenticate.mockRejectedValueOnce(new Error("cancelled"));

		await expect(promptBiometric("Unlock GrindrX")).resolves.toBe(false);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("passes the device-credential fallback through", async () => {
		mockedAuthenticate.mockResolvedValueOnce();
		await promptBiometric("Unlock GrindrX", true);
		expect(mockedAuthenticate).toHaveBeenCalledWith("Unlock GrindrX", {
			title: "Unlock GrindrX",
			allowDeviceCredential: true,
		});
	});
});
