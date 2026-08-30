# Contributions by @Tgbjr2025

This document summarises all bug fixes, features, schema corrections, and tests
added in this branch on top of upstream `open-grind/open-grind` main.

---

## v0.1.32 — open the app with your fingerprint (no PIN needed) (2026-08-30)

**Fingerprint/face can now lock the app on its own** — Previously biometric unlock was only an
alternative to typing your PIN. Now you can turn on "Unlock with fingerprint / face" **without
setting a PIN at all**, so opening GrindrX just asks for your fingerprint or face. If the sensor
ever won't cooperate, the OS prompt falls back to your device PIN/pattern, so you can't get locked
out. (Set a PIN too if you want both.) Settings → App → Security.

---

## v0.1.31 — biometric unlock (2026-08-30)

**Unlock with fingerprint / face (new)** — If you use the PIN lock, you can now unlock with your
device's biometrics instead of typing the PIN. Turn it on in Settings → App → Security → PIN lock →
"Unlock with fingerprint / face" (you'll confirm once to enable it). When the app opens locked it
prompts for your fingerprint/face automatically, with your PIN always available as a fallback. The
biometric check is handled by Android; GrindrX never sees your biometric data.

---

## v0.1.30 — favorite fix + first-run tour & What's-New (2026-08-30)

**Fixed: favoriting now works** — Adding/removing a favorite (the heart on a profile) was hitting a
wrong endpoint and silently failing ("failed to update favorite"). It now uses the documented
endpoint. This also unblocks favorite notes / auto-fill, which need a favorite to exist first.

**Feature tour + What's-New (new)** — The first time you open the app it offers a short guided tour
of the features that aren't in the regular Grindr app (saved phrases, voice messages, album
management, favorite notes with auto-fill, PIN lock, notification controls, search, and more). After
each update you'll see a "What's new" card listing that version's changes. You can reopen the tour
anytime from Settings → GrindrX → "Take the feature tour".

---

## v0.1.29 — auto-fill favorite notes from chat (2026-08-30)

**Auto-fill from chat (new)** — When adding a note to a favorite, tap "Auto-fill from chat" and
GrindrX scans your conversation with them for details worth remembering — a name they introduced
themselves with, a phone number, or a street address — and pre-fills the note and phone fields for
you to review before saving. It only reads their messages (things they told you), never overwrites
what you've already typed (it appends and fills blanks), and everything stays on your device except
the note you choose to save. The detection is a plain pattern match — no AI, nothing sent anywhere.

---

## v0.1.28 — voice messages, search, album management, favorites notes (2026-08-30)

A big feature batch.

**Voice messages (new)** — Record and send a voice message: tap the mic in the composer, watch the
timer, then send or cancel. Receiving voice notes already worked; now you can send them too.

**Profile / tag search (new)** — A new Search tab in the bottom bar lets you search profiles by tag,
with tappable results that open the profile.

**Album management (new)** — Settings → Account → My Albums: create, rename, and delete albums, add
photos, and see and remove who each album is shared with.

**Notes on favorites (new)** — Attach a private note (and phone number) to any favorite, from the
Favorites screen.

**Photo-reply messages render** — "ProfilePhotoReply" chat messages (a reply to one of your photos)
now show the photo + reply instead of "Unsupported message type".

**Reliability** — Preferences are now written atomically (write-to-temp then rename), so an app
crash mid-save can no longer corrupt your settings.

**Docs** — The repository README is brought current (correct download links, real signing
fingerprint, and the full current feature list).

_Note: voice-message playback format and a couple of album-management endpoints are implemented
against the documented API but not yet verified on a live device — see FIX_NOTES if anything
misbehaves. Biometric unlock was scoped out of this build (it needs its own native-plugin
validation) and is planned next._

---

## v0.1.27 — settings fixes, notification settings, phrase autocomplete (2026-08-30)

**Blocked / Hidden / Favorites now load (fixes)** — All three account lists showed "Failed to
load" because they hit reverse-engineered endpoints/shapes that never matched Grindr's real API.
Fixed against the documented API: Blocked users now use `GET /v3.1/me/blocks` (resolving names +
photos via a profile lookup), Hidden users parse the real `{ hides: [...] }` shape, and Favorites
load from the documented favorites grid instead of a non-existent `/v1/favorites` (with a
"location needed" hint when the grid has no location yet). Unfavorite now uses the documented
`/v3/me/favorites/{id}` endpoint.

**Notification settings (new)** — Settings → App → Notifications lets you turn message and tap
notifications on or off. Grindr has no server-side notification toggle, so these are enforced on
the device: the switches are read by the native notifier before it posts, so turning one off
actually stops those notifications. The system-wide on/off still lives in your device settings.

**Saved-phrase autocomplete (new)** — As you type in a chat, matching saved phrases now pop up
above the message box for one-tap completion (in addition to the existing phrases button).

**Stats page updates live** — The Downloads & active-users screen now auto-refreshes while open
and has a manual Refresh button, instead of only loading once.

**Branding** — The version label on the settings screen now reads GrindrX instead of OpenGrind.

---

## v0.1.26 — share with a friend + downloads/active-users stats (2026-08-30)

**Share with a friend (new)** — A "Share GrindrX with a friend" option in Settings opens your
phone's share sheet so you can send an invite link by any app you like (messages, email, social,
etc.), with a copy-link fallback. A free way to spread the app.

**Downloads & active-users stats (new)** — A new Stats screen (Settings → Downloads & active
users) shows total downloads across every version and both repos (GitHub + Forgejo), broken down
by version, plus active users in the last hour / 24 hours / 7 days and by app version. Active
users are counted from an anonymous launch ping (a random per-install id + the app version — no
personal data) aggregated over a rolling 7-day window.

---

## v0.1.25 — saved phrases, multi-album share, PIN lock, update notices (2026-08-30)

**Saved phrases (new)** — Reusable message snippets (quick replies) in chat. Tap the new
chat-bubble button in the composer to open your phrase library, tap a phrase to drop it into
the message box, and add or delete phrases right from the drawer. Starts with a few handy
defaults; your list is stored on the device.

**Share more than one album at once (new)** — The album picker is now multi-select: tap several
albums, then Share, and each is shared into the chat in one action. Partial failures are
reported instead of aborting the whole batch.

**PIN app-lock (new)** — Optionally require a PIN to open GrindrX (Settings → App → Security →
PIN lock). The PIN is stored only as a salted SHA-256 hash on the device, never in the clear,
and the app locks on each cold start until you enter it.

**Update notifications now tell you what's new** — The in-app "Update available" banner was
pointing at the wrong repository (upstream Open Grind), so it would never surface GrindrX
releases; it now checks the GrindrX release feed. It shows the new version number, the version
you're on, and a "What's new" panel with the release notes so you can see what changed and what
was fixed before updating.

**Video calling** — Assessed and intentionally NOT shipped: real 1:1 video calling needs
signaling + TURN/STUN infrastructure and camera/mic permissions that don't exist in this app
yet. See `memory/VIDEO_CALL_FEASIBILITY.md` for exactly what it would take. We don't ship a
non-functional call button.

**Tests** — +37 unit tests (149 total, was 112): saved-phrases store, multi-album share
orchestration, semver update comparison, and PIN hashing/lock behaviour.

---

## v0.1.24 — audit fix batch (2026-08-14)

Driven by a full 9-dimension code audit (48 findings). See `memory/FIX_NOTES_v0.1.24.md` for the
complete record. Highlights:

**Photos (known issue)** — Fixed the private/album "tap to send" crash (signed CloudFront bytes are
now fetched via a new no-auth `fetch_media_bytes` Rust command with a signed-CDN host allowlist), and
added a persistent `mediaHash → mediaId` cache so a saved/album photo re-sends without re-downloading
and re-uploading every time.

**Explore other areas (known issue)** — Root-caused `CAS-4001`: `exploreGeoHash` is built and sent
correctly; the error is a server-side Grindr XTRA/region gate, not a client bug. The grid now shows an
honest premium/region message instead of a misleading "try again", and a regression test pins the
query serialization.

**Bugs** — Rewrote broken profile taps (`/v2/taps/add` + correct tap IDs + status check); surfaced the
real server error on password-change/delete; added status checks so favorite/hide/unhide can't fail
silently; split recipient-read vs local-read cursor so read receipts are correct; fixed a concurrent-
send duplicate race; stopped drifted-but-successful sends being marked failed (was double-sending on
retry); stopped the reconcile poll rebuilding the whole message list; stopped a corrupt preferences
read from clobbering saved settings.

**Security (Rust)** — Shared HTTP client now refuses redirects (closing a bearer-token leak on the
`request`/`upload_image` paths); WebSocket is torn down on logout/account-switch; request payloads are
size-capped.

**Unimplemented features** — Incoming voice notes, GIFs, videos and gaymoji now render (were
"Unsupported message type"); "Reveal profile views" is wired to the server prefs endpoint; the
mislabeled "Reveal message read" copy corrected.

**Reactivity / a11y / config** — Fixed 3 Svelte `state_referenced_locally` bugs; delete-popover
keyboard/ARIA; imperial height as feet+inches; tightened CSP `connect-src`; dropped unused `WAKE_LOCK`.

**Tests** — 112 unit tests (was 52) incl. regression tests for both known issues; new
`shared_client_does_not_follow_redirects` Rust test.

Deferred (see FIX_NOTES): auth-endpoint divergence (needs live verification), voice-message *sending*,
PIN lock, notification-settings subpage, native notification deep-link.

---

## v0.1.16 — open-issue fixes (2026-07-14)

Fixes for the issues reported on `git.dominusaxis.com/dominus/grindrx`.

**Notifications split across categories (#6)**
- `NotificationService.kt`: register the `grindx_messages` channel (IMPORTANCE_HIGH)
  in `onCreate()`, not only in `MainActivity`. The Rust WebSocket loop posts message
  notifications from the sticky foreground service's process, which can be alive after
  a `START_STICKY` restart without `MainActivity` ever running — so the channel didn't
  exist at post time and Android's Notification Assistant bucketed those under
  "suggestions", splitting a conversation across categories.

**Chat photo picker showed public profile pics, not private ones (#5)**
- `AlbumPicker.svelte`: added a **Private** tab sourced from the user's album content
  (signed-CDN media via `/v1/albums`); the old public-profile-photos source is kept
  under a **Profile** tab. Private photos are sent by re-uploading their bytes through
  the chat-media endpoint to mint a numeric `mediaId` (`prepareAuthedUrlForSend` in
  `profile.ts`).

**Explore/map `CAS-4001 is not valid JSON` (#3)**
- `api/index.ts`: the cascade/explore endpoint can answer **HTTP 200 with a bare code**
  (e.g. `CAS-4001`) instead of JSON. `json()` now routes a short/non-JSON success body
  into `ApiHttpError` (which decodes the bare code), so the grid shows an actionable
  message via `toGridError` instead of a raw `SyntaxError`. Removed the temporary
  `[GrindrX-API]` logcat probe now that this is root-caused.

**App crash on changing filters/settings until restart (#3)**
- `app-data/preferences.svelte.ts`: `getPreferences()` degrades to defaults on any
  read/decode/parse failure instead of rejecting. A non-atomic write racing a read (or
  a half-written file from an app kill) previously threw, and the home route's
  `{#await preferences}` had no catch — so a filter/location change hard-crashed the app.
- `(root)/+page.svelte`: added a `{:catch}` backstop on the preferences await.
- `TopBar.svelte`, `GridFilters.svelte`, `AgeQuickFilter.svelte`, `PositionQuickFilter.svelte`:
  deep-clone `defaultFilters` (shared module state with nested arrays) before seeding
  `$state`, so in-place slider edits can't corrupt the defaults and later fail
  `preferencesSchema.parse`.

**Account creation error toasts (#1)**
- `rest.rs` / `lib.rs`: added an unauthenticated `request_public` bridge (mirrors
  `request` but sends no Authorization header). Registration and password-reset are
  pre-session actions; routing them through the authed bridge failed at the auth guard
  with "Not logged in" before any network call, which the frontend turned into a
  sign-in redirect plus a second "unknown error" toast.
- `RegisterForm.svelte`, `ForgotPasswordForm.svelte`: use the public bridge, read the
  real error body (`response.json()` now throws on non-2xx), and show a single honest
  message. NOTE: Grindr's first-party account-creation endpoint is "dynamic, WIP" and
  not publicly documented; this fixes the client-side error handling and transport, but
  server-side account creation may still be unavailable — the user now sees the real
  response instead of a misleading redirect.

**Known limitation (not a code defect):** profiles beyond the free viewing radius (#3,
part 1) require a Grindr subscription; the server does not return them for a free
account, so they cannot be made to load client-side.

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
