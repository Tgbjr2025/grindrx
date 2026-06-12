# PROJECT_ROADMAP — grindrx-work

> Operator: **Tom**. Created 2026-06-09 06:57 UTC (bootstrap).

## What it is

**GrindrX** — an unofficial, privacy-focused, ad-free / tracker-free **Grindr client for Android**. Built with **Tauri 2** (Rust API layer) + **SvelteKit** (frontend embedded into the native binary). It is a **fork of `open-grind`**, maintained by `@Tgbjr2025`. [verified: README.md, package.json `author`]

- Rust layer (`src-tauri/src/api/`) makes Grindr API calls with device-header spoofing and session management (`auth.rs`, `client.rs`, `headers.rs`, `rest.rs`, `ws.rs`). [verified: `ls`]
- Svelte frontend (`src/`) renders grid, chat, map radar, media gallery, etc. [verified: README features list, `ls src/lib`]
- Tauri identifier `org.opengrind`; Cargo crate `open-grind`; product name `GrindrX`. [verified: tauri.conf.json, Cargo.toml]
- This checkout is a **BUILD TREE** — there is no long-running app daemon. The related `grindx-ping.service` (active-user tracker) is a **separate** Node program and not part of this roadmap. [verified: `systemctl`]

## Phases

1. **Fork & feature parity+** — DONE/ongoing. Features beyond upstream (distance radar map, chat media gallery, taps/favorites, inbox search, keyring session storage, authenticated image loading, etc.) are in place; see `CHANGES.md` for the commit-by-commit log. [verified: README, CHANGES.md]
2. **Stabilization → v0.1.8** — DONE. Versions aligned at `0.1.8` across all manifests; last commit `45083f2` (2026-05-26) fixed a WS listener leak. [verified]
3. **v0.1.9 audit fixes — IN PROGRESS (current).** Branch `audit/v0.1.9-fixes` carries uncommitted work across Rust (`headers.rs`), Svelte messaging/image/album/grid models, and the Android manifest/gradle, plus a new cascade-response test and an authed-image util. Intent of these changes is **not yet confirmed with Tom** — R3 hold. Not yet committed; no version bump. [verified: `git status -s`, `git diff --stat`]
4. **Signed release build** — NOT STARTED. Produce the release apk via `nix run .#build-android` and sign it with the project keystore (cert SHA-256 in `KEYS.md`). The apk currently in `~` is a **debug** build only. [verified: BUILDING.md, KEYS.md, `ls ~`]

## Success criterion

**A working, signed Android build** — a release APK produced by the documented Nix pipeline whose signing certificate SHA-256 matches the value in `KEYS.md` (`28:05:FD:D8:...:C3:65:8C`), installable on-device. The current debug apk does not satisfy this. [verified: KEYS.md, BUILDING.md]
