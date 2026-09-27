# FIX_NOTES — v0.1.34 (full audit remediation + release)

**Date:** 2026-09-27 · **Rollback tag:** `audit-v0.1.34-rollback-20260927`
**Full findings:** `memory/AUDIT_REPORT_v0.1.33.md` · **Changelog:** `CHANGES.md` → v0.1.34

## What this release is

Not a feature release. A 100% line-by-line audit of the whole codebase
(30,107 lines TS/Svelte + 3,410 lines Rust + Android config + docs), every line
read, no sampling, in 7 file-disjoint partitions, followed by remediation of
everything found in 8 batches.

## Baseline, captured BEFORE any change

| Gate | Result |
|---|---|
| `svelte-check` | 0 errors, **30** warnings / 5 files |
| `vitest` | 244 tests |
| `eslint src` | claimed clean — **never actually observed to complete** |
| `cargo check/test` | **never run in this version's history** |
| CI | none |

## After

| Gate | Result |
|---|---|
| `svelte-check` | 0 errors, **4** warnings / 4 files |
| `vitest` | **442** tests / 39 files, all passing |
| `eslint` | clean on all 127 changed files (chunked — see note) |
| `cargo check --lib` | clean |
| `cargo test --lib` | **17/17** |
| `cargo check --lib --target aarch64-linux-android` | **clean** |
| CI | `.github/workflows/ci.yml` added (**never executed**) |

**The Rust is the important change in verification terms.** The previous round
shipped three Rust files that had never been compiled (`AtomicU64` never imported,
`WebSocketConfig` is `#[non_exhaustive]`, `connect_async_tls_with_config` takes 4
args not 3). There is no cargo on the OVH host. This round used the M1 Mac over
Tailscale (`ssh mac` = `thomasbateman@100.92.26.108`) and verified against the
**shipping target**, not just the host.

## The 4 criticals

1. **PIN lockout (every PIN set in v0.1.25–v0.1.32).** Legacy single-SHA-256
   verifiers were compared against a PBKDF2 digest with no migration, and the
   upgrade path only ran *after* a successful verify. Permanent, unrecoverable.
   Proven empirically (legacy `ee2d9d48…3e3c` vs `25d8ffd1…5628`), not inferred.
2. **Weight filter sent kg into `weightGramsMin`.** 1000× error; the mapper had
   zero tests. Now `buildCascadeQuery()`, a pure table-tested function.
3. **`retainAuthedImage` had zero callers.** The "never revoke a blob while
   displayed" guarantee was dead code, and its bound test was hollow because the
   cache is module state. Now `resolveAuthedImageRetained()` returns the release
   function *with* the URL.
4. **Lock-screen notifications leaked 80 chars of chat text** past the app lock —
   the Rust notifier had no way to learn the lock state. Fixed on both sides.

11 HIGH, ~30 MEDIUM, 60+ LOW/INFO — all enumerated in the audit report.

## Release mechanics

- version **0.1.34**, versionCode **1069** (was 1068 — a bump was mandatory or
  F-Droid/Play would reject it as a downgrade).
- Built on the M1, `BUILD_EXIT=0`, universal APK, all 4 ABIs, minSdk 28 /
  targetSdk 36.
- Signed with the same `22:D6:…:4C:01` key, `package com.grindrx.app` — identical
  to the published v0.1.33, so it is an in-place upgrade. Verified by
  `aapt2 dump badging` + `apksigner verify --print-certs` against the *actual*
  v0.1.33 artifact, not from memory.
- APK sha256 `00c8582f62a34ab4befe5b9df416ab82abc30a716b06159254b67d50762cff07`,
  71,136,868 bytes, copied to both hosts and re-hashed (R5).
- Verified in the **built** manifest: `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` and
  `READ_EXTERNAL_STORAGE` are **gone**; location permissions present;
  `allowBackup`/`usesCleartextTraffic` still correct.

## Two mistakes made during this release, recorded

1. **`rsync --delete` on `src-tauri/gen/android/` deleted the M1's
   `keystore.properties`** — a machine-local secret that exists nowhere else, so
   the second build came out **unsigned**. Recovered from
   `~/open-grind/src-tauri/gen/android/keystore.properties` (the stale checkout)
   and verified with `keytool -list` that alias `grindx` / owner
   `CN=GrindX, O=GrindX, C=US` matches the published certificate.
   **Never `--delete` a build tree that may hold machine-local files.**
2. **Put the file in the wrong directory first** — `build.gradle.kts` uses
   `rootProject.file("keystore.properties")` (i.e. `gen/android/`), whereas it
   uses plain `file("tauri.properties")` for the version (i.e.
   `gen/android/app/`). Both paths are documented correctly in the README; the
   slip was mine, not a doc error.

A third issue was caught before it shipped: the first build used the **old**
Android manifest because `gen/android/` had not been synced to the M1, so the
media permissions were still present. Caught by reading the built APK's merged
manifest, not by trusting the build's exit code.

## Known-open, deliberately not done

- **Password-reset endpoint contradiction** — the form posts
  `/v1/accounts/password/reset`; Rust implements `/v3/users/forgot-password`, whose
  registered implementation has zero callers. Needs a live Grindr account to
  resolve; guessing risks breaking account recovery.
- **PIN verifier still in plaintext app storage.** Minimum length raised 4→6 and
  the threat model documented honestly, but moving the verifier into the
  keyring/Stronghold needs Rust + a device.
- **The PIN lockout backoff is wall-clock based** and stored in writable storage.
  Hardened (clamped, clock-skew aware) but not tamper-proof; the forward tolerance
  is deliberately loose (24 h) because a tight bound fails *closed* on the
  ordinary case and would cause the same class of support-visible lockout.
- **The two stacked keyboard-compensation mechanisms** (`MainActivity.kt` bottom
  margin *and* `app.html interactive-widget=resizes-content`) may double-count the
  IME height. **Highest-risk unresolved item** — unresolvable without a device.
- **`MainActivity.createNotificationChannel` still needs
  `setVisibility(VISIBILITY_PRIVATE)`** plus a channel-id bump, because Android
  never updates a live channel's visibility. The Rust gate suppresses
  notifications entirely while locked, so this is defence-in-depth.
- `medias` left required in `profileSchema` because a test deliberately pins it.
- Tauri isolation pattern still off (Brownfield); enabling it changes every
  `invoke` path and needs a device test.
- Location bubbles still fetch a third-party map tile, leaking the reader's IP and
  a `Referer` containing the conversationId. Needs a product decision.
- Data-URL accumulation in the album viewer needs a thumb-vs-full-res design
  decision.

## Not verified

**Not device-tested.** Everything compiles, is signed and passes 442 + 17 tests;
nothing has been run on hardware. Fixes resting on Svelte-5 runtime semantics
(windowing maths, layout thrash, IME composition, permission-dialog ordering,
touch gestures) are source-level reasoning, marked UNVERIFIED-RUNTIME by the agent
that made them. The CI workflow has never executed. `esbuild`/`vite` strip
`console.log` in production, but nothing here ran in a real WebView.
