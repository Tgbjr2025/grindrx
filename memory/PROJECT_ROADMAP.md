# PROJECT_ROADMAP — grindrx-work

> Operator: **Tom**. Created 2026-06-09 06:57 UTC (bootstrap). Last reconciled **2026-10-11**.
> Canonical source: `axis:/srv/projects/grindrx-work`. Build host: the **M1 Mac**. See `PROJECT.md`.

## What it is

**GrindrX** — an unofficial, privacy-focused, ad-free / tracker-free **Grindr client for Android**. Built with **Tauri 2** (Rust API layer) + **SvelteKit** (frontend embedded into the native binary). It is a **fork of `open-grind`**, maintained by `@Tgbjr2025`. [verified: README.md, package.json `author`]

- Rust layer (`src-tauri/src/api/`) makes Grindr API calls with device-header spoofing and session management (`auth.rs`, `client.rs`, `headers.rs`, `rest.rs`, `ws.rs`). [verified: `ls`]
- Svelte frontend (`src/`) renders grid, chat, map radar, media gallery, etc. [verified: README features list, `ls src/lib`]
- Tauri identifier `com.grindrx.app`; product name `GrindrX`. **The bundle id was changed from upstream's `org.opengrind` to `com.grindrx.app`** — an older note in this file saying otherwise is stale. [verified: `src-tauri/tauri.conf.json`]
- **An iOS port now exists** (`scripts/build-ios.sh`, unsigned `.ipa` for AltStore/SideStore). It builds, installs and launches on the simulator. **Keyring has never worked on iOS** — read `memory/FIX_NOTES_ios_port_v0.1.48.md` before assuming sign-in functions there. [verified: that file; iOS `bundleVersion` is now 1085]
- This checkout is a **BUILD TREE** — there is no long-running app daemon in it. The related `grindx-ping` service (active-user tracker + the FCM token registry at `POST /grindrx/register`) is a **separate** Node program on `axis`, not part of this roadmap. [verified: `axis:/home/axis/ping-server/`]

## Phases

1. **Fork & feature parity+** — DONE/ongoing. Features beyond upstream (distance radar map, chat media gallery, taps/favorites, inbox search, keyring session storage, authenticated image loading, etc.) are in place; see `CHANGES.md` for the commit-by-commit log. [verified: README, CHANGES.md]
2. **Stabilization → v0.1.8** — DONE. Versions aligned at `0.1.8`; commit `45083f2` (2026-05-26) fixed a WS listener leak. [verified]
3. **v0.1.9 audit fixes — DONE (committed).** The audit branch was finalized and committed as `28b1648` (2026-06-12): schema-drift robustness (cascade `v3.ts`, `messages.ts`), authed-media lightbox fix (`utils/authed-image.ts`), `headers.rs` app-version spoof bump, `ws.rs` self-notify fix, GrindX→GrindrX branding, Android manifest media permissions, eslint config, flake.nix Linux devshell. Version bumped 0.1.8→0.1.9 across all manifests. Rollback tag `audit-v0.1.9-rollback-20260612`. See `memory/FIX_NOTES_v0.1.9.md`. [verified: `git log`, version probe]
4. **App icon — DONE.** Tom picked concept **A** (monogram G); `d3c0392` regenerated all android/ios/desktop icon assets. [verified: `git log`]
5. **Media compatibility — DONE (committed, partially open on-device).** `eaf60dc` (2026-06-13): CSP now allows CloudFront (`https://*.cloudfront.net`) which made images/albums actually display; conversation/profile schema-drift tolerance; direct signed-URL image loads; album thumb-probe; graceful saved-photo send. Some on-device behaviour still open (saved-photo 400, album-share unlock) — see Known Open Issues in SESSION_STATE. See `memory/FIX_NOTES_media_features.md`. [verified: `git show eaf60dc`, CSP in tauri.conf.json]
6. **New features — DONE (committed).** `1d09c10` (2026-06-13): pull-to-refresh + refresh button (grid), swipe between profiles (profile page), Explore-location (browse a remote location, new `stores/explore-location.svelte.ts`); plus map-tile CSP (OpenStreetMap + Carto basemap hosts in img-src) so map tiles render. [verified: `git show 1d09c10`]
7. **Grid windowing perf — DONE (committed).** `03f88f2` (2026-06-18): viewport windowing (`GridWindow.svelte`) to bound image memory. Field-verify on-device still advised. [verified: `git show 03f88f2`]
8. **Audit-hardening + bug fixes — DONE (committed).** The formerly-uncommitted audit fixes landed in `17d47f3` (2026-06-18): `rest.rs` FIX 13 (enforce https before attaching the auth header + redirect-refusing client, closing a session-token leak), `album.ts` album-share grant via `/v4/albums/{id}/shares` (recipient can unlock), chat live-update + dup-message race, Explore geohash plumbing. `a6fed16` then fixed the saved-photo 400 (mediaId from `/v4/me/profile`), added metric/imperial units, and removed the Map/nearby bottom tab. See `memory/FIX_NOTES_media_features.md` §4. [verified: `git show 17d47f3 a6fed16`]
9. **v0.1.12 / v0.1.13 releases — DONE.** `bccb55d` (v0.1.12, 2026-06-19): compositor-freeze fix (single masked blur layer), off-main-thread image decode + upload downscale, real mediaId via `/v5/chat/media/upload`, background notifications (foreground service + deep-link), inbox newest-first sort, masked views/previews, tolerant taps schema. `715a248` ported unsend-messages (#89). `b5d182e` (v0.1.13): lightbox-open freeze fix. `3e1d412` + `b112cb3`: surface server error codes (`ApiHttpError`, CAS-4001) + a temp `[GrindrX-API]` logcat diagnostic. [verified: `git show`, version probe]
10. **CAS-4001 root-cause — RESOLVED, differently than the phase assumed.** The explore/cascade endpoint could return a bare text error code (e.g. `CAS-4001`) instead of JSON; `3e1d412` surfaced it. The actual reason the cascade was failing turned out to be **an 8-character geohash sent where the endpoint requires 12** → HTTP 400 `urn:gr:err:geo_hash_decode`, introduced by `5cda11f`. Fixed in `0c223af`. **`/v3/cascade` now answers with data.** The `ApiHttpError` reader was also corrected to read `type`/`title`, because this API's error envelope has **no `code` and no `message` field**. [verified: `src-tauri/src/api/rest.rs` release logging; the captured 400 body recorded in `README_HANDOFF.md` §1]
11. **Signed release build — DONE.** The release APK is produced by `bun run tauri android build --apk` on the **M1** (JDK 17, NDK 27.0.12077973) and signed with the project keystore; `apksigner verify --print-certs` reports cert SHA-256 `22d6889e…4c01`, matching `KEYS.md`. Latest: **0.1.50 / 1085, 71,440,981 bytes, sha256 `7847eafc77e2ceb8e1ec0f8ba38bf42eee9d8beef7b5ab5d78e3117ff80d358d`**. [verified 2026-10-11 on the artifact at `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`]
    - ⚠ **`KEYS.md` used to publish the UPSTREAM governance certificate (`28:05:FD:D8:…:C3:65:8C`), which no GrindrX APK has ever been signed with.** It has since been corrected to the fork's own cert — verify against `22d6889e…4c01`, not the old value.
    - ⚠ **`autoIncrementVersionCode` MUST stay `false`.** Re-enabling it caused the historical **1067→1086 regression**. [verified: `tauri.conf.json`; `memory/FIX_NOTES_v0.1.33.md`]
    - ⚠ **The build only works with the npm Tauri CLI pinned to EXACTLY 2.12.1.** Gradle invokes the *cargo-installed* `tauri-cli` (`BuildTask.kt:27` hardcodes `executable = "cargo"`), so a version split means `cli-options-server.json` is never written and the build dies blaming Android Studio. See `memory/FIX_NOTES_android_build_toolchain.md`. [verified: `package.json` pins `"@tauri-apps/cli": "2.12.1"`, no caret]
12. **Release distribution — PARTIAL.** Both forges are authoritative and the app polls **both** release sources, taking the higher tag. **What does not yet work is the last mile to users:** releases must still be published to each forge by hand, and there is **no scheduled push** — `axis:/home/axis/push-sender/push.sh` exists and is proven end-to-end against the FCM service account, but it has never run for a real release, and the device registry it reads (`devices.jsonl`) is **empty**. [verified: `src-tauri/src/api/rest.rs:872-874`; `axis:/home/axis/push-sender/`; `devices.jsonl` = 0 lines]

> **Re-probe note:** this project has had multiple agents editing in parallel; treat the working tree
> and commit log as moving targets; re-probe before acting (R7).

## Success criterion

**A working, signed Android build, verified running on real hardware.** The first half is met and
measured: a signed APK whose certificate SHA-256 matches `KEYS.md`
(`22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01`), built at versionCode 1085
strictly monotonic over the last release. **The second half is not currently met:** the S26 Ultra is
unreachable, so **no release since 0.1.48 has been confirmed running on a device**, and this project
has a documented history of shipping a green build whose most-used screen was dead. [verified:
`apksigner`, `output-metadata.json`; S26 unreachable as of 2026-10-11]
