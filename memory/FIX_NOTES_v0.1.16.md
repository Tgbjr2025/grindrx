# FIX_NOTES — v0.1.16 (open-issue fixes)

> Ship date: 2026-07-14. Operator: Tom. Base: HEAD of `main` (v0.1.15, `0bab49c`).
> Branch: `claude/grindrx-total-downloads-o1hodl`. Rollback tag: `pre-v0.1.16` (tag the
> base commit before merging/releasing).

## Scope

Fixes for the five open issues on `git.dominusaxis.com/dominus/grindrx`:

| # | Title | Status |
|---|-------|--------|
| 6 | Notifications showing under multiple categories | Fixed |
| 5 | Chat photo selector shows public not private pics | Fixed |
| 3 | Three errors (far profiles / CAS-4001 / filter crash) | 2 of 3 fixed; far-profiles is a paywall (documented) |
| 2 | Crashes constantly opening profiles | Likely subsumed by the #3 filter-crash + prior freeze fixes; no separate repro found |
| 1 | Account creation error toasts | Client-side transport + error handling fixed; server endpoint is WIP/unknown |

## Root causes & fixes

### #6 — notification categorization
`grindx_messages` was created only in `MainActivity.onCreate()`, but notifications are
posted by the Rust WS loop from the sticky foreground service's process, which can be
alive (START_STICKY restart, null intent) without the Activity ever running. Missing
channel → Android fallback → Notification Assistant "suggestions" bucket → conversation
split across categories.
- Fix: `NotificationService.kt` now also registers the IMPORTANCE_HIGH `grindx_messages`
  channel in `onCreate()` (`createMessagesChannel()`), so it always exists at post time.

### #5 — chat picker sourced public photos
`AlbumPicker` "My Photos" tab called `getProfileUploadedPhotos()` → `/v3.1/me/profile/images`
(public profile pics). Private pics live in albums (`/v1/albums`, signed CDN).
- Fix: new **Private** tab flattens `getMyAlbums()` image content; sends via
  `prepareAuthedUrlForSend()` (fetch signed bytes → re-upload to `/v5/chat/media/upload`
  to mint a numeric `mediaId`). Public source retained under a **Profile** tab.

### #3a — CAS-4001 "not valid JSON"
Cascade/explore returns **HTTP 200 with a bare text code** (`CAS-4001`); the prior guard
only caught non-2xx, so the 200 body hit `JSON.parse` → `SyntaxError`.
- Fix: `api/index.ts json()` routes a short/non-JSON **success** body into `ApiHttpError`
  (decodes bare code). `toGridError` already renders an actionable grid message. Removed
  the temp `[GrindrX-API]` logcat probe (root-caused).

### #3b — filter-change crash
`getPreferences()` could reject on a torn read (non-atomic write racing a read, or a
half-written file); the home route `{#await preferences}` had no catch → hard crash until
relaunch. Shared `defaultFilters` (nested arrays) seeded into `$state` and mutated in place
could also corrupt persisted prefs.
- Fix: `getPreferences()` degrades to defaults on any failure; `+page.svelte` gains a
  `{:catch}` backstop; filter components deep-clone `defaultFilters` before seeding state.

### #1 — account creation / password reset toasts
Sign-up/reset posted through the **authed** bridge; a signed-out user has no session, so
`request_raw` failed at the auth guard with "Not logged in" before any network call —
which `fetchRest` turned into a sign-in redirect, and `RegisterForm` then showed a second
"unknown error" toast (double toast + wrong redirect).
- Fix: new unauthenticated `request_public` Tauri command (no Authorization header, same
  path-safety guard). `RegisterForm`/`ForgotPasswordForm` use `fetchRest(..., { public: true })`,
  read the real body (`json()` now throws on non-2xx), and show a single honest message.
- HONESTY (R1): Grindr's first-party create-account endpoint is "dynamic, WIP" in
  `docs/.../account.md` and not publicly documented. This fixes the client transport and
  error UX; it does NOT guarantee server-side account creation works. The user now sees the
  real server response rather than a misleading redirect.

## Not fixed (by design)
- #3, far-away profiles not loading: Grindr gates beyond-free-radius profiles behind a paid
  subscription; the server returns nothing usable for a free account. Not a client defect —
  documented as a known limitation in CHANGES.md and the release notes.

## Verification
- `bun run check` → 0 errors (pre-existing warnings only).
- `bun run lint` → clean.
- `bun run test:unit` → 46/46 pass.
- `cargo test` (Rust) → run on the OVH Nix host (see build log).
- Signed APK built via `nix run .#build-android` with `OPEN_GRIND_KEYSTORE_PROPERTIES`
  (`~/open-grind-key.jks`, alias `grindx`). Output: `com.grindrx.app`, versionName
  `0.1.16`, versionCode `1044` (auto-incremented from v0.1.15's 1043). APK sha256
  `25bfda2328c675ce72c05720d793c1ae24fe4690158b51ae4ef77bf8b0680e7d`.

### KEYS.md discrepancy (R1/R2 — flagged)
The signing cert SHA-256 is **`22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01`**,
which does NOT match the `2805fdd8…c3658c` documented in `KEYS.md`. That `2805fd…`
fingerprint is UPSTREAM Open Grind's governance-held key, which this fork does not
possess. **Verified**: the published v0.1.15 APK (downloaded from the Gitea release)
carries the SAME `22d6…` cert and the same `com.grindrx.app` package — so `22d6…` is the
de-facto GrindrX release key used since at least v0.1.15, and using it is REQUIRED for
v0.1.16 to install as an in-place upgrade. Matching KEYS.md's `2805fd…` would break
upgrades (and is impossible without the upstream key). KEYS.md is upstream product doc
(R23, not edited); this note records the real state. If a canonical GrindrX KEYS doc is
ever wanted, it should record `22d6…`.

## Releases published (v0.1.16)
- Gitea: https://git.dominusaxis.com/dominus/grindrx/releases/tag/v0.1.16 (release id 19)
- GitHub: https://github.com/Tgbjr2025/grindrx/releases/tag/v0.1.16 (release id 353510605)
- Both carry the identical `GrindrX-v0.1.16.apk` (69,226,028 bytes, sha256 `25bfda23…680e7d`).
- Tag `v0.1.16` → commit `062a6508c25a4f901941a3add550bec345fd09c1` on both remotes.

## Rollback
- Rollback tag `pre-v0.1.16` = `0bab49c` (v0.1.15 merge, the base of this work). To roll
  back: re-publish the v0.1.15 APK as latest and revert/close the v0.1.16 branch + releases.
