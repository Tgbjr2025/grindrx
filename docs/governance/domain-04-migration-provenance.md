# AUDIT 4 — Migration Provenance Report

**Generated:** 2026-10-09T10:15:00+02:00
**Agent:** AUDIT 4 (source, platform, migration and reconciliation provenance)
**Repository:** `/srv/projects/grindrx-work` (HEAD `7fffcec773b539a18b2f993cb9d8143fc2ec32c5`)
**Scope:** Branch inventory, source provenance, rescued iOS work, platform separation, build artifact policy, version consistency, CI configuration

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total commits (grindrx-work) | 493 |
| Local branches | 13 |
| Remote-tracking branches | 28 |
| Stale `0.1.38` references | 23 locations |
| Current version `0.1.48` locations | 6 canonical |
| Current `versionCode` `1083` locations | 3 canonical |
| Build artifacts tracked in git | 0 (correct) |
| `dist/` tracked in git | 0 (correct) |
| iOS generated project in git | **NO** |
| Android generated project in git | 48 files (tracked) |
| CI validates Android APK build | **NO** |
| CI validates iOS build | **NO** |
| CI validates cross-compilation | **NO** |
| Commit `5b69ca4` located | **NO — absent from all 4 repos** |

---

## 1. Branch Inventory Across Repos

### grindrx-work (canonical)
- **Local branches (13):** `audit/v0.1.9-fixes`, `ci/release-version-gate`, `claude/grindrx-freeze-json-audit-gp4lnk`, `claude/grindrx-total-downloads-o1hodl`, `fix/album-exif-bypass`, `fix/auth-contract`, `fix/http-retry-policy`, `fix/media-cache-signout`, `fix/media-exif-sanitization`, `fix/session-expiry-cache-purge`, `fix/test-suite-load-flake`, `integrate/p0-security-2026-10-09`, `main`, `migration/ovh-state-2026-10-05`
- **Remote branches (28):** Includes `origin/main` (120 commits behind), `grindrx-forgejo/main` (33 commits behind, at v0.1.39), `github/main` (upstream open-grind), plus 17 stale `claude/*` branches from unrelated sessions (forex bot, carving, vehicle pricing, etc.)
- **Divergence:** `main` is 120 commits ahead of `origin/main` (upstream), 33 ahead of `grindrx-forgejo/main`. `migration/ovh-state-2026-10-05` == `main` == `integrate/p0-security-2026-10-09` at `7fffcec`.

### opengrind-upstream
- **Branches (3):** `main`, `fix/album-reaction-render`, `fix/linkify-messages`
- **State:** Only 2 commits since fork point (`7222650`). Effectively dormant.

### dominusaxis / anchor-ext
- Single commit each: migration docs (`docs: add PROJECT.md and BUILD.md`). No code.

### Stale/Divergent Branches Requiring Action
| Branch | Status | Action |
|--------|--------|--------|
| `ci/release-version-gate` | Merged to `integrate/` but not `main` | **Merge to main** — contains release-version gate |
| `fix/*` (5 branches) | Merged to `integrate/` | Verify all needed fixes are in `main` |
| `claude/grindrx-freeze-json-audit-gp4lnk` | At `0c223af` (geohash fix) | Already in `main` via `integrate/` |
| `github/claude/forex-trading-bot-xychyi` et al. | Unrelated to GrindrX | **Remove remote tracking** — pollutes inventory |

---

## 2. Source Provenance Classification

| Code Area | Provenance | Evidence |
|-----------|------------|----------|
| GrindrX core (src/, src-tauri/) | **CANONICAL (GRINDRX)** | 493 commits diverged from upstream at `7222650` (v0.1.24 audit fix) |
| opengrind-upstream | **OPENGRIND (HISTORICAL)** | Fork point `7222650`; only 2 commits since; no active sync |
| Platform port (`memory/FIX_NOTES_platform_port.md`) | **PORT (UNCOMMITTED)** | Ported from upstream open-grind; 6 modules, 30 mutation-verified tests; uncommitted |
| Rescued iOS port (`memory/FIX_NOTES_ios_port_v0.1.48.md`) | **NEW** | Built on M1 Mac 2026-10-02; no precedent in either tree; Rust compiles for `aarch64-apple-ios` |
| dominusaxis / anchor-ext | **HISTORICAL (MIGRATION METADATA)** | Migration control plane docs only |

**Key Finding:** GrindrX is a fully independent fork. No active upstream imports. The "platform port" was a one-time import from upstream that remains uncommitted. The iOS port is entirely new work with no upstream precedent.

---

## 3. Rescued iOS Work — Commit `5b69ca4` and iOS Port Status

### Commit `5b69ca4`: **NOT FOUND**
- Searched all 4 repos: `git log --all --oneline | grep 5b69ca4` → **empty**
- `grep -r 5b69ca4 .` in all repos → **empty**
- No references in commit messages, documentation, or code
- **Disposition:** `HISTORICAL-ONLY` — cannot be preserved because it does not exist in any accessible repository. Human must confirm if it exists in an external backup or was a local-only commit.

### iOS Port (Documented in `memory/FIX_NOTES_ios_port_v0.1.48.md`)
**Verified Working (Measured):**
- Rust compiles for `aarch64-apple-ios` (`cargo build --target aarch64-apple-ios` → exit 0)
- `apple-native-keyring-store v0.2.3` and `security-framework v3.7.0` compile
- App builds for arm64 device → `release-iphoneos/GrindrX.app`
- Installs and runs on iOS 26.5 simulator (process alive, Tauri DevTools attached, Vite HMR connected)
- Sign-in screen renders (screenshot captured)
- Unsigned `.ipa` reproducible (5,837,841 bytes) for AltStore/SideStore — **no Apple account needed**

**Defects Fixed During Port:**
1. `CFBundleVersion` was `"0.1.48"` (Apple rejects semver) → fixed to `"1083"` in `tauri.conf.json:54`
2. Missing privacy usage strings (`NSLocationWhenInUse`, `NSMicrophone`, `NSPhotoLibrary`) → added `src-tauri/Info.plist`
3. `libapp.a` shipped inside `.app` (146 MB vs 5.8 MB) → fixed xcodegen exclude glob `**/*.a`
4. `tauri ios init` preserves `gen/apple/project.yml` edits (hand-edits survive regeneration)

**Blockers Requiring Operator:**
1. **Apple ID session rejected** — Xcode sign-in needed (certificate valid, session not)
2. **Firebase not configured** — `google-services.json` missing, `firebase login:ci` needed
3. **Keyring never exercised on iOS** — entitlements file is empty `<dict/>`; AltStore signature *may* supply keychain group (hypothesis, not measured)
4. **Bundle identifier mismatch** — iOS uses `org.opengrind` (upstream), Android uses `com.grindrx.app`; changing top-level `identifier` may disturb Android build

**Unverified / Open:**
- Horizontal clipping on simulator (not reproducible in source; likely dev-build artifact)
- No screenshot blocking (iOS has no `FLAG_SECURE` equivalent — privacy regression)
- No background notifications (APNs/Firebase required)
- Edge-swipe-back collides with 3 ungated swipe handlers
- Audio MIME probing prefers webm/opus; Safari only does `audio/mp4`

**Repository State:** `src-tauri/gen/` contains **only `android/` and `schemas/`** — no `ios/`, `apple/`, or `iphone/`. The iOS build exists only on the M1 Mac host. `gen/apple/` is untracked.

**Disposition:** `PRESERVE` — must not be lost. Decision needed: commit `gen/apple/` (like `gen/android/`) or document as regenerated-per-build via `tauri ios init`.

---

## 4. Platform Separation Readiness

### Android/Kotlin Leakage into Shared Logic: **NONE**
- `grep -r android src/lib --include="*.ts"` returns only `src/lib/platform/os.ts:2-3`:
  ```typescript
  return isTauri() && ["android", "ios"].includes(platform());
  return isTauri() && platform() === "android";
  ```
- Pure platform detection — no Android-specific logic in shared TypeScript/Rust
- `src-tauri/gen/android/` is proper Tauri-generated project (48 tracked files)
- `MainActivity.kt` is generated but hand-modified (documented in `MEMORY.md:72`)

### iOS Generated Project: **NOT IN GIT**
- `ls -la src-tauri/gen/` → only `android/` and `schemas/`
- `find src-tauri/gen -name "ios" -o -name "apple" -o -name "iphone"` → **no results**
- iOS port built on M1 Mac only; `gen/apple/` never committed

**Verdict:** Platform separation is clean. Android code properly isolated. iOS project absent from repo — must be decided before repo split.

---

## 5. Build Artifact Policy — PROVEN

### `src-tauri/gen/android/app/build/**` — **NOT TRACKED** ✓
```bash
$ git ls-files src-tauri/gen/android/app/build/
# (empty output)
```
**Ignore Rules:**
- `src-tauri/gen/android/.gitignore:11` → `build`
- Root `.gitignore:3` → `/build`
- Root `.gitignore:7` → `/dist`

### `dist/` — **NOT TRACKED** ✓
```bash
$ git ls-files dist/
# (empty output)
```

### **CRITICAL EXCEPTION:** `src-tauri/gen/android/app/src/main/assets/tauri.conf.json` **IS TRACKED** AND STALE
- Contains: `version: "0.1.33"`, `versionCode: 1068`, `identifier: "org.opengrind"`
- Canonical `src-tauri/tauri.conf.json`: `version: "0.1.48"`, `versionCode: 1083`, `identifier: "com.grindrx.app"`
- This file is copied into the APK assets — **will ship wrong version if not regenerated**

### `src-tauri/gen/android/app/tauri.properties` — **TRACKED AND STALE**
- Contains: `tauri.android.versionName=0.1.33`, `tauri.android.versionCode=1068`
- Header comment: "Regenerate with `bun tauri android init`"
- `build.gradle.kts:40-41` reads these for shipped `versionName`/`versionCode`

---

## 6. Version Consistency — Complete Stale Inventory

### Canonical Current Version
| File | Version | VersionCode | BundleVersion |
|------|---------|-------------|---------------|
| `package.json:2` | `0.1.48` | — | — |
| `src-tauri/Cargo.toml:3` | `0.1.48` | — | — |
| `src-tauri/tauri.conf.json:4` | `0.1.48` | — | — |
| `src-tauri/tauri.conf.json:50` | — | `1083` | — |
| `src-tauri/tauri.conf.json:54` | — | — | `"1083"` |

### Stale `0.1.38` References (23 locations, excluding node_modules/target/memory)
| File | Line | Context |
|------|------|---------|
| `src-tauri/tauri.conf.json` | 22 | `userAgent: "GrindrX/0.1.38 (+https://git.dominusaxis.com/dominus/grindrx)"` **SHIPS IN BUILD** |
| `src/lib/data/whats-new.ts` | 6 | `"0.1.38": [...]` — **oldest entry; missing 0.1.39–0.1.48** |
| `README.md` | 3,8,11,14 | "Current release: v0.1.38", SHA256 for v0.1.38.apk |
| `CHANGES.md` | 3 | `## v0.1.38 — the Photos tab was lying...` (historical, acceptable) |
| `src/lib/components/cdn-image-layout.guard.test.ts` | 4,7,11,15 | Test comments referencing v0.1.38 regression |
| `README_HANDOFF.md` | multiple | Documents stale state |
| `HANDOFF_MESSAGE.md` | multiple | Documents stale state |
| `docs/ENDPOINT_GAP_SPEC.md` | 1 | References v0.1.38 shipped |

### Stale VersionCodes in Generated Artifacts
| File | VersionCode | Status |
|------|-------------|--------|
| `src-tauri/gen/android/app/src/main/assets/tauri.conf.json` | 1068 | **TRACKED — SHIPS IN APK** |
| `src-tauri/gen/android/app/tauri.properties` | 1068 | **TRACKED — READ BY build.gradle.kts** |
| Build intermediates (debug) | 1041 | Generated, ignored |
| Build intermediates (release) | 1065 | Generated, ignored |
| Build intermediates (release (another)) | 1085 | Generated, ignored |

### Burned Version Codes (Documented in Handoff Docs)
- **1076–1083** consumed by real installed diagnostic builds (HANDOFF_MESSAGE.md, README_HANDOFF.md)
- **Must never be reused** — Android rejects downgrade

### `whats-new.ts` Coverage Gap
- Has entries for: 0.1.38, 0.1.37, 0.1.36, 0.1.35, 0.1.34, 0.1.33, 0.1.32, 0.1.31, 0.1.30, 0.1.29, 0.1.28, 0.1.27, 0.1.26, 0.1.25
- **MISSING:** 0.1.39, 0.1.40, 0.1.41, 0.1.42, 0.1.43, 0.1.44, 0.1.45, 0.1.46, 0.1.47, 0.1.48
- Fallback: `"Bug fixes and improvements."` for all current versions

---

## 7. CI Configuration State

### What CI Claims (ci.yml lines 3-10)
> "Before this file existed, nothing re-ran the test suite... This is the minimum that would have caught a broken `svelte-check` or a red test before a release is tagged."

### What CI Actually Validates
| Job | Steps | Validates |
|-----|-------|-----------|
| **frontend** | `bun install --frozen-lockfile`, `bun run lint`, `bun run check`, `bun run test:unit` | Frontend lint, typecheck, unit tests (734 tests) |
| **rust** | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **Linux desktop lib only** |

### What CI Does NOT Validate (Explicitly Documented in ci.yml:52-77)
- ❌ **Android APK build** — needs NDK, JDK 17-21, 4 android Rust targets
- ❌ **Cross-compilation for `aarch64-linux-android`** — `tauri-plugin-biometric`, keyring backends not compiled
- ❌ **iOS build** — needs macOS + Xcode
- ❌ **Release-version gate** — exists only on branch `ci/release-version-gate` (commit `7111ff9`), not merged to `main`
- ❌ **Signed artifact verification** — no signing in CI

### CI Gap: Release-Version Gate
- Branch `ci/release-version-gate` at `7111ff9` has the gate (ported from upstream)
- **Not merged to `main`** — releases can be tagged without version consistency check
- TODO in ci.yml:76: "once a Linux container with Android SDK/NDK is available, add `cargo check --target aarch64-linux-android`"

---

## P0 Findings (Release-Blocking)

| ID | Finding | Severity |
|----|---------|----------|
| **M4-001** | Commit `5b69ca4` missing from all repos — cannot verify provenance | P0 |
| **M4-002** | iOS port exists only on Mac host; `gen/apple/` untracked; keyring untested; bundle id mismatch | P0 |
| **M4-005** | Stale `0.1.38` in shipping `userAgent` (tauri.conf.json:22), `whats-new.ts` missing 10 versions, README claims v0.1.38 | P0 |
| **M4-004** | Tracked Android asset `tauri.conf.json` has stale 0.1.33/1068/org.opengrind — will ship in APK | P1 |

---

## Unverifiable / Blocked Areas

1. **Commit `5b69ca4`** — Absent from all repos. No external backup searched (out of scope).
2. **iOS keyring on real device** — Requires Apple Developer account, signed build, physical device. Hypothesis: AltStore signature supplies keychain group. **Not measured.**
3. **iOS background notifications / APNs** — Requires Firebase + Apple credentials. Blocked on operator.
4. **Android APK build verification** — Requires Mac host with Android SDK/NDK. Not runnable in this environment.
5. **opengrind-upstream git corruption** — `error: Could not read 802f20fe...` prevents full history traversal (partial data only).
6. **Cross-compilation for Android targets** — No Linux Android SDK/NDK container available.

---

## Disposition Summary for Repo Split

| Target Repo | Disposition | Contents |
|-------------|-------------|----------|
| **grindrx-core** | `ADOPT` | All shared TypeScript/Rust, CI config, docs, build config |
| **grindrx-android** | `ADOPT` | `src-tauri/gen/android/` (48 tracked files), `build.gradle.kts`, `tauri.properties` (fix stale first) |
| **grindrx-iphone** | `PRESERVE` | iOS port (commit `gen/apple/` or document regeneration); resolve bundle id; add keychain entitlements |
| **Historical** | `HISTORICAL-ONLY` | Commit `5b69ca4` (missing), opengrind-upstream (reference only), dominusaxis/anchor-ext (migration metadata) |

---

## Verification Commands (Reproducibility)

```bash
# Branch inventory
cd /srv/projects/grindrx-work && git branch -a -v
cd /srv/projects/opengrind-upstream && git branch -a -v

# Commit 5b69ca4 search
cd /srv/projects/grindrx-work && git log --all --oneline | grep 5b69ca4
cd /srv/projects/opengrind-upstream && git log --all --oneline | grep 5b69ca4

# Build artifact tracking
cd /srv/projects/grindrx-work && git ls-files src-tauri/gen/android/app/build/
cd /srv/projects/grindrx-work && git ls-files dist/

# iOS generated project
cd /srv/projects/grindrx-work && ls -la src-tauri/gen/
cd /srv/projects/grindrx-work && find src-tauri/gen -name "ios" -o -name "apple" -o -name "iphone"

# Stale version references
cd /srv/projects/grindrx-work && grep -r "0.1.38" --include="*.ts" --include="*.json" --include="*.toml" --include="*.md" | grep -v node_modules | grep -v target/ | grep -v memory/

# CI config
cd /srv/projects/grindrx-work && cat .github/workflows/ci.yml

# Android asset tauri.conf.json
cd /srv/projects/grindrx-work && cat src-tauri/gen/android/app/src/main/assets/tauri.conf.json

# tauri.properties
cd /srv/projects/grindrx-work && cat src-tauri/gen/android/app/tauri.properties
```

---

## Ledger Compliance

All findings recorded with:
- Stable IDs (M4-001 through M4-012)
- File:line citations
- Exact commands used for measurement
- Timestamps and environment
- Confidence levels (all `measured` except where noted)
- Disposition per mandate vocabulary

Output files:
- `/srv/projects/grindrx-recon/findings/audit-4-migration.json` (machine-readable)
- `/srv/projects/grindrx-work/docs/governance/domain-04-migration-provenance.md` (this report)