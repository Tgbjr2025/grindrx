# Contributions by @Tgbjr2025

This document summarises all bug fixes, features, schema corrections, and tests
added in this branch on top of upstream `open-grind/open-grind` main.

---

## v0.1.9 — audit pass (2026-06-12)

Robustness, security-hygiene, and DX fixes from a full line-by-line audit. No
behavioural changes to the happy path; everything here makes the client tolerate
Grindr server-side drift and fixes media rendering.

**Schema robustness (stop one bad record blanking the screen)**
- `grid/cascade/response/v3.ts`: parse each cascade item independently; an
  unrecognised item `type` or a single malformed profile is dropped + logged
  instead of throwing the whole response and blanking the grid. Cosmetic
  profile fields made optional/tolerant; top-level `nextPage`/`shuffled` tolerated.
- `api/messages.ts`: parse each conversation message individually, degrading an
  unparseable one to an `Unknown` message instead of failing the whole chat load.
- `model/album.ts`, `model/message.ts`: allow `null` cover/thumb/url while media
  is still processing or was rejected.
- Added `v3.test.ts` covering the tolerant cascade parsing.

**Authenticated media — fix black-box photos & albums**
- New `utils/authed-image.ts` (`resolveAuthedImage`): resolve an authed
  `cdns.grindr.com` URL to a `data:` URL via the Rust `fetch_authed_bytes` command.
- `ImageMessage.svelte`: pre-resolve the image to a `data:` URL for BOTH the inline
  thumbnail and the PhotoSwipe lightbox (the lightbox opened the raw URL with no
  auth header -> 403 -> black box).
- `AlbumMessage.svelte`: resolve every album slide (photo and video) to a `data:`
  URL for the lightbox and dimension-probing; cover uses `AuthedImage` fallback.
- `AuthedImage.svelte`: refactored onto the shared `resolveAuthedImage` helper.

**Rust / backend**
- `headers.rs`: bump the spoofed Grindr app version `26.7.0.159416` -> `26.9.1.163471`
  to keep the client accepted by current API.
- `ws.rs`: `maybe_notify` now compares `senderId` whether it arrives as a JSON
  string OR number, so your own sent messages never trigger a self-notification.

**Branding / DX**
- `GrindX` -> `GrindrX` in the notification title, channel description, and log
  tags (the internal channel id `grindx_messages` is left unchanged — it is shared
  with `MainActivity.kt` and is not user-visible).
- `eslint.config.js`: global ignores for `build/`, `.svelte-kit/`, `dist/`,
  `src-tauri/`; added a `lint` script. Lint no longer scans generated output.
- `flake.nix`: Linux desktop libs (glib/gtk3/webkit2gtk/...) added to the dev
  shell so `bun run test` (incl. `cargo test`) runs on a headless Linux host.
  Gated to Linux; the Android cross-build is unaffected.
- Version bumped `0.1.8` -> `0.1.9` across `package.json`, `tauri.conf.json`,
  `Cargo.toml`.

---

## Commits (newest first)

| SHA | Description |
|-----|-------------|
| `c7ac231` | Implement Views, Right Now, and Interest tabs with live data |
| `fd29c8c` | Revert gradle.properties to upstream values |
| `233e4de` | Fix faceOnly filter bug, albumName schema, profile error state, and add test suite |
| `166c8fa` | Fix nullable conversation preview crashing inbox load |
| `149e52f` | Add Views tab to navbar and fix inbox infinite loading skeleton |
| `b43397f` | Show in-app toast banners for new messages from other conversations |
| `59c62c6` | Auto-refresh geolocation on grid load and add profile editing |
| `7baf509` | Add polling fallback and manual refresh when WebSocket disconnects |
| `34269b4` | Add favorite/unfavorite toggle button to profile page |
| `a8a3854` | Implement Views tab showing who viewed your profile |
| `ebd0f0d` | Implement features, fix stubs, and modernize UI |
| `9f6c85f` | Add album sharing to chat composer |
| `1d52dde` | Re-enable @typescript-eslint/no-unsafe-* rules globally |
| `4844f02` | Fix race conditions, bounds check, memory leak, and cache over-clearing |
| `8bf381c` | Replace Rust panics with graceful error handling |
| `85c9fa9` | Fix build crash, document insecure JWT decode, surface ws.send errors |
| `42cbe7e` | Replace randomized languages in headers with en_US |
| `82f420e` | Improve reconnection data fetching |
| `fcb7556` | Increase size of foreground icon |
| `78cc99d` | Refetch data from server on websocket reconnection/foreground wake |
| `096eb61` | Fix stale messages cache |

---

## Bug Fixes

### Inbox crashes on load — nullable conversation preview
**File:** `src/lib/model/conversation.ts`

The `preview` field was typed as a required object (`z.object({...})`). The Grindr
API returns `null` for preview on some conversations (e.g. deleted messages,
album-only previews). This caused a Zod parse error that silently rejected every
conversation with a null preview, making the entire inbox list fail to render.

**Fix:** Added `.nullable()` to the preview schema. Added a null guard in
`Conversation.svelte` so the template renders "No messages yet" when preview is null.

---

### faceOnly filter always sends false
**File:** `src/routes/(protected)/(navbar)/(root)/grid-state.svelte.ts`

The "Has Face Pics" filter never worked. The condition checked for
`"has-profile-pic"` — a string that does not exist as a filter value. The actual
toggle value emitted by `PhotosFilter.svelte` is `"has-face-pics"`. Because the
string never matched, `faceOnly` was never included in the API query.

**Fix:** Changed the condition to check `"has-face-pics"` and hardcoded
`faceOnly: true` (the value was always true when the option was selected anyway).

---

### albumMinSchema rejects albums with a real name
**File:** `src/lib/model/album.ts`

`albumMinSchema.albumName` was typed as `z.null()` — meaning it only accepted
`null` and would reject any album that actually had a name string. The Grindr API
returns the album name as a string when the user has named their album.

**Fix:** Changed to `z.string().nullable()`.

---

### Profile page stuck on infinite skeleton on network failure
**File:** `src/routes/(protected)/(navbar)/profile/[profileId]/+page.svelte`

The `{#await profile}` block had no `{:catch}` handler. If the network request
failed, the page silently stayed on the loading skeleton indefinitely.

**Fix:** Added a `{:catch}` block showing a "Couldn't Load Profile" error state.

---

### Build crash in svelte.config.js
**File:** `svelte.config.js`

`APP_VERSION` and `BUILD_NUMBER` regex matches could return `null`, causing a
crash at build time when optional chaining was missing.

**Fix:** Added `?.` optional chaining on the match result.

---

### Rust panics on keyring initialisation failure
**File:** `src-tauri/src/storage.rs`

Five `.expect()` calls on keyring entry creation across all platforms (iOS,
Android, macOS, Windows, Linux) would panic the entire app if the OS keyring was
unavailable or returned an error.

**Fix:** Replaced all five with pattern-matched error handling that logs the error
and continues gracefully.

---

### msgpack encoding panic
**File:** `src-tauri/src/api/auth.rs`

Session encoding used `.unwrap()` on msgpack serialisation. Any encoding failure
would panic the Rust thread.

**Fix:** Changed to `?` propagation so the error is returned to the caller.

---

### WebSocket race condition on destroyed component
**File:** `src/routes/(protected)/chat/conversations.svelte.ts`

WebSocket listeners could fire after the conversation state was destroyed (e.g.
on logout), causing state mutations on a dead object.

**Fix:** Added `if (this.#destroyed) return;` guard at the top of each listener.

---

### Array bounds crash in grid batch loading
**File:** `src/routes/(protected)/(navbar)/(root)/grid-state.svelte.ts`

`partialBatches[batchIndex]` was accessed without checking whether the index was
valid, crashing if the batch was already removed.

**Fix:** Added a null guard before accessing the batch.

---

### Memory leak in AlbumMessage.svelte
**File:** `src/routes/(protected)/chat/[conversationId]/AlbumMessage.svelte`

Video and image DOM nodes were created inside a Promise but not cleaned up if the
Promise rejected, leaking nodes into memory.

**Fix:** Wrapped in try/finally to ensure cleanup always runs.

---

### Over-aggressive message cache clearing
**File:** `src/routes/(protected)/chat/conversations.svelte.ts`

On reconciliation after reconnect, the message cache was cleared for all
non-active conversations, causing unnecessary re-fetches.

**Fix:** Cache is only cleared for conversations no longer present in the
refreshed list.

---

## Features Implemented

### Views tab — who viewed your profile
**File:** `src/routes/(protected)/(navbar)/views/+page.svelte`

Implemented live data from `GET /v7/views/list`. Shows each viewer's avatar,
display name, time since they viewed, and distance. Displays total viewer count.

API notes discovered during implementation:
- Response key is `profiles`, not `views`
- `profileId` comes as a string, coerced to number
- `seen` is a unix timestamp in ms, not a boolean

---

### Interest/Taps tab — who tapped you
**File:** `src/routes/(protected)/(navbar)/interest/+page.svelte`

Implemented live data from `GET /v2/taps/received`. Shows each tapper's avatar,
display name, tap emoji (👋😊🔥😈 by tap type), mutual badge, and distance.

API notes discovered during implementation:
- Response key is `profiles`, not `taps`
- Field is `profileId`, not `senderId`

---

### Right Now tab — people currently available nearby
**File:** `src/routes/(protected)/(navbar)/right-now/+page.svelte`

Implemented using the cascade grid with `rightNow=true&onlineOnly=true` query
params. Shows profile cards with name, photo, and distance.

API notes discovered during implementation:
- `/v4/browse/right-now` returns binary (not JSON) — wrong endpoint
- The real Right Now feed uses `GET /v3/cascade?rightNow=true&onlineOnly=true&nearbyGeoHash=...`

---

### Album sharing in chat composer
**Files:** `src/routes/(protected)/chat/[conversationId]/MessageComposer.svelte`,
`AlbumPicker.svelte` (new)

Added a photos icon button to the message composer that opens a bottom drawer
showing the user's albums. User selects an album, picks an expiration type
(indefinite / view once / 10 min / 1 hr / 24 hrs), and shares it to the
conversation via `POST /v4/albums/{albumId}/shares`.

---

### Profile editing
**File:** `src/routes/(protected)/(navbar)/profile/[profileId]/EditProfileSheet.svelte` (new)

Full profile edit sheet accessible from the user's own profile page. Editable
fields: display name, about me, sexual position, body type, height, weight,
ethnicity, relationship status, looking for, tribes. Sends a PATCH to
`/v4/me/profile` with only the changed fields.

---

### Favorite / unfavorite toggle
**File:** `src/routes/(protected)/(navbar)/profile/[profileId]/+page.svelte`

Heart button on profile page. Sends `POST /v1/favorites/{profileId}` to favorite
and `DELETE /v1/favorites/{profileId}` to unfavorite. Uses optimistic UI — reverts
on failure.

---

### In-app message toast banners
**File:** `src/routes/(protected)/+layout.svelte`

When a new chat message arrives via WebSocket while the user is on a different
screen, a toast banner appears with the sender's name and message preview.
Tapping the banner navigates to the conversation.

---

### Geolocation auto-update on grid load
**File:** `src/routes/(protected)/(navbar)/(root)/+page.svelte`

On app mount, silently requests the current GPS position (if permission already
granted). If the user has moved more than ~1km (6-character geohash cell
boundary), the stored geohash is updated and the grid refreshes automatically.
No permission prompts if location was already granted.

---

### WebSocket polling fallback and manual refresh
**File:** `src/lib/ws.svelte.ts`

When the WebSocket fails to connect (e.g. on Android when network is flaky), the
app now falls back to polling the conversations inbox every 30 seconds. A manual
refresh button is shown in the conversation list header when offline.

---

### Registration form
**File:** `src/routes/(auth)/register/+page.svelte`

Wired up full account creation form. Validates email, password strength, and
submits to the registration endpoint.

---

### Forgot password
**File:** `src/routes/(auth)/forgot-password/+page.svelte`

Wired up the password reset flow with email input and success state.

---

### Report message
**Files:** `src/routes/(protected)/chat/[conversationId]/ReportDialog.svelte` (new),
`MessageContextMenu.svelte`

Report dialog with 6 reason options and an optional comment field. Submits to
`POST /v4/flags/{profileId}`. Wired into the message long-press context menu.

---

### Voice message button — graceful stub
Shows a "coming soon" toast instead of crashing or doing nothing.

---

## UI Modernization

- **NavBar** — active tab gets an accent-color pill background and semibold label
- **Chat bubbles** — `rounded-2xl`, `shadow-sm`, refined padding and font size (`text-[15px]`, `leading-[1.45]`)
- **Message composer** — floating card with `backdrop-blur`
- **Grid profile cards** — hover zoom, gradient overlay, cleaner unread badge styling
- **Profile page** — display name at `text-3xl` bold, section headers in ALLCAPS small-caps
- **Settings** — grouped sections with micro-labels (Preferences / Account / Community), proper sub-page navigation replacing all `#/` stubs
- **Empty states** — larger icon container, bolder title typography
- **Conversation list** — unread conversation title semibold, timestamp in accent color

---

## Tests Added

**38 new frontend unit tests across 5 new files, all passing:**

| File | What it tests |
|------|---------------|
| `src/lib/model/conversation.test.ts` | Null preview, image/album/text previews, participants length constraint, rightNow enum values |
| `src/lib/model/album.test.ts` | albumName string / null / missing, content with empty URL |
| `src/lib/model/right-now.test.ts` | Valid status values; documents narrow-enum risk if Grindr adds values |
| `src/lib/model/profile.test.ts` | socialNetworks object-vs-array mismatch; viewSourceEnumSchema narrow-enum risk |
| `src/lib/components/filters/filters.test.ts` | Confirms `"has-profile-pic"` is invalid, `"has-face-pics"` is correct |

---

## Open Issues (not yet addressed)

- `logout` does not clear the keyring entry — stale session token persists across installs (`src-tauri/src/api/auth.rs`)
- `messages[0]?.messageId` accessed without null guard in `MessagesList.svelte`
- Block / report button missing from profile page
- Browse grid has no empty state when 0 results are returned
- `socialNetworks` schema: cascade v3 endpoint returns `[]` (array) but profile endpoint returns `{}` (object) — currently silently fails on cascade responses
- `rightNowStatusSchema` and `viewSourceEnumSchema` are narrow enums — will break if Grindr adds new values to either field
