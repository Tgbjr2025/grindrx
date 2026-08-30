# FIX_NOTES — v0.1.32 (biometric as a standalone app lock)

**Date:** 2026-08-30 · **Base:** `3e21f6d` (v0.1.31) · **Rollback tag:** `pre-v0.1.32` = `3e21f6d`
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk` · **Operator:** Tom

Tom: "can it also be set up to log into the app with your fingerprint as well." In v0.1.31 biometric
was only an unlock for the PIN. Now biometric can gate the app ON ITS OWN (no PIN). Frontend-only
(the plugin was added in v0.1.31). Verified: vitest 194 (was 193), svelte-check 0 errors, eslint
clean. Version 0.1.31→0.1.32, versionCode base 1080→1085.

## What changed
- **Store `app-data/app-lock.svelte.ts`** restructured to two INDEPENDENT gates: PIN (`pinEnabled`)
  and biometric (`biometric`). The app is locked when EITHER is on (`isLockEnabled()` /
  `lockActive()`). `isBiometricUnlockEnabled()` no longer requires a PIN; `disablePin()` keeps a
  biometric-only lock; `setBiometricUnlock(false)` fully unlocks when it was the last gate;
  `locked` starts true if either gate is set.
- **`api/biometric.ts`** `promptBiometric(reason, allowDeviceCredential=false)` — pass true when
  biometrics are the SOLE lock so the OS offers the device PIN/pattern as a fallback (no lockout).
- **`PinLockGate.svelte`** two modes: PIN set → PIN screen (+ fingerprint button); biometric-only →
  a fingerprint screen (auto-prompt with device-credential fallback, an Unlock button to retry).
- **`PinLockSetting.svelte`**: the "Unlock with fingerprint / face" toggle is shown ALWAYS (not just
  when a PIN exists); its description adapts (PIN-unlock vs "require fingerprint to open, device
  PIN/pattern is the fallback"). Enabling still requires a confirming scan (+ availability check).
- Feature-tour lock slide reworded to mention fingerprint-to-open.
- Tests updated: biometric-only lock counts + starts locked on reload; disablePin keeps biometric;
  turning biometric off fully unlocks.

## Scope note (honest)
"Log into the app with your fingerprint" here means **gating app access** with biometrics (the app
already remembers your Grindr session in the keyring, so opening the app restores it; the biometric
gate sits in front of that). It does NOT store your Grindr password to re-authenticate a fresh login
after an explicit logout/session-expiry — that would be a separate credential-storage feature.
Needs on-device verification of the actual sensor prompt + device-credential fallback.
