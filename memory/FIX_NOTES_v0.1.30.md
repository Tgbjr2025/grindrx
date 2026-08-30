# FIX_NOTES — v0.1.30 (favorite fix + onboarding: tour & What's-New)

**Date:** 2026-08-30 · **Base:** `c5f28ac` (v0.1.29) · **Rollback tag:** `pre-v0.1.30` = `c5f28ac`
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk` · **Operator:** Tom

Tom reported: favoriting fails; can't find album-add / notes auto-fill; wants the app to introduce
its features on first run / after an update (a usage tour + a tour of the features independent of
Grindr). Frontend-only. Verified: vitest 191 (was 189), svelte-check 0 errors, eslint clean.
Version 0.1.29→0.1.30, versionCode base 1070→1075.

## FIX — favoriting silently failed
`profile/[profileId]/+page.svelte` `toggleFavorite` posted to `/v1/favorites/{id}` (reverse-
engineered, wrong) → "failed to update favorite". Changed to the documented `POST/DELETE
/v3/me/favorites/{id}` (matching the settings unfavorite fixed in v0.1.27). This was ALSO why the
user couldn't reach favorite notes / auto-fill: no favorite could be created. (The "can't find album
add" + "don't see auto-fill" were discoverability — addressed by the tour below; album management is
Settings → Account → My Albums, auto-fill is the Notes button on a favorite.)

## NEW — onboarding (first-run tour + What's-New)
- `src/lib/stores/onboarding.svelte.ts` (+ test): localStorage `grindrx-last-seen-version` +
  `grindrx-tour-done`. `isFirstRun()`, `isNewVersion(v)`, `markVersionSeen(v)`, `isTourDone()`,
  `markTourDone()`.
- `src/lib/data/whats-new.ts`: per-version highlight lists (`highlightsFor(version)`), keep newest
  in sync with CHANGES.
- `FeatureTour.svelte`: a Drawer carousel (9 slides — welcome, getting around, saved phrases, voice
  messages, albums, favorite notes/auto-fill, PIN lock, notifications, "and more"). Back/Skip/Next,
  dot indicator, `markTourDone` on finish. Covers both the "usage" ask (getting-around slide) and the
  "independent features" ask.
- `WhatsNewDialog.svelte`: AlertDialog listing the current version's highlights, with a "Tour all
  features" button.
- Wired in `(protected)/+layout.svelte` onMount: first run → tour (+ markVersionSeen so What's-New
  doesn't double-fire); else if the version changed → What's-New. Reads the app version via
  `getVersion()` (tauri); no-ops on web/no-tauri.
- Re-openable: Settings landing gains a "GrindrX → Take the feature tour" item (own FeatureTour
  instance).

## Notes
- Onboarding is per-install/per-device (localStorage), shown once per version. Clearing app data
  re-triggers it.
- Carried-over unverified caveats (v0.1.28): voice playback format, album add-photo/remove-viewer
  endpoints. Deferred: biometric unlock.
