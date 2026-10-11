# MEMORY — grindrx-work (index)

> Per HANDOFF_SYSTEM v1. Operator: **Tom**.
> **Canonical source: `/srv/projects/grindrx-work` on host `axis`.**
> **Build host: the M1 Mac** (JDK 17, NDK 27.0.12077973, build-tools 34/35/36) — it is the only box
> with an Android SDK. `opencode` and agents run **on the M1** and must `ssh axis` for repo work.
> The old `ovh` host and `/home/ubuntu/grindrx-work` are **history** — see `PROJECT.md`.
> Created 2026-06-09 06:57 UTC (bootstrap). Last reconciled **2026-10-11**.

This is the index. Read it first, then the file the task points you to.

## ⚠ READ THIS BEFORE TRUSTING ANY SINGLE FACT IN THIS FILE

Three of the historical entries below (build host, server, `origin` remote) were **wrong** and were
believed for weeks. Before acting on anything, re-probe it (R7). If a fact here disagrees with what
you can measure, **the measurement wins and this file is the bug** — fix it in the same session.

## Memory files

| File | Purpose |
|------|---------|
| `memory/SESSION_STATE.md` | Live state: current step, decision gate, files modified this session, timeline, known open issues. **Read after this index, before acting (R3).** Newest entry at the TOP. |
| `memory/rules.md` | Canonical operating rules R1–R11 (verbatim) + project R20–**R26**. |
| `memory/FIX_NOTES_android_build_toolchain.md` | **The Android build fails unless the npm Tauri CLI is EXACTLY 2.12.1.** Gradle invokes the **cargo-installed** `tauri-cli` (`BuildTask.kt:27` hardcodes `executable = "cargo"`), so an npm/cargo version split means `cli-options-server.json` is never written and the build dies with a misleading "Android Studio must be running" message. Verified fix + its three traps. |
| `memory/FIX_NOTES_p3_cleanup_20261010.md` | The P3 batch: stale-version sweep, binary `profile.test.ts` re-encoding, the 17-branch `claude/*` inventory, and the `.bak.*` archive with provenance. |
| `memory/PROJECT_ROADMAP.md` | What grindrx-work is, the phases, and the definition of success. |
| `memory/AUDIT_REPORT_v0.1.37.md` | Read-only audit of `432766f` + the v0.1.37 WIP. 2 CRITICAL + 5 HIGH in the Photos tab, 10 more HIGH board-wide. **Historical** — the findings were remediated in v0.1.38. |
| `memory/FIX_NOTES_v0.1.9.md` | FIX_NOTES for the v0.1.9 audit ship (commit `28b1648`) + rollback tag. |
| `memory/FIX_NOTES_platform_port.md` | 2026-10-01 — `platform/` ported from upstream open-grind. IME-inset deferral, `dismissOnBackGesture()`, 6 new `src/lib/platform/` modules, and the `MainActivity.kt` `imeVisible()` Kotlin half (which **has since compiled** — the note's "UNCOMPILED, no Android SDK on this box" was true on the old `ovh` host and is **no longer true**; the M1 has the SDK). 30 mutation-verified tests. Records what was deliberately NOT ported and why — notably `link-opener.ts`, where ours is better. |
| `memory/FIX_NOTES_ios_port_v0.1.48.md` | 2026-10-02 — THE iOS PORT BUILDS, INSTALLS AND LAUNCHES. Sign-in screen verified rendering on the simulator. Rust compiles for `aarch64-apple-ios` (`apple-native-keyring-store` + `security-framework` confirmed, closing an old UNVERIFIED). Two product defects fixed: `CFBundleVersion` was `"0.1.48"` (Apple rejects it — **the app could never have installed**), and no `NS*UsageDescription` keys existed. `scripts/build-ios.sh` builds a reproducible 5.8 MB unsigned `.ipa` for **AltStore/SideStore, needing no Apple account at all**. Signed device install is blocked ONLY on a rejected Apple ID session. **Keyring has still never worked on iOS** — read the OPEN section before assuming login functions. **iOS bundleVersion is now 1085** (tracks Android versionCode); the note records 1083. |
| `memory/FIX_NOTES_media_features.md` | FIX_NOTES for the post-v0.1.9 media-compat + 3-feature + grid-windowing commits (`eaf60dc`, `1d09c10`, `03f88f2`), plus §4 — the audit fixes (rest.rs token-leak, album-share unlock, +3) now **committed in `17d47f3`**. |

## ⚠ THREE STANDING CORRECTIONS — do not let these rot back in

1. **THE "api.grindr.com TLS OUTAGE" IS FALSE.** It was never our host. Our base URL is
   `https://grindr.mobi` (`src-tauri/src/api/client.rs:13`), which answers fine. `api.grindr.com`
   appears once in the whole tree, in a comment. **"All 7 probes unprobeable" / "WP-5 and WP-6
   blocked" are UNFOUNDED.** Probe #1 is now ANSWERED: `/v3/cascade` returns data.
2. **PROFILES DID NOT FAIL BECAUSE OF THE NETWORK.** They failed with **HTTP 400
   `urn:gr:err:geo_hash_decode`** — the app was sending an 8-character geohash and the cascade
   endpoint requires 12. Introduced by `5cda11f` ("GrindrX Audit Agent", 2026-09-27), an ancestor
   of `v0.1.40`, so 0.1.40 SHIPPED BROKEN and its device test never opened the grid. Fixed in
   `0c223af`.
3. **AN EXPIRED SESSION CAN BE REFRESHED.** `client.rs` was deleting the refresh token at startup
   instead of using it — a self-inflicted lockout, made permanent by a WAF that intermittently
   refuses the login endpoint. Fixed in `0c223af`.
4. **AND THAT FIX INTRODUCED A SIGNED-OUT LOOP** (found and fixed 2026-10-02; **now committed**).
   Keeping the session removed the only thing accidentally clearing stale ones, so a
   server-REJECTED session kept a `profileId`, the `(protected)/+layout.ts` guard kept re-admitting
   the user, and every request 401'd — stuck on the grid with no sign-in, **including on a cold
   start**. **A 401 must clear the backend session (`invoke("logout")`) so `auth_state` returns
   null and the guard fires. Navigating alone is never enough.** Still unfixed: the client trusts
   the JWT's own `expires_at`, so a revoked-but-in-date token 401s forever instead of refreshing.
   The proper fix is **one refresh-and-retry on 401**.

**THE INSTRUMENTATION THAT ENDED THE MISDIRECTION:** `rest.rs` logs status + a 240-char body
prefix on **every non-2xx in RELEASE builds**. Before this the only request logging was behind
`#[cfg(debug_assertions)]`, and a week was lost to a fictional outage. **Do not remove it.**
(Still present at `rest.rs:265-291` — failure path only, 240-char prefix, control chars stripped.)
**The `[DIAG]` block that logged 2600-char prefixes of 2xx bodies is GONE** — it is what finally
showed a real `profileImageMediaHash`, and it has since been removed. So **no `medias[]` diagnostic
is armed on the device**; re-arm one before trying to close the image gap.

**MEASURED OFF THE DEVICE — use these, don't re-derive them:**
- `profileImageMediaHash` is **40 hex chars** (e.g. `d9180f7d…cfca6457`), a valid **public** hash.
  The private/signed-hash theory for missing profile photos is **dead**.
- `GET /v7/profiles/{id}` → **200**; profiles and profileIds load fine.
- `POST /v5/views/{id}` → **400 `urn:gr:err:internal_error`** on every profile open.

**TWO PROCESS LESSONS THAT COST REAL TIME — both still true, both re-earned since:**
- **WebView `console.log` does NOT reach logcat in a release build.** A JS-side diagnostic
  produced a silently empty log and cost a build cycle. `eprintln!` → `RustStdoutStderr` is the
  only channel proven to work on-device.
- **Watch the test COUNT, not just "tests pass".** A `git checkout` used to undo a mutation
  silently reverted 5 unrelated tests (732 → 729). Current baseline: **1115 passed / 0 failed /
  2 skipped across 80 files** — if the count drops, something was reverted, whatever the verdict
  says.

**THE ERROR ENVELOPE THIS API RETURNS IS NOT WHAT `ApiHttpError` EXPECTED:**
`{"type":"urn:gr:err:...","title":"...","status":N,"traceId":"..."}` — there is **no `code` and no
`message` field**. Reading only those two silently discarded the server's explanation for *every*
error in the app. Now reads `type`/`title` too. **Any new error handling must use this shape.**

**ALSO: `cdns.grindr.com` returns S3 `AccessDenied` on every path including its own root.** Still
open, and still the leading suspect for profile photos not populating — see `README_HANDOFF.md` §3
gap 1.

**Also note:** `src-tauri/gen/android/.../MainActivity.kt` is a **generated** file that is heavily
hand-modified. `tauri android init` can clobber it — diff before running one.

### FORGES — BOTH ARE AUTHORITATIVE. THIS HAS CHANGED TWICE. RE-PROBE IT.

- **GitHub `Tgbjr2025/grindrx` — public.** Remote name `github`.
- **Forgejo `dominusaxis/grindrx-work` — public.** Remote name `origin`.
- **BOTH are authoritative and are kept in sync.** The app polls **both** release sources and takes
  the **higher** tag (`fetch_latest_release`, `src-tauri/src/api/rest.rs:872-874` +
  `fetch_download_stats:922-924`), so neither forge can strand users on an old build.
- **"origin is upstream open-grind, never push" IS DEAD.** That was `axis`'s old remote and it has
  been corrected **in this checkout only** — `origin` here is `dominusaxis/grindrx-work`. ⚠
  **`axis:/srv/projects/grindrx-work/.git/config` still has `origin` = `dominus/open-grind`**, plus
  an old `grindrx-forgejo` pointing at `dominus/grindrx`. **Verify `git remote -v` on the host you
  are actually on before any push** (R7).

**Also note:** `google-services.json` is **NOT** in `.gitignore` (verified with
`git check-ignore`). Decide that before any `git add -A`.

## Root handoff docs (outside memory/)

| File | Purpose |
|------|---------|
| `README_HANDOFF.md` | **RECONCILED 2026-10-11 — the primary gap document.** Current state, the retracted false premises, the open gaps in priority order, the M1 build recipe, and the honest open-items list. **Does NOT replace `README.md`.** |
| `HANDOFF_MESSAGE.md` | **RECONCILED 2026-10-11** — verbatim bootstrap prompt for the next session. |

## Authoritative project docs (pre-existing, do not modify — R23)

- `README.md` — product overview. ⚠ **It says "Current release: v0.1.49" / sha256 `9f7959f7…` while
  the code is 0.1.50/1085.** It was corrected on 2026-10-10 (`90e66f63`) and has drifted again with
  the version bump. R23 says do not touch it; record the drift rather than silently editing.
- `BUILDING.md` — Nix-based Android build pipeline.
- `CHANGES.md` — changelog of fork fixes/features.
- `KEYS.md` / `KEYS.md.asc` — PGP + APK signing keys.

## Current version + build facts (measured 2026-10-11 on this checkout)

| Fact | Value | Verified how |
|---|---|---|
| Version | **0.1.50** | `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `gen/android/app/tauri.properties` — all four agree |
| versionCode | **1085** | `tauri.conf.json` `bundle.android.versionCode`; `output-metadata.json` |
| iOS bundleVersion | **1085** | `tauri.conf.json` `bundle.iOS.bundleVersion` |
| `autoIncrementVersionCode` | **false — MUST STAY false** | `tauri.conf.json`. Re-enabling it caused the historical **1067→1086 regression**; see `memory/FIX_NOTES_v0.1.33.md` |
| Latest verified APK | **71,440,981 bytes**, sha256 `7847eafc77e2ceb8e1ec0f8ba38bf42eee9d8beef7b5ab5d78e3117ff80d358d` | `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk` |
| Cert SHA-256 | `22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01`, DN `CN=GrindX, O=GrindX, C=US` | `apksigner verify --print-certs`; matches `KEYS.md` |

**The build only works with the npm Tauri CLI pinned to EXACTLY 2.12.1** — gradle invokes the
**cargo-installed** `tauri-cli` (`BuildTask.kt:27` hardcodes `executable = "cargo"`), so any
npm/cargo version split means `cli-options-server.json` is never written. Full story:
`memory/FIX_NOTES_android_build_toolchain.md`.

**Gates measured 2026-10-11 at HEAD `d742ebfc`:** vitest **1115 passed / 0 failed / 2 skipped
(80 files)** · svelte-check **0 errors, 4 pre-existing warnings** · `cargo test --lib` **35/35**.

## R24–R26 — the rules that exist because work was silently lost (2026-10-10)

Full text in `memory/rules.md`. **Summarised here because this index is what gets read first:**

- **R24 — Agents commit every verified increment to their OWN branch.** Not once at the end: an
  agent that holds work until a final commit and hits a context limit loses exactly that work.
  Committing is not pushing (R11 still forbids publishing). Six P2/P3 agents were dispatched
  2026-10-10; **three died to a context limit and were reported to the operator as "merged in" when
  every branch held ZERO commits.**
- **R25 — Never put a worktree on `/tmp`.** `/tmp` is **tmpfs (RAM)**; uncommitted files there are
  lost on reboot. Git *objects* are safe (they live in `<repo>/.git/worktrees/`), so R24 makes a
  `/tmp` worktree survivable — the working files are not. **Create worktrees under
  `/srv/worktrees/`** (verified to exist on `axis`).
- **R26 — The ledger records LOSSES, not just results.** A batch that dies, produces nothing, or is
  abandoned gets an entry saying what was lost and whether it was recovered. **An empty ledger
  section reads as "nothing happened"** — which is how three empty branches were reported as merged.

## Release pipeline (measured 2026-10-11)

- **FCM token registry:** `POST https://cam.dominusaxis.com/grindrx/register`, implemented in the
  ping server at `axis:/home/axis/ping-server/server.js` (`registerDevice()` — prunes on token
  rotation, appends to `devices.jsonl`). The app registers from `MainActivity.kt` on every launch
  via `registerIfKnown`. **`devices.jsonl` is currently 0 lines** — nothing has registered, because
  the S26 Ultra is unreachable.
- **Sender:** `axis:/home/axis/push-sender/push.sh` (+ `push.js`), using the service account at
  `axis:/home/axis/.secrets/grindrx-fbsvc.json` (mode **0600**). It reads the **published Forgejo
  release**, not a local file, so a push can never announce something that was not released.
- **It sends a NOTIFICATION payload, not a data payload, on purpose.** FCM `data` messages are
  **not delivered to a closed app** under modern Android's background-execution limits and OEM
  battery managers; only a `notification` message renders without starting the app.
- **Update checks:** `https://api.github.com/repos/Tgbjr2025/grindrx/releases/latest` and the
  Forgejo equivalent `https://git.dominusaxis.com/api/v1/repos/dominusaxis/grindrx-work/releases/latest`
  (`rest.rs:872-874`; download stats at `:922-924`). **Highest tag wins.** Fails open.

## One-line state
**0.1.50 / 1085. Grid, sign-in and the session loop are fixed; the signed APK builds, signs and
verifies on the M1 (cert `22d6889e…4c01`).** `main` is clean at `d742ebfc` and identical to both
forges (`origin`, `github`). Gates: **vitest 1115/0/2 over 80 files · svelte-check 0 errors ·
cargo test --lib 35/35**. ⚠ **0.1.50 has NOT been device-verified — the S26 Ultra is unreachable.**
⚠ **The canonical source on `axis` (`71a03294`) has DIVERGED from this checkout** — it lacks
`48f34943`/`d742ebfc` and holds one unpushed ledger commit of its own. Reconcile before either is
called authoritative. Top functional open item: **profile photos do not populate** (`medias[]`
schema). Full gap list and the M1 build recipe in `README_HANDOFF.md`.

<details><summary>Superseded 2026-06 → 2026-09 history</summary>

**v0.1.38 IS THE LATEST — it is UNCOMMITTED WIP in the tree, not 1.37.** `0.1.38` is in
`package.json` / `tauri.conf.json` / `Cargo.toml`, versionCode 1073, 36 files modified
(+1188/-648) + 4 untracked paths, rollback tag `audit-v0.1.38-rollback-20260927`. v0.1.37 is only the
last *tagged release*. 0.1.38 is the remediation of the audit below and it is **genuinely good**:
**both CRITICAL Photos-tab bugs are really fixed** (F2 at three layers via `planWrite` refusing
unless `load === "loaded"`; F1 by reordering to persist-BEFORE-reload and gating the success toast
on the write actually landing), plus F3–F7, and the state machine is now a pure module with 269
lines of tests — which closes the structural gap that let F1/F2 ship through 465 green tests. All 10
board-wide HIGHs are addressed. Gates measured: **vitest 510/43 files, svelte-check 0 errors**
(v0.1.37's committed error really is fixed), **eslint 8 errors — all pre-existing**, on lines 0.1.38
did not touch. **AND, on the M1 over Tailscale (fresh temp dir, the M1's own dirty checkout left
alone, sha256-verified per R5): `cargo check --lib` exit 0, `cargo check --all-targets` exit 0,
`cargo test --lib` 17/17** — the audit's largest gap, now closed. The 0.1.38 `auth.rs`/`error.rs`
changes compile clean, which matters because the v0.1.33 round shipped Rust that had *never*
compiled. `cargo` is not on the M1's default PATH — needs `export PATH="$HOME/.cargo/bin:$PATH"`.
**RELEASE-SAFE: `versionCode 1073` verified strictly monotonic** (`aapt2 dump badging` on every
released APK: …1065, 1069, 1070, 1071, 1072), so 0.1.38 is a valid in-place upgrade over v0.1.37.
Keep `autoIncrementVersionCode: false` — re-enabling it caused the historical 1067→1066 regression.

**⚠ DO NOT SHIP 0.1.38's IMAGE PATH AS VERIFIED.** The §4 probe has now been run and it
**contradicts the premise 0.1.38 is built on.** 0.1.38 bet on the vendored docs over the
`authed-image.ts:7-8` code comment and migrated 13 sites to bare unauthenticated CDN URLs. Probe
(read-only, no credentials): `/images/thumb/320x320/<40-hex>` **403**, `/` itself **403**,
`server: AmazonS3` — the signature of a fully private bucket. **Not conclusive** (S3 403s missing
keys when ListBucket is denied, and there is no real hash in the tree to test) but the evidence is
now clearly against the docs. If the comment is right, this is a regression that hits hardest in
the Photos tab and is invisible to build/tests/type-check/lint. **Needs one real `mediaHash` from a
live account + one `curl` with no `Authorization` header.**

**ACTIVE USERS: the tracker is BACK UP (restarted 2026-09-28 at Tom's go-ahead) and there are
live users.** It had been **DEAD since 2026-09-18 (10.2 days)**, so the pre-restart reading of
**1h/24h/7d = 0/0/0** was an artifact of a dead collector, NOT evidence of zero users. On restart,
real traffic reappeared within minutes: **`active_1h` = 2**, one of them on **v0.1.37** — the first
ping ever recorded from v0.1.33+. So the 13-day silence was the collector, not a user exodus. Last
real snapshot before the outage: **1h 5 / 24h 62 / 7d 261**. Lifetime **674 distinct install-ids**
from 4485 rows, **649 (96%) on v0.1.32**. Note `total_known` reads 0 immediately after a restart —
`server.js:27` loads only pings inside a 7-day window and all stored pings are >10 days old, so that
is retention working as designed, not data loss; the 674 figure is only readable by parsing
`pings.jsonl` directly. The S26 Ultra is offline on Tailscale (13d), so today's traffic is other
installs. Verified end-to-end over HTTPS (`/grindrx/` → :4242) and left clean — self-test ping
removed, DB back to 4485 lines.

**Prior round (v0.1.37 audit, now remediated in the tree) — read `memory/AUDIT_REPORT_v0.1.37.md`
for the detail.** Tom's reported "profile pics selection in the photos tab" was **two live CRITICAL
bugs in `settings/(subpage)/account/photos/+page.svelte`**, invisible to 465 passing tests, a clean
type-check and a clean lint because the screen had **zero test coverage**. Do not start the image
work without settling the CDN question above.

**Prior round, still the reference for what "done" looks like:** a 100% line-by-line audit of
v0.1.33 (`89e2e41`) — 30,107 lines TS/Svelte + 3,410 lines Rust, 7 partitions. See
`memory/AUDIT_REPORT_v0.1.33.md`: 4 CRITICAL (incl. the PIN lockout that bricked every PIN set in
v0.1.25–v0.1.32, a 1000× weight-filter unit error, the dead `retainAuthedImage` ref-count, and
lock-screen notifications leaking chat text past the app lock), 11 HIGH, ~30 MEDIUM, all fixed in
8 batches with regression tests: 0 type errors / 4 warnings, 442 tests, eslint clean. **Two of its
own claims did not survive re-verification in the v0.1.37 audit** — the C-4 `VISIBILITY_PRIVATE`
rationale was factually wrong (that is the platform default and it does redact on a secure lock
screen; the Rust gate is the real control), and its "no `fs:default` is needed" claim is backwards
(the chosen `fs:allow-app-*` sets carry much broader scopes than the capability files' comments say).
Do not cite the v0.1.33 report on those two points.

**Build host (SUPERSEDED — kept because the correction took weeks):** the **M1 Mac** was, and still
is, the build host. The old note said it was reachable as `ssh mac` at `100.92.26.108` and that
"OVH has no cargo and no bun". **Both hosts named in this paragraph are gone from the picture:**
the canonical source moved to `axis:/srv/projects/grindrx-work` (2026-10-05) and the agents now run
*on* the M1 itself. **JDK 17, NDK 27.0.12077973, build-tools 34/35/36** on the M1 — note
**JDK 25 is also installed and AGP 8.13.2 rejects it with a useless `> 25.0.2`, so pin the JDK**.

**STILL not device-tested, three releases running** (v0.1.34, .35, .36). Everything compiles;
nothing has run on hardware. The v0.1.36 grid-placeholder regression shipped twice before anyone
saw it, and the Photos-tab bugs above are exactly the class that a build cannot catch.

**v0.1.37 is the current HEAD** (`9f680d4`, versionCode 1072) — a Download-button fix that is
genuinely correct but shipped with **1 committed svelte-check error**
(`no-broken-opener.test.ts:43`). `v0.1.36` (tag `v0.1.36`, `6c1fe4b`, signed APK sha256
`60baa93c…3456`) is the last release whose committed tree was type-clean. `flake.nix` is modified
and uncommitted — the known OVH-only system-SDK workaround, **do not commit** (hardcodes an
absolute path). `memory/FIX_NOTES_v0.1.33.md` still records the `autoIncrementVersionCode` trap.

</details>

## ⚠ KNOWN OPEN ITEMS — state these plainly, do not let a green gate imply they are done

Measured/confirmed 2026-10-11. None of these are closed.

1. **Four Forgejo access tokens (ids 10–13) await operator revocation.** Created during the
   2026-10-10/11 reconciliation: `release-bot-20261010`, `probe`, `probe2`, `inventory`. Forgejo's
   token-delete endpoint requires **password** auth and the CLI has no delete command, so an agent
   could not revoke them. **Operator action:** `git.dominusaxis.com` → Settings → Applications.
2. **Forgejo token ids 1 and 3 carry scope `all`** (`migration-token`, `mig-1791238924`). They
   pre-date the current sessions but are the highest-value thing to revoke.
3. **`axis:/srv/projects/grindrx-work/.git/config` still embeds a GitHub PAT and a now-dead Forgejo
   password in the remote URLs.** That Forgejo credential returns 401, so **axis cannot push to
   Forgejo at all**, and any `git remote -v` on that box leaks the PAT into logs and transcripts.
   **This checkout's `.git/config` is clean** (SSH for GitHub, no credentials).
4. **The S26 Ultra is unreachable**, so **0.1.50 has NOT been device-verified** — and neither has
   0.1.49. A signed, correct APK is not a working app. `POST /grindrx/register` has consequently
   never been exercised: `devices.jsonl` is 0 lines.
5. **`axis` and this checkout have DIVERGED.** `axis:/srv/projects/grindrx-work` is at `71a03294`
   (5 ledger entries further than this tree's 85) and **does not contain `48f34943` or `d742ebfc`**.
   Reconcile before calling either the canonical one.
6. **P0-007 (unprobed endpoints) and P1-002 (WS contract tests) need live credentials.** The
   honest alternative is recorded in the ledger: P0-007's own acceptance criterion allows
   "verified **or documented as deprecated**", and P1-002 can use recorded fixtures. An agent
   **declined** to fabricate a test account and bypass phone verification — that decision stands and
   should not be relitigated without the operator revisiting it.
7. **U1 — `Accept: */*` on image requests — needs a device test.** The rescue commit's author
   asserted the CDN needs it but recorded **neither the media types it was for nor a request it
   actually fixed**, so `d742ebfc` **deliberately did not add it**: *"adding an untested header
   speculatively is how a guess becomes a 'fix'."* It is therefore an **open item, not code**, which
   is why it does not appear in the tree. If it does turn out to matter, it goes on the image/CDN
   request path, and it must be **proven on a device** before it is called a fix. [verified: the
   `d742ebfc` commit message, section "DELIBERATELY NOT RESTORED"]
8. **`README.md` has drifted again** — it advertises v0.1.49/`9f7959f7…` while the code is
   0.1.50/1085.
9. **Known load-sensitive tests** (pass in isolation, flaky under full-suite parallel load):
   `telemetry-consent-dialog.dom.test.ts` (2 tests) and `profile.media-upload.test.ts` (timeout).
