# FIX_NOTES — v0.1.27 (settings fixes + notification settings + phrase autocomplete)

**Date:** 2026-08-30 · **Base:** `773c376` (v0.1.26) · **Rollback tag:** `pre-v0.1.27` = `773c376`
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk` · **Operator:** Tom

Rapid on-device feedback batch. Verified: vitest 156, svelte-check 0 errors, eslint clean.
Version 0.1.26→0.1.27, versionCode base 1055→1060 (autoIncrement at build).

## Bug fixes — Blocked / Hidden / Favorites "failed to load"
Root cause: all three used reverse-engineered endpoints/shapes from `docs/api-discoveries.md`
that never matched Grindr's live API (the same class of error block.ts already fixed for
block/unblock). Corrected against `docs/content/grindr-api/`:
- **Blocked** (`account/blocked/+page.svelte`): `GET /v1/blocks {profiles}` →
  `GET /v3.1/me/blocks` returning `{ blocking: [{ profileId, blockedTime }] }` (ids only) → resolve
  names/avatars via `getProfiles` (POST /v3/profiles), tolerant of a failed/partial lookup.
- **Hidden** (`account/hidden/+page.svelte`): response shape `{profiles:[{…profileImageMediaHash}]}`
  → documented `{ hides: [{ profileId, displayName, mediaHash }] }`; tolerant per-item parse.
- **Favorites** (`account/favorites/+page.svelte`): `GET /v1/favorites` doesn't exist. Grindr lists
  favorites via the cascade grid with `favorites=true` → `getCascadeV3({ nearbyGeoHash, favorites:true })`,
  full items give name+photo, partial items resolved via `getProfiles`. Added a "location needed"
  empty state (cascade needs a geohash). Unfavorite endpoint `/v1/favorites/{id}` →
  `/v3/me/favorites/{id}` (documented).

## Notification settings — NEW (local, enforced in Rust)
Grindr has NO server-side notification toggle (confirmed across docs). So these are local device
prefs, enforced natively:
- Prefs: `preferences.svelte.ts` gains `notifyMessages` + `notifyTaps` (default true).
- Rust: `AppState` gains `notify_messages`/`notify_taps` `AtomicBool` (`state.rs`); new
  `set_notification_prefs(messages, taps)` command (`lib.rs`); `ws.rs` `maybe_notify_message` /
  `maybe_notify_tap` early-return when their flag is off. Mirrors the existing `is_foreground` atomic.
- Frontend pushes the values to Rust via `$lib/api/notifications.ts` `syncNotificationPrefs()` —
  on launch (root `+layout.svelte`) and on every toggle change.
- UI: new subpage `settings/(subpage)/app/notifications/` (+ `NotifyMessagesSetting` /
  `NotifyTapsSetting`), registered in `SettingsNavBar`, and the app-settings "Notifications" item
  changed from a "coming soon" dialog to a link (dialog machinery removed).

## Saved-phrase autocomplete — NEW
`MessageComposer.svelte`: a `$derived` filters saved phrases containing the typed text (startsWith
ranked first, exact excluded, top 4) and renders a tap-to-complete popup above the composer.

## Stats page live update
`settings/(subpage)/stats/+page.svelte`: extracted `load()`, added a 30s `setInterval` poll
(cleared on unmount) + a manual Refresh button.

## Branding
`settings/(me)/+page.svelte`: the composite version label now `.replace(/OpenGrind/gi,"GrindrX")`.

## NOT fixed (honest) — "unlock all profile viewers"
The "who viewed you" page (`views/+page.svelte`) already surfaces every viewer it can. Grindr's
`/v7/views/list` returns unlocked `profiles` + masked `previews`; for a free account the server
WITHHOLDS the profileId of locked viewers (XTRA gate), so the client cannot unlock them — same
server-side gate as CAS-4001. The page already links every preview that DOES carry an id. No
client-side fix is possible without faking a paid feature.
