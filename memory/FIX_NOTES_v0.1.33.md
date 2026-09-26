# FIX_NOTES — v0.1.33 (audit remediation batch 1)

**Operator:** Tom. **Host:** ovh. **Base:** `ec7e9a3` (v0.1.32).
**Status:** code complete, typechecked, tested. **NOT built, NOT installed, NOT pushed** (R11).

## Baseline before this batch

`vitest` 24 files / 194 passed · `svelte-check` 0 errors, 30 warnings · `eslint` clean.

## Shipped

### 1. Branding — removed the last user-visible "Open Grind" string
`src/routes/(protected)/(navbar)/(root)/+page.svelte:55` — the webview title was
literally `Open Grind`. Now `GrindrX`, matching `tauri.conf.json` `productName`
and the settings version string.

**Deliberately NOT changed** (flagging, not silently rewriting):
- `tauri.conf.json` `identifier: "org.opengrind"` — this is the **Android package
  id**. Changing it makes the app a different package: existing installs are
  orphaned, every user must reinstall and re-login, and app-data is lost.
  Needs an explicit decision, not a find-replace.
- `src-tauri/Cargo.toml` `name = "open-grind"` / `open_grind_lib` — feeds
  `Theme.open_grind` in the generated manifest and the Gradle autogen files
  (which are intentionally dirty, R20). Cosmetic only; not worth destabilising
  the Android build for.
- `LICENSE`, `GOVERNANCE.md`, `KEYS.md`, `BUILDING.md`, `CONTRIBUTING.md`,
  `flake.nix`, `OPEN_GRIND_KEYSTORE_PROPERTIES`, the `open-grind` keystore alias.
  These are **not in the app**. Several are legally/operationally load-bearing
  (MIT attribution, PGP signing chain, release keystore alias — renaming the
  alias would break release signing).
- The `git.dominusaxis.com/dominus/open-grind` URLs are **real working URLs**.
  Rewriting them breaks the links they point at.

The two remaining `OpenGrind` hits in `src/` are a comment and
`settings/(me)/+page.svelte:19`, which is the code that *converts* `OpenGrind`
→ `GrindrX` in the displayed version string. Both are correct as-is.

### 2. Incognito mode — implemented for real (was a label with no effect)
`settings/(subpage)/app/IncognitoSetting.svelte` rewritten.

Previously it wrote **only** the local `preferences.incognito` flag, which drives
the grid's "Incognito" chip and nothing else. The description admitted as much:
*"Visual indicator only."* Turning it on changed a label while the account stayed
fully visible to everyone.

Now it writes the real server-side prefs via the already-present but previously
unused `setPrefsSettings` (`PUT /v3/me/prefs/settings`):
- `incognito` — withhold the profile from browse results
- `locationSearchOptOut` — keep it out of location search

Reads initial state from the server (`getPrefsSettings`), falls back to the local
flag only if that call fails. Handles 402/403 like `RevealProfileViewSetting`
does: reverts the switch and says XTRA is required, so the badge can never claim
incognito while the account is still exposed.

### 3. Black screen on back-navigation from a profile — root cause fixed
Reported as "view a profile, back out to the grid, black screen". Four defects
compounded. All four fixed.

- `Grid.svelte` — the scroll restore was a **one-shot latch** that fired on the
  first non-loading frame, before the grid had its real height. Replaced with an
  ordered sequence: two `requestAnimationFrame`s → `measureGrid()` → `tick()` →
  `window.scrollTo`, gated on `rowHeight > 0`.
- `Grid.svelte` `measureGrid()` — the row-height fallback was a hardcoded `120`,
  ~35% short of a real 2-column phone cell (~190px), so the pre-measurement
  document was too short and a restore landed inside spacer territory. Now falls
  back to `gridEl.clientWidth / columns`.
- `Grid.svelte` `saveScroll` — the restore's own `window.scrollTo` fires a scroll
  event, which wrote the **clamped** value back over `gridState.scrollY`,
  destroying the real offset permanently (it is only cleared by `refresh()`).
  Added a `restoring` guard.
- `GridWindow.svelte` `recomputeVisible()` — reset `visible` to `new Set([0])`
  whenever `hitCount` was empty. Right after a restore the observers under the
  viewport have not reported yet, so `hitCount` is transiently empty; resetting
  shrank the page **below** the current scroll offset, leaving the viewport past
  the end of the content. Now returns early and keeps whatever is mounted.
- `GridWindow.svelte` `chunkPx()` — removed the `120` magic number; spacers are
  sized purely from the measured row height.

**Needs on-device confirmation** (S26 Ultra): derived from the code, not
reproduced on hardware. Test: scroll deep into the grid, open a profile, press
back — the grid must return to the same profiles at the same offset.

### 4. Album share no longer produces a permanent duplicate bubble (C1)
`lib/api/album.ts` + `chat/[conversationId]/conversation-state.svelte.ts`.

`POST /v4/albums/{id}/shares` returns an **empty body**, so there is no real
`messageId`. The old code fabricated one
(`album-share-${albumId}-${profileId}-${Date.now()}`) and wrote it onto the
optimistic bubble. That broke every dedup path simultaneously: the WS echo
matched neither the exact id nor the "single pending message" fallback, so a
second album bubble was prepended; `removeDuplicateMessages` keys on
`messageId` so it could not collapse them either; and no reconcile runs while
the WebSocket is healthy, so it never healed and could not be unsent (400s
server-side).

Now: the bubble stays `pending` and carries a `pendingKey` (`album:{albumId}`).
Both the WS handler and `reconcile` match on it and adopt the server's real
message. `shareAlbum` returns `void` — no more synthetic id.

Also added: a 60s **safety-net reconcile** that runs even while connected
(the 10s poll only runs when the socket is down, so a missed echo had no
recovery path), and a `#reconcileInFlight` guard so overlapping polls can't pile
up concurrent full-page fetches on a slow network.

**+4 regression tests** in `conversation-state.reconcile.test.ts` — this path had
zero coverage, which is why it shipped.

### 5. Voice recording no longer survives navigation (C2)
`chat/[conversationId]/MessageComposer.svelte`.

`mediaRecorder`/`audioStream`/`recordTimer` had **no** `$effect`/`onDestroy`
cleanup; teardown was only reachable from `mediaRecorder.onstop`. Hitting back
mid-recording left the microphone live, kept the 250ms interval firing, and at
the 300s cap still ran `onstop` → upload → **send a voice message into a
conversation the user had already left**, with no UI.

Added a teardown effect (covers back gesture, conversation switch, app close)
plus a `destroyed` guard in `uploadAndSendAudio` and `startRecording`.

### 6. Profile edits no longer silently fail to save (C3 + H12 + H13 + H14)
`profile/[profileId]/EditProfileSheet.svelte`.

Four bugs, all "the save appears to work and nothing changed":
- **C3** — `fetchRest` only rejects on IPC failure, never on HTTP status. The
  PATCH result was never inspected, so a 400/402/403/500 showed
  **"Profile updated"** and closed the sheet. Now throws `ApiHttpError` and
  reports 402/403 as an XTRA requirement.
- **H12** — the inputs are `type="number"`, and Svelte coerces number bindings
  with `to_number`, which returns **`null`** (not `""`) for an empty field.
  `heightFeet.trim()` threw a TypeError as soon as either box was cleared, so
  nothing saved. Normalised through a `numText()` helper.
- **H13** — same root cause: `weight !== ""` is **true** for `null`, so
  `Number(null) === 0` and clearing weight wrote `weight: 0` grams.
- **H14** — a non-finite number (`"1e999"` → `Infinity`) is msgpack-encoded as a
  float the Tauri bridge **refuses to decode**, failing the entire PATCH and
  discarding all 19 fields with an opaque error. Added `Number.isFinite` guards.

## Still open (from the audit, not in this batch)

- **Video calling** — no WebRTC/signalling/TURN exists; `VideoCall` is explicitly
  an unsupported type. Needs infrastructure, not a code fix. See
  `VIDEO_CALL_FEASIBILITY.md`.
- **Explore** — client is correct (`exploreGeoHash` is sent, per
  `docs/.../browse/grid.md`); the server gates it with `CAS-4001`. `errorIsExploreGate`
  is still written and never read, so the grid still shows a futile "Retry".
- **Viewers list** — masked rows have no `profileId` server-side (paywall);
  `viewSchema.profileId` is still a required `z.coerce.number()` that turns
  `null` into `0`.
- **Photos** — no way to add a profile photo / set an avatar; album add-photo
  needs a real multipart command in Rust.
- **Share location** — receive-only, no send path.
- Share location, viewers, explore, app-lock hardening (H8–H11), chat HIGH
  items (H1–H7), Rust MEDIUM items — all still to do.

## Rollback

`git revert` the batch commit, or reset to `ec7e9a3`.

---

## Batch 2 (same version, second commit)

### Viewers list — masked rows fixed and made informative
`src/routes/(protected)/(navbar)/views/+page.svelte`

Two real client bugs, plus the honest limit:

- `viewSchema.profileId` was a **required** `z.coerce.number()`. `Number(null)`
  is `0`, so a masked viewer that leaked into `profiles[]` became a *clickable*
  row linking to **`/profile/0`**, and a genuinely id-less entry failed
  `safeParse` and was silently dropped by `dropBad`. Replaced with a
  `profileIdOf` transform that only yields a **positive integer** id.
- `seen` was `z.number()`; the docs say unix milliseconds, but a string form
  failed validation and was `.catch()`-ed to `null`, which silently removed the
  "Viewed 2 hours ago" line. Now a tolerant numeric-or-string coercion.
- Both arrays are parsed with one shared schema (`profiles` is documented as
  "everything from previews" plus `ProfileShort`), and a viewer present in both
  is de-duplicated so the keyed `{#each}` cannot collide.
- Masked rows now surface the signals the server *does* send —
  `viewedCount.totalCount` ("Viewed you 4× recently") and `isSecretAdmirer` —
  and say plainly that Grindr hides the identity until XTRA, instead of an
  unexplained "Anonymous".

**Not fixable client-side:** `ProfileMasked` genuinely has no `profileId`
(docs/content/grindr-api/users/profiles.md#ProfileMasked), so a masked viewer
cannot be made clickable without a paid tier. The official app behaves the same.

### Explore — the dead end is gone
`src/routes/(protected)/(navbar)/(root)/Grid.svelte`,
`.../LocationChange.svelte`

- `errorIsExploreGate` was written and **never read** (its own comment said it
  existed so a caller could offer "reset to my location" instead of a futile
  retry). The grid now branches on it and shows **"Back to my location"**
  instead of a Retry button that can only fail again. The handler also calls
  `gridState.refresh()`, because `gridState` caches the failing explore hash and
  a bare re-render would rebuild the identical request.
- Added a **second route to the same place that is not paywalled**: "Browse from
  here" moves our own nearby reference point (`preferences.geohash`) instead of
  using the `exploreGeoHash` param, so a free account can actually browse an
  area it picked. It clears any explore override first (otherwise the grid
  would still centre on the old area and it would look like a no-op), and is
  offered right after a pick with an explicit dismiss.

**Still server-gated:** the `exploreGeoHash` request itself is already correct
(`model/grid/index.ts:9`, `docs/.../browse/grid.md:8`); Grindr answers CAS-4001
without a paid tier. That cannot be fixed in the client.

### Share a location in chat — implemented (was receive-only)
`lib/api/messages.ts`, `chat/[conversationId]/LocationShareSheet.svelte` (new),
`chat/[conversationId]/MessageComposer.svelte`

`locationMessageSchema` and `LocationMessage.svelte` existed, so the app could
*receive* and render a shared location but had no way to send one.
- `sendLocationMessage()` posts `type: "Location"` with `{ lat, lon }`.
  `ConversationState.send()` already handles arbitrary message types, so it
  flows through the normal optimistic + WebSocket-echo path.
- New `LocationShareSheet`: reuses the existing `LocationChooser`/`GeoMapPicker`,
  offers "Use my location" (device GPS) or a map pick, and **requires an
  explicit confirm** showing the literal coordinates and geohash that will be
  transmitted. Sharing a location is a real disclosure, so it never sends on a
  map tap alone.
- Composer gets a pin button, disabled until the conversation's profile resolves.

### Lint: Grid.svelte 13 errors -> 0
`{#snippet children(item)}` left `item` as `any` (11 errors). Annotated it
`GridProfile` and added an explicit `PartialGridProfile` narrow in the partial
branch, which the Svelte template checker cannot infer on its own.
`LocationChange.svelte`'s `locationChooser` used the component as a bare type
(widening to `any`); replaced with a precise structural type and made the call
optional, since the handle is undefined before the chooser mounts.

**Verification:** svelte-check 0 errors / 30 warnings (unchanged) · eslint clean
on every changed file · vitest 198 passed.

---

## Batch 3 (same version, third commit) — profile photos

### Add / set-main / reorder profile photos
Previously the app could only **delete** a profile photo. `POST /v3/me/profile/images`
(upload) and `PUT /v3/me/profile/images` (set primary + secondaries) were never
called from anywhere in `src/` or `src-tauri/src/`, and `EditProfileSheet` (727
lines) contained no photo code at all.

- **New Rust command `upload_profile_image`** (`src-tauri/src/api/rest.rs`,
  registered in `lib.rs`). Posts to the legacy `POST /v4/media/upload`, which
  returns a **public** 40-char hash. This is a separate path from the existing
  `upload_image` on purpose: that one targets `POST /v5/chat/media/upload` — the
  only endpoint that mints a numeric `mediaId` — but it yields a **signed**
  64-char hash, which is not a valid `primaryImageHash`.
  `thumbCoords` is a RectF serialised `y2,x1,x2,y1` and **must be square**; the
  server accepts a non-square crop without error and then **silently drops** the
  image when it is later referenced. The command therefore computes the largest
  centred square from the caller-supplied real dimensions, so it is square by
  construction, and rejects a zero dimension rather than sending a bad crop.

  ⚠️ **THIS RUST IS UNCOMPILED.** There is no cargo/rustc in this environment, so
  it has not been built, let alone run against the live endpoint. It must be
  built (`nix run .#build-android`) and tested on device before release. The
  query-param shape and the hash it returns are the two things to verify first.

- **`setProfilePhotos()`** (`lib/api/profile.ts`) wraps `PUT /v3/me/profile/images`,
  a plain JSON body, so it goes through `fetchRest` like any other call. Handles
  both documented traps: `secondaryImageHashes` is sent as `[]` and never `null`
  (primary + null secondaries is a 400), and the primary is de-duplicated out of
  the secondaries (repeats are silently dropped server-side).

- **`uploadProfilePhoto()`** validates the response is a 40-char **public** hash,
  so a signed/chat hash can never reach `primaryImageHash`.

- **Photos page rewritten**: add a photo, promote any photo to "main" (the grid
  avatar), reorder the extras with arrows, delete. The main photo is tracked
  separately from the ordered list because the API stores it separately. All
  mutations are optimistic with rollback, and re-read the server's order after a
  change. Deleting a photo now **also** re-persists the primary/ordering (it
  previously left the profile pointing at a deleted hash) and gets a real
  confirmation dialog, since the delete also purges the CDN copy.

- `downscaleImage()` now reports the true `width`/`height` of the bytes it
  returns (including the "no downscale needed" and failure paths), because the
  upload needs them to compute a valid square crop. Previously the small-image
  path returned early with no dimensions at all.

**Known limitation, unchanged:** album photo add/remove still needs a multipart
command. `addAlbumContent` still POSTs JSON to a multipart-only endpoint and
still leaks an undeletable chat-media copy per attempt, and
`removeAlbumContent` still has no caller. That is the next thing to fix.

**Verification:** svelte-check 0 errors / 30 warnings (unchanged baseline) ·
eslint clean on changed files · vitest 198 passed. Rust: **not compiled**.

---

## Batch 4 (same version, fourth commit) — app-lock hardening

Four real holes in the PIN/biometric lock.

- **H11 — the KDF was a single SHA-256.** `hashPin` was
  `SHA-256(salt:pin)` with the salt stored beside the hash in the same
  unencrypted WebView localStorage. A 4-digit PIN is 10,000 candidates and that
  many single SHA-256 evaluations take well under a second on a GPU, so anyone
  who could read app storage (adb backup, rooted device) could brute-force it
  offline. Now **PBKDF2-SHA-256 at 200,000 iterations**. The iteration count is
  stored next to the hash, so an existing install still verifies (its stored
  count is read back and the PIN re-derived at that cost) and is
  **transparently upgraded** to the current cost on the next successful unlock.
  The PIN is imported via `TextEncoder` bytes rather than as a raw key string, so
  a short PIN isn't zero-padded into a fixed-length key.
- **H10 — unlimited attempts.** `unlock()` could be called forever, so a PIN was
  recoverable unattended. Now 5 free attempts, then a cooldown that doubles per
  further miss (30s → 30min cap), persisted to localStorage so killing the app
  does not clear it. The unlock screen shows a live countdown and disables the
  button. `setPin` also now validates the 4-8 digit shape.
  Deliberate non-behaviour: failed attempts against an **already-unlocked** app
  do not re-lock it, because that is a trivial DoS (tap 5 times while walking
  past and the phone locks itself). Covered by a test.
- **H8 — the lock never re-engaged.** `lockNow()` existed but nothing called it
  (only the definition and a test referenced it), `locked` was only ever set
  `false`, and there was no focus/visibility handler — so pressing Home and
  returning left the app unlocked indefinitely and the gate only came back on a
  full process restart. Now wired to `visibilitychange` in the root layout, with
  a 30s grace period so a brief app switch (notification shade, a permission
  dialog) does not demand the PIN again.
- **H9 — the lock was an overlay, not a gate.** `PinLockGate` was layered on top
  of a fully rendered tree at `z-100`, so while "locked" every protected node —
  chat text, names, photos — was still in the DOM and reachable from JS, nothing
  blocked data fetches, and the layout's WebSocket handler raised a toast
  containing **up to 60 characters of an incoming message** on the lock screen.
  The protected layout now renders **nothing** while locked, and the WS toast
  handler returns early. (No `FLAG_SECURE` yet — see below.)

Also: `PinLockGate` snapshotted `pinOn`/`biometricOn` into `const`s at module
init, so toggling the PIN in Settings would have left a stale PIN-only screen
whose Unlock button could never succeed. Both are `$derived` now, and the
biometric auto-prompt re-runs on re-lock rather than only on first mount.

**Still open:** `FLAG_SECURE` is not set anywhere in `src-tauri/`, so the Android
recents-thumbnail still captures whatever was last on screen. That needs a
native change (or accepting the risk) and is not done here.

**Verification:** svelte-check 0 errors / 30 warnings (unchanged baseline) ·
eslint clean on changed files · vitest 198 → **208** (10 new: lockout threshold,
cooldown refusal, counter reset, persistence across a simulated restart, PIN
validation, no-trivial-DoS, plus PBKDF2 salt-sensitivity / determinism /
not-a-plain-SHA256 / iteration-count portability).

---

## Batch 5 (same version, fifth commit) — album multipart + Rust hardening

### Album photo add/remove now actually work
This was the last broken feature from the audit.

- **New Rust command `upload_album_content`** (`rest.rs`, registered in `lib.rs`).
  Builds a real `multipart/form-data` body for `POST /v1/albums/{albumId}/content`
  with the raw file under the field `content`. This had to be a dedicated command
  because the generic `request` bridge msgpack-decodes every body and re-sends it
  as JSON, so a multipart endpoint was unreachable from the WebView.
  - Content-Type is forced to `image/*` (defaults to `image/jpeg`) so an opaque
    blob is never posted to a multipart endpoint.
  - The multipart boundary is a fixed constant and the filename is fixed, so
    neither can be influenced by user input and inject a header.
- **Frontend**: `addAlbumContent` (the broken by-reference path) is replaced by
  `addAlbumContentFromBytes`. It goes through the new `prepareImageForUpload`
  helper, so album uploads get the same downscale + EXIF stripping as the profile
  and chat paths — a camera photo no longer leaks its GPS to a second endpoint.
- **Multi-select**: the file input now takes `multiple` and uploads sequentially
  (the old code read only `files[0]` and silently dropped the rest). Per-photo
  failures are reported individually rather than aborting the batch.
- **`removeAlbumContent` finally has a caller.** A "Manage" toggle reveals the
  full content grid with a per-item delete. Previously only `content[0]` (the
  cover) was ever rendered, so photos 2..N of every album were invisible and
  unmanageable.

⚠️ **The two new Rust commands are UNCOMPILED.** No cargo on this host. The
multipart boundary/field name and the `thumbCoords` square-crop query are the
two things to verify first against a live endpoint.

### Rust security / robustness
- **Logout during the WS handshake could be silently lost (H15).** The reset used
  `Notify::notify_waiters()`, which only wakes waiters registered *at that
  instant* and stores no permit. The only waiter is the `select!` arm inside
  `run_message_loop`, which is not registered during the backoff sleep or the
  15s connect handshake — so a logout in that window was dropped, the socket
  completed with the **pre-logout** token, and it kept delivering the previous
  account's events and notifications. Replaced with a monotonic
  `AppState::ws_epoch`, snapshotted before credentials are used and re-checked
  after the token fetch AND after the handshake, *before* `ws:connected` is
  emitted. The `Notify` is retained purely as a wakeup hint so the loop still
  blocks instead of polling.
- **`ws_send` could never succeed (H16).** `WsCommand.ref_id` carried
  `#[serde(rename = "ref")]` with no alias, so the IPC deserializer required
  `ref` while the frontend sends `ref_id` → `InvalidArgs` on every call. Latent
  only because `ws.send()` had no callers. Now `rename = "ref", alias = "ref_id"`,
  and the pointless `Serialize` derive is gone (the outgoing frame is hand-built).
- **`ws_send` could also hang forever.** The channel is bounded at 64 and its
  receiver lives for the process lifetime, so `send` never returns `Err` (the
  old "WS not connected" path was unreachable) and the 65th command would await
  indefinitely, leaving `invoke("ws_send")` unsettled with no error. Now bounded
  by a 5s timeout with a real error.
- **Uncapped API responses (H18).** `MAX_FETCH_BYTES` only guarded the media
  paths; `request_raw`/`request_raw_unauthed` did `response.bytes().await?` with
  no limit and then msgpack+base64 encoded it, peaking at 3-4x the response. Both
  now stream through `stream_capped_body` with a new `MAX_API_RESPONSE_BYTES`
  (32 MB — real API responses are far smaller; media uses its own path).
- **Server error `code` truncated i64 → i32.** `4294967697` wrapped to `401`,
  which `authorization_header` classifies as an invalid session and responds to by
  **deleting the keyring session** — a spurious forced logout from an integer
  overflow. `AppError::Api.code` is now `i64` end to end.
- **Debug builds logged every request body.** The `Authorization` header and the
  query string were correctly redacted, but the body was printed in full — which
  is where chat text, profile edits, and (via `/v1/accounts` and the password
  pages) the account password live. `bun dev:android` on a real device wrote all
  of it to logcat. Now prints `<N bytes redacted>`.
- **Blocking keyring calls inside `async fn`.** `Entry::get_secret` is
  synchronous and goes through JNI to the Android Keystore; it was called with no
  `spawn_blocking`, and `authorization_header` calls it *inside* the refresh
  critical section, so the stall was paid by every request queued behind the lock.
  `AuthStorage::get_session` is now async via `spawn_blocking`, with
  `get_session_blocking` retained for the one genuinely sync caller
  (`GrindrClient::new`, which runs in Tauri's `setup` hook).
- **Heartbeat could kill a healthy connection.** `tokio::select!` picks a ready
  branch at random, so a `Pong` landing in the same poll iteration as the
  heartbeat tick could be ignored and the connection torn down. The select is now
  `biased` with the read arm first.
- **No jitter on the WS backoff.** A deterministic 1→2→4→30s ladder means a fleet
  disconnected by one blip retries in lockstep. Now scaled by a random factor in
  [0.8, 1.2).
- **WS frame size left at tungstenite's defaults** (16 MiB frame / 64 MiB
  message), with every text frame JSON-parsed and re-emitted to the WebView. Now
  capped at 1 MiB via `connect_async_tls_with_config`.
- **A session with no usable `exp` was stored as already-expired.** `f64 as u64`
  saturates, so a negative/NaN/missing `exp` became `0`, which
  `authorization_header` reads as expired — every subsequent call did a wasted
  refresh round-trip, forever. `exp` is now validated at session creation.
- **A disabled notification could fire at cold start.** `notify_messages` /
  `notify_taps` defaulted to `true` in Rust and were corrected only after the
  WebView's async preferences read completed, so a message arriving in that
  window produced a notification the user had explicitly turned off. They now
  default to **false** and a new `prefs_loaded` flag gates the notifier until the
  WebView has pushed the real values.
- **`GrindrClient::new()` failure was completely silent** (`if let Ok(..)` +
  `let _ = ..`), leaving the `OnceLock` empty so every command returned
  "GrindrClient not initialized" with nothing in logcat. Now logged on both
  failure paths.

### Android / Tauri config
- **`allowBackup` was unset** (defaults to `true`), so `adb backup` could extract
  the app data directory: `preferences.data` (which contains the user's
  **precision-12 geohash**, ~±4 m, plus every grid filter), the WebView
  localStorage holding the app-lock salt and PIN hash, and the signed-URL
  mediaId cache. Now `allowBackup="false"` + `fullBackupContent="false"` + a new
  `res/xml/data_extraction_rules.xml` excluding every domain from both cloud
  backup and device-to-device transfer.
- **Capabilities narrowed.** `clipboard-manager:default` granted the WebView
  **read** access to the system clipboard on Android — a channel for capturing
  anything the user copied from another app — when the app only ever writes
  (invite links, copied message text). Reduced to `allow-write-text`.
  `notification:default` let the WebView post its own notifications, i.e. spoof
  "new message" alerts; the app posts from Rust, so it is reduced to the two
  permission-query calls the frontend actually makes. `opener:default` included
  `allow-open-path` / `reveal-item-in-dir`, which can point the OS at arbitrary
  filesystem paths and are never used — narrowed to `opener:allow-open-url`
  (the app *does* use opener for "View location" and social links, so removing
  the grant outright would have broken those).
- **CSP hardened additively**: added `object-src 'none'`, `frame-src 'none'`,
  `base-uri 'self'`, `form-action 'none'`.
  **`'unsafe-inline'` was deliberately LEFT on `script-src`** — Tauri injects its
  own bootstrap `<script>` into the document, and whether it self-nonces under v2
  must be verified against the pinned Tauri version first. Getting that wrong
  blanks the app at launch, which is a far worse outcome than the hardening
  gain. Flagged for a follow-up once the nonce behaviour is confirmed.

### Deliberately NOT done
- **msgpack nesting depth bound (H19).** The payload size cap bounds bytes, not
  depth, and a deep payload can overflow the stack (which aborts the process,
  not a catchable `Err`). A correct fix needs a real msgpack structure walker —
  ~80 lines that must parse element headers and skip payloads. I wrote a
  first attempt, realised it counted *containers* rather than *nesting depth*
  (so it would have rejected legitimate payloads with more than 64 elements), and
  **removed it rather than ship a guard that would break the app**. It needs to
  be written and unit-tested with real msgpack fixtures.
- **`FLAG_SECURE`** — the Android recents thumbnail still captures the last
  screen. Needs a native change.

**Verification:** svelte-check 0 errors / 30 warnings (unchanged baseline) ·
eslint clean on every changed file · vitest 207 passed. Rust: structural checks
only (brace/paren balance verified unchanged against HEAD for all 7 touched
files; JSON and XML parse) — **not compiled**.

---

## Batch 6 (same version, sixth commit) — chat HIGH cluster + media

- **H5 — the Android keyboard covered the composer.** `app.html` set
  `viewport-fit=cover` with **no `interactive-widget`**, so Chromium defaulted to
  `resizes-visual`: the *visual* viewport shrank but the *layout* viewport did
  not. The chat layout sizes itself with `h-dvh` (derived from the layout
  viewport) and the message list is `flex-1 min-h-0 overflow-auto`, so `dvh`
  never changed and the composer stayed behind the keyboard — you could read
  messages but not type a reply. Now `interactive-widget=resizes-content`.
- **H20 — voice messages never played.** `AudioMessage` did
  `<audio src={message.url}>` with **no `Authorization` header**, unlike every
  other media component (all of which go through `resolveAuthedImage`). For a
  bearer-gated `cdns.grindr.com` URL that is a silent 403: the bubble rendered,
  showed a duration, and pressing play did nothing, forever. Now resolved through
  the authenticated path (signed CloudFront URLs still pass through untouched),
  with a "Loading voice message…" / "Couldn't load audio" state instead of a dead
  player. Also dropped the empty `<track kind="captions" />`, which added a dead
  captions entry to the native player.
- **H1 — every inbound message yanked you to the bottom.** The effect
  smooth-scrolled on ANY change to `messages[0].messageId`. With
  `overflow-anchor: none` on the container, reading history and then receiving a
  message lost your place with no way back. Now tracks proximity to the bottom
  and only auto-follows when you were already there (or sent the message
  yourself); otherwise a sticky **"N new messages ↓"** pill appears and is
  cleared when you scroll back down.
- **H2 — `loadMore` could loop forever.** `messages.ts` synthesises the cursor as
  `messages.at(-1)?.messageId` when the server omits `pageKey`, which is only the
  OLDEST message if the server returns newest-first. If the order differed, or the
  server repeated a page, the same cursor came back indefinitely — an unbounded
  request loop with a permanent spinner. Now stops when a page adds no messages
  or returns the same cursor.
- **H3 — `reactTo` mutated an orphaned object.** It closed over `msg` across an
  `await`; if the WS echo landed in that window the array slot was replaced with
  a NEW object, so the failure path spliced a detached object and the visible
  reaction was never removed — leaving a reaction the server had rejected. Now
  re-finds by `messageId`, with a fallback match, and de-dupes so a double-tap
  before the first request resolves cannot inflate the count.
- **H4 — reactions were effectively write-once and un-removable.**
  `reactionAvailable` was `reactions.length === 0 && !isOut`, so you could not
  react to your own message, could not add a second reaction, and could **never**
  remove one. `MessageContextMenu` rendered a "Double tap to 🔥" hint and no
  reaction buttons at all; the only path was an `ondblclick` hardcoding id 1.
  Now: a real 6-emoji reaction picker in the context menu (works on touch, where
  a double-tap is ambiguous), own messages are reactable, and `Reaction` takes a
  `mine` flag so a badge shows which reaction is yours.
- **H15 (frontend) — double-tap stole text selection.** The old `ondblclick` called
  `preventDefault()` and `getSelection().removeAllRanges()` on every double-tap, so
  double-tapping to *select and copy a word* fired a 🔥. Removed with the picker.
- **H6 — phones ≥424dp got the desktop split-pane.** `new MediaQuery("(width <
  424px)")` put iPhone 15/16 Pro Max (430/440pt) and Pixel 8 Pro (448dp) into the
  two-pane layout. Because the pane group is keyed on that value, rotating
  mid-conversation **destroyed and re-created the `[conversationId]` page**,
  tearing down its `ConversationState` — losing scroll, pagination and in-flight
  sends. Now gates on `(max-width: 767px), ((hover: none) and (pointer: coarse))`.
- **H7 — `send()` silently discarded the message.** `if (!this.profile) return;`
  with no UI. The composer's field and submit button are not disabled while the
  conversation's profile resolves, so a user who typed and hit send immediately
  watched the field clear with no bubble, no toast, no error. Now toasts.
- A failed conversation load had **no retry affordance** — the only recovery was
  the navbar refresh, which only renders while the WebSocket is disconnected. Now
  has a Retry button.

### Lint: `MessageContextMenu.svelte` 9 errors -> 0
`placement` (the `children` snippet param) arrived as `any` through the
`ComponentProps<typeof ContextMenu>` intersection, and `props.onClose()` was
untyped. Fixed by annotating `placement: Placement` and giving `onClose` a
concrete type via `Omit<ComponentProps<...>, "onClose">` + an optional
re-declaration (with a no-op fallback at the call site, since `ContextMenu`
requires it).

**Verification:** svelte-check 0 errors / 30 warnings (unchanged baseline) ·
eslint clean on every changed file · vitest 207 passed.

---

## Batch 7 (same version, seventh commit) — media memory + first tests for authed-image

### The object-URL cache no longer revokes URLs that are on screen
`src/lib/utils/authed-image.ts`

- `MAX_ENTRIES` was **96 full-resolution** entries. Inline bubbles are at most
  240 px wide but the full-resolution bytes were fetched and decoded anyway, so
  96 multi-MB decoded bitmaps is a hard OOM on a mid-range WebView. Now 32.
- **Eviction revoked a blob URL that a MOUNTED `<img>` was still displaying.**
  There was no refcount, so scrolling past the cache size blanked the visible
  image, whose `onerror` handler then re-ran the entire IPC byte fetch — a
  flash-and-refetch storm. Evicted-but-referenced URLs are now *parked* in a
  `retired` map and revoked only when the last consumer releases them, via a new
  `retainAuthedImage()` that hands back a release function for an `$effect`
  teardown.
- **HEIC/AVIF photos were mislabelled as video.** The MP4 sniff checked only
  `ftyp` at bytes 4..8, but `ftyp` sits there in *every* ISO-BMFF container —
  including HEIC and AVIF, which are images. A photo was wrapped in a
  `video/mp4` blob and an `<img>` could refuse to decode it. Now reads the
  **major brand** at bytes 8..12 and checks it against explicit `VIDEO_BRANDS` /
  `IMAGE_BRANDS` sets, falling through rather than guessing for an unknown
  brand.

### `authed-image.ts` finally has tests (13, was zero)
This module is what every image, album slide and now voice message depends on,
and it had no coverage at all. Added: host classification, cache reuse,
concurrent-resolve dedup (asserts exactly one fetch), null-on-failure rather than
throw, bounded live-URL count, eviction actually frees, and MIME sniffing for
JPEG/PNG/MP4/HEIC/AVIF.

**The HEIC and AVIF tests were verified to actually catch the bug**: reverting
the sniff to the old `ftyp`-only check fails exactly those two and nothing else.

One testing gotcha worth recording: stubbing the global `URL` with a plain object
silently breaks `classifyHost`, which does `new URL(url).hostname` — the host
tests failed for a reason that had nothing to do with the code under test. The
stub subclasses `URL` instead.

**Verification:** svelte-check 0 errors / 30 warnings (unchanged baseline) ·
eslint clean on changed files · vitest 207 → **220** (25 files).

---

## Batch 8 (same version, eighth commit) — conversation previews, date grouping, and THE RUST NOW COMPILES

This batch exists because **batch 7 ended mid-edit and the tree was left broken**
(`svelte-check` 1 error) with three user prompts unanswered. It also closes the
single largest gap in the whole v0.1.33 effort: **the Rust had never been compiled.**

### The app did not compile. Three real errors, all shipped in batch 5.

Batch 5 added `upload_profile_image` / `upload_album_content`, the `ws_epoch`
logout fix, the API response cap, and a 1 MiB WS frame cap — and verified none of
it, because there was no cargo on the host. With a toolchain obtained, all three
are genuine build breaks:

- **`AtomicU64` was never imported** (`lib.rs:62`). Batch 5 added
  `ws_epoch: Arc<AtomicU64>` to `AppState` but only `AtomicBool` was imported.
- **`WebSocketConfig` is `#[non_exhaustive]`**, so the frame cap could not be
  written as a struct literal — not even with `..Default::default()`. Now built
  from `default()` and assigned field-by-field.
- **`connect_async_tls_with_config` takes 4 arguments**, not 3:
  `(request, config, disable_nagle, connector)`. The batch-5 call passed
  `(request, None, Some(ws_config))` — which not only had the wrong arity, it had
  the config in the *wrong slot*. Now `Some(ws_config), false, None`, where
  `false` is the `disable_nagle` that plain `connect_async` used before, so the
  only behaviour change is the intended frame cap.

**Verified for the first time: `cargo test --lib` 3/3 pass, `cargo check
--all-targets` clean (0 errors, 0 unused warnings).** Three of the seven batches
of "fixes" in this version were unverifiable Rust; they now at least compile.
**They are still not device-tested** — compilation is not correctness.

### Conversation list: "Preview not available" for every photo, album and voice message
`src/lib/model/message.ts`

`previewFromMessage` returned `text: null` from *every* non-`Text` branch, so
`Conversation.svelte` fell through to its italic "Preview not available" for all
of them, and its `preview.imageHash` / `preview.albumId` branches were dead code.
Now every renderable type gets a real label, and the two types that genuinely
have no preview (`Retract`, `Unknown`, `Generative`) still return `null` rather
than an invented string.

The interrupted edit also added `case "Tap"`, which is **not a member of the
message union** — it was the 1 type error. Removed; labelling is derived from
the type name and the schema body, not invented. `ProfileLink` / `VideoCall`
bodies are `z.unknown()`, so those are labelled from the type name only.

**21 tests** (was 0 for this function), built by parsing through
`apiResponseMessageSchema` so they also pin the body shapes the switch reads.
**Verified to catch the bug**: restoring the old all-`null` behaviour fails 11 of
them and nothing else.

### The day separator could show a bare weekday for a date that has not happened
`src/lib/utils/day-group.ts` (new) + `MessageDateGroup.svelte`

```js
startOfToday().getTime() - dayStart < 7 * 24 * 60 * 60 * 1000 ? weekday : date
```

Two defects: a **future** `dayStart` makes the difference negative, and negative
is `< 7 days`, so a future day rendered as a bare weekday with no date; and
168 fixed hours is the wrong width across a DST change. Now
`differenceInCalendarDays`, which is calendar-based and has a natural lower
bound.

The DST test stubs `TZ=America/New_York` (via `vi.stubEnv`, not `process.env`,
which this tsconfig does not type) because **this host is UTC and the defect is
unobservable here** — the test asserts the real 157h/181h spans so the
transition is genuinely exercised. **Verified to catch the bug**: the old logic
fails 2 of 6.

> Caught while writing it: `startOfToday(x)` in date-fns v4 **ignores its
> argument** and always returns the real current day. The first version of the
> helper passed `now` to it, making the parameter a silent no-op.

### Stale comment, and a deliberate decision left alone
`preferences.svelte.ts` claimed the file was "written non-atomically (truncate +
write)". That stopped being true in v0.1.28 — `writeAppDataFile` is temp+rename.
The comment is corrected. The `unreadable → skip write` guard it justifies is
**left as-is, with its trade-off now stated**: because writes are atomic, an
unreadable file is not a transient race, so that guard is *sticky* — while the
file stays undecodable, **every** `setPreferences` call is dropped and settings
never persist again. That is a real trade-off, protected by a deliberate
REGRESSION test; changing it is a product call, not a cleanup. **Flagged, not
changed.**

### FLAG_SECURE — the recents thumbnail no longer captures the screen
`src-tauri/gen/android/.../MainActivity.kt`

Set `FLAG_SECURE` on the window in `onCreate`. Without it the OS captures the
current screen into the recents/multitasker thumbnail and permits screenshots
and screen recording; this app shows chat text, profile photos, album photos and
precise location by design. On the window, so it also covers the WebView
surface and cannot be sidestepped by the page rendering its own canvas.

⚠️ **UNVERIFIED — the Kotlin was not compiled on the M1 in this batch.** It is a
5-line, API-stable change, but "not compiled" is exactly the mistake batch 5
made. It is included in the M1 build below; see the build log.

### Verification

- `svelte-check` **0 errors** / 30 warnings (baseline)
- `eslint` clean on every changed file
- `prettier --check` clean on every changed file
- `vitest` **220 → 244** (25 → 26 files)
- `cargo test --lib` **3/3** (first successful run in this version's history)
- `cargo check --all-targets` **0 errors, 0 warnings**

**Not done here:** H19 msgpack depth guard, CSP `unsafe-inline` nonce
verification, the M1 APK build + signing (separate step, see SESSION_STATE).

---

## The M1 build — v0.1.33 signed and verified

Built on the operator's M1 Mac (arm64, macOS 26.5.2) over Tailscale SSH, because
the OVH host cannot: its Nix androidenv fails to resolve the Tauri plugin
projects (`No matching variant of project :tauri-plugin-biometric`), and
`cargo` was not on `PATH` at all.

**Toolchain (all newly provisioned on the M1):**
- Rust **1.95.0** via the existing rustup — the exact pinned version; added the
  four Android targets (`aarch64-linux-android`, `armv7-linux-androideabi`,
  `i686-linux-android`, `x86_64-linux-android`).
- Android SDK: NDK **27.0.12077973** (exact pin), platform-36, build-tools
  35.0.0, cmake 3.22.1.
- **Temurin JDK 21** — see below.
- bun 1.3.x, `bun install` 293 packages.

**The JDK 25 rejection is real and reproducible.** The M1's default JDK is
Temurin 25, and AGP 8.13.2 refuses it at configuration time with a bare,
very unhelpful message:

```
A problem occurred configuring project ':buildSrc'.
> 25.0.2
```

That is the entire error. Temurin 21 is installed at `~/jdks/jdk-21.0.12.1+1`
and `JAVA_HOME` must point at it or the build cannot start. `build.gradle.kts`
already targets `sourceCompatibility/targetCompatibility = 17`, so 21 is the
right ceiling.

### Artifact

| | |
|---|---|
| File | `GrindrX-v0.1.33.apk` (universal release, **70,909,248 B**) |
| SHA-256 | `054576d5e081096a2aff4a2106f3e6d7fb468ad4ce7cdc997fee26d01956a75d` |
| versionName / versionCode | **0.1.33** / **1067** |
| minSdk / targetSdk | 28 / 36 |
| ABIs | arm64-v8a, armeabi-v7a, x86, x86_64 |
| Signature | v2 scheme, 1 signer, CN=GrindX |
| Cert SHA-256 | `22d6889ef07459a20919d48afffe7ed7a4e3903039e15542767cedcdff8d4c01` |

⚠️ **On `versionCode`.** `autoIncrementVersionCode: true` **overrides** the
`versionCode` in `tauri.conf.json` — setting it to 1090 produced **1067**. The
published history increments by exactly 1 per release (0.1.26→1059 …
0.1.32→**1065**), and 1067 is higher, so this is a valid in-place upgrade. But
**each `tauri android build` invocation consumes a versionCode**: the first run
(drowned by the JDK failure) burned 1066. Do not assume the config value is what
ships — read it back with `aapt2 dump badging` and compare against the last
release before installing.

**The cert is unchanged (`22d6…4c01`)**, so this installs over v0.1.32 without a
uninstall — verified on both hosts, not just the build host (R22).

### FLAG_SECURE is now compiled

The batch-8 note flagged the Kotlin as UNVERIFIED. It no longer is:
`build/tmp/kotlin-classes/universalRelease/org/opengrind/MainActivity.class`
exists in the build output, and `setFlags` is present in the APK's dex string
table. A Kotlin syntax or type error would have failed the build; it did not.

### Still not verified

**None of this is device-tested.** The APK builds, is signed by the right key
and carries the right version — that is a compile-time claim, not a behavioural
one. Everything in batches 5-7 that was "structurally checked only" is now
*compiled*, which is strictly better and still not the same as *run*. The Rust
security fixes (WS logout epoch, `ws_send` serde key, response cap, i64 error
code, keyring off the async runtime), the album multipart upload, the
notification `prefs_loaded` gate and the `allowBackup`/data-extraction rules all
need a real device before release.

---

## Batch 9 (same version) — H19: the msgpack depth guard, shipped this time

The one item batch 5 explicitly refused to ship. It is now written **and**
mutation-tested. `src/api/msgpack_depth.rs` (new), wired into all four inbound
msgpack decode sites in `rest.rs` (2 request bridges + 2 `request`/
`request_public` payload decoders).

**Why a byte cap is not enough:** a 1-element array is one byte (`0x91`), a
1-element map is one byte (`0x81`), an empty string is one byte (`0xa0`). An
8 MB body — well under `MAX_REQUEST_PAYLOAD_BYTES` — can therefore encode
**~8 million levels of nesting**. `rmp_serde` has no recursion limit, and
decoding that overflows the stack. A Rust stack overflow **aborts the process**;
it is not an `Err`, so it cannot be caught, cannot become an `ApiHttpError`, and
takes down the app rather than failing one request. That is why this is a
crash, not a bug report.

`MAX_DEPTH = 64`. The walker recurses but checks the limit **before**
descursing, so its own recursion is bounded at 65 frames and it cannot itself
be the thing that overflows.

**It counts nesting DEPTH, not containers** — the mistake that made the previous
attempt unusable. A map entry counts as **one** level (key and value are both at
`d+1`, not `d+2`), and map **keys** are walked too, since msgpack permits a
container as a key and a deep key overflows a decoder's stack just as well as a
deep value.

**14 tests**, fixtures generated by `rmp_serde` itself rather than hand-rolled
bytes, so "valid" means *known*-valid. Covers: real encoded values, 500 siblings
at one level (the regression), depth exactly at/over the limit, **1,000,000
levels in 1 MB**, deep nesting inside maps, deep containers as map keys, map
entries counting as one level, every array/map header width, every scalar and
ext width, `0xc1`, truncated payloads (must be `Err`, never a panic), and a
4 GB claimed length that must not wrap the cursor.

**Mutation-tested, twice** — because "the tests pass" proves nothing on their own:
- guard stubbed to a no-op → **9 of 14 fail**
- guard counting containers per level (the original bug) → **`accepts_a_wide_but_shallow_payload` fails**, which is precisely the test that exists to catch it

A test suite that cannot fail when the guard is removed is not evidence, and the
reason this guard was removed the first time is that nobody could tell whether it
was working.

**Verification:** `cargo test --lib` **17 passed** (was 3) ·
`cargo check --all-targets` **0 errors, 0 warnings** · vitest 244 ·
svelte-check 0 errors.

---

## The CSP `unsafe-inline` question — resolved (the answer is: it is required)

Batch 5 deliberately left `'unsafe-inline'` on `script-src` and deferred the
question, because getting it wrong "blanks the app at launch". That is now
settled with evidence rather than caution. Inspecting the **actually built**
`index.html` on the M1 (not the source template):

```
$ grep -o "<script[^>]*>" build/index.html
<script>            <- inline, no src=, no nonce
$ grep -c nonce build/index.html
0
```

There is exactly **one** script tag, it is **inline**, and it carries **no
nonce**. It is SvelteKit's hydration script. So `script-src 'self'` alone would
block it and the app would fail to boot — batch 5's caution was correct, and
`'unsafe-inline'` is load-bearing **today**.

**Why it cannot simply be removed.** The two halves want different things:
Tauri owns the CSP (`app.security.csp` in `tauri.conf.json`) and nonces the
scripts *it* injects, while the nonced-by-nobody inline script is emitted by
**SvelteKit** as part of the built asset. SvelteKit's own nonce support
(`kit.csp.mode: 'nonce'`) makes *SvelteKit* generate a CSP header, which Tauri
then overrides. Making these cooperate means letting SvelteKit emit the policy
and folding Tauri's directives into it — or hashing the inline script. Both are
real changes, and either one that is subtly wrong produces a **blank app at
launch**, so it needs a device to confirm, not a static check.

Also note `dangerousDisableAssetCspModification: ['style-src']`, which is why
`style-src 'unsafe-inline'` is likewise expected. That flag is load-bearing for
the same reason and should not be flipped casually.

**Status: the open question is closed, the hardening is not done.** The next
step is a device-verified attempt at `kit.csp.mode: 'nonce'`, and it must ship
as its own batch so it can be reverted independently — a failed attempt blanks
the app, which is the worst possible regression to bisect into a security batch.
