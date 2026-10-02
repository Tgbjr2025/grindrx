# FIX_NOTES — v0.1.31 (biometric unlock)

**Date:** 2026-08-30 · **Base:** `41c4c89` (v0.1.30) · **Rollback tag:** `pre-v0.1.31` = `41c4c89`
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk` · **Operator:** Tom

Tom: "do the bio unlock." Adds fingerprint/face unlock on top of the existing PIN lock. This is the
first NATIVE-PLUGIN addition of the session — validated by the APK build compiling it.
Verified: vitest 193 (was 191), svelte-check 0 errors, eslint clean. Version 0.1.30→0.1.31,
versionCode base 1075→1080.

## Native plugin wiring
- **Cargo:** `tauri-plugin-biometric = "2"` added to the `android` AND `ios` target-dep sections
  (mobile-only). Init in `lib.rs` gated `#[cfg(mobile)]` (`builder.plugin(tauri_plugin_biometric::init())`).
  `Cargo.lock` pre-updated via the flake's cargo (`cargo metadata`) so the build didn't lock-mismatch.
- **JS:** `@tauri-apps/plugin-biometric ~2.3.2` added to package.json; `bun.lock` updated via the
  flake's bun (`nix develop -c bun install`).
- **Capability:** `biometric:default` added to `capabilities/mobile.json`.

## App integration
- Wrapper `src/lib/api/biometric.ts`: `isBiometricAvailable()` (checkStatus) + `promptBiometric(reason)`
  (authenticate, `allowDeviceCredential:false`). Both fail-soft (false) off-device.
- Store `app-data/app-lock.svelte.ts`: `grindrx-pinlock-biometric` flag + `isBiometricUnlockEnabled()`,
  `setBiometricUnlock(on)`, `unlockWithBiometric()` (bypasses PIN entry after a successful scan).
  `disablePin()` also clears the biometric opt-in.
- `PinLockGate.svelte`: on mount, if biometric is enabled + locked, auto-prompts the scan; a
  "Use fingerprint / face" button offers a manual retry. PIN entry is always the fallback.
- `PinLockSetting.svelte`: a SwitchField "Unlock with fingerprint / face" shown when a PIN is set —
  enabling it checks availability + requires a confirming scan before turning on.
- Tests: app-lock biometric opt-in (only counts with a PIN, persists, unlockWithBiometric unlocks,
  disablePin clears it).

## Notes
- Biometric is a convenience ON TOP of the PIN; the PIN is always the ground-truth fallback, and the
  PIN hash is what's stored (biometrics never replace it). Needs on-device verification of the actual
  fingerprint/face prompt (can't test the native sensor here).
