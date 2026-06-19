# PROJECT_ROADMAP — grindrx-work

> Operator: **Tom**. Created 2026-06-09 06:57 UTC (bootstrap). Last reconciled 2026-06-18 04:16 UTC.

## What it is

**GrindrX** — an unofficial, privacy-focused, ad-free / tracker-free **Grindr client for Android**. Built with **Tauri 2** (Rust API layer) + **SvelteKit** (frontend embedded into the native binary). It is a **fork of `open-grind`**, maintained by `@Tgbjr2025`. [verified: README.md, package.json `author`]

- Rust layer (`src-tauri/src/api/`) makes Grindr API calls with device-header spoofing and session management (`auth.rs`, `client.rs`, `headers.rs`, `rest.rs`, `ws.rs`). [verified: `ls`]
- Svelte frontend (`src/`) renders grid, chat, map radar, media gallery, etc. [verified: README features list, `ls src/lib`]
- Tauri identifier `org.opengrind`; Cargo crate `open-grind`; product name `GrindrX`. [verified: tauri.conf.json, Cargo.toml]
- This checkout is a **BUILD TREE** — there is no long-running app daemon. The related `grindx-ping.service` (active-user tracker) is a **separate** Node program and not part of this roadmap. [verified: `systemctl`]

## Phases

1. **Fork & feature parity+** — DONE/ongoing. Features beyond upstream (distance radar map, chat media gallery, taps/favorites, inbox search, keyring session storage, authenticated image loading, etc.) are in place; see `CHANGES.md` for the commit-by-commit log. [verified: README, CHANGES.md]
2. **Stabilization → v0.1.8** — DONE. Versions aligned at `0.1.8`; commit `45083f2` (2026-05-26) fixed a WS listener leak. [verified]
3. **v0.1.9 audit fixes — DONE (committed).** The audit branch was finalized and committed as `28b1648` (2026-06-12): schema-drift robustness (cascade `v3.ts`, `messages.ts`), authed-media lightbox fix (`utils/authed-image.ts`), `headers.rs` app-version spoof bump, `ws.rs` self-notify fix, GrindX→GrindrX branding, Android manifest media permissions, eslint config, flake.nix Linux devshell. Version bumped 0.1.8→0.1.9 across all manifests. Rollback tag `audit-v0.1.9-rollback-20260612`. See `memory/FIX_NOTES_v0.1.9.md`. NOT pushed (R11). [verified: `git log`, version probe]
4. **App icon — DONE.** Tom picked concept **A** (monogram G); `d3c0392` regenerated all android/ios/desktop icon assets. [verified: `git log`]
5. **Media compatibility — DONE (committed, partially open on-device).** `eaf60dc` (2026-06-13): CSP now allows CloudFront (`https://*.cloudfront.net`) which made images/albums actually display; conversation/profile schema-drift tolerance; direct signed-URL image loads; album thumb-probe; graceful saved-photo send. Some on-device behaviour still open (saved-photo 400, album-share unlock) — see Known Open Issues in SESSION_STATE. See `memory/FIX_NOTES_media_features.md`. [verified: `git show eaf60dc`, CSP in tauri.conf.json]
6. **New features — DONE (committed).** `1d09c10` (2026-06-13): pull-to-refresh + refresh button (grid), swipe between profiles (profile page), Explore-location (browse a remote location, new `stores/explore-location.svelte.ts`); plus map-tile CSP (OpenStreetMap + Carto basemap hosts in img-src) so map tiles render. [verified: `git show 1d09c10`]
7. **Grid windowing perf — ADDED, verify (HEAD).** `03f88f2` (2026-06-18): viewport windowing (`GridWindow.svelte`) to bound image memory and fix the WebView freeze. Not yet field-verified on-device. [verified: `git show 03f88f2`]
8. **Audit-hardening + bug fixes — IN PROGRESS (UNCOMMITTED, in the dirty tree).** Concurrent audit tasks have produced five uncommitted code changes on `audit/v0.1.9-fixes`: `rest.rs` (FIX 13 — enforce https before attaching the auth header + a redirect-refusing client, closing a session-token leak); `album.ts` (album-share now grants via `/v4/albums/{id}/shares` so the recipient can unlock — the in-flight fix for the album-share open issue); `messages.ts` (dead-import cleanup); `grid-state.svelte.ts` (Explore-location routed through `exploreGeoHash`); `conversation-state.svelte.ts` (WS listener-leak fix + self read-receipt guard). NOT committed, NO rollback tag yet — tag + FIX_NOTES required before any ship (R9/R10). See SESSION_STATE dirty-set + `memory/FIX_NOTES_media_features.md`. [verified: `git diff` @ 2026-06-18 04:16 UTC]
9. **Signed release build — NOT STARTED.** Produce the release apk via `nix run .#build-android` and sign it with the project keystore (cert SHA-256 in `KEYS.md`). The apk currently in `~` is a **debug** build only. [verified: BUILDING.md, KEYS.md]

> **Concurrency note:** as of 2026-06-18 multiple other agents are editing the code (Rust, chat,
> albums, grid) in parallel. Treat the working tree and commit log as moving targets; re-probe
> before acting (R7).

## Success criterion

**A working, signed Android build** — a release APK produced by the documented Nix pipeline whose signing certificate SHA-256 matches the value in `KEYS.md` (`28:05:FD:D8:...:C3:65:8C`), installable on-device. The current debug apk does not satisfy this. [verified: KEYS.md, BUILDING.md]
