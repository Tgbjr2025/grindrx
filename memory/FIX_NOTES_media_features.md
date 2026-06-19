# FIX_NOTES — media compat + features + grid windowing (post-v0.1.9)

Operator: **Tom**. Branch: `audit/v0.1.9-fixes`. **NOT pushed** (R11). Version stays **0.1.9**
(these commits did not bump it). Created 2026-06-18 03:58 UTC. Updated 2026-06-18 04:16 UTC (added
section 4: the in-flight UNCOMMITTED audit fixes).

> Covers three commits landed after the v0.1.9 icon ship: `eaf60dc`, `1d09c10`, `03f88f2` (HEAD),
> PLUS (section 4) the uncommitted audit fixes sitting in the dirty working tree as of 04:16 UTC.
> Rollback reference point for the committed batch is the v0.1.9 state at `d3c0392` (icon ship).
> There is no dedicated rollback tag for these media/feature commits, nor for the uncommitted
> section-4 changes — if a ship is needed, tag before it (R9).

---

## 1. Media compat — commit `eaf60dc` (2026-06-13)
"media compat: CSP allow CloudFront, tolerate conversation/profile drift, direct signed-URL loads,
album thumb-probe, graceful saved-photo send"

- **CSP allow CloudFront (the key fix that made images/albums actually display):** `tauri.conf.json`
  CSP now lists `https://*.cloudfront.net` in `connect-src`, `img-src`, and `media-src`. Grindr serves
  media via CloudFront; without this the WebView blocked the loads and images/albums were blank.
- **Tolerate conversation/profile schema drift:** `api/messages.ts` + `api/index.ts` parse more
  defensively so a drifted conversation or profile record degrades gracefully instead of erroring.
- **Direct signed-URL image loads:** new helper in `utils/authed-image.ts`; signed CDN URLs load
  directly rather than going through the authed-fetch path where possible.
- **Album thumb-probe:** `AlbumMessage.svelte` / `AlbumPicker.svelte` probe album thumbnails.
- **Graceful saved-photo send:** sending a saved/profile photo no longer hard-crashes when the API
  returns 400 — it degrades. (The underlying 400 is still open — see Open issues.)
- Files: `tauri.conf.json`, `api/index.ts`, `api/messages.ts`, `utils/authed-image.ts`,
  `chat/[conversationId]/AlbumPicker.svelte`, `chat/[conversationId]/message/AlbumMessage.svelte`.

## 2. Three features + map-tile CSP — commit `1d09c10` (2026-06-13)
"feat(grid/profile/explore): pull-to-refresh + refresh button, swipe between profiles,
Explore-location; map-tile CSP"

- **Pull-to-refresh + refresh button** on the grid (root page): new `stores/grid-order.svelte.ts`,
  reworked `Grid.svelte` / `+page.svelte` / `TopBar.svelte`.
- **Swipe between profiles** on the profile page (`profile/[profileId]/+page.svelte`).
- **Explore-location:** browse a remote/chosen location instead of your own; new
  `stores/explore-location.svelte.ts`, plus `LocationChooser` / `GeoMapPicker` / `LocationChange`
  wiring and map page (`map/+page.svelte`).
- **Map-tile CSP:** `img-src` now also allows OpenStreetMap + Carto basemap hosts
  (`https://tile.openstreetmap.org`, `https://*.tile.openstreetmap.org`,
  `https://*.basemaps.cartocdn.com`) so the radar/map tiles render.
- Files: as above + `ChatNavBar.svelte`, `chat/conversations.svelte.ts`, `tauri.conf.json` (CSP).

## 3. Grid viewport windowing — commit `03f88f2` (2026-06-18, HEAD)
"perf(grid): viewport windowing to bound image memory (fix WebView freeze)"

- The cascade grid could **freeze the WebView** once enough profile images accumulated in memory.
- Added **viewport windowing:** new `GridWindow.svelte` (~189 LOC) + reworked `Grid.svelte`; mounts
  only the cards near the viewport and unmounts off-screen ones so their images release memory,
  bounding total image memory.
- **Status: ADDED, NOT yet field-verified on-device.** Next agent should confirm the freeze is gone
  on the S26 Ultra under heavy scrolling.

## 4. In-flight audit fixes — UNCOMMITTED (in the dirty tree as of 2026-06-18 04:16 UTC)

These are NOT yet committed — they sit in the working tree of `audit/v0.1.9-fixes`, made by
concurrent audit tasks. Each was verified against `git diff` at 04:16 UTC. NO rollback tag exists for
them; tag + write a ship FIX_NOTES before committing/shipping (R9/R10). A doc agent did not author
these — they are tracked here for the next session.

- **`src-tauri/src/api/rest.rs` — "FIX 13": session-token leak hardening in `fetch_authed_bytes`.**
  (a) Reject any non-`https` URL *before* attaching the `Authorization` header — a caller-supplied
  `http://...grindr.com/...` URL would otherwise transmit the user's Grindr session token in
  cleartext (the host allowlist alone does not constrain the scheme). (b) Perform the fetch with a
  dedicated `reqwest` client built `redirect(Policy::none())` (and matching 30s/10s timeouts) so a
  30x redirect to an off-allowlist host or to `http://` cannot re-send the Authorization header —
  reqwest does not strip auth across cross-origin redirects. Falls back to the shared client if the
  builder fails. New import: `reqwest::redirect::Policy`.
- **`src/lib/api/album.ts` — album-share-doesn't-unlock fix.** `shareAlbum` now POSTs to
  `/v4/albums/{albumId}/shares` with `{ profiles: [{ profileId, expirationType }] }`, which GRANTS
  the recipient view access AND auto-delivers the shared-album message into chat. The previous
  implementation posted a raw `Album`/`ExpiringAlbumV2` chat message via `/v4/chat/message/send`,
  which only references the album and never registers a share grant — so on the recipient's side
  `isViewable` was false and the album rendered **locked**. Going through `/shares` is what actually
  entitles the recipient to unlock it. The endpoint returns an empty body (no `messageId`); the real
  chat message arrives over the WS `chat.v1.message_sent` event and is reconciled by ConversationState,
  so `shareAlbum` returns a synthetic `messageId` to satisfy the existing caller contract. Removed
  now-unused `AlbumExpiration` / `apiResponseMessageSchema` imports and the `expiresAtMs` helper.
- **`src/lib/api/messages.ts` — cleanup.** Removed the dead `unixTimestampMsSchema` import (imported
  but never referenced; message-timestamp parsing lives in `$lib/model/message`).
- **`src/routes/(protected)/(navbar)/(root)/grid-state.svelte.ts` — Explore-location routing fix.**
  Adds a distinct `#exploreGeohash` that maps to the dedicated `exploreGeoHash` cascade param rather
  than overloading `nearbyGeoHash`. Routing the remote area through `nearbyGeoHash` made the server
  treat the remote point as the user's own location (wrong distances, bypassed explore aggregation).
  `load` / `refresh` / `#fetchProfiles` now thread `exploreGeohash`, and the cache key combines both
  so toggling Explore or switching areas refetches.
- **`src/routes/(protected)/chat/[conversationId]/conversation-state.svelte.ts` — WS-leak +
  self-read fixes.** Store the WS connect/disconnect listeners as *promises* (not resolved unlisten
  fns) so `destroy()` can await + unlisten even if it runs before `listen()` settles (previously a
  listener leak when destroy ran before the listen promise resolved). Plus a guard so an incoming
  `message_sent` from our own profile does not generate a self read-receipt (mirrors the
  `#reconcileMessages` guard).

> Also still dirty (unchanged, dirty ON PURPOSE): the 2 machine-specific gradle autogen files
> (`tauri.settings.gradle`, `tauri.build.gradle.kts` — `/home/ubuntu/...` paths), and the TEMP
> `[diag-mediaid]` probe in `src/lib/api/profile.ts`.

---

## Open issues these commits address or leave open

1. **App freeze under image memory** — windowing added (`03f88f2`); VERIFY on-device. Intermittent
   WebView memory pressure under heavy media may persist.
2. **Saved-photo send 400** — root cause: **Grindr removed the usable `mediaId`** from
   `/v3.1/me/profile/images`. `eaf60dc` made the send fail gracefully; the **TEMP `[diag-mediaid]`
   probe** currently uncommitted in `src/lib/api/profile.ts` is a one-shot console probe trying
   `/v4/me/profile/images`, `/v3/me/profile/images`, `/v4.1/me/profile/images`, `/v4/me/profile` to
   find an endpoint that still returns a usable mediaId. **Still open — pending the real mediaId
   source.** Remove the probe once root-caused.
3. **Album-share doesn't unlock for the recipient** — **FIX IN PROGRESS (uncommitted, section 4):**
   `album.ts` now grants via `/v4/albums/{id}/shares`. Not yet committed or field-verified.
4. **WS DNS flakiness on cellular / Tailscale drops** — WebSocket DNS resolution unreliable over
   cellular/mobile data (works on Wi-Fi); reconnect/backoff exists but DNS resolution itself is the
   weak point. Separately, the S26 Ultra **keeps dropping off Tailscale**, which blocks adb installs
   — confirm the phone is online first. **Open.**

## Validation / notes
- No version bump (still 0.1.9). NOT pushed (R11). No signing (R22).
- CSP changes verified present in `src-tauri/tauri.conf.json` (CloudFront + OSM/Carto + grindr CDN).
- Section-4 changes verified against `git diff` @ 2026-06-18 04:16 UTC (uncommitted).
- **Concurrency:** as of 2026-06-18 other agents are editing the code (Rust/chat/albums/grid) in
  parallel; the dirty set may already have follow-up fixes or be committed. Re-probe `git log`/`git
  status`/`git diff` before trusting this (R7).
