# MEMORY — grindrx-work (index)

> Per HANDOFF_SYSTEM v1. Operator: **Tom**. Server: `ovh`. Root: `/home/ubuntu/grindrx-work`.
> Created 2026-06-09 06:57 UTC (bootstrap). Last reconciled 2026-06-23 08:16 UTC.

This is the index. Read it first, then the file the task points you to.

## Memory files

| File | Purpose |
|------|---------|
| `memory/SESSION_STATE.md` | Live state: current step, decision gate, files modified this session, timeline, known open issues. **Read after this index, before acting (R3).** |
| `memory/AUDIT_REPORT_v0.1.37.md` | **NEW — read this before touching the Photos tab or any image code.** Read-only audit of `432766f` + the v0.1.37 WIP. 2 CRITICAL + 5 HIGH in the Photos tab alone, 10 more HIGH board-wide. The Photos tab has **zero test coverage**. Includes the one question that needs a live `curl` before any image work. |
| `memory/PROJECT_ROADMAP.md` | What grindrx-work is, the phases, and the definition of success. |
| `memory/rules.md` | Canonical operating rules R1–R11 (+ project R20–R23). |
| `memory/FIX_NOTES_v0.1.9.md` | FIX_NOTES for the v0.1.9 audit ship (commit `28b1648`) + rollback tag. |
| `memory/FIX_NOTES_platform_port.md` | **NEW 2026-10-01 — `platform/` ported from upstream open-grind, uncommitted.** IME-inset deferral, `dismissOnBackGesture()`, 6 new `src/lib/platform/` modules, and the `MainActivity.kt` `imeVisible()` Kotlin half (**UNCOMPILED** — no Android SDK on this box). 30 mutation-verified tests. Records what was deliberately NOT ported and why — notably `link-opener.ts`, where ours is better. |
| `memory/FIX_NOTES_ios_port_v0.1.48.md` | **NEW 2026-10-02 — THE iOS PORT BUILDS, INSTALLS AND LAUNCHES.** Sign-in screen verified rendering on the simulator. Rust compiles for `aarch64-apple-ios` (`apple-native-keyring-store` + `security-framework` confirmed, closing an old UNVERIFIED). Two product defects fixed: `CFBundleVersion` was `"0.1.48"` (Apple rejects it — **the app could never have installed**), and no `NS*UsageDescription` keys existed. `scripts/build-ios.sh` builds a reproducible 5.8 MB unsigned `.ipa` for **AltStore/SideStore, needing no Apple account at all**. Signed device install is blocked ONLY on a rejected Apple ID session. **Keyring has still never worked on iOS** — read the OPEN section before assuming login functions. |
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
4. **AND THAT FIX INTRODUCED A SIGNED-OUT LOOP** (uncommitted, fixed 2026-10-02). Keeping the
   session removed the only thing accidentally clearing stale ones, so a server-REJECTED session
   kept a `profileId`, the `(protected)/+layout.ts` guard kept re-admitting the user, and every
   request 401'd — stuck on the grid with no sign-in, **including on a cold start**. **A 401 must
   clear the backend session (`invoke("logout")`) so `auth_state` returns null and the guard fires.
   Navigating alone is never enough.** Still unfixed: the client trusts the JWT's own `expires_at`,
   so a revoked-but-in-date token 401s forever instead of refreshing.

**THE INSTRUMENTATION THAT ENDED THE MISDIRECTION:** `rest.rs` logs status + a 240-char body
prefix on **every non-2xx in RELEASE builds**. Before this the only request logging was behind
`#[cfg(debug_assertions)]`, and a week was lost to a fictional outage. **Do not remove it.**
There is also a TEMPORARY `[DIAG]` block logging 2600-char prefixes of **2xx** bodies for
profile/images/cascade paths — that is what finally showed a real `profileImageMediaHash`. **Delete
it before committing.**

**MEASURED OFF THE DEVICE — use these, don't re-derive them:**
- `profileImageMediaHash` is **40 hex chars** (e.g. `d9180f7d…cfca6457`), a valid **public** hash.
  The private/signed-hash theory for missing profile photos is **dead**.
- `GET /v7/profiles/{id}` → **200**; profiles and profileIds load fine.
- `POST /v5/views/{id}` → **400 `urn:gr:err:internal_error`** on every profile open.

**TWO PROCESS LESSONS THAT COST REAL TIME:**
- **WebView `console.log` does NOT reach logcat in a release build.** A JS-side diagnostic
  produced a silently empty log and cost a build cycle. `eprintln!` → `RustStdoutStderr` is the
  only channel proven to work on-device.
- **Watch the test COUNT, not just "tests pass".** A `git checkout` used to undo a mutation
  silently reverted 5 unrelated tests (732 → 729).

**THE ERROR ENVELOPE THIS API RETURNS IS NOT WHAT `ApiHttpError` EXPECTED:**
`{"type":"urn:gr:err:...","title":"...","status":N,"traceId":"..."}` — there is **no `code` and no
`message` field**. Reading only those two silently discarded the server's explanation for *every*
error in the app. Now reads `type`/`title` too. **Any new error handling must use this shape.**

**ALSO: `cdns.grindr.com` returns S3 `AccessDenied` on every path including its own root.** Still
open (0.1.38), and now the leading suspect for profile photos not populating — see
`README_HANDOFF.md` §3 gap 1, which has a diagnostic armed on the device.

**Also note:** `src-tauri/gen/android/.../MainActivity.kt` is a **generated** file that is heavily
hand-modified. `tauri android init` can clobber it — diff before running one.

**Also note:** `origin` is **`dominus/open-grind` — UPSTREAM open-grind, not this fork.** A bare
`git push` publishes to the upstream project. This fork's remotes are `github`
(`Tgbjr2025/grindrx`) and `grindrx-forgejo` (`dominus/grindrx`). `main` is 112 commits behind and
diverged; it is never a push target.

**Also note:** `google-services.json` is **NOT** in `.gitignore` (verified with
`git check-ignore`). Decide that before any `git add -A`.

## Root handoff docs (outside memory/)

| File | Purpose |
|------|---------|
| `README_HANDOFF.md` | **REWRITTEN 2026-10-02 — the primary gap document.** Current state, the three retracted false premises, committed-vs-uncommitted, the 7 remaining gaps in priority order, the M1 build recipe with its four traps, the two upstream-version traps, and the test-runner layout. **Does NOT replace `README.md`.** |
| `HANDOFF_MESSAGE.md` | **REWRITTEN 2026-10-02** — verbatim bootstrap prompt for the next session. |

## Authoritative project docs (pre-existing, do not modify — R23)

- `README.md` — product overview (upstream, leave as-is).
- `BUILDING.md` — Nix-based Android build pipeline.
- `CHANGES.md` — changelog of fork fixes/features.
- `KEYS.md` / `KEYS.md.asc` — PGP + APK signing keys.

## One-line state
**0.1.48/1083 — the app is FIXED AND VERIFIED WORKING ON THE DEVICE.** The grid bug (8-char geohash
where the API requires 12 → HTTP 400 `urn:gr:err:geo_hash_decode`) is fixed in **`0c223af`, on both
forks**; the signed-out loop it introduced is fixed in the tree. **Nothing committed or pushed since
`0c223af`.** Last *shipped* release is still **0.1.40 / 1075**; **1076–1083 are each consumed by a
real installed diagnostic build and must never be reused**. `main` untouched, 112 behind. Gates:
**vitest 734/57, svelte-check 0 errors, eslint clean**. **Probe #1 answered.** Top open item:
**profile photos do not populate** — a diagnostic is armed in 0.1.48 and needs the operator to open
a profile; `profileImageMediaHash` is confirmed a valid 40-char public hash, so the remaining
suspect is `medias[].mediaHash` failing validation at `profile.ts:354` (no `.catch()`, so one bad
hash empties the whole carousel). Full gap list and the M1 build recipe in `README_HANDOFF.md`.

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

**Build host:** the **M1 Mac is the build host**, reachable over Tailscale: `ssh mac` (user is
`thomasbateman@100.92.26.108` — the `ubuntu@`/`mac@` names from `tailscale status` are WRONG).
It has a prebuilt 3.8 GB `target/`, cargo 1.95.0, bun 1.4.2, Temurin JDK 21. **OVH has no cargo
and no bun** — use `node_modules/.bin/{vitest,svelte-check,eslint}` directly. The M1 checkout is
stale (`e155a35` = v0.1.33) and diverges from OVH; rsync + verify by sha256 (R5) before building.
Note `eslint src` on the full tree did not finish in 15 min on OVH — scope it, or run it on the M1.

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
