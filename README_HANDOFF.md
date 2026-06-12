# README_HANDOFF — grindrx-work

> Handoff doc for the **grindrx-work** project. Operator: **Tom**. Created 2026-06-09 06:57 UTC (bootstrap).
> This file does NOT replace the upstream `README.md` (the product readme). Read both.

## TL;DR (90 seconds)

- **What:** `GrindrX` — a privacy-focused, ad-free Grindr client for **Android**, built with **Tauri 2** (Rust) + **SvelteKit**. A fork of `open-grind`. [verified: README.md, package.json]
- **Version:** `0.1.8` (package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml all agree). [verified]
- **This is a BUILD TREE, not a running service.** There is no app daemon here. The only related running service on this host is `grindx-ping.service` (the active-user tracker, see Inventory) — that is a *separate* program at `/home/ubuntu/ping-server/`, NOT part of this tree. [verified: `systemctl`]
- **Current branch:** `audit/v0.1.9-fixes` — **working tree is DIRTY** (12 modified tracked files + 2 untracked). This is unfinished v0.1.9 audit work. **See Critical Traps.** [verified: `git status -s`]
- **Last commit:** `45083f2` (2026-05-26 19:09 UTC) — "fix(chat): WS listener leak…". [verified: `git log`]
- **Artifact:** a ~256 MB `grindrx-arm64-debug.apk` sits in `~` (`/home/ubuntu/grindrx-arm64-debug.apk`, 256,413,590 bytes, May 30). It is a **debug** apk, not a signed release. [verified: `ls -la ~`]

## Inventory — where the real docs live

Upstream-style product docs already exist in the tree root. Use them; this handoff only points at them:

| File | What it covers |
|------|----------------|
| `README.md` | Product overview, features, install, download links (Forgejo). **Do not clobber — leave as-is.** |
| `BUILDING.md` | **Authoritative build pipeline.** Nix-flake based. `nix run .#build-android`. Output apk path, jniLibs symlink fix, signing, reproducibility. |
| `CHANGES.md` | Full changelog of `@Tgbjr2025` branch fixes/features on top of upstream. |
| `KEYS.md` (+ `KEYS.md.asc`) | **Signing keys.** PGP fingerprint `CB72 2EE9 67E4 FCAD 7C65 8FC6 9A1F 7F5F 5929 19D2`; Android APK cert SHA-256 `28:05:FD:D8:F0:BA:DB:94:24:D3:24:4C:5E:5B:34:73:CE:F5:B8:79:8E:C1:11:73:82:E8:9E:DA:45:C3:65:8C`. |
| `CONTRIBUTING.md`, `GOVERNANCE.md`, `CODE_OF_CONDUCT.md`, `FUNDING.md`, `LICENSE` | Project governance / legal. |

Code layout: `src-tauri/` = Rust API layer (`src/api/`: `auth.rs`, `client.rs`, `headers.rs`, `rest.rs`, `ws.rs`, `mod.rs`); `src/` = SvelteKit frontend (`src/lib/`, `src/routes/`). Android Gradle project generated under `src-tauri/gen/android/`. [verified: `ls`]

## Critical Traps

1. **DIRTY working tree, no session tracking it.** Branch `audit/v0.1.9-fixes` has uncommitted changes spanning Rust + Svelte + Android manifest. **Do NOT `git checkout`/`stash`/`reset`/`clean` — you will lose v0.1.9 audit work.** Inspect with `git -C /home/ubuntu/grindrx-work diff` before doing anything. The modified files:
   - `src-tauri/src/api/headers.rs`, `src-tauri/gen/android/app/src/main/AndroidManifest.xml`, `src-tauri/gen/android/app/tauri.build.gradle.kts`, `src-tauri/gen/android/tauri.settings.gradle`
   - `src/lib/api/messages.ts`, `src/lib/components/AuthedImage.svelte`, `src/lib/model/album.ts`, `src/lib/model/grid/cascade/response/v3.ts`, `src/lib/model/message.ts`, `src/routes/(protected)/(navbar)/(root)/grid.ts`, and two chat message Svelte components.
   - Untracked: `src/lib/model/grid/cascade/response/v3.test.ts`, `src/lib/utils/authed-image.ts`. [verified: `git status -s`, `git diff --stat`]
2. **Version is 0.1.8 but you are on a v0.1.9 branch.** No version bump has been committed yet. Don't assume the tree == a release. [verified]
3. **Signing keys are load-bearing — see `KEYS.md`.** A build is only a *real* deliverable once signed with the keystore whose cert SHA-256 matches the value in KEYS.md. The apk in `~` is **debug**, unsigned-for-release. Do not invent or rotate keys. [verified: KEYS.md, README.md]
4. **Build is Nix-driven, not raw cargo/gradle.** Per BUILDING.md the supported path is `nix run .#build-android` (output: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`). Don't hand-roll the toolchain. [verified: BUILDING.md]
5. **`grindx-ping.service` is NOT this project.** It is a separate Node active-user tracker at `/home/ubuntu/ping-server/server.js` on `:4242`. Leave it alone unless the task explicitly concerns it. [verified: `systemctl status grindx-ping.service`]

## How to resume

1. Read `memory/MEMORY.md`, then `memory/SESSION_STATE.md`. (R3 — read state before acting.)
2. `git -C /home/ubuntu/grindrx-work status -s && git -C /home/ubuntu/grindrx-work diff --stat` — confirm the dirty set still matches what SESSION_STATE records.
3. Decide WITH operator Tom what the v0.1.9 changes are meant to do before committing/building (R3 hold). Do not push from an agent loop (R11).
4. Build only via the Nix path in `BUILDING.md`; sign only with the keystore in `KEYS.md`.
