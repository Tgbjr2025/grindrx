# README_HANDOFF — grindrx-work

> Handoff doc for the **grindrx-work** project. Operator: **Tom**. Created 2026-06-09 06:57 UTC (bootstrap).
> Last reconciled 2026-06-18 04:16 UTC. This file does NOT replace the upstream `README.md` (the product readme). Read both.

## TL;DR (90 seconds)

- **What:** `GrindrX` — a privacy-focused, ad-free Grindr client for **Android**, built with **Tauri 2** (Rust) + **SvelteKit**. A fork of `open-grind`. [verified: README.md, package.json]
- **Version:** `0.1.9` (package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml all agree — committed in `28b1648`). [verified]
- **This is a BUILD TREE, not a running service.** There is no app daemon here. The only related running service on this host is `grindx-ping.service` (the active-user tracker, see Inventory) — that is a *separate* program at `/home/ubuntu/ping-server/`, NOT part of this tree. [verified: `systemctl`]
- **Current branch:** `audit/v0.1.9-fixes` — **working tree is DIRTY** with **8 modified code files** as of 04:16 UTC (2 machine-specific gradle autogen + the TEMP `[diag-mediaid]` probe in `profile.ts` + five in-flight UNCOMMITTED audit fixes). **See Critical Traps.** [verified: `git status -s` + `git diff`]
- **Last commit (HEAD):** `03f88f2` (2026-06-18 03:55 UTC) — "perf(grid): viewport windowing to bound image memory (fix WebView freeze)". [verified: `git log`]
- **CONCURRENCY:** multiple other agents are editing the code (Rust, chat, albums, grid) in parallel as of 2026-06-18. The commit log and dirty tree are moving targets — re-probe with `git log --oneline -8` and `git status -s` / `git diff` before trusting any state here (R7). (The dirty set grew from 3 to 8 files between 03:58 and 04:16 UTC.)
- **Artifact:** a ~256 MB `grindrx-arm64-debug.apk` sits in `~` (`/home/ubuntu/grindrx-arm64-debug.apk`). It is a **debug** apk, not a signed release. A v0.1.9 (vc1017, arm64) debug build was installed on-device (S26 Ultra) over Tailscale adb. [verified earlier — re-probe ~ if size/date matters]

## Recent commits (since v0.1.8)

| Commit | Date | What it did |
|--------|------|-------------|
| `28b1648` | 2026-06-12 | **v0.1.9 audit ship** — schema-drift robustness, authed-media lightbox fix, WS self-notify, host-test devshell, branding, manifest media perms; bumped 0.1.8→0.1.9. See `memory/FIX_NOTES_v0.1.9.md`. |
| `2290210` | 2026-06-12 | chore(handoff): audit session memory + FIX_NOTES for the ship. |
| `d3c0392` | 2026-06-12 | **Icon** — GrindrX monogram-G launcher icon (concept A) + regenerated android/ios/desktop assets. |
| `eaf60dc` | 2026-06-13 | **media compat** — CSP allows CloudFront (made images/albums display), conversation/profile schema-drift tolerance, direct signed-URL image loads, album thumb-probe, graceful saved-photo send. See `memory/FIX_NOTES_media_features.md`. |
| `1d09c10` | 2026-06-13 | **3 features + map-tile CSP** — pull-to-refresh + refresh button (grid), swipe between profiles, Explore-location; map-tile hosts added to CSP so map tiles render. |
| `03f88f2` | 2026-06-18 | **grid windowing (HEAD)** — viewport windowing (`GridWindow.svelte`) to bound image memory and fix the WebView freeze. ADDED, not yet field-verified. |

> Beyond HEAD, the dirty tree carries **uncommitted** audit fixes — see Critical Traps #1 and
> `memory/FIX_NOTES_media_features.md` §4.

## Inventory — where the real docs live

Upstream-style product docs already exist in the tree root. Use them; this handoff only points at them:

| File | What it covers |
|------|----------------|
| `README.md` | Product overview, features, install, download links (Forgejo). **Do not clobber — leave as-is (R23).** |
| `BUILDING.md` | **Authoritative build pipeline.** Nix-flake based. `nix run .#build-android`. Output apk path, jniLibs symlink fix, signing, reproducibility. |
| `CHANGES.md` | Full changelog of `@Tgbjr2025` branch fixes/features on top of upstream. |
| `KEYS.md` (+ `KEYS.md.asc`) | **Signing keys.** PGP fingerprint `CB72 2EE9 67E4 FCAD 7C65 8FC6 9A1F 7F5F 5929 19D2`; Android APK cert SHA-256 `28:05:FD:D8:F0:BA:DB:94:24:D3:24:4C:5E:5B:34:73:CE:F5:B8:79:8E:C1:11:73:82:E8:9E:DA:45:C3:65:8C`. |
| `CONTRIBUTING.md`, `GOVERNANCE.md`, `CODE_OF_CONDUCT.md`, `FUNDING.md`, `LICENSE` | Project governance / legal. |
| `memory/FIX_NOTES_v0.1.9.md`, `memory/FIX_NOTES_media_features.md` | Per-ship FIX_NOTES (R10). |

Code layout: `src-tauri/` = Rust API layer (`src/api/`: `auth.rs`, `client.rs`, `headers.rs`, `rest.rs`, `ws.rs`, `mod.rs`); `src/` = SvelteKit frontend (`src/lib/`, `src/routes/`). Android Gradle project generated under `src-tauri/gen/android/`. [verified: `ls`]

## Build / install workflow (as actually used)

1. **Build:** `nix run .#build-android` (Nix flake; per BUILDING.md). Do NOT hand-roll cargo/gradle (R21). Output unsigned apk under `src-tauri/gen/android/app/build/outputs/apk/...`.
2. **Install:** **adb over Tailscale** to the **S26 Ultra** (SM-S948U1, Android 17, Tailscale IP `100.64.176.13:5555`). Wireless debugging must be on + phone online. **The phone keeps dropping off Tailscale — confirm it is reachable before attempting an install.** Uninstall wipes app data → re-login required.
3. **Sign** only with the keystore whose cert SHA-256 matches `KEYS.md` (R22). The apk in `~` is debug.

## Critical Traps

1. **DIRTY working tree (8 code files as of 04:16 UTC; the set is MOVING).** Branch `audit/v0.1.9-fixes` carries uncommitted code. **Do NOT `git checkout`/`stash`/`reset`/`clean` (R20).** The files:
   - `src-tauri/gen/android/app/tauri.build.gradle.kts` and `src-tauri/gen/android/tauri.settings.gradle` — **machine-specific autogen, dirty ON PURPOSE** (`/home/ubuntu/…` vs `/Users/thomasbateman/…` + plugin ordering). Committing them breaks the macOS build. Leave dirty.
   - `src/lib/api/profile.ts` — a **TEMPORARY `[diag-mediaid]` probe** (one-shot console-logging probe hunting for a Grindr endpoint that still returns a usable `mediaId` for saved photos). Diagnostic scaffolding; expected to be removed once the saved-photo-send 400 is root-caused.
   - **Five in-flight UNCOMMITTED audit fixes** (concurrent audit tasks): `src-tauri/src/api/rest.rs` (FIX 13 — enforce https before attaching the auth header + redirect-refusing client, closing a session-token leak), `src/lib/api/album.ts` (album-share now grants via `/v4/albums/{id}/shares` so the recipient can unlock), `src/lib/api/messages.ts` (dead-import cleanup), `src/routes/(protected)/(navbar)/(root)/grid-state.svelte.ts` (Explore-location routed through `exploreGeoHash`), `src/routes/(protected)/chat/[conversationId]/conversation-state.svelte.ts` (WS listener-leak fix + self read-receipt guard). NOT committed, NO rollback tag — tag + FIX_NOTES before any ship (R9/R10). Full cited detail in `memory/FIX_NOTES_media_features.md` §4.
   [verified: `git status -s` + `git diff` @ 2026-06-18 04:16 UTC]
2. **Concurrent agents are editing the code.** Rust, chat, albums, grid are being touched in parallel. The dirty set and commit log WILL move (it grew 3→8 between 03:58 and 04:16 UTC). Re-probe before relying on anything (R7). A docs agent must NOT edit `src/` or `src-tauri/`.
3. **Signing keys are load-bearing — see `KEYS.md`.** A build is only a *real* deliverable once signed with the keystore whose cert SHA-256 matches KEYS.md. The apk in `~` is **debug**, unsigned-for-release. Do not invent or rotate keys (R22). [verified: KEYS.md]
4. **Build is Nix-driven, not raw cargo/gradle.** Per BUILDING.md the supported path is `nix run .#build-android` (R21). [verified: BUILDING.md]
5. **`grindx-ping.service` is NOT this project.** Separate Node active-user tracker at `/home/ubuntu/ping-server/server.js` on `:4242`. Leave it alone unless the task explicitly concerns it. [verified: `systemctl status grindx-ping.service`]

## Known open issues

- **App freeze under image memory** — grid windowing added in `03f88f2` (`GridWindow.svelte`); NOT yet field-verified on-device. Intermittent WebView memory pressure under heavy media may persist.
- **Saved-photo send 400** — Grindr removed the usable `mediaId` from `/v3.1/me/profile/images`; graceful degradation shipped (`eaf60dc`), the `[diag-mediaid]` probe in `profile.ts` still hunting for a working endpoint. Pending the real mediaId source.
- **Album-share doesn't unlock for the recipient** — **fix in progress (uncommitted):** `album.ts` now grants via `/v4/albums/{id}/shares`. Not yet committed or field-verified.
- **WS DNS flakiness on cellular + phone drops off Tailscale** — WebSocket DNS resolution unreliable off Wi-Fi; separately the S26 Ultra keeps dropping off Tailscale, blocking adb installs.

## How to resume

1. Read `memory/MEMORY.md`, then `memory/SESSION_STATE.md`. (R3 — read state before acting.)
2. `git -C /home/ubuntu/grindrx-work status -s && git -C /home/ubuntu/grindrx-work log --oneline -8 && git -C /home/ubuntu/grindrx-work diff --stat` — the tree shifts because other agents edit/commit live; re-probe (R7). Expect the dirty set to differ from this doc.
3. The dirty tree carries in-flight audit fixes (rest.rs / album.ts / etc.) with NO rollback tag — if Tom authorises a ship, tag first (R9), write FIX_NOTES (R10), build only via the Nix path in `BUILDING.md`, sign only with the keystore in `KEYS.md`. Do not push from an agent loop (R11).
