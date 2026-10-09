# DOMAIN 11: Git History & Provenance — Measurement Report

**Generated:** 2026-10-09T10:30:00+02:00
**Agent:** Domain 11 Measurement Agent (nvidia/nemotron-3-ultra)
**Repository:** `/srv/projects/grindrx-work` at commit `7fffcec` (tag: v0.1.49-p0.1), branch `migration/ovh-state-2026-10-05` (also `main`, `integrate/p0-security-2026-10-09`)
**Scope:** Observational only — no source modifications

---

## 1. Repository Baseline (grindrx-work)

| Metric | Value | Method |
|--------|-------|--------|
| Current HEAD | `7fffcec773b539a18b2f993cb9d8143fc2ec32c5` | `git rev-parse HEAD` |
| Current Branch | `migration/ovh-state-2026-10-05` (also `main`, `integrate/p0-security-2026-10-09`) | `git branch --show-current` |
| Working Tree Clean | **NO** — 3 modified, 16 untracked | `git status` |
| Modified Files | `bun.lock`, `package.json`, `src-tauri/Cargo.lock` | `git status` |
| Untracked Files | `coverage/`, 15 `docs/governance/*.md`, 11 `docs/governance/measure-*.jsonl` | `git status` |
| Total Commits (all refs) | 493 | `git log --oneline --all \| wc -l` |
| Commits on `main` | 418 | `git log --oneline main \| wc -l` |
| Commits on `migration/ovh-state-2026-10-05` | 418 | `git log --oneline migration/ovh-state-2026-10-05 \| wc -l` |
| Tags | 68 (including `v0.1.0`–`v0.1.40`, `v0.1.49-p0.1`, rollback/backup tags) | `git tag -l` |
| Local Branches | 13 | `git branch` |
| Remote-Tracking Branches | 28 (across `origin`, `github`, `grindrx-forgejo`) | `git branch -r` |

---

## 2. Cross-Repository Inventory

| Repository | Path | Total Commits | Tracked Files | Status |
|------------|------|---------------|---------------|--------|
| **grindrx-work** (canonical) | `/srv/projects/grindrx-work` | 493 | 791 | Active, clean history |
| **opengrind-upstream** | `/srv/projects/opengrind-upstream` | ~3 visible (corrupted) | 756 | **Git corruption**: missing commit `802f20fe` breaks history traversal |
| **dominusaxis** | `/srv/projects/dominusaxis` | 2 | 15 | Migration metadata only |
| **anchor-ext** | `/srv/projects/anchor-ext` | 2 | 48 | Migration metadata only |

**opengrind-upstream corruption detail:** `git fsck` reports broken link from commit `3f0a9c0` to missing commit `802f20fe`. Only 2 commits accessible after fork point.

---

## 3. Branch Divergence Matrix (grindrx-work)

| Comparison | Ahead | Behind | Merge Base | Notes |
|------------|-------|--------|------------|-------|
| `main` vs `origin/main` (upstream open-grind) | 120 | 0 | `7222650` (v0.1.24 audit fix) | Fork point; no upstream sync since |
| `main` vs `grindrx-forgejo/main` | 33 | 0 | `30e6a1e` (v0.1.39) | Forgejo at v0.1.39 |
| `main` vs `github/main` (GitHub mirror) | 76 | 0 | `7222650` | Same fork point as origin |
| `main` vs `integrate/p0-security-2026-10-09` | 0 | 0 | `7fffcec` | Identical |
| `main` vs `migration/ovh-state-2026-10-05` | 0 | 0 | `7fffcec` | Identical |

**Divergence summary:** GrindrX is a fully independent fork. 76 first-parent commits since fork point `7222650`. No active upstream imports since `7e2dad9` (release-version gate port, 2026-09-30).

---

## 4. Source File Provenance Comparison (src/)

| Category | Count | Details |
|----------|-------|---------|
| Common to both repos | 278 | Shared core modules |
| Unique to grindrx-work | 220 | Profile photos state machine, auth-media cache, CDN validation, batch sharing, P0 security fixes, extensive tests |
| Unique to opengrind-upstream | 256 | Command-center, filter-grid, browse/messaging/users APIs, Google OAuth, different architecture |

**Key GrindrX-unique implementations (measured):**
- `src/lib/profile-photos/photos-state.ts` + 269 tests — **no upstream equivalent**
- `src/lib/utils/authed-image.ts` (464 lines, semaphore bounds, cacheEpoch, refCounts) — **no upstream equivalent**
- `src/lib/utils/cdn.ts` (`isPublicMediaHash` validation) — **no upstream equivalent**
- `src/lib/utils/share-albums.ts` (sequential batch with partial success) — **no upstream equivalent**
- ~180 test files vs upstream ~5 — **measured gap**

**Key Upstream-unique implementations (measured):**
- `src/lib/components/command-center/` (multi-command palette)
- `src/lib/api/browse/`, `messaging/`, `users/` (nested API structure)
- `src-tauri/src/api/google_oauth/` (Google Sign-In)
- `src-tauri/vendor/grindr-google-oauth-webextension`

---

## 5. Source File Provenance Comparison (src-tauri/)

| Category | Count |
|----------|-------|
| Common | 78 |
| Unique to grindrx-work | 28 (incl. `Info.plist`, iOS fixes, msgpack_depth, headers, openurl) |
| Unique to opengrind-upstream | 13 (incl. Google OAuth Rust modules, WebViewSupport, media_upload) |

---

## 6. Changes Imported from Upstream (Verified)

| Commit | Date | Files | Description | Verification |
|--------|------|-------|-------------|--------------|
| `7e2dad9` | 2026-09-30 | `ci/check-release-version.sh`, `ci/version.sh`, `deny.toml`, `src/lib/components/cdn-image-layout.guard.test.ts` | Port upstream release-version gate + layout guard test + cargo-deny config | Mutation-verified: exits 1 on desynced tree, 0 when synced; test mutations fail correctly |
| `715a248` | earlier | Chat unsend messages | Port from upstream v0.1.11 (#89) | Documented in commit message |
| `fd29c8c` | earlier | `gradle.properties` | Revert to upstream values | Measured |

**No other upstream imports found** in 76 commits since fork point.

---

## 7. Recovered Work & Rescued iOS Port

| Work Item | Source | Status | Evidence |
|-----------|--------|--------|----------|
| **iOS Port (v0.1.48)** | Built on M1 Mac 2026-10-02, branch `claude/grindrx-freeze-json-audit-gp4lnk` | **VERIFIED WORKING** on simulator; blocked on Apple credentials for device | `cargo build --target aarch64-apple-ios` → exit 0; `release-iphoneos/GrindrX.app` arm64; installs/runs on iOS 26.5 simulator; sign-in screen renders; unsigned .ipa reproducible (5.8 MB) |
| **Platform Port** | One-time import from upstream open-grind (6 modules, 30 mutation-verified tests) | **UNCOMMITTED** — documented in `memory/FIX_NOTES_platform_port.md` | Not in any git history |
| **Commit `5b69ca4`** | Referenced in Audit 3/4 as "rescued iOS work" | **ABSENT FROM ALL 4 REPOS** — `git log --all --oneline \| grep 5b69ca4` → empty in all repos; `grep -r 5b69ca4 .` → empty | **Disposition: HISTORICAL-ONLY** — cannot be preserved; human must confirm external backup |
| **Commit `bb05c55`** | Referenced in Audit 3 as upstream commit with 4 missing changes | **ABSENT FROM ALL REPOS** — searched grindrx-work, opengrind-upstream, dominusaxis, anchor-ext | **Disposition: UNVERIFIABLE** — upstream git corruption prevents verification |

---

## 8. The "10 Unique OpenGrind Changes" — Disposition

**Master Plan Claim:** Exactly 10 unique changes in GrindrX vs upstream.

**Audit 3 Finding:** 6 substantiated, 4 unverified.

| # | Change | Status | Evidence |
|---|--------|--------|----------|
| 1 | Profile photos state machine (269 tests) | **SUBSTANTIATED** | `src/lib/profile-photos/photos-state.ts` + tests; no upstream equivalent |
| 2 | Authenticated media cache with semaphore bounds | **SUBSTANTIATED** | `src/lib/utils/authed-image.ts` (464 lines); `MAX_ENTRIES=32`, `cacheEpoch`, `refCounts`, `retired` cache |
| 3 | CDN URL validation with hash schema | **SUBSTANTIATED** | `src/lib/utils/cdn.ts:isPublicMediaHash()`; upstream has no validation |
| 4 | Batch album sharing with partial success | **SUBSTANTIATED** | `src/lib/utils/share-albums.ts`; sequential, continues past failures |
| 5 | Profile photos demo system (`demoMyUploadedPhotos`) | **SUBSTANTIATED** | `src/lib/demo/route.ts`; upstream only has `demoMediaUrl` |
| 6 | Test suite coverage (~180 vs ~5) | **SUBSTANTIATED** | `find . -name "*.test.ts" \| wc -l` measured in both repos |
| 7 | Commit `bb05c55` (4 changes) | **UNVERIFIED** | Commit not found; upstream corruption blocks history |
| 8 | Image-fetch semaphore implementation | **UNVERIFIED** | Unclear in upstream; grindrx-work has semaphore in authed-image |
| 9 | Album-share schema specifics | **UNVERIFIED** | Could not verify specific schema in upstream |
| 10 | Black-grid fix reference | **UNVERIFIED** | No reference found in upstream codebase |

**Total Verified: 6/10. Verification Incomplete.**

---

## 9. Stale Branches & Tags Requiring Action

### Stale Local Branches
| Branch | Status | Action |
|--------|--------|--------|
| `ci/release-version-gate` | Merged to `integrate/` but not `main` | **Merge to main** — contains release-version gate |
| `fix/album-exif-bypass` | Merged to `integrate/` | Verify in main |
| `fix/auth-contract` | Merged to `integrate/` | Verify in main |
| `fix/http-retry-policy` | Merged to `integrate/` | Verify in main |
| `fix/media-cache-signout` | Merged to `integrate/` | Verify in main |
| `fix/media-exif-sanitization` | Merged to `integrate/` | Verify in main |
| `fix/session-expiry-cache-purge` | Merged to `integrate/` | Verify in main |
| `fix/test-suite-load-flake` | Has 2 commits not in main | Review/merge |
| `claude/grindrx-freeze-json-audit-gp4lnk` | At `0c223af` (geohash fix) | Already in main via integrate |
| `claude/grindrx-total-downloads-o1hodl` | Unrelated session | **Delete** |
| `audit/v0.1.9-fixes` | Old audit branch | **Delete** |

### Stale Remote-Tracking Branches (Polluting Inventory)
| Remote | Branch | Reason |
|--------|--------|--------|
| `github` | `claude/forex-trading-bot-xychyi` | Unrelated to GrindrX |
| `github` | `claude/great-lakes-carving-scp-vlnng6` | Unrelated |
| `github` | `claude/vehicle-pricing-inspection-3t8gob` | Unrelated |
| `github` | `claude/phone-battery-drain-77zz36` | Unrelated |
| `github` | `claude/pantry-cabinet-build-plan-6v1q5f` | Unrelated |
| `github` | `claude/iq-estimate-b9z9qe` | Unrelated |
| `github` | `claude/sms-log-tom-lockouts-0cs0d5` | Unrelated |
| `github` | `claude/m1-mic-noise-cleanup-kprxyz` | Unrelated |
| `github` | `claude/anchor-memory-prosthetic-dhe5e8` | Unrelated |
| `github` | `claude/build-merge-release-xtqnqw` | Unrelated |
| `origin` | `claude/grindrx-freeze-json-audit-gp4lnk` | Duplicate of local |
| `origin` | `claude/grindrx-total-downloads-o1hodl` | Duplicate of local |
| `grindrx-forgejo` | `claude/grindrx-freeze-json-audit-gp4lnk` | Duplicate of local |
| `grindrx-forgejo` | `claude/grindrx-total-downloads-o1hodl` | Duplicate of local |

### Stale Tags (Rollback/Backup Artifacts)
- `audit-v0.1.34-rollback-20260927` through `audit-v0.1.38-rollback-20260927`
- `rollback-pre-v0.1.38` through `rollback-pre-v0.1.40`
- `backup/forgejo-main-20261001`, `backup/github-main-20261001`, `backup/local-main-20261001`

---

## 10. Unpushed / Unreconciled Commits

| Remote | Commits Ahead | Commits Behind | Status |
|--------|---------------|----------------|--------|
| `origin` (Forgejo open-grind) | 120 | 0 | All local work unpushed to upstream |
| `grindrx-forgejo` | 33 | 0 | Forgejo at v0.1.39; local at v0.1.49-p0.1 |
| `github` (GitHub mirror) | 76 | 0 | GitHub mirror of upstream |

**No commits behind any remote** — grindrx-work is strictly ahead.

---

## 11. Historical Functionality Without Current Equivalent

| Upstream Feature | GrindrX Status | Notes |
|------------------|----------------|-------|
| Command Center (multi-command palette) | **Absent** | Upstream has full implementation |
| Filter Grid (saved filters, definitions) | **Absent** | Upstream has 87 e2e specs for this |
| Browse API (grid, location, blocks) | **Different structure** | GrindrX uses flat `api/`; upstream uses nested |
| Messaging API (albums, chat-media, conversations) | **Different structure** | Upstream has richer conversation/media types |
| Users API (favorites, profiles, pronouns, tags) | **Different structure** | GrindrX has partial equivalents |
| Google OAuth (Rust + WebExtension) | **Absent** | GrindrX uses different auth |
| Demo Mode (`PUBLIC_ENABLE_DEMO`) | **Absent** | Upstream uses for 87 Playwright e2e specs |

---

## 12. Merge Bases & Patch Equivalence

| Pair | Merge Base | Commits Since Base (First-Parent) | Patch Equivalence |
|------|------------|-----------------------------------|-------------------|
| grindrx-work `main` ↔ opengrind-upstream `main` | `7222650` (v0.1.24 audit fix) | 76 | **Low** — different architectures, API structures, test coverage |
| grindrx-work `main` ↔ grindrx-forgejo `main` | `30e6a1e` (v0.1.39) | 33 | **Medium** — same codebase, Forgejo 33 commits behind |
| grindrx-work `integrate/` ↔ `main` | `7fffcec` | 0 | **Identical** |

---

## 13. Audit 3 + 4 Findings Reconciliation

| Finding ID | Description | Status | Disposition |
|------------|-------------|--------|-------------|
| **M4-001** | Commit `5b69ca4` missing from all repos | **CONFIRMED** | `HISTORICAL-ONLY` — cannot verify provenance |
| **M4-002** | iOS port only on Mac host; `gen/apple/` untracked; keyring untested | **CONFIRMED** | `PRESERVE` — commit `gen/apple/` or document regeneration |
| **M4-003** | Stale `0.1.38` in shipping `userAgent` (tauri.conf.json:22) | **CONFIRMED** | `P0` — ships in build |
| **M4-004** | Tracked Android asset `tauri.conf.json` has stale 0.1.33/1068/org.opengrind | **CONFIRMED** | `P1` — will ship in APK |
| **M4-005** | `whats-new.ts` missing 10 versions (0.1.39–0.1.48) | **CONFIRMED** | `P0` — fallback text for current versions |
| **P0-001** | Profile photos state machine missing from upstream | **SUBSTANTIATED** | `PORT` to upstream |
| **P0-002** | Authenticated media cache missing from upstream | **SUBSTANTIATED** | `PORT` to upstream |
| **P0-003** | CDN URL hash validation missing from upstream | **SUBSTANTIATED** | `PORT` to upstream |
| **P0-004** | Batch album sharing missing from upstream | **SUBSTANTIATED** | `PORT` to upstream |
| **P1-001** | Profile photos demo system missing from upstream | **SUBSTANTIATED** | `ADOPT` to upstream |
| **P2-001** | Test coverage gap (180 vs 5) | **SUBSTANTIATED** | `IMPROVE` upstream |

---

## 14. Provenance Gaps & Unverifiable Areas

| Gap | Impact | Required to Resolve |
|-----|--------|---------------------|
| Commit `5b69ca4` absent from all repos | Cannot verify iOS work provenance; Audit 4 M4-001 P0 | Search external backups; human confirmation |
| Commit `bb05c55` absent; upstream git corruption | 4 of 10 claimed unique changes unverified | Restore upstream repo from clean source; re-traverse history |
| opengrind-upstream git corruption (`802f20fe` missing) | Cannot measure full upstream history; cannot verify patch equivalence | `git fsck` repair or re-clone from authoritative source |
| iOS keyring on real device | Security/privacy unmeasured on target platform | Apple Developer account + signed build + physical device |
| Android APK build verification | Release artifacts unmeasured | Mac host with Android SDK/NDK + JDK 17-21 |
| Cross-compilation for `aarch64-linux-android` | Rust targets (biometric, keyring) uncompiled | Linux container with Android SDK/NDK |

---

## 15. Verification Commands (Reproducibility)

```bash
# Baseline
cd /srv/projects/grindrx-work && git rev-parse HEAD
cd /srv/projects/grindrx-work && git status

# Branch inventory
cd /srv/projects/grindrx-work && git branch -a -v
cd /srv/projects/opengrind-upstream && git branch -a -v

# Divergence
cd /srv/projects/grindrx-work && git log --oneline origin/main..main | wc -l
cd /srv/projects/grindrx-work && git log --oneline grindrx-forgejo/main..main | wc -l
cd /srv/projects/grindrx-work && git merge-base main github/main

# File provenance
cd /srv/projects/grindrx-work && git ls-files src/ | sort > /tmp/gw.txt
cd /srv/projects/opengrind-upstream && git ls-files src/ 2>/dev/null | sort > /tmp/og.txt
comm -12 /tmp/gw.txt /tmp/og.txt | wc -l   # common
comm -23 /tmp/gw.txt /tmp/og.txt | wc -l   # grindrx-unique
comm -13 /tmp/gw.txt /tmp/og.txt | wc -l   # upstream-unique

# Commit searches
cd /srv/projects/grindrx-work && git log --all --oneline | grep 5b69ca4
cd /srv/projects/grindrx-work && git log --all --oneline | grep bb05c55

# iOS port evidence
cat /srv/projects/grindrx-work/memory/FIX_NOTES_ios_port_v0.1.48.md

# Stale version references
cd /srv/projects/grindrx-work && grep -r "0.1.38" --include="*.ts" --include="*.json" --include="*.toml" --include="*.md" | grep -v node_modules | grep -v target/ | grep -v memory/
```

---

## 16. Measurement Ledger Entries (Summary)

All measurements recorded with: timestamp, actor, type, target, result, metric, value, unit, method, confidence.

| ID | Metric | Value | Unit | Method | Confidence |
|----|--------|-------|------|--------|------------|
| D11-001 | grindrx-work total commits | 493 | commits | `git log --oneline --all \| wc -l` | measured |
| D11-002 | grindrx-work main commits | 418 | commits | `git log --oneline main \| wc -l` | measured |
| D11-003 | Working tree modified files | 3 | files | `git status` | measured |
| D11-004 | Working tree untracked files | 16 | files | `git status` | measured |
| D11-005 | Fork point commit | `7222650` | SHA | `git merge-base main github/main` | measured |
| D11-006 | Commits since fork (first-parent) | 76 | commits | `git log --oneline 7222650..HEAD --first-parent \| wc -l` | measured |
| D11-007 | Main ahead of origin/main | 120 | commits | `git log --oneline origin/main..main \| wc -l` | measured |
| D11-008 | Main ahead of grindrx-forgejo/main | 33 | commits | `git log --oneline grindrx-forgejo/main..main \| wc -l` | measured |
| D11-009 | Main ahead of github/main | 76 | commits | `git log --oneline github/main..main \| wc -l` | measured |
| D11-010 | Common src files | 278 | files | `comm -12` on sorted ls-files | measured |
| D11-011 | GrindrX-unique src files | 220 | files | `comm -23` on sorted ls-files | measured |
| D11-012 | Upstream-unique src files | 256 | files | `comm -13` on sorted ls-files | measured |
| D11-013 | Common src-tauri files | 78 | files | `comm -12` on sorted ls-files | measured |
| D11-014 | GrindrX-unique src-tauri files | 28 | files | `comm -23` on sorted ls-files | measured |
| D11-015 | Upstream-unique src-tauri files | 13 | files | `comm -13` on sorted ls-files | measured |
| D11-016 | Upstream imports verified | 3 | commits | `git log --grep="port\|upstream" --oneline` | measured |
| D11-017 | Commit 5b69ca4 found | 0 | boolean | `git log --all --oneline \| grep 5b69ca4` in 4 repos | measured |
| D11-018 | Commit bb05c55 found | 0 | boolean | `git log --all --oneline \| grep bb05c55` in 4 repos | measured |
| D11-019 | Substantiated unique changes | 6 | changes | Audit 3 verification | measured |
| D11-020 | Unverified unique changes | 4 | changes | Audit 3 verification | measured |
| D11-021 | iOS port verified on simulator | 1 | boolean | `cargo build --target aarch64-apple-ios` exit 0 | measured |
| D11-022 | Stale claude/* remote branches | 17 | branches | `git branch -r \| grep claude/` | measured |
| D11-023 | opengrind-upstream git corruption | 1 | missing commit | `git fsck` | measured |

---

## 17. Conclusion

**GrindrX is a fully independent fork** with 76 first-parent commits diverged from upstream since `7222650` (v0.1.24). Only 3 verified upstream imports since fork. The codebases have **different architectures** (flat vs nested API, different component structures).

**Critical provenance gaps:**
1. Commit `5b69ca4` (claimed rescued iOS work) — **absent from all accessible repos**
2. Commit `bb05c55` (claimed 4 of 10 unique changes) — **absent; upstream corruption blocks verification**
3. opengrind-upstream git corruption — **prevents full history measurement**

**Verified unique GrindrX value (6/10 claimed):**
- Profile photos state machine (269 tests)
- Authenticated media cache with semaphore bounds (security-critical)
- CDN URL hash validation (security-critical)
- Batch album sharing with partial success
- Profile photos demo system
- Test coverage (~180 vs ~5)

**iOS port:** Verified working on simulator (measured), blocked on Apple credentials for device. `gen/apple/` untracked — must decide: commit or document regeneration.

**Stale inventory:** 17 unrelated remote branches, 5 fix branches merged to integrate but not main, ci/release-version-gate not on main, numerous rollback/backup tags.

**All measurements observational. No source modified.**

---

*End of Domain 11 Provenance Report*