# FIX_NOTES — v0.1.25 (features batch)

**Date:** 2026-08-30 · **Base:** `7222650` (v0.1.24) · **Rollback tag:** `pre-v0.1.25` = `7222650`
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk` · **Operator:** Tom

Feature batch requested by Tom: saved phrases in messages, share more than one album at once,
"any other fixes", video chat, other unimplemented features, and an update notification that
carries the new version number + what changed. Implemented the well-scoped, testable features;
gave an honest no-go on video calling (needs infrastructure); deferred voice-message *sending*
and a notification-settings subpage.

## Verification (all green before ship)
- `bun run test` (vitest): **149 pass** across 19 files (was 112/14). +37 new tests.
- `bun run check` (svelte-check): **0 errors** (30 pre-existing warnings, none added).
- `eslint` on all changed files: clean.
- Rust: the only Rust change is the `fetch_latest_release` URL + headers (see below). `cargo`
  not re-run in this session (no cargo on PATH; Nix devshell only) — change is a const string +
  two header lines, no logic change.
- Version 0.1.24→0.1.25, androidVersionCode 1053→1054 (package.json, Cargo.toml, Cargo.lock,
  tauri.conf.json). Backups `*.bak.pre_v0.1.25.*` beside each version file.

## 1. Saved phrases (quick replies) — NEW
- Store: `src/lib/stores/saved-phrases.svelte.ts` (localStorage `grindrx-saved-phrases`, zod,
  reactive rune — mirrors `explore-location.svelte.ts`). Seeds a few defaults on first run only;
  an intentionally-empty list is never re-seeded. Tolerant read (corrupt → empty, no crash).
- UI: `SavedPhrasesDrawer.svelte` (new) opened from a chat-bubble button added to
  `MessageComposer.svelte`. Tap a phrase → inserted into the composer (`insertPhrase`, appends
  with a separating space if text already typed); add/delete phrases inline in the drawer.
- Tests: `saved-phrases.svelte.test.ts` (10) — seed-once, restore, empty-not-reseeded, add/trim,
  update, remove, tolerant reads.

## 2. Multi-album share — NEW
- `AlbumPicker.svelte`: single `selectedAlbumId` → `selectedAlbumIds: number[]` with a
  `toggleAlbum`, a check indicator per row, and a "Share N albums" button. Default selection is
  now none (was auto-first).
- Orchestration: pure `src/lib/utils/share-albums.ts` (`shareAlbumsSequential` +
  `shareAlbumsErrorMessage`) — sequential per-album share, collects failures, partial-success
  message. `ConversationState.sendAlbum` → `sendAlbums(albumIds, expirationType)` (extracted
  `#sendOneAlbum`; each album gets its own optimistic message). The API `shareAlbum` is unchanged
  (endpoint is per-album path `/v4/albums/{id}/shares`; N albums = N calls).
- Wiring: `MessageComposer` `onSendAlbum` + `+page.svelte` updated to arrays.
- Tests: `share-albums.test.ts` (7) — shares each once/in order, continues past a failure
  (partial success), records last error, empty no-op, error-message singular/plural.

## 3. Update notification: fix + changelog — FIX + FEATURE
- **Bug fixed:** `fetch_latest_release` (`src-tauri/src/api/rest.rs`) fetched
  `git.dominusaxis.com/.../dominus/open-grind/releases/latest` — the UPSTREAM repo — so the
  banner could never surface GrindrX releases. Now `https://api.github.com/repos/Tgbjr2025/
  grindrx/releases/latest` (public repo, reliable, returns `body`) with the `User-Agent` header
  GitHub's API requires. Update check still goes through Rust (no WebView CORS).
- **Feature:** `UpdateBanner.svelte` now parses `release.body` and shows a "What's new" panel
  (release notes) plus the new version and the version you're on. Version compare extracted to
  `src/lib/utils/version.ts` (`parseSemver`/`isNewer`) — now tolerates pre-release/build
  suffixes (`v0.1.25-rc1`) which the old inline compare did not.
- Tests: `version.test.ts` (10) — parse (v-prefix, suffixes, defaults), newer major/minor/patch,
  equal/older false, v-tag vs bare version.
- **Release side:** the v0.1.25 release body on the feed is the CHANGES.md v0.1.25 section (that
  is the "what's new" text users see). Publish releases to GitHub `Tgbjr2025/grindrx` (the feed
  the app checks) AND Forgejo `dominus/grindrx`.

## 4. PIN app-lock — NEW (replaces the "coming soon" stub)
- Pure crypto: `src/lib/utils/pin.ts` — `generateSalt`, `hashPin` (SHA-256 of `salt:pin` via
  Web Crypto), `constantTimeEqual`, `isValidPin` (4–8 digits).
- Store: `src/lib/app-data/app-lock.svelte.ts` — enable/verify/unlock/disable/lockNow; stores
  only salt + hash in localStorage (`grindrx-pinlock-*`). App starts locked when a PIN is set.
- UI: `PinLockGate.svelte` mounted in `(protected)/+layout.svelte` (full-screen overlay, z-100,
  above the update banner) — blocks the authenticated app until the PIN is entered.
- Settings: `PinLockSetting.svelte` under Settings → App → Security (set/change/turn off);
  the old "PIN — coming soon" AlertDialog item was removed.
- Tests: `pin.test.ts` (8) + `app-lock.svelte.test.ts` (6) — hash determinism/salting, valid-PIN
  rule, constant-time compare; enable persists a hash-not-PIN, verify accept/reject, locked-on-
  reload + unlock, disable clears, lockNow.

## 5. Video calling — NOT shipped (honest no-go)
- No WebRTC/signaling/TURN/STUN, no camera/mic permission, CSP blocks it; Grindr's servers don't
  broker third-party WebRTC. A real build needs a signaling server + TURN relay + a WebRTC client
  + native permissions — its own project. Documented in `memory/VIDEO_CALL_FEASIBILITY.md`. Did
  NOT ship a non-functional call button (same principle as CAS-4001: don't fake a server feature).

## DEFERRED (documented, NOT in this batch)
- **Voice-message SENDING** — receiving works (`AudioMessage`); sending needs `getUserMedia` +
  Android `RECORD_AUDIO` permission + an audio-typed upload path + on-device testing. The mic
  button remains the `ToastUnimplemented` stub (#35). Not shipped blind without a device.
- **Notification-settings subpage** — lower value; the "Notifications" app-settings item is still
  the coming-soon dialog.
- **Auth-endpoint divergence** — carried over from v0.1.24 (needs LIVE Grindr verification).
