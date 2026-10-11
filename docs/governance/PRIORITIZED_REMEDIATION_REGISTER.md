# Prioritized Remediation Register — GrindrX v0.1.50

**Baseline:** `7fffcec` | **Directive:** MASTER_MEASUREMENT_DIRECTIVE.md §9
**Register title updated 2026-10-11:** the register now tracks 0.1.50. It was titled v0.1.48 while
the code was three releases ahead — the same staleness this document exists to correct.
**Last reconciliation pass: 2026-10-11** (second pass; the first was 2026-10-10).

---

## Status Legend
- `OPEN` → `TRIAGED` → `APPROVED` → `IN_PROGRESS` → `IMPLEMENTED` → `VERIFIED` → `CLOSED`
- `DEFERRED` | `REJECTED_WITH_REASON` | `NOT_REPRODUCIBLE` | `BLOCKED`

---

## P0 — Release Blocking (10 Findings)

| ID | Finding | Domain | Owner | Dependencies | Acceptance Criteria | Status |
|----|---------|--------|-------|--------------|---------------------|--------|
| P0-001 | `grindx_messages` notification channel lacks `VISIBILITY_PRIVATE` | 07 | Android | `MainActivity.kt`, `NotificationService.kt` | Lock-screen shows "New message" only; no chat text | VERIFIED |
| P0-002 | Authenticated media cache cross-account leak (fixed v0.1.33) | 07 | Core | `authed-image.ts`, purge tests | Cache fully revoked on sign-out; `cacheEpoch` blocks stale fetches | VERIFIED |
| P0-003 | Version drift: 3 different version tuples in repo | 10 | Build | `tauri.conf.json`, `tauri.properties`, CI gate | Single source of truth; all builds produce 0.1.50/1085 | VERIFIED |
| P0-004 | Android APK never built/validated on device | 10 | Android | CI config, SDK/NDK, keystore, device | `aarch64-linux-android` compiles; APK installs/runs | IMPLEMENTED |
| P0-005 | Commit `5b69ca4` absent from all repos | 11 | Provenance | External backups | Commit located or dispositioned HISTORICAL-ONLY | OPEN |
| P0-006 | Stale Android assets tracked (ship 0.1.33/1068) | 11 | Build | `src-tauri/gen/android/.../tauri.conf.json`, `tauri.properties` | Regenerated assets match 0.1.50/1085/com.grindrx.app | VERIFIED |
| P0-007 | HTTP endpoints unprobed (UNPROBED in source) | 04 | API | Live server credentials | Endpoints verified or documented as deprecated | OPEN |
| P0-008 | No dependency vulnerability scanning in CI | 06 | CI | `cargo-audit`, `npm audit` (Bun→npm lockfile) | CI fails on HIGH/CRITICAL vulns | IMPLEMENTED |
| P0-009 | PNG/WebP/HEIF EXIF not stripped on canvas fallback | 07 | Core | `profile.ts` `stripImageMetadata` + upload path | All image formats sanitized; tests added | VERIFIED |
| P0-010 | `rotate_api_params` unlimited (DoS keystore) | 07 | Core | `ws.rs`, keyring usage | Rate limit + backoff on rotation | VERIFIED |

---

## P1 — Major Product Completion (12 Findings)

| ID | Finding | Domain | Owner | Acceptance Criteria | Status |
|----|---------|--------|-------|---------------------|--------|
| P1-001 | No user consent for telemetry pings | 07 | Core | Opt-in dialog; disabled by default | VERIFIED |
| P1-002 | WS protocol completely untested vs real server | 05 | Test | Contract tests against staging | OPEN |
| P1-003 | Most test files mock `invoke()` without contract validation | 05 | Test | Schema validation on all mocks | OPEN |
| P1-004 | WS reconnect has no max attempts (infinite retry) | 08 | Core | Max attempts configured; backoff capped | VERIFIED |
| P1-005 | MessagesList renders all messages (no virtualization) | 08 | Core | Windowed rendering for >100 messages | VERIFIED |
| P1-006 | Image upload: double base64 round-trip (33% × 2) | 08 | Core | Direct blob upload or single encode | VERIFIED |
| P1-007 | Android back gesture handler leak (never unregistered) | 09 | Android | Registration balanced with unregistration | VERIFIED |
| P1-008 | `rotate_api_params` race on rotation | 09 | Core | Guard + idempotency key | VERIFIED |
| P1-009 | iOS: no background modes for WS keep-alive | 10 | iOS | `UIBackgroundModes` includes `voip`/`fetch` | VERIFIED (goal NOT met — see reconciliation) |
| P1-010 | No CI for Android/iOS/desktop builds | 10 | CI | All 3 platforms build in CI | IMPLEMENTED |
| P1-011 | `bb05c55` provenance unverifiable | 12 | Provenance | Upstream repo repaired or dispositioned | OPEN |
| P1-012 | Message variant union divergence (2 extra in OpenGrind) | 12 | Core | Union merged; tests for new variants | VERIFIED |

---

## P2 — Technical Debt / Optimization (Selected)

| ID | Finding | Domain | Acceptance Criteria | Status |
|----|---------|--------|---------------------|--------|
| P2-001 | `preferences.data` double-failure purge path untested | 07 | Failure injection test passes | VERIFIED |
| P2-002 | Grid profile cache not explicitly purged on sign-out | 07 | Purge test covers grid cache | VERIFIED |
| P2-003 | `allowBackup` flag not audited (keyring in backups) | 07 | `android:allowBackup=false` or keyring excluded | VERIFIED |
| P2-004 | No image fetch semaphore (concurrency uncontrolled) | 08 | Semaphore with configurable limit | VERIFIED |
| P2-005 | `ws:ws_error` listener removed but code path remains | 09 | Dead code removed or re-enabled | VERIFIED |
| P2-006 | 99 `.bak.*` files in working tree (untracked) | 01 | Cleaned or archived with provenance | VERIFIED |

---

## P3 — Cleanup / Cosmetic

| ID | Finding | Domain | Status | Verification |
|----|---------|--------|--------|--------------|
| P3-001 | Stale `0.1.38` references in 23 locations (README, whats-new, etc.) | 11 | VERIFIED | Commit `500b505`. Measured **22** tracked files, not 23; **21 are legitimate** (historical prose in `CdnImage.svelte`, `ProfileMiniCard.svelte`, `cdn-image-layout.guard.test.ts`, `vite.config.mjs`; changelog key `whats-new.ts:6`; release records in `CHANGES.md`, fastlane, `memory/`, ledgers). **One live bug fixed**: `tauri.conf.json:22` webview `userAgent` `0.1.38` → `0.1.48`. Drift cannot recur — `.github/workflows/version-check.yml` already fails when `userAgent` lacks `.version`; replayed against old file (exit 1) and new file (pass). `headers.rs` `APP_VERSION = "26.9.1.163471"` is the **spoofed Grindr client** version, deliberately untouched. `README.md:5` was then fixed anyway by `90e66f63` (`0.1.38` → `0.1.49`) — **and has re-drifted again to `v0.1.49` while the code is `0.1.50`/`1085`**, so the CI `userAgent` guard does not cover `README.md`. **The version-bump procedure, not the file, is the defect.** Merged to `main` (`eca61c2`); ledger updated 2026-10-10 and re-measured 2026-10-11. |
| P3-002 | 17 unrelated `claude/*` remote branches | 11 | TRIAGED | **Nothing deleted.** Full inventory produced: 17 refs, 12 distinct names, 3 remotes (`github`, `grindrx-forgejo`, `origin`). **9 safe**, **8 hold unmerged work**. `--is-ancestor` alone is misleading — `claude/grindrx-freeze-json-audit-gp4lnk` reads UNIQUE/54 but `git cherry` returns 54 `-` / 0 `+` (all patches already in main, SHAs differ from rewritten history). `github/claude/phone-battery-drain-77zz36` holds 1 real commit (`d7d950b`, `ws.rs` battery/backoff constants absent from main). Awaiting operator approval; delete commands supplied in report, not run. **Re-measured 2026-10-11: 16 refs, 12 distinct names, 2 remotes** — the `grindrx-forgejo` remote no longer exists in `.gitconfig`, so one ref went with it. The 9-safe/8-hold split was computed over the 17-ref set and was **not** recomputed; re-run the inventory before deleting anything. |
| P3-003 | Binary test file `profile.test.ts` should be TypeScript or removed | 01 | VERIFIED | Commit `d0cf011`. File kept (it is valid TypeScript; only its encoding was broken). **12** control bytes total — the 10 NULs plus 2 raw `0x01`, all inside string literals feeding `ascii()`. They are meaningful JPEG bytes (EXIF `Exif\0\0`, `8BIM`, JFIF/ICC padding), so they were **re-encoded as `\x00`/`\x01` escapes, not deleted**. `file -b`: `data` → `JavaScript source, Unicode text, UTF-8 text`. Size `21351` → `21387` (+36 = 12 × +3). All 24 string literals proven byte-identical at runtime by `node` char-code comparison. `vitest run src/lib/api/profile.test.ts` → **30/30 pass**, same as baseline. Pre-existing eslint import-sort errors and prettier warning untouched (confirmed present at HEAD). |

Full method, byte offsets and reasoning: `memory/FIX_NOTES_p3_cleanup_20261010.md`.

---

## P2 verification evidence (2026-10-10, measured on `main` @ `eca61c2`)

The P2 batch was dispatched 2026-10-10 to six agents. **Three died to a context limit
having written nothing; three wrote code and died before committing.** 1067 lines were
rescued from tmpfs and are the basis of P2-001/002/004. `main` carried **35 failing tests**
after the rescue and carries **0 attributable to P2** now.

| ID | Evidence |
|----|----------|
| P2-001 | `3a324d5`. Real defect: on a *double* purge failure (delete refused AND the PII-free overwrite unwritable) the prior account's geohash survives; `failures[]` is function-local and `purgeAccountLocalData` must not throw, so the next `getPreferences` decodes the stale file cleanly and adopts the old geohash. `purge.double-failure.test.ts` (new, 616 lines) injects that failure. |
| P2-002 | `4200787`. Cache moved out of the route leaf into `src/lib/model/grid/profile-cache.ts` so sign-out purge can reach it by construction; re-exported from `src/lib/api/grid.ts` as a named list. `grid-cache.purge.test.ts` (new, 334 lines). |
| P2-003 | Already satisfied on arrival — manifest carries `allowBackup="false"`, `fullBackupContent="false"`, `dataExtractionRules="@xml/data_extraction_rules"`, and ledger entry 19 holds on-device `dumpsys` evidence. Re-audited rather than trusted: keyring (`android-native-keyring-store` 0.5.0) writes to the `sharedpref` domain, excluded in **both** `<cloud-backup>` and `<device-transfer>`; AOSP `FullBackup.extractCanonicalFile` maps a path-less exclude to the domain dir and `isFileSpecifiedInPathList` matches by prefix, so the excludes genuinely bite. `ad016c4` closed one **defense-in-depth** gap: 4 of 9 valid domains (`device_root`/`device_file`/`device_database`/`device_sharedpref`) were unexcluded. Not exploitable today — nothing writes `/data/user_de` — but `getDirectoryForCriteriaDomain` silently skips unknown domains, so it would never have failed loudly. **Not validated by a real Android build** (no build run on the audit host). |
| P2-004 | **The rescued commit shipped a live mutation.** `6a1115f` line 621 read `// MUTATION-1: release removed` inside a `finally` block whose own comment declares "THE SLOT-RELEASE CONTRACT. Unconditional, and the LAST thing that happens". Every authenticated fetch acquired a limiter slot and never returned it, saturating the cap at 4 and starving **30 tests** (and, via the same code path, 5 `api/index` purge tests). Fixed in `c760de9` (restore the release), `12bbe09` (`acquireFetchSlot` promised on the under-limit fast path, costing a microtask that the purge test's same-tick bridge release depended on), `4b1df26` (test teardown drain). Both implementation fixes are mutation-verified: reverting either reproduces the original failure. |
| P2-005 | Register was **inverted**. The listener existed (`ws.svelte.ts:152`) but `grep -rn ws_error src-tauri/src/` returns zero — the emitter never existed (`git log -S ws_error -- src-tauri/src/api/ws.rs` = 0 commits); the listener arrived frontend-only. Removed in `b3419bd` rather than re-adding an emit: no diagnostic is swallowed, because `ws.rs:289` already `eprintln!`s and the terminal case surfaces the same text as `lastError`. |
| P2-006 | 99 files, **0 tracked by git** (covered by `.gitignore:36 *.bak.*`). Archived to `/srv/archive/grindrx-bak-20261010/` with `MANIFEST.tsv` (sha256, path, mtime, counterpart-comparison), archive checksum-verified against source **before** anything was removed: **0 mismatches**. **96 of 99 hold content differing from their live counterpart** — these are real R4 audit trail and are referenced by `master_measurement_ledger.jsonl` and `measure-*.jsonl`; deleting them would have destroyed evidence. Only 3 were identical to their counterpart. |

### Known non-P2 failure carried into the build

`src/lib/components/telemetry-consent-dialog.dom.test.ts` fails **2 tests under full-suite
parallel load only** (P1-001 telemetry consent, not a P2 item). It passes **8/8 in isolation,
3 runs out of 3**, and the failing test *names* vary per run — a race, not a fixed defect.
Under load the file takes ~43s vs ~1s alone. Not fixed here; recorded so the build is not
mistaken for a clean full-suite run.

---

## Reconciliation 2026-10-10 — the register was 2 releases stale

Twenty-one items still read `OPEN` that were in fact complete, because the register was
last touched at baseline `7fffcec` and was never updated as the P1 merges landed. That
staleness is the same disease as the SESSION_STATE doc and the empty ledger: a status
field that nobody maintains reads as truth until someone acts on it. Every status
above was re-derived from the code, not from a commit message.

**Still genuinely open, and why:**

- **P0-005 / P1-011 (provenance).** `5b69ca4` and `bb05c55` are absent from every repo
  this machine can reach. Not a code defect — a records defect that needs an external
  backup or an explicit HISTORICAL-ONLY disposition from the operator.
- **P0-007 (9 unprobed endpoints).** Needs live Grindr credentials. Cannot be done
  honestly without them.
- **P1-002 / P1-003.** WS contract tests against a real server, and schema validation
  across the `invoke()` mocks. Real work, not started.
- **P1-009's goal is not met by its fix.** The background mode is declared; a WebSocket
  still dies with the app suspended. Closing this honestly means re-scoping the item,
  not marking it done.

**Known-unreliable guards** (a green suite is not the same as a working one):
`profile.media-upload.test.ts` times out under full-suite load and
`telemetry-consent-dialog.dom.test.ts` fails 2 tests under load only. Both pass in
isolation. Both are load-sensitive and neither is a defect in the code under test.

**P0-004 is the one to watch.** A signed APK now builds and its certificate verifies,
but no release has yet been confirmed running on a device for the current code. It is
recorded IMPLEMENTED rather than VERIFIED deliberately.

---

## Reconciliation 2026-10-11 — second pass, and one item was found to have been closed ON PAPER

The 2026-10-10 pass fixed 21 stale `OPEN` statuses. This pass re-derived the remaining ones from
the tree at `main` = `d742ebfc`. **Two findings closed with evidence, and one item that a ledger
entry claimed was closed is NOT.**

### Closed, with the evidence

**P0-006 — stale Android assets. VERIFIED.** The acceptance criterion is that the tracked
`gen/android` assets match the current version tuple and identifier. Measured 2026-10-11:

- `gen/android/app/tauri.properties` → `tauri.android.versionName=0.1.50`, `versionCode=1085`
- `gen/android/app/src/main/assets/tauri.conf.json` → `"version":"0.1.50"`, `"identifier":"com.grindrx.app"`,
  `userAgent` `GrindrX/0.1.50`
- `app/build.gradle.kts:60` `applicationId = "com.grindrx.app"`; `:63-64` read the version from
  `tauriProperties` rather than hardcoding it
- The only surviving `org.opengrind` strings under `gen/android` are in **explanatory comments**
  (`AndroidManifest.xml:17,27`, `res/xml/file_paths.xml:6`), not live identifiers

**P0-009 — EXIF on the canvas-fallback path. VERIFIED.** Closed by `f32228cb`
("refuse unsanitizable EXIF"), which is on `main`. `stripImageMetadata` (`src/lib/api/profile.ts:654`)
handled jpeg/gif/png/webp but its default branch returned HEIF/AVIF bytes **as-is**, so a HEIF photo
whose canvas re-encode failed was uploaded with its EXIF intact — and EXIF carries GPS. It now
detects the `Exif\0\0` payload by signature (present wherever TIFF/EXIF is stored, including as an
iloc-addressed item inside an ISO-BMFF container) and **refuses the upload** rather than letting an
unrewritable container through. Tests in `src/lib/api/profile-exif.test.ts`; ledger records them as
mutation-verified, with the note that the first attempt asserted nothing useful and was discarded.

### NOT closed — the ledger says one thing and the refs say another

**P0-005 (`5b69ca4`) stays OPEN, and the ledger's "exists on GitHub" does not survive checking.**
Ledger entry 84 records *"5b69ca4 exists on GitHub (2026-10-06, 'migration: preserve OVH iOS
port'), closing P0-005."* Measured 2026-10-11 at `d742ebfc`:

```
$ git branch -a --contains 5b69ca4
  remotes/ovh-migration/migration/ovh-ios-port-v0.1.48-2026-10-06

$ git merge-base --is-ancestor 5b69ca4 main          # -> NO
$ git merge-base --is-ancestor 5b69ca4 origin/main   # -> NO
$ git remote
  github
  origin
```

The commit object is present, but it is reachable **only** through `refs/remotes/ovh-migration/…`,
and **`ovh-migration` is not a configured remote** — `.git/config` lists only `github` and `origin`.
So the commit is in exactly one local object store, behind a stale tracking ref for a remote that
no longer exists, and is **not on GitHub or Forgejo**. That is a *worse* position than the original
finding, because it looks closed. (`refs/remotes/axis/*`, `refs/remotes/bundle/*` and
`refs/remotes/axisbranches/*` are stale in the same way.) **Action: push it, or take an explicit
HISTORICAL-ONLY disposition from the operator.** Do not report this item as resolved until one of
those two has happened.

**P1-011 (`bb05c55`) stays OPEN — located, but not backed up.** Ledger entry 86 traces it to the
M1's `/Users/thomasbateman/open-grind`, where `bb05c55` is the second commit below HEAD `26be526`
("rescue(m1): preserve GrindrX photo/album auth fixes (uncommitted on M1)"). It is on **no remote**,
and `git cat-file` in `grindrx-work` fails on it. Ledger entry 88 records a second artifact copy at
`bc71144d…` on the M1. **Two unbacked-up local repos is one disk failure from losing it.**

### Re-derived, still open

**P0-007 — the finding's own count is stale.** The item reads "9 HTTP endpoints unprobed". Only
**two** source files still carry an `UNPROBED` banner: `src/lib/api/assignment.ts:12` and
`src/lib/api/taps.ts:52`. Either seven were closed since the baseline or the original count was
wrong. **Re-derive the list from the banners before assigning this work** — an item whose scope is
unknown is how an agent reports "done" on work that was never specified.

**P1-003 — partially answered by a different approach.** `src/lib/api/auth-contract.guard.test.ts`
validates **cross-layer** agreement (it globs `/src/**/*.{ts,svelte}` and `/src-tauri/src/**/*.rs`
and asserts the TS bridge, the Svelte form and the Rust command name the same endpoint), because the
defect it guards — three internally-correct files implementing one feature with two endpoints — was
structurally invisible to every per-file test. That is one endpoint pinned, not "schema validation
on all mocks". The item stays **OPEN**; the count "30/65" was removed from the row rather than
carried forward as fact.

**P1-002 — unchanged, and it needs credentials an agent will not manufacture.** A WS contract test
against a real server. Ledger entry 85 records an explicit **decline** to fabricate a Grindr test
account and bypass phone verification. The legitimate route is recorded there: use **recorded
fixtures**. That decision stands.

**P1-009 — the status is honest but the goal is not met.** `UIBackgroundModes` is declared; a
WebSocket still dies with the app suspended. Recorded as `VERIFIED (goal NOT met)` rather than
re-scoping it silently. **Closing this honestly means rewriting the item, not the status.**

### Blockers that are not code

- **No device.** The S26 Ultra is unreachable (`ssh s26` → connection timed out), so **P0-004 cannot
  advance past IMPLEMENTED**, and **0.1.49 and 0.1.50 are both unverified on hardware**. The signed
  APK is real and its certificate verifies — that is a different claim.
- **Four Forgejo access tokens (ids 10–13) await operator revocation.** Ledger entry 90.
- **`axis/.git/config` embeds a GitHub PAT and a dead Forgejo password in remote URLs**, and axis
  therefore cannot push to Forgejo at all. Ledger entry 90.

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
