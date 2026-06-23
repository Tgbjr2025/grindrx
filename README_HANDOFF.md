# README_HANDOFF — grindrx-work

> Handoff doc for the **grindrx-work** project. Operator: **Tom**. Created 2026-06-09 06:57 UTC (bootstrap).
> Last reconciled 2026-06-23 08:16 UTC. This file does NOT replace the upstream `README.md` (the product readme). Read both.

## TL;DR (90 seconds)

- **What:** `GrindrX` — a privacy-focused, ad-free Grindr client for **Android**, built with **Tauri 2** (Rust) + **SvelteKit**. A fork of `open-grind`. [verified: README.md, package.json]
- **Version:** `0.1.13` (package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml all agree). [verified]
- **This is a BUILD TREE, not a running service.** There is no app daemon here. The only related running service on the build host is `grindx-ping.service` (the active-user tracker, see Inventory) — that is a *separate* program at `/home/ubuntu/ping-server/`, NOT part of this tree. [verified: `systemctl`]
- **Working tree:** **CLEAN** at HEAD (this checkout). The audit fixes the prior handoff flagged as uncommitted are now all committed (`17d47f3`); the old `[diag-mediaid]` probe is gone. **One NEW temp trap exists** — the `[GrindrX-API]` logcat diagnostic added at HEAD. **See Critical Traps.** [verified: `git status -s`]
- **Last commit (HEAD):** `b112cb3` (2026-06-20 06:48 UTC) — "chore(api): log real HTTP status + body for non-2xx responses" (the temporary CAS-4001 diagnostic). [verified: `git log`]
- **Re-probe before trusting state:** this project has had multiple agents editing in parallel historically; always re-probe `git log --oneline -8` and `git status -s` / `git diff` (R7).
- **Artifact:** a debug `grindrx-arm64-debug.apk` has historically sat in `~` on the build host (`/home/ubuntu/...`). It is a **debug** apk, not a signed release. Re-probe `~` on the build host; it is NOT in a fresh clone.

## Recent commits (since v0.1.9 ship)

| Commit | Date | What it did |
|--------|------|-------------|
| `28b1648` | 2026-06-12 | **v0.1.9 audit ship** — schema-drift robustness, authed-media lightbox fix, WS self-notify, host-test devshell, branding, manifest media perms; bumped 0.1.8→0.1.9. See `memory/FIX_NOTES_v0.1.9.md`. |
| `d3c0392` | 2026-06-12 | **Icon** — GrindrX monogram-G launcher icon (concept A) + regenerated android/ios/desktop assets. |
| `eaf60dc` | 2026-06-13 | **media compat** — CSP allows CloudFront (made images/albums display), conversation/profile schema-drift tolerance, direct signed-URL image loads, album thumb-probe, graceful saved-photo send. See `memory/FIX_NOTES_media_features.md`. |
| `1d09c10` | 2026-06-13 | **3 features + map-tile CSP** — pull-to-refresh + refresh button (grid), swipe between profiles, Explore-location; map-tile hosts added to CSP so map tiles render. |
| `03f88f2` | 2026-06-18 | **grid windowing** — viewport windowing (`GridWindow.svelte`) to bound image memory and fix the WebView freeze. |
| `17d47f3` | 2026-06-18 | **audit fixes committed** (was the prior "dirty tree") — album-share grant/unlock via `/v4/albums/{id}/shares`, `fetch_authed_bytes` token-leak/redirect hardening, chat live-update + dup-message race, Explore geohash plumbing. See `memory/FIX_NOTES_media_features.md` §4. |
| `a6fed16` | 2026-06-18 | **photo-send fix + units + nav** — saved-photo `mediaId` now sourced from `/v4/me/profile` (the 400 root cause); metric/imperial for height+weight; **Map/nearby bottom tab removed**. |
| `bccb55d` | 2026-06-19 | **release v0.1.12** — collapse 9-layer backdrop blur to fix compositor freeze, off-main-thread image decode + upload downscale, real `mediaId` via `/v5/chat/media/upload`, background notifications (foreground service + deep-link), inbox newest-first sort, masked views/previews, tolerant taps schema. |
| `715a248` | 2026-06-19 | feat(chat): port unsend-messages (#89) from v0.1.11; docs: api-discoveries. |
| `b5d182e` | 2026-06-19 | **v0.1.13** — eliminate lightbox-open freeze on shared photos (drop the PhotoSwipe border-radius morph that re-rasterized the full-res bitmap every frame). |
| `3e1d412` | 2026-06-20 | **surface server error codes** — `ApiHttpError` raises a structured HTTP-status + server-code error (e.g. `CAS-4001`) instead of JSON-parsing the error body; grid maps it to an actionable message; drop the map/location-picker full-screen blur that froze the picker. |
| `b112cb3` | 2026-06-20 | **(HEAD)** — temporary `[GrindrX-API]` logcat diagnostic logging real HTTP status + body for non-2xx responses, to root-cause CAS-4001. **Temp — remove once diagnosed.** |

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

1. **NEW temp diagnostic at HEAD — remove once CAS-4001 is diagnosed.** `b112cb3` added a **TEMPORARY `[GrindrX-API]` logcat probe** that logs the real HTTP status + body for non-2xx API responses (`adb logcat | grep GrindrX-API`), to surface the server-side cause of cascade error codes like `CAS-4001`. It is diagnostic scaffolding; expected to be removed once the cause is identified. (The older `[diag-mediaid]` probe in `profile.ts` is **gone** — the saved-photo 400 was root-caused in `a6fed16`.) [verified: `git show b112cb3`, `grep diag-mediaid` → none]
2. **Machine-specific gradle autogen — dirty ON PURPOSE on a build host.** `src-tauri/gen/android/app/tauri.build.gradle.kts` and `src-tauri/gen/android/tauri.settings.gradle` carry the build host's absolute paths (`/home/ubuntu/…` vs `/Users/thomasbateman/…`) + plugin ordering. On a checkout that has run a build they will show modified — **leave them dirty, never commit them** (committing breaks the other host's build). They are NOT present in a fresh clone. **Do NOT `git checkout`/`stash`/`reset`/`clean` a dirty build tree (R20).**
3. **Re-probe before trusting state (R7).** This project has had multiple agents editing in parallel; the commit log and tree move. Always re-run `git log --oneline -8` and `git status -s` / `git diff`. A docs agent must NOT edit `src/` or `src-tauri/`.
4. **Signing keys are load-bearing — see `KEYS.md`.** A build is only a *real* deliverable once signed with the keystore whose cert SHA-256 matches KEYS.md. Any apk in `~` is **debug**, unsigned-for-release. Do not invent or rotate keys (R22). [verified: KEYS.md]
5. **Build is Nix-driven, not raw cargo/gradle.** Per BUILDING.md the supported path is `nix run .#build-android` (R21). [verified: BUILDING.md]
6. **`grindx-ping.service` is NOT this project.** Separate Node active-user tracker at `/home/ubuntu/ping-server/server.js` on `:4242`. Leave it alone unless the task explicitly concerns it. [verified: `systemctl status grindx-ping.service`]

## Known open issues

- **CAS-4001 / cascade bare-text error codes (active).** The explore/cascade endpoint can answer with a bare text code (e.g. `CAS-4001`) rather than JSON, which previously surfaced as a misleading `JSON.parse` error in the grid after changing the explore location. `3e1d412` added `ApiHttpError` (structured HTTP-status + server-code) and an actionable grid message; `b112cb3` added the temp `[GrindrX-API]` logcat probe. **The server-side reason for the code is still under investigation.**
- **App freeze under image memory / WebView compositor** — addressed across several commits: `03f88f2` (grid viewport windowing), `bccb55d` (collapse 9-layer backdrop blur + off-main-thread decode + upload downscale), `b5d182e` (drop lightbox border-radius morph), `3e1d412` (drop map/location-picker full-screen blur). **Confirm the freezes are gone on-device** under heavy media.
- **WS DNS flakiness on cellular + phone drops off Tailscale** — WebSocket DNS resolution unreliable off Wi-Fi; separately the S26 Ultra keeps dropping off Tailscale, blocking adb installs.
- *(Resolved since the prior handoff:* saved-photo send 400 → fixed in `a6fed16` / `bccb55d`; album-share unlock → committed `17d47f3`; `fetch_authed_bytes` token-leak → committed `17d47f3`.*)*

## How to resume

1. Read `memory/MEMORY.md`, then `memory/SESSION_STATE.md`. (R3 — read state before acting.)
2. `git status -s && git log --oneline -8 && git diff --stat` — re-probe (R7); on a build host expect the 2 gradle autogen files to show dirty (on purpose), otherwise the tree should be clean at HEAD `b112cb3`.
3. Next substantive work: root-cause **CAS-4001** (then remove the temp `[GrindrX-API]` logcat probe), and field-verify the freeze fixes on the S26 Ultra. If Tom authorises a ship, tag first (R9), write FIX_NOTES (R10), build only via the Nix path in `BUILDING.md`, sign only with the keystore in `KEYS.md`. Do not push from an agent loop (R11).
