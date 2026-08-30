# FIX_NOTES — v0.1.28 (voice, search, albums, favorites notes, photo-reply, atomic writes)

**Date:** 2026-08-30 · **Base:** `00ae334` (v0.1.27) · **Rollback tag:** `pre-v0.1.28` = `00ae334`
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk` · **Operator:** Tom

Tom: "incorporate, code, build, and compile all the features you listed … use sub agents." Built as
one batch with 4 file-disjoint general-purpose subagents (favorites-notes, search, album-management,
ProfilePhotoReply+atomic-writes) + the cross-cutting work (voice, nav, capabilities, README) done
directly. Verified: **vitest 177** (was 156), **svelte-check 0 errors**, eslint clean except one
pre-existing cva false-positive (`NavBar.svelte:37 tabsListVariants`, untouched line; svelte-check
resolves it). Version 0.1.27→0.1.28, versionCode base 1060→1065.

## Voice-message sending — NEW (own work)
- Record via `getUserMedia`+`MediaRecorder` in `MessageComposer.svelte` (mic button replaces the
  old ToastUnimplemented stub; recording overlay with timer + cancel/send; 5-min cap).
- Upload reuses the existing `upload_image` Rust command (it uploads raw bytes with any Content-Type —
  no new Rust command needed). New `src/lib/api/audio.ts` (`pickAudioMimeType`, `uploadAudioBlob`).
- `ConversationState.sendAudio` builds an optimistic "Audio" message + sends via `sendMessage`
  (`{type:"Audio", body:{mediaId,mediaHash,url,contentType,length,expiresAt}}`). Wired through
  `+page.svelte` `onSendAudio`.
- Android `RECORD_AUDIO` permission added to `AndroidManifest.xml`.
- **CAVEAT (needs device):** the WebView records webm/opus or mp4 depending on support; Grindr's
  players expect aac. Format compatibility is unverified on a live device — `pickAudioMimeType`
  prefers mp4/aac. Also getUserMedia needs the Android WebView mic-permission bridge to grant.

## Profile/tag search — NEW (subagent)
- New route `src/routes/(protected)/(navbar)/search/+page.svelte` using the pre-existing (unused)
  `searchProfiles` (`GET /v7/search`), query field → `profileTags`, requires `preferences.geohash`
  ("location needed" empty state otherwise). Results link to `/profile/{id}`.
- Added a **Search tab** (MagnifyingGlass) to `NavBar.svelte` (my nav wiring).

## Album management — NEW (subagent)
- `album.ts` gained (documented endpoints): `createAlbum` (POST /v2/albums), `renameAlbum`
  (PUT /v2/albums/{id}), `deleteAlbum` (DELETE /v1/albums/{id}), `addAlbumContent`
  (POST /v1/albums/{id}/content), `removeAlbumContent`, `getAlbumViewers` (GET .../shares),
  `removeAlbumViewer` (PUT .../unshares). + pure helpers unit-tested (`album.test.ts`, 20 cases).
- New route `settings/(subpage)/albums/+page.svelte` + `ViewersDrawer.svelte`. Linked as "My Albums"
  in account settings + title in `SettingsNavBar` (my nav wiring).
- **CAVEATS (subagent-flagged, need live verification):** add-photo posts a JSON `{mediaId,mediaHash}`
  reference (the doc only specifies multipart, which `fetchRest`'s JSON bridge can't send); remove-
  viewer uses `PUT /v1/albums/{id}/unshares {profiles:[{profileId,shareId:0}]}` (doc's
  `/shares/remove` is marked WIP/403). Both best-effort against the documented shapes.
- Fixed a subagent bug: both album files named a reactive var `state`, colliding with the `$state`
  rune (16 svelte-check errors) → renamed to `albumsState`/`viewersState`.

## Favorites notes — NEW (subagent)
- `src/lib/api/favorites-notes.ts` (`getFavoriteNote`/`setFavoriteNote`/`deleteFavoriteNote` +
  tolerant `parseNote`, tested) against documented `/v1/favorites/notes[/{id}]`. `FavoriteNotesDialog`
  + a "Notes" button per row on the Favorites page.

## ProfilePhotoReply rendering + atomic writes — (subagent)
- `ProfilePhotoReplyMessage.svelte` (thumbnail of the replied-to photo + reply text, mirrors
  AlbumReactionMessage) wired into `Message.svelte` (was falling through to "Unsupported").
- `app-data/index.ts` `writeAppDataFile` now atomic: write `${path}.tmp` then `rename` over the real
  path (`@tauri-apps/plugin-fs` `rename`). **Capability added** (`capabilities/default.json`):
  `fs:allow-rename` + widened read/write/exists scope to `preferences.data` + `preferences.data.tmp`
  (the previous scope only allowed `preferences.json`).

## README — brought current (own work)
Fixed download links to the grindrx repos, replaced the WRONG upstream signing fingerprint with the
real `22:D6:88:9E…4C:01`, updated clone/build to grindrx + `nix run .#build-android`, and rewrote the
feature list to reflect v0.1.24–0.1.28.

## DEFERRED
- **Biometric unlock** for the PIN — scoped out to protect this build (adds a native Tauri plugin
  that needs its own build validation). Planned next.
- **ProfileLink / NonExpiringVideo / VideoCall** display components — need a live payload capture first.
- **Voice SEND format** + the two album endpoints above — need on-device/live verification.
