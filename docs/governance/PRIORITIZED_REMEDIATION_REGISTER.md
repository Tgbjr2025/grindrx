# Prioritized Remediation Register — GrindrX v0.1.48

**Baseline:** `7fffcec` | **Directive:** MASTER_MEASUREMENT_DIRECTIVE.md §9

---

## Status Legend
- `OPEN` → `TRIAGED` → `APPROVED` → `IN_PROGRESS` → `IMPLEMENTED` → `VERIFIED` → `CLOSED`
- `DEFERRED` | `REJECTED_WITH_REASON` | `NOT_REPRODUCIBLE` | `BLOCKED`

---

## P0 — Release Blocking (10 Findings)

| ID | Finding | Domain | Owner | Dependencies | Acceptance Criteria | Status |
|----|---------|--------|-------|--------------|---------------------|--------|
| P0-001 | `grindx_messages` notification channel lacks `VISIBILITY_PRIVATE` | 07 | Android | `MainActivity.kt`, `NotificationService.kt` | Lock-screen shows "New message" only; no chat text | OPEN |
| P0-002 | Authenticated media cache cross-account leak (fixed v0.1.33) | 07 | Core | `authed-image.ts`, purge tests | Cache fully revoked on sign-out; `cacheEpoch` blocks stale fetches | VERIFIED |
| P0-003 | Version drift: 3 different version tuples in repo | 10 | Build | `tauri.conf.json`, `tauri.properties`, CI gate | Single source of truth; all builds produce 0.1.48/1083 | OPEN |
| P0-004 | Android APK never built/validated on device | 10 | Android | CI config, SDK/NDK, keystore, device | `aarch64-linux-android` compiles; APK installs/runs | OPEN |
| P0-005 | Commit `5b69ca4` absent from all repos | 11 | Provenance | External backups | Commit located or dispositioned HISTORICAL-ONLY | OPEN |
| P0-006 | Stale Android assets tracked (ship 0.1.33/1068) | 11 | Build | `src-tauri/gen/android/.../tauri.conf.json`, `tauri.properties` | Regenerated assets match 0.1.48/1083/com.grindrx.app | OPEN |
| P0-007 | 9 HTTP endpoints unprobed (UNPROBED in source) | 04 | API | Live server credentials | Endpoints verified or documented as deprecated | OPEN |
| P0-008 | No dependency vulnerability scanning in CI | 06 | CI | `cargo-audit`, `npm audit` (Bun→npm lockfile) | CI fails on HIGH/CRITICAL vulns | OPEN |
| P0-009 | PNG/WebP/HEIF EXIF not stripped on canvas fallback | 07 | Core | `profile.ts:502-504` | All image formats sanitized; tests added | OPEN |
| P0-010 | `rotate_api_params` unlimited (DoS keystore) | 07 | Core | `ws.rs`, keyring usage | Rate limit + backoff on rotation | OPEN |

---

## P1 — Major Product Completion (12 Findings)

| ID | Finding | Domain | Owner | Acceptance Criteria | Status |
|----|---------|--------|-------|---------------------|--------|
| P1-001 | No user consent for telemetry pings | 07 | Core | Opt-in dialog; disabled by default | OPEN |
| P1-002 | WS protocol completely untested vs real server | 05 | Test | Contract tests against staging | OPEN |
| P1-003 | 30/65 test files mock `invoke()` without contract validation | 05 | Test | Schema validation on all mocks | OPEN |
| P1-004 | WS reconnect has no max attempts (infinite retry) | 08 | Core | Max attempts configured; backoff capped | OPEN |
| P1-005 | MessagesList renders all messages (no virtualization) | 08 | Core | Windowed rendering for >100 messages | OPEN |
| P1-006 | Image upload: double base64 round-trip (33% × 2) | 08 | Core | Direct blob upload or single encode | OPEN |
| P1-007 | Android back gesture handler leak (never unregistered) | 09 | Android | Registration balanced with unregistration | OPEN |
| P1-008 | `rotate_api_params` race on rotation | 09 | Core | Guard + idempotency key | OPEN |
| P1-009 | iOS: no background modes for WS keep-alive | 10 | iOS | `UIBackgroundModes` includes `voip`/`fetch` | OPEN |
| P1-010 | No CI for Android/iOS/desktop builds | 10 | CI | All 3 platforms build in CI | OPEN |
| P1-011 | `bb05c55` provenance unverifiable | 12 | Provenance | Upstream repo repaired or dispositioned | OPEN |
| P1-012 | Message variant union divergence (2 extra in OpenGrind) | 12 | Core | Union merged; tests for new variants | OPEN |

---

## P2 — Technical Debt / Optimization (Selected)

| ID | Finding | Domain | Acceptance Criteria | Status |
|----|---------|--------|---------------------|--------|
| P2-001 | `preferences.data` double-failure purge path untested | 07 | Failure injection test passes | OPEN |
| P2-002 | Grid profile cache not explicitly purged on sign-out | 07 | Purge test covers grid cache | OPEN |
| P2-003 | `allowBackup` flag not audited (keyring in backups) | 07 | `android:allowBackup=false` or keyring excluded | OPEN |
| P2-004 | No image fetch semaphore (concurrency uncontrolled) | 08 | Semaphore with configurable limit | OPEN |
| P2-005 | `ws:ws_error` listener removed but code path remains | 09 | Dead code removed or re-enabled | OPEN |
| P2-006 | 99 `.bak.*` files in working tree (untracked) | 01 | Cleaned or archived with provenance | OPEN |

---

## P3 — Cleanup / Cosmetic

| ID | Finding | Domain | Status | Verification |
|----|---------|--------|--------|--------------|
| P3-001 | Stale `0.1.38` references in 23 locations (README, whats-new, etc.) | 11 | IMPLEMENTED | Commit `500b505`. Measured **22** tracked files, not 23; **21 are legitimate** (historical prose in `CdnImage.svelte`, `ProfileMiniCard.svelte`, `cdn-image-layout.guard.test.ts`, `vite.config.mjs`; changelog key `whats-new.ts:6`; release records in `CHANGES.md`, fastlane, `memory/`, ledgers). **One live bug fixed**: `tauri.conf.json:22` webview `userAgent` `0.1.38` → `0.1.48`. Drift cannot recur — `.github/workflows/version-check.yml` already fails when `userAgent` lacks `.version`; replayed against old file (exit 1) and new file (pass). `headers.rs` `APP_VERSION = "26.9.1.163471"` is the **spoofed Grindr client** version, deliberately untouched. **`README.md:5` "Current release: v0.1.38" is genuinely stale and NOT fixed — R23 forbids it.** CI not yet run on branch; ledger not updated (`.jsonl` outside this pass's ownership) → not yet `VERIFIED`. |
| P3-002 | 17 unrelated `claude/*` remote branches | 11 | TRIAGED | **Nothing deleted.** Full inventory produced: 17 refs, 12 distinct names, 3 remotes (`github`, `grindrx-forgejo`, `origin`). **9 safe**, **8 hold unmerged work**. `--is-ancestor` alone is misleading — `claude/grindrx-freeze-json-audit-gp4lnk` reads UNIQUE/54 but `git cherry` returns 54 `-` / 0 `+` (all patches already in main, SHAs differ from rewritten history). `github/claude/phone-battery-drain-77zz36` holds 1 real commit (`d7d950b`, `ws.rs` battery/backoff constants absent from main). Awaiting operator approval; delete commands supplied in report, not run. |
| P3-003 | Binary test file `profile.test.ts` should be TypeScript or removed | 01 | IMPLEMENTED | Commit `d0cf011`. File kept (it is valid TypeScript; only its encoding was broken). **12** control bytes total — the 10 NULs plus 2 raw `0x01`, all inside string literals feeding `ascii()`. They are meaningful JPEG bytes (EXIF `Exif\0\0`, `8BIM`, JFIF/ICC padding), so they were **re-encoded as `\x00`/`\x01` escapes, not deleted**. `file -b`: `data` → `JavaScript source, Unicode text, UTF-8 text`. Size `21351` → `21387` (+36 = 12 × +3). All 24 string literals proven byte-identical at runtime by `node` char-code comparison. `vitest run src/lib/api/profile.test.ts` → **30/30 pass**, same as baseline. Pre-existing eslint import-sort errors and prettier warning untouched (confirmed present at HEAD). |

Full method, byte offsets and reasoning: `memory/FIX_NOTES_p3_cleanup_20261010.md`.

---

## Verification Requirements Per Finding

For each finding, verification requires:

1. **Code change** — Implementation in correct repository (core/android/iphone)
2. **Tests** — Unit/integration test added covering the behavior
3. **CI** — Test executes in CI pipeline
4. **Device validation** (P0/P1 platform) — Physical device test
5. **Ledger update** — Post-change measurement recorded in `master_measurement_ledger.jsonl`
6. **Status transition** — `IMPLEMENTED` → `VERIFIED` → `CLOSED`

---

*Register per MASTER_MEASUREMENT_DIRECTIVE.md §9. Update status only after verification.*
