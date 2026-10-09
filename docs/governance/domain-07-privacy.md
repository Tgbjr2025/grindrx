# Domain 7: Privacy & Data Lifecycle — Measurement Report

**Repository:** `/srv/projects/grindrx-work`  
**Commit:** `7fffcec` (branch `main`)  
**Date:** 2026-10-09  
**Agent:** MEASUREMENT (observational only — no source modifications)

---

## Executive Summary

This report inventories every location and lifetime of account-specific data in GrindrX. The codebase demonstrates **significant privacy engineering investment** — particularly the sign-out purge system (`src/lib/app-data/purge.ts`) which addresses a previously severe cross-account data leak. However, gaps remain in notification privacy (lock-screen visibility), device-scoped key handling, and EXIF metadata handling for non-JPEG/GIF formats.

---

## 1. Persistent Storage

### 1.1 localStorage (WebView)

| Key | Category | Content | Lifetime | Sign-out Cleared? | Account Deletion | Encrypted/Access-Controlled |
|-----|----------|---------|----------|-------------------|------------------|----------------------------|
| `grindrx-saved-phrases` | User content | Saved message snippets (up to 100, 1KB each) | Until explicit delete or sign-out | ✅ Yes (`PER_ACCOUNT_LOCALSTORAGE_KEYS`) | ⚠️ Only via sign-out purge | No (plaintext, user-writable) |
| `grindrx-explore-location` | Location | Browsing geohash + label override | Until cleared or sign-out | ✅ Yes | ⚠️ Only via sign-out purge | No |
| `grindrx-mediaid-cache` | Media index | `mediaHash` → `{mediaId, signedUrl, mediaHash}` (minted chat media IDs) | Until invalidated or sign-out | ✅ Yes | ⚠️ Only via sign-out purge | No — signed URLs are **bearer-equivalent for ~15 min** |
| `grindrx-stored-viewers` | Social graph | Last 50 profile viewers (names, photo hashes, distances, view counts) | Until 50 newer viewers or sign-out | ✅ Yes (fixed in v0.1.33) | ⚠️ Only via sign-out purge | No |
| `grindrx-geohash-user-pinned` | Location flag | "Chosen by hand" flag for explore location | Until sign-out | ✅ Yes | ⚠️ Only via sign-out purge | No |
| `grindrx-install-id` | Device ID | Pseudonymous install UUID (cross-account link) | Until sign-out | ✅ Yes | ⚠️ Only via sign-out purge | No |
| `grindrx-tour-done` | Onboarding | Feature tour completion flag | Until sign-out | ✅ Yes | ⚠️ Only via sign-out purge | No |
| `pref:distanceUnit` | Preference | `"mi"` or `"km"` | Until sign-out | ✅ Yes | ⚠️ Only via sign-out purge | No |
| `grindrx-pinlock-*` (7 keys) | Auth gate | PIN salt, hash, iterations, biometric flag, failures, lockout, clock | Until PIN disabled or sign-out | ✅ Yes | ⚠️ Only via sign-out purge | **No — salt/hash/iterations in plaintext localStorage** |
| `chat:read:{conversationId}` | Chat state | Per-conversation read cursors (timestamps) | Until conversation purged or sign-out | ✅ Yes (prefix match) | ⚠️ Only via sign-out purge | No |
| `grindrx-update-dismissed-{version}` | UI state | Dismissed "What's new" versions | Until sign-out | ✅ Yes (prefix match) | ⚠️ Only via sign-out purge | No |
| `grindrx-last-seen-version` | Onboarding | App version string (e.g., `"0.1.33"`) | **Survives sign-out** (device-scoped) | ❌ **Deliberately kept** | ❌ Survives | No |

**Account Isolation Evidence:** The purge system enumerates all per-account keys explicitly (`PER_ACCOUNT_LOCALSTORAGE_KEYS`, `PER_ACCOUNT_LOCALSTORAGE_PREFIXES`) and removes them in `purgeAccountLocalData()`. Tests verify every seeded PII key is cleared.

**Gap:** `grindrx-install-id` is purged on sign-out but is a **cross-account linkage vector** while present. `grindrx-last-seen-version` is device-scoped and correctly kept, but `grindrx-tour-done` (same class) is purged — an acknowledged inconsistency documented in `purge.ts:119-124`.

### 1.2 Tauri AppData (Native Filesystem)

| File | Content | Format | Lifetime | Sign-out Cleared? | Encrypted |
|------|---------|--------|----------|-------------------|-----------|
| `preferences.data` | Geohash (~±4m precision), incognito, reveal toggles, notification prefs | msgpack (zod-validated) | Until overwritten or sign-out | ✅ Deleted or neutralized | No (AppData, user-readable) |

**Purge Behavior:** `purgePreferencesFile()` attempts `fs:remove`; on failure (missing `fs:allow-remove` capability), overwrites with PII-free defaults (`geohash: null`, toggles `false`). Failures logged but purge continues.

**Gap:** If `remove` fails AND `writeAppDataFile` fails, previous user's geohash persists on disk. No test covers this double-failure path.

### 1.3 OS Keystore / Keyring (Secure Storage)

| Entry | Service/User | Content | Lifetime | Sign-out Cleared? | Platform |
|-------|--------------|---------|----------|-------------------|----------|
| `open-grind/session` | Keyring | Session JWT (`auth_token`, `session_id`, `profile_id`, `email`, `expires_at`) | Until logout or expiry | ✅ `AuthStorage::delete_session_async()` | Yes (OS keystore: Android Keystore, iOS Keychain, Windows Credential Manager, Linux libsecret, macOS Keychain/file-store) |
| `open-grind/device` | Keyring | DeviceInfo (device_id, advertising_id, model, manufacturer, etc.) | Until rotated or reinstall | ❌ **Survives sign-out** (device-scoped) | Yes (OS keystore) |

**Account Isolation Evidence:** Session is tied to email in `Session` struct. `logout` command calls `delete_session_async()` and bumps `ws_epoch` to tear down WS. `login` also bumps epoch on account switch.

**Gap:** DeviceInfo persists across accounts — acceptable (device identity), but `advertising_id` is a **stable cross-app tracking identifier** regenerated only on `rotate_api_params` (unlimited, no rate limit — noted as B8 in `client.rs:183-188`).

### 1.4 IndexedDB / SQLite / Cache API

**Finding:** No IndexedDB, SQLite, or Cache API usage found in codebase. All client-side persistence uses localStorage or Tauri AppData/Keyring.

---

## 2. In-Memory Caches

| Cache | Location | Content | Max Size | Lifetime | Sign-out Cleared? | Leak Risk |
|-------|----------|---------|----------|----------|-------------------|-----------|
| `profilesCache` (Map) | `src/lib/api/profile.ts:25-28` | Full `Profile` objects by profileId | Unbounded (time-TTL 60s) | Process | ✅ `clearAllProfileCaches()` | Low (TTL-bounded) |
| `myProfileCache` | `src/lib/api/profile.ts:116-119` | Self profile (short) | 1 entry (60s TTL) | Process | ✅ `clearAllProfileCaches()` | Low |
| `mediaIdCache` (Map + localStorage) | `src/lib/api/profile.ts:219` | `mediaHash` → `{mediaId, signedUrl, mediaHash}` | Unbounded (persisted) | Process + disk | ✅ `clearMediaIdCache()` | **High — signed URLs are bearer tokens** |
| `objectUrlCache` (Map) | `src/lib/utils/authed-image.ts:59` | `sourceUrl` → `blob:` object URL (full-res image bytes) | **32 entries** (MAX_ENTRIES) | Process | ✅ `purgeAuthedImageCache()` (v0.1.33 fix) | **Critical — was cross-account leak before fix** |
| `inflight` (Map) | `src/lib/utils/authed-image.ts:60` | In-flight fetch promises | Unbounded | Process | ✅ Cleared in purge | Medium (dedup only) |
| `refCounts` / `retired` (Map) | `src/lib/utils/authed-image.ts:65-67` | Reference counts for blob revocation | `MAX_RETIRED = 32` | Process | ✅ Cleared in purge | Medium |
| `viewers` (rune store) | `src/lib/app-data/viewers.svelte.ts:226-228` | Last 50 `StoredViewer` objects | 50 entries | Process + localStorage | ✅ `clearStoredViewers()` | Medium (social graph) |
| `profilesCache` (grid) | `src/routes/(protected)/(navbar)/(root)/grid.ts` | Grid profile batches | LRU, capped | Process | Not explicitly purged | Low (re-fetched on navigate) |

**Account Isolation Evidence:** `purgeAccountLocalData()` calls `clearAllProfileCaches()`, `clearMediaIdCache()`, `purgeAuthedImageCache()`, `clearStoredViewers()` in sequence before localStorage pass. Tests verify `objectUrlCache` is emptied and all `blob:` URLs revoked.

**Gap:** Grid profile cache in `grid.ts` not explicitly cleared on sign-out (re-fetched on navigation, but could leak via memory inspection).

---

## 3. Media/Image Caches

### 3.1 Authenticated Blob Cache (`authed-image.ts`)

- **Mechanism:** `resolveAuthedImage(url)` fetches Grindr-hosted media (`cdns.grindr.com`, `*.grindr.com`, `*.grindr.mobi`) via `fetch_authed_bytes` (Rust command with bearer token), wraps bytes in `blob:` object URL, caches in module-state `Map`.
- **Capacity:** 32 full-resolution images (`MAX_ENTRIES`), LRU eviction with reference counting to avoid revoking displayed images.
- **Purge:** `purgeAuthedImageCache()` revokes **all** object URLs (including `retired` parked blobs), clears maps, increments `cacheEpoch` to discard in-flight fetches from signed-out session.
- **URL Validation:** `classifyHost()` allows only `cdns.grindr.com`, `*.grindr.com`, `*.grindr.mobi` for authed fetch. Signed CloudFront URLs bypass auth and load directly.
- **Failure Paths:** 12s timeout on `fetch_authed_bytes`; on failure returns `null`, caller falls back to raw URL (403). Purge increments epoch so in-flight fetches from old session drop their bytes.

**Account Isolation:** Fixed in v0.1.33 — previously `clearMediaIdCache()` only dropped localStorage key, leaving 32 full-res blobs in memory accessible to next account.

### 3.2 CDN Image Cache (`cdn.ts`, `cdn-image-load.ts`)

- **Mechanism:** Public thumbnails/profile images via signed CloudFront URLs (no auth needed). No client-side caching beyond browser HTTP cache.
- **Transformations:** None — URLs used directly in `<img src>`.
- **URL Validation:** `isAuthedHost()` distinguishes auth-required vs direct URLs.

---

## 4. Temporary Files

| Location | Content | Lifetime | Cleanup |
|----------|---------|----------|---------|
| `preferences.data.tmp` | Atomic write temp file for preferences | Milliseconds (rename) | Auto-cleaned on crash (orphan `.tmp`) |
| `blob:` object URLs | Full-resolution image bytes in WebView memory | Until cache eviction or purge | `URL.revokeObjectURL()` on eviction/purge |
| Audio blobs (`MediaRecorder`) | Voice message recordings | Until upload completes | GC after `blobToBase64()` |
| Canvas intermediate bitmaps | Downscaled images for upload | During `downscaleImage()` | `bitmap.close()` in `finally` block |

**Finding:** No persistent temporary files written to disk. All media processing in-memory via Web APIs.

---

## 5. Logs and Diagnostic Output

### 5.1 WebView Console (Android logcat in production)

| Log Source | Content | Redaction | Risk |
|------------|---------|-----------|------|
| `console.error/warn` in `authed-image.ts` | Fetch failures (URL truncated to 120 chars) | URL truncated, no token | Low |
| `console.error` in `purge.ts` | Purge failures (key names only) | No PII | Low |
| `console.error` in `app-lock.svelte.ts` | PIN/biometric persist failures | No PIN values | Low |
| `console.warn` in `viewers.svelte.ts` | Persist/clear failures | No viewer data | Low |
| `console.warn` in `ws.svelte.ts` | WS schema mismatches (type + first 3 zod issues) | **Payload NOT logged in prod** (dev-only) | **Mitigated** |
| `console.error` in `hooks.client.ts` | Auth state failures | No PII | Low |
| `eprintln!` in Rust (`rest.rs`) | Request/response logging (debug builds only) | **Authorization header redacted**, body redacted | **Production-safe** |
| `eprintln!` in Rust (`auth.rs`, `ws.rs`) | Auth/WS lifecycle events | No tokens | Low |

**Critical Finding:** `ws.svelte.ts:203-234` explicitly **does not log `event.payload` in production** because `vite.config.mjs` strips `console.log` but keeps `console.warn/error`, which land in logcat readable by any app with `READ_LOGS`. Schema mismatch logs only event type and zod issues.

**Gap:** `rest.rs:215-253` debug logging prints request headers (with Authorization redacted) and body shape (`<N bytes redacted>`). In debug builds this goes to logcat. Release builds exclude this via `#[cfg(debug_assertions)]`.

---

## 6. Browser/WebView Storage

| Storage | Used? | Content |
|---------|-------|---------|
| localStorage | ✅ Yes | All per-account keys (see §1.1) |
| sessionStorage | ❌ No | — |
| IndexedDB | ❌ No | — |
| Cache API | ❌ No | — |
| Cookies | ❌ No | — |
| Service Worker | ❌ No | — |

---

## 7. Native Storage and OS Keystores

### 7.1 Keyring (Secure Credential Storage)

- **Backend:** Platform-native via `keyring_core`:
  - Android: `android_native_keyring_store` → Android Keystore (hardware-backed when available)
  - iOS: `apple_native_keyring_store::protected` → iOS Keychain (Secure Enclave)
  - macOS: `apple_native_keyring_store::keychain` (feature `keychain`) or file-store fallback
  - Windows: `windows_native_keyring_store` → Credential Manager
  - Linux: `linux_keyutils_keyring_store` → kernel keyrings / libsecret
- **Entries:** `open-grind/session` (auth credentials), `open-grind/device` (device identity)
- **Permissions:** File-store fallback (macOS without keychain) uses `0o700` dirs, `0o600` files (`storage.rs:34-41`).
- **Sign-out:** `AuthStorage::delete_session_async()` deletes session entry. Device entry persists.

### 7.2 Biometric

- **Android/iOS:** `tauri_plugin_biometric` — OS-managed, no app-accessible secret storage.
- **Fallback:** Device credential (PIN/pattern) when `allowDeviceCredential=true`.

---

## 8. Network Requests and Telemetry

### 8.1 Authenticated Requests (Bearer Token)

- **All API calls:** `Authorization: Grindr3 <session_id>` header via `request_raw`/`request_json`.
- **Redirects:** Refused globally (`redirect(Policy::none())` in `client.rs:32`, `rest.rs:631`).
- **Host Allowlist:** `fetch_authed_bytes`/`fetch_media_bytes` validate eTLD+1 (`grindr.com`, `grindr.mobi`, `cloudfront.net`) and enforce HTTPS before attaching token.

### 8.2 Telemetry / Usage Pings

| Endpoint | Data | Frequency | Opt-out |
|----------|------|-----------|---------|
| `https://cam.dominusaxis.com/grindrx/ping` | `{id: anonymous_install_id, v: app_version}` | Fire-and-forget (caller swallows failures) | No explicit opt-out |
| `https://cam.dominusaxis.com/grindrx/stats` | Active user counts by version (7-day window) | On app start / update check | No |
| `https://api.github.com/repos/Tgbjr2025/grindrx/releases` | Release metadata (public) | Update check | N/A (public) |
| `https://git.dominusaxis.com/api/v1/repos/dominus/grindrx/releases` | Release metadata (public) | Update check | N/A (public) |

**Finding:** `send_usage_ping` sanitizes inputs to alphanumeric + `_-.` (64 chars max). No PII. But **no user consent mechanism** documented.

---

## 9. Notifications and Lock-Screen Content

### 9.1 Notification Channels (Android)

| Channel ID | Importance | Visibility | Content |
|------------|------------|------------|---------|
| `grindx_messages` | HIGH | **DEFAULT (not PRIVATE/SECRET)** | Chat previews (body text), tap alerts |
| `grindx_service` | LOW | SECRET (`VISIBILITY_SECRET`) | "GrindrX is running" persistent banner |

### 9.2 Lock-Screen Gate (Rust WS Notifier)

**Code Path:** `ws.rs:300-319` (`maybe_notify_message`), `ws.rs:489-508` (`maybe_notify_tap`), `ws.rs:528-549` (`post_notification`)

**Gates (all must pass):**
1. `!state.is_locked()` — app lock not engaged
2. `state.prefs_loaded` — WebView has pushed real prefs
3. `state.notify_messages` / `state.notify_taps` — user hasn't disabled

**Defense-in-Depth:** `post_notification()` re-checks `is_locked()` and substitutes `LOCKED_NOTIFICATION_BODY` ("Open GrindrX to see your new activity").

**Critical Gap:** `grindx_messages` channel created with `IMPORTANCE_HIGH` but **NOT `VISIBILITY_PRIVATE`** in both `MainActivity.kt:107-118` and `NotificationService.kt:161-172`. `ws.rs:521-527` explicitly documents this as a required follow-up: channel **must** be created with `setVisibility(Notification.VISIBILITY_PRIVATE)` in Kotlin. Without this, Android renders notification body on lock screen regardless of app lock state.

**Evidence:** `MainActivity.kt:162-172` sets `FLAG_SECURE` on window (blocks recents thumbnail, screenshots, screen recording) — good for WebView content. But notification channel visibility is separate.

---

## 10. Backups and Export Files

| Mechanism | Content | User-Controlled? |
|-----------|---------|------------------|
| Android Backup (`adb backup`) | App data including localStorage, AppData, Keyring (if `allowBackup=true`) | Manifest-controlled (`android:allowBackup`) — **not audited** |
| iOS Backup (iTunes/Finder) | Keychain (if `kSecAttrAccessibleAfterFirstUnlock`), App sandbox | Not audited |
| Manual export | No export feature implemented | N/A |

**Gap:** `AndroidManifest.xml` not inspected for `allowBackup` flag. Keyring entries use default accessibility (likely `AfterFirstUnlock` → included in backups).

---

## 11. Generated Artifacts Containing Test/User Data

| Artifact | Location | Contains PII? |
|----------|----------|---------------|
| `coverage/` | `lcov.info`, HTML reports | No (code coverage only) |
| `dist/` | Built WebView assets | No (bundled source) |
| `.svelte-kit/` | SvelteKit build artifacts | No |
| `node_modules/` | Dependencies | No |
| `target/` (Rust) | Compiled artifacts | No |
| Test snapshots | `*.test.ts` inline expectations | Some seeded PII in `purge.test.ts` (test-only) |

---

## 12. Image/Media Processing: Metadata Handling

### 12.1 Upload Pipeline (`profile.ts:315-606`)

**Primary Sanitizer:** Canvas re-encode (`canvas.toBlob()`) — **strips all EXIF/IPTC/XMP** by writing new file.
- Applied to **all non-GIF images** (including those ≤1920px) since v0.1.33 fix.
- JPEG quality: 0.85 (`REENCODE_QUALITY`).

**Fallback Sanitizer (byte-level, in-place):**
- **JPEG:** `stripJpegMetadata()` — drops APP1 (EXIF/XMP), APP11 (JUMBF), APP13 (IPTC), COM. Keeps APP0 (JFIF), APP2 (ICC), APP14 (Adobe).
- **GIF:** `stripGifMetadata()` — drops Comment extension (0xFE) and non-NETSCAPE2.0/ANIMEXTS1.0 Application extensions. Keeps frame data, delays, loop count.
- **PNG/WebP/HEIF:** **NOT rewritten** — rely on canvas path (always taken for these formats).

**Failure Handling:** If canvas path fails (no 2d context, `toBlob` null, decode error), byte-level stripper used. If stripper returns `null` (unrecognized container), **original bytes uploaded** — **GPS leak possible for unhandled formats**.

**Gap:** PNG (eXIf/iTXt chunks), WebP/HEIF (EXIF chunk) not stripped in fallback path. Canvas path covers them *if* canvas succeeds.

### 12.2 Album Upload (`album.ts:296-326`)

- Uses `upload_album_content` (multipart) — **no metadata stripping documented**. Relies on frontend calling `prepareImageForUpload` (which uses `downscaleImage` → canvas re-encode).

### 12.3 Profile Photo Upload (`profile.ts:633-649`)

- Uses `upload_profile_image` → `downscaleImage` → canvas re-encode → EXIF stripped.

### 12.4 Chat Media Re-upload (`prepareAuthedUrlForSend`, `prepareSavedPhotoForSend`)

- Fetches full-res bytes via `fetch_authed_bytes`/`fetch_media_bytes` (already stripped at original upload), re-uploads via `upload_image` → canvas re-encode again.

---

## 13. Sign-Out Behavior Summary

**Sequence (from `purge.ts:16-23`):**
1. `callMethod("logout")` — revokes server session, deletes keyring entry, bumps `ws_epoch`
2. `clearAllProfileCaches()` + `clearMediaIdCache()` — in-memory API caches
3. `purgeAuthedImageCache()` — **revokes all `blob:` object URLs** (critical fix)
4. `clearStoredViewers()` — in-memory + localStorage viewer list
5. `disablePin()` + `setBiometricUnlock(false)` — app-lock state + localStorage keys
6. `localStorage.removeItem()` for all `PER_ACCOUNT_LOCALSTORAGE_KEYS` + prefix matches
7. `purgePreferencesFile()` — delete or neutralize `preferences.data`

**Verified by Tests:** All per-account keys cleared, media cache emptied and blobs revoked, viewers cleared, preferences neutralized, idempotent, non-throwing.

**Gap:** `grindrx-tour-done` purged but `grindrx-last-seen-version` kept — acknowledged inconsistency.

---

## 14. Account Deletion Behavior

**Finding:** No account deletion flow implemented in client. Server-side account deletion would require:
1. `logout` (clears local session)
2. Server API call to delete account (not implemented)
3. Client purge (already exists via `purgeAccountLocalData`)

**Current State:** Sign-out purge is the only user-initiated data removal.

---

## 15. Process Termination Persistence

| Data | Survives Process Death? | Mechanism |
|------|------------------------|-----------|
| localStorage keys | ✅ Yes | Browser persistence |
| `preferences.data` (AppData) | ✅ Yes | Filesystem |
| Keyring session | ✅ Yes | OS keystore |
| Keyring device | ✅ Yes | OS keystore |
| In-memory caches | ❌ No | Process memory |
| `blob:` object URLs | ❌ No | Revoked on purge or process exit |
| WS connection | ❌ No | Torn down, reconnects on restart |

---

## 16. Leak Risks Summary

| Risk | Location | Severity | Status |
|------|----------|----------|--------|
| Cross-account photo leak via `blob:` cache | `authed-image.ts` (pre-v0.1.33) | **Critical** | ✅ Fixed (`purgeAuthedImageCache`) |
| Signed CDN URLs in localStorage (`mediaid-cache`) | `profile.ts:204` | High (bearer for 15 min) | ✅ Purged on sign-out |
| Lock-screen notification preview | `ws.rs` + `MainActivity.kt` | **High** | ❌ **Open** — channel lacks `VISIBILITY_PRIVATE` |
| EXIF/GPS in PNG/WebP/HEIF fallback | `profile.ts:502-504` | Medium | ⚠️ Partial (canvas path covers if successful) |
| `advertising_id` stable cross-app tracker | `headers.rs:402` | Medium | ⚠️ Rotatable via `rotate_api_params` (unlimited) |
| `grindrx-install-id` cross-account link | `purge.ts:71` | Low | ✅ Purged on sign-out |
| Logcat exposure (debug builds) | `rest.rs:215-253` | Low | ✅ Release builds exclude |
| Keyring session in backups | Android/iOS backup | Low | ⚠️ Not audited (`allowBackup` flag) |
| Viewer social graph in localStorage | `viewers.svelte.ts` | Medium | ✅ Purged on sign-out |

---

## 17. Tested vs Unverified

| Area | Test Coverage | Verification Method |
|------|---------------|---------------------|
| Sign-out purge (localStorage) | ✅ `purge.test.ts:174-192` | Unit test with memory storage |
| Sign-out purge (media cache + blob revocation) | ✅ `purge.test.ts:240-278` | Unit test with `URL` stub |
| Sign-out purge (viewers) | ✅ `purge.test.ts:283-303` | Unit test |
| Sign-out purge (preferences.file) | ✅ `purge.test.ts:315-346` | Unit test with mocked FS |
| EXIF stripping (JPEG/GIF) | ✅ `profile.test.ts` (implied) | Unit test |
| EXIF stripping (PNG/WebP/HEIF fallback) | ❌ **No test** | Unverified |
| Notification lock-screen gate | ❌ **No integration test** | Code review only |
| Keyring session isolation | ❌ **No test** | Code review only |
| `rotate_api_params` rate limit | ❌ **No test** | Documented as known gap (B8) |
| Backup inclusion | ❌ **Not tested** | Manifest not inspected |

---

## 18. Conclusions

### Privacy Posture: **Strong but Incomplete**

**Strengths:**
- Comprehensive sign-out purge with explicit enumeration and tests
- In-memory authenticated media cache properly revoked on sign-out (fixed v0.1.33)
- EXIF stripping via canvas re-encode for all non-GIF uploads
- OS keystore for session credentials (hardware-backed on mobile)
- `FLAG_SECURE` on Android window (blocks recents/screenshots)
- Lock-screen notification gate in Rust notifier (3-layer check)
- Redirect refusal on all authenticated requests
- Host allowlist + HTTPS enforcement for media fetches

**Critical Gaps (P0):**
1. **Lock-screen notification visibility** — `grindx_messages` channel lacks `VISIBILITY_PRIVATE`; chat previews render on lock screen despite app lock.
2. **PNG/WebP/HEIF EXIF fallback** — byte-level stripper skips these formats; canvas failure path uploads raw metadata.

**Major Gaps (P1):**
3. **No user consent for telemetry pings** — `send_usage_ping` fires without opt-out.
4. **`rotate_api_params` unlimited** — can regenerate `advertising_id` in tight loop (DoS keystore).
5. **Keyring backup exposure** — `allowBackup` flag not audited; session may persist in Android/iOS backups.

**Minor Gaps (P2/P3):**
6. `grindrx-tour-done` / `grindrx-last-seen-version` inconsistency.
7. Grid profile cache not explicitly purged on sign-out.
8. Double-failure path for `preferences.data` purge untested.

---

## 19. Evidence Register

| Finding ID | File | Line | Evidence Type |
|------------|------|------|---------------|
| P7-001 | `purge.ts` | 50-84 | Per-account key enumeration |
| P7-002 | `purge.ts` | 241-295 | Purge sequence implementation |
| P7-003 | `purge.test.ts` | 240-278 | Media cache purge + blob revocation test |
| P7-004 | `authed-image.ts` | 177-191 | `purgeAuthedImageCache` implementation |
| P7-005 | `authed-image.ts` | 58 | `MAX_ENTRIES = 32` |
| P7-006 | `profile.ts` | 382-420 | JPEG metadata stripper |
| P7-007 | `profile.ts` | 435-490 | GIF metadata stripper |
| P7-008 | `profile.ts` | 502-504 | PNG/WebP/HEIF fallback gap |
| P7-009 | `ws.rs` | 300-319 | Lock-screen notification gate |
| P7-010 | `ws.rs` | 521-527 | Missing `VISIBILITY_PRIVATE` documented |
| P7-011 | `MainActivity.kt` | 107-118 | Channel creation without visibility |
| P7-012 | `NotificationService.kt` | 161-172 | Channel creation without visibility |
| P7-013 | `auth.rs` | 117-195 | Keyring session storage/deletion |
| P7-014 | `headers.rs` | 371-437 | DeviceInfo + advertising_id |
| P7-015 | `client.rs` | 183-188 | Unlimited `rotate_api_params` |
| P7-016 | `rest.rs` | 659-662 | HTTPS enforcement for authed fetch |
| P7-017 | `rest.rs` | 682 | Redirect refusal for media fetch |
| P7-018 | `storage.rs` | 34-41 | File-store permissions (0o700/0o600) |
| P7-019 | `MainActivity.kt` | 162-172 | `FLAG_SECURE` set |
| P7-020 | `rest.rs` | 215-253 | Debug logging redaction |

---

*End of Domain 7 Measurement Report*