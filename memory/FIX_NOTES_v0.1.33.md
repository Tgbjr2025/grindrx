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
