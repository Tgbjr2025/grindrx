# Domain 4: API, Protocol & Data-Contract Inventory

**Repository:** `/srv/projects/grindrx-work` at commit `7fffcec`, branch `main`
**Measurement Date:** 2026-10-09
**Agent:** MEASUREMENT (Domain 4)
**Status:** Observational only — no source modifications

---

## 1. HTTP Endpoints (via `fetchRest` bridge)

All HTTP calls route through the generic `fetchRest(path, options)` bridge in `$lib/api/index.ts`, which msgpack-encodes the request envelope and sends it via the Tauri `request` (authenticated) or `request_public` (unauthenticated) commands. The Rust bridge (`src-tauri/src/api/rest.rs`) validates paths against `is_safe_api_path()` (must start with `/vN` or `/vN.M`), enforces an HTTP verb allow-list (GET, POST, PUT, PATCH, DELETE), and caps request/response bodies.

**Authentication:** All endpoints via `request` require a valid Grindr session (Bearer token `Grindr3 <jwt>`). Endpoints via `request_public` are for pre-session flows (account creation, password reset) and carry no Authorization header.

### 1.1 Auth & Session Endpoints (Verified in Source)

| Method | Path | Auth | Bridge | Source File | Notes |
|--------|------|------|--------|-------------|-------|
| POST | `/v8/sessions` | ❌ (pre-session) | `request_public` | `src-tauri/src/api/auth.rs:200` | Login via `GrindrClient::login()` |
| POST | `/v8/sessions` | ❌ (pre-session) | `request_public` | `src-tauri/src/api/auth.rs:284` | Token refresh via `GrindrClient::refresh_token()` |
| POST | `/v3/users/forgot-password` | ❌ (pre-session) | `request_public` | `src/lib/api/auth-contract.ts:46` | **Single password-reset path** (reconciled) |
| POST | `/v1/accounts` | ❌ (pre-session) | `request_public` | `src/lib/api/auth-contract.ts:60` | Account registration — **UNVERIFIED** |

### 1.2 Profile & Grid Endpoints

| Method | Path | Auth | Bridge | Source File | Notes |
|--------|------|------|--------|-------------|-------|
| GET | `/v7/profiles/{profileId}` | ✅ | `request` | `src/lib/api/profile.ts:57` | Single profile detail |
| POST | `/v3/profiles` | ✅ | `request` | `src/lib/api/profile.ts:102` | Batch profiles (up to 150 ids) |
| GET | `/v4/me/profile` | ✅ | `request` | `src/lib/api/profile.ts:125` | Current user's profile |
| GET | `/v3.1/me/profile/images` | ✅ | `request` | `src/lib/api/profile.ts:175` | Uploaded profile photos (public hashes) |
| PUT | `/v3/me/profile/images` | ✅ | `request` | `src/lib/api/profile.ts:689` | Set primary/secondary photos |
| GET | `/v3/cascade` | ✅ | `request` | `src/lib/api/grid.ts:42` | Main grid (v3 cascade) |
| GET | `/v7/search` | ✅ | `request` | `src/lib/api/grid.ts:11` | Profile tag search |

### 1.3 Chat & Messaging Endpoints

| Method | Path | Auth | Bridge | Source File | Notes |
|--------|------|------|--------|-------------|-------|
| POST | `/v4/chat/message/send` | ✅ | `request` | `src/lib/api/messages.ts:159` | Send text/image/location |
| POST | `/v4/chat/message/reaction` | ✅ | `request` | `src/lib/api/messages.ts:255` | React to message |
| POST | `/v4/chat/message/delete` | ✅ | `request` | `src/lib/api/messages.ts:276` | Delete for me |
| POST | `/v4/chat/message/unsend` | ✅ | `request` | `src/lib/api/messages.ts:298` | Unsend (both sides) |
| GET | `/v5/chat/conversation/{conversationId}/message` | ✅ | `request` | `src/lib/api/messages.ts:135` | Paginated messages |
| POST | `/v4/inbox` | ✅ | `request` | `src/lib/api/conversation.ts:28` | Conversation list |
| POST | `/v4/chat/conversation/{conversationId}/read/{messageId}` | ✅ | `request` | `src/lib/api/conversation.ts:44` | Mark read |
| DELETE | `/v4/chat/conversation/{conversationId}` | ✅ | `request` | `src/lib/api/conversation.ts:59` | Delete conversation |

### 1.4 Media Upload Endpoints (Dedicated Tauri Commands)

These do **not** go through `fetchRest` — they are dedicated Tauri commands that build multipart or raw binary bodies.

| Command | Server Endpoint | Auth | Purpose |
|---------|-----------------|------|---------|
| `upload_image` | `POST /v5/chat/media/upload` | ✅ | Chat media (returns numeric `mediaId`) |
| `upload_profile_image` | `POST /v4/media/upload` | ✅ | Profile photos (returns public `hash`) |
| `upload_album_content` | `POST /v1/albums/{albumId}/content` | ✅ | Album content (multipart) |

### 1.5 Album Endpoints

| Method | Path | Auth | Bridge | Source File | Notes |
|--------|------|------|--------|-------------|-------|
| GET | `/v2/albums/{albumId}` | ✅ | `request` | `src/lib/api/album.ts:79` | Album content (viewing surface) |
| GET | `/v1/albums` | ✅ | `request` | `src/lib/api/album.ts:99` | User's album list (management surface) |
| POST | `/v2/albums` | ✅ | `request` | `src/lib/api/album.ts:228` | Create album |
| PUT | `/v2/albums/{albumId}` | ✅ | `request` | `src/lib/api/album.ts:256` | Rename album |
| DELETE | `/v1/albums/{albumId}` | ✅ | `request` | `src/lib/api/album.ts:273` | Delete album |
| POST | `/v1/albums/{albumId}/content` | ✅ | `upload_album_content` | `src/lib/api/album.ts:305` | Add content (multipart) |
| DELETE | `/v1/albums/{albumId}/content/{contentId}` | ✅ | `request` | `src/lib/api/album.ts:340` | Remove content |
| GET | `/v1/albums/{albumId}/shares` | ✅ | `request` | `src/lib/api/album.ts:379` | List viewers |
| PUT | `/v1/albums/{albumId}/unshares` | ✅ | `request` | `src/lib/api/album.ts:412` | Revoke viewer |
| POST | `/v4/albums/{albumId}/shares` | ✅ | `request` | `src/lib/api/album.ts:143` | Share album (grants access + sends chat message) |

### 1.6 Blocks / Hides / Favorites / Notes

| Method | Path | Auth | Bridge | Source File |
|--------|------|------|--------|-------------|
| POST | `/v3/me/blocks/{profileId}` | ✅ | `request` | `src/lib/api/block.ts:28` |
| DELETE | `/v3/me/blocks/{profileId}` | ✅ | `request` | `src/lib/api/block.ts:36` |
| POST | `/v1/me/hides/{profileId}` | ✅ | `request` | `src/lib/api/hide.ts:88` |
| DELETE | `/v1/hides/{profileId}` | ✅ | `request` | `src/routes/(protected)/(navbar)/settings/(subpage)/account/hidden/+page.svelte:59` |
| GET | `/v1/hides` | ✅ | `request` | `src/routes/(protected)/(navbar)/settings/(subpage)/account/hidden/+page.svelte:45` |
| DELETE | `/v1/hides` | ✅ | `request` | (unhide all) |
| GET | `/v1/favorites/notes/{profileId}` | ✅ | `request` | `src/lib/api/favorites-notes.ts:60` |
| PUT | `/v1/favorites/notes/{profileId}` | ✅ | `request` | `src/lib/api/favorites-notes.ts:85` |
| DELETE | `/v1/favorites/notes/{profileId}` | ✅ | `request` | `src/lib/api/favorites-notes.ts:100` |

### 1.7 Taps & Views (Engagement) — **UNVERIFIED**

| Method | Path | Auth | Bridge | Source File | Status |
|--------|------|------|--------|-------------|--------|
| POST | `/v2/taps/add` | ✅ | `request` | `src/lib/api/taps.ts:40` | Send tap |
| GET | `/v2/taps/received` | ✅ | `request` | `src/lib/api/taps.ts:85` | Received taps — **UNPROBED** |
| GET | `/v7/views/list` | ✅ | `request` | `src/lib/api/view.ts:68` | Who viewed me — **UNPROBED** |
| POST | `/v5/views/{profileId}` | ✅ | `request` | `src/lib/api/view.ts:94` | Record view (fire-and-forget) — **UNPROBED** |

### 1.8 Reports / Safety — **UNVERIFIED**

| Method | Path | Auth | Bridge | Source File | Status |
|--------|------|------|--------|-------------|--------|
| GET | `/v5/flags/{profileId}` | ✅ | `request` | `src/lib/api/report.ts:159` | Profile report state — **UNVERIFIED** |
| POST | `/v5/flags/{profileId}` | ✅ | `request` | `src/lib/api/report.ts:96` | Report profile — **UNVERIFIED** |
| GET | `/v1/flags/right-now/{postId}` | ✅ | `request` | `src/lib/api/report.ts:155` | Right-now report state — **UNVERIFIED** |
| POST | `/v1/flags/right-now/{postId}` | ✅ | `request` | `src/lib/api/report.ts:129` | Report right-now post — **UNVERIFIED** |

### 1.9 Preferences / Settings

| Method | Path | Auth | Bridge | Source File |
|--------|------|------|--------|-------------|
| GET | `/v3/me/prefs/settings` | ✅ | `request` | `src/lib/api/prefs.ts:23` |
| PUT | `/v3/me/prefs/settings` | ✅ | `request` | `src/lib/api/prefs.ts:37` |

### 1.10 Reference Data (Public, Cached)

| Method | Path | Auth | Bridge | Source File | Cache |
|--------|------|------|--------|-------------|-------|
| GET | `/public/v2/genders` | ❌ | `request_public` | `src/lib/api/genders.ts:9` | In-memory |
| GET | `/v1/pronouns` | ❌ | `request_public` | `src/lib/api/pronouns.ts:11` | In-memory |
| GET | `/v1/tags` | ❌ | `request_public` | `src/lib/api/tags.ts:75` | None |
| GET | `/v3/places/search` | ❌ | `request_public` | `src/lib/api/places.ts:18` | None |

### 1.11 Assignments / Analytics — **UNVERIFIED**

| Method | Path | Auth | Bridge | Source File | Status |
|--------|------|------|--------|-------------|--------|
| GET | `/v3/assignment?geohash={coarse}` | ✅ | `request` | `src/lib/api/assignment.ts:115` | **UNPROBED** |

### 1.12 Media Fetch (Dedicated Tauri Commands)

| Command | Purpose | Auth | Host Allowlist |
|---------|---------|------|----------------|
| `fetch_authed_bytes` | Grindr-hosted images (bearer token) | ✅ | `grindr.com`, `grindr.mobi` (eTLD+1) |
| `fetch_media_bytes` | Signed CDN URLs (CloudFront, no token) | ❌ | `grindr.com`, `grindr.mobi`, `cloudfront.net` |

### 1.13 Telemetry / Stats (Public, No Auth)

| Command | URL | Purpose |
|---------|-----|---------|
| `fetch_latest_release` | `https://api.github.com/repos/Tgbjr2025/grindrx/releases/latest` | In-app update banner |
| `fetch_download_stats` | GitHub + Forgejo releases | Download counters |
| `fetch_active_users` | `https://cam.dominusaxis.com/grindrx/stats` | Active user aggregate |
| `send_usage_ping` | `https://cam.dominusaxis.com/grindrx/ping` | Anonymous install ping |

### 1.14 Deprecated / Removed Endpoints

- **`/v1/accounts/password/reset`** — Removed. Was a non-existent path introduced in original import. Replaced by `/v3/users/forgot-password` via single `request_public` transport.
- **`forgot_password` Tauri command** — Removed. Duplicated the password-reset transport.

---

## 2. Tauri / Native Commands (Registered in `src-tauri/src/lib.rs`)

Registered via `invoke_handler!(tauri::generate_handler![...])` in `lib.rs:89-112`.

| Command | Module | Handler | Frontend Call Sites | Status |
|---------|--------|---------|---------------------|--------|
| `login` | `api::auth` | `auth::login` | `$lib/api/index.ts:callMethod` | ✅ Called |
| `refresh_token` | `api::auth` | `auth::refresh_token` | `$lib/api/index.ts:callMethod` | ✅ Called |
| `logout` | `api::auth` | `auth::logout` | `$lib/api/index.ts:725` (handleSessionLost) | ✅ Called |
| `auth_state` | `api::auth` | `auth::auth_state` | `$lib/api/index.ts:callMethod`, `hooks.client.ts`, layouts | ✅ Called |
| `request` | `api::rest` | `rest::request` | `$lib/api/index.ts:invokeRest` (all authed REST) | ✅ Called |
| `request_public` | `api::rest` | `rest::request_public` | `$lib/api/index.ts:invokeRest` (pre-session) | ✅ Called |
| `upload_image` | `api::rest` | `rest::upload_image` | `$lib/api/profile.ts:289` | ✅ Called |
| `upload_profile_image` | `api::rest` | `rest::upload_profile_image` | `$lib/api/profile.ts:635` | ✅ Called |
| `upload_album_content` | `api::rest` | `rest::upload_album_content` | `$lib/api/album.ts:305` | ✅ Called |
| `fetch_authed_bytes` | `api::rest` | `rest::fetch_authed_bytes` | `$lib/utils/authed-image.ts` | ✅ Called |
| `fetch_media_bytes` | `api::rest` | `rest::fetch_media_bytes` | `$lib/utils/authed-image.ts` | ✅ Called |
| `fetch_latest_release` | `api::rest` | `rest::fetch_latest_release` | `$lib/api/usage.ts:72` | ✅ Called |
| `fetch_download_stats` | `api::rest` | `rest::fetch_download_stats` | `$lib/api/usage.ts:72` | ✅ Called |
| `fetch_active_users` | `api::rest` | `rest::fetch_active_users` | `$lib/api/usage.ts:77` | ✅ Called |
| `send_usage_ping` | `api::rest` | `rest::send_usage_ping` | `$lib/api/usage.ts:41`, `$lib/api/usage.ts:70` | ✅ Called |
| `open_external_url` | `api::openurl` | `openurl::open_external_url` | `$lib/api/open-url.ts:28` | ✅ Called |
| `set_foreground` | inline | `set_foreground` | `src/routes/+layout.svelte:95` | ✅ Called |
| `set_notification_prefs` | inline | `set_notification_prefs` | `$lib/api/notifications.ts:14` | ✅ Called |
| `set_app_locked` | inline | `set_app_locked` | `$lib/api/app-lock-gate.ts` | ✅ Called |
| `ws_connect` | `api::ws` | `ws::ws_connect` | `$lib/ws.svelte.ts:150` | ✅ Called |
| `ws_send` | `api::ws` | `ws::ws_send` | `$lib/ws.svelte.ts:179` | ✅ Called |
| `rotate_api_params` | `api::client` | `client::rotate_api_params` | (No frontend caller found) | ⚠️ **DEAD** |

### 2.1 Dead / Unused Tauri Commands

| Command | Reason |
|---------|--------|
| `rotate_api_params` | Registered in `lib.rs:111` but **no frontend `invoke("rotate_api_params")` call site found**. Device rotation happens automatically on `login`/`logout` via `bump_ws_epoch()`. |

### 2.2 Commands Called But Not Registered

**None found.** All frontend `invoke()` calls match a registered command.

---

## 3. WebSocket Events

### 3.1 Server → Client Events (Observed in `src-tauri/src/api/ws.rs`)

The Rust WS client connects to `wss://grindr.mobi/v1/ws`, authenticates with `Authorization: Grindr3 <session_id>`, and emits every parsed frame as a Tauri event `grindr:{type_with_dots_replaced_by_underscores}`.

**Event names emitted by Rust (from `ws.rs:293`):**
- `grindr:chat_v1_message_sent` — Incoming chat message
- `grindr:chat_v1_conversation_delete` — Conversation deleted
- `grindr:chat_v1_typing_start` — Typing indicator start
- `grindr:chat_v1_typing_stop` — Typing indicator stop
- `grindr:tap_v1_tap_sent` — Incoming tap

**Additional events emitted by Rust:**
- `ws:connected` — Socket connected (emitted at `ws.rs:201`)
- `ws:disconnected` — Socket disconnected (emitted at `ws.rs:82,87`)
- `ws:ws_error` — WebSocket error string (emitted at `ws.rs:126`)
- `notification:posted` — Notification posted with `conversationId` (emitted at `ws.rs:543`)

### 3.2 Client → Server Commands (via `ws_send`)

Sent from frontend via `ws.send(type, payload)` → `invoke("ws_send", { command: { type, ref_id, payload }})`.

**Documented command types (from `ws.svelte.ts:52-57` and `ws.rs:41-54`):**
- `chat.v1.message_sent` — Not used (client sends via REST)
- Typing indicators — Not yet implemented in frontend

### 3.3 Frontend Event Listeners (from `$lib/ws.svelte.ts`)

| Event | Schema | Handler | Status |
|-------|--------|---------|--------|
| `ws:connected` | `void` | Sets `status = "connected"` | ✅ Active |
| `ws:disconnected` | `void` | Sets `status = "disconnected"` | ✅ Active |
| `ws:ws_error` | `string` | `console.error` | ✅ Active |
| `grindr:chat_v1_message_sent` | `chatV1MessageSentEventSchema` | `coerceApiResponseMessage` → conversation state | ✅ Active |
| `grindr:chat_v1_conversation_delete` | `chatV1ConversationDeleteEventSchema` | Conversation deletion | ✅ Active |
| `grindr:chat_v1_typing_start` | `chatV1TypingStartEventSchema` | Typing indicator | ✅ Active |
| `grindr:chat_v1_typing_stop` | `chatV1TypingStopEventSchema` | Typing indicator | ✅ Active |

### 3.4 WebSocket Event Chain Status

| Link | Status | Evidence |
|------|--------|----------|
| Server frame → Rust parse → `grindr:*` emit | ✅ Verified in source | `ws.rs:286-294` |
| `grindr:*` emit → Tauri event → Frontend `listen()` | ✅ Verified in source | `ws.svelte.ts:187-236` |
| Frontend schema validation → handler | ✅ Verified in source | `ws.svelte.ts:193-199` |
| Schema mismatch → logged, not dropped | ✅ Verified in source | `ws.svelte.ts:199-234` |
| `ws:connected`/`disconnected` → UI state | ✅ Verified in source | `ws.svelte.ts:112-121` |
| Background notification gating (lock/prefs) | ✅ Verified in source | `ws.rs:463-508` |
| **Live server behaviour** | ❌ **UNVERIFIED** | No live probe possible |

### 3.5 Dead / Mismatched Listeners

**None found.** All registered listeners have matching Rust emits. The speculative events `chat.v1.message_reaction`, `chat.v1.message_retracted`, `chat.v1.read` were explicitly **removed** (see `ws.svelte.ts:43-51`) because they do not exist on the real server.

---

## 4. Auth / Authorization Requirements

| Layer | Mechanism | Scope |
|-------|-----------|-------|
| **Tauri Command** | `AppState::client()` returns `GrindrClient` from `OnceLock` | All commands except `request_public`, `fetch_latest_release`, `fetch_download_stats`, `fetch_active_users`, `send_usage_ping`, `open_external_url` |
| **Rust Bridge (`request`)** | `authorization_header()` → `Grindr3 <session_id>` | Attaches Bearer token; auto-refreshes if expired (<60s) |
| **Rust Bridge (`request_public`)** | No Authorization header | Pre-session endpoints only |
| **WS Connection** | `Authorization: Grindr3 <session_id>` on handshake | Validated by `ws_connect` before `auth_notify.notify_one()` |
| **Session Epoch** | `AppState::ws_epoch` (AtomicU64) | Bumped on `login`, `logout`, `rotate_api_params`; invalidates stale WS |
| **Frontend Redirect Latch** | `authRedirectLatched` (module state) | Prevents N-toast/N-navigation on concurrent 401s |
| **App Lock Gate** | `isLocked()` blocks `handleSessionLost` redirect | Deferral until unlock (see `index.ts:619-630`) |

**Key Finding:** The `auth_state` command now returns `{ profileId: number|null, keyringError: string|null }` (breaking IPC change) to distinguish "not logged in" from "secure storage broken" (see `auth.rs:426-435`).

---

## 5. Deep Links & Navigation Contracts

### 5.1 Android App Links / Custom Scheme

**No custom URI scheme (`grindrx://` or similar) is declared** in:
- `src-tauri/gen/android/app/src/main/AndroidManifest.xml` — Only `MAIN/LAUNCHER` intent filters
- `tauri.conf.json` — No `deepLink` or `customProtocol` configuration
- Frontend — No `grindrx://` handling code found

### 5.2 Notification Deep Links

- Rust WS emits `notification:posted` with `{ conversationId }` (`ws.rs:542-547`)
- Android `MainActivity` handles notification intent extras (referenced in `ws.rs:511-513`)
- **Frontend deep-link handler for `conversationId` routing: NOT FOUND in source** — `ws.rs:513` says "needs frontend wiring"

### 5.3 Internal Navigation

- SvelteKit file-based routing under `src/routes/`
- Protected routes under `(protected)/` with `+layout.ts` guard calling `auth_state`
- Auth routes under `(auth)/` (sign-in, register, password reset)

---

## 6. Environment Variables & Config Keys

### 6.1 Build-Time Public Env Vars (Vite `import.meta.env.PUBLIC_*`)

| Variable | Used In | Default | Purpose |
|----------|---------|---------|---------|
| `PUBLIC_ENABLE_ANALYTICS` | `src/routes/+layout.svelte:26` | `"false"` | Enable analytics pageviews |
| `PUBLIC_ENABLE_BLUR_EFFECTS` | `src/routes/(protected)/(navbar)/(root)/ProfileMiniCard.svelte` | (unset) | Enable blur visual effects |

### 6.2 Tauri Configuration (`tauri.conf.json`)

| Key | Value | Notes |
|-----|-------|-------|
| `identifier` | `com.grindrx.app` | Bundle ID |
| `version` | `0.1.48` | App version |
| `build.beforeDevCommand` | `bun run dev:web` | |
| `build.beforeBuildCommand` | `bun run build` | |
| `app.security.csp` | Strict CSP with `connect-src` allowlist | `grindr.mobi`, `analytics.dominusaxis.com`, `cdns.grindr.com`, `*.cloudfront.net`, map tiles |
| `bundle.android.minSdkVersion` | `28` | Android 9+ |
| `bundle.android.versionCode` | `1083` | |

### 6.3 Rust-Side Constants (Compiled In)

| Constant | File | Value |
|----------|------|-------|
| `BASE_URL` | `src-tauri/src/api/client.rs:13` | `https://grindr.mobi` |
| `WS_URL` | `src-tauri/src/api/ws.rs:18` | `wss://grindr.mobi/v1/ws` |
| `HEARTBEAT_INTERVAL` | `src-tauri/src/api/ws.rs:19` | `45s` |
| `CONNECT_TIMEOUT` | `src-tauri/src/api/ws.rs:22` | `15s` |
| `MAX_REQUEST_PAYLOAD_BYTES` | `src-tauri/src/api/rest.rs:126` | `8 MB` |
| `MAX_API_RESPONSE_BYTES` | `src-tauri/src/api/rest.rs:583` | `32 MB` |
| `MAX_FETCH_BYTES` | `src-tauri/src/api/rest.rs:577` | `10 MB` (media) |
| `MAX_UPLOAD_RESPONSE_BYTES` | `src-tauri/src/api/rest.rs:597` | `32 MB` |
| `MAX_PUBLIC_JSON_BYTES` | `src-tauri/src/api/rest.rs:604` | `256 KB` |
| `RELEASES_URL` | `src-tauri/src/api/rest.rs:770` | `https://api.github.com/repos/Tgbjr2025/grindrx/releases/latest` |
| `GITHUB_URL` | `src-tauri/src/api/rest.rs:809` | `https://api.github.com/repos/Tgbjr2025/grindrx/releases?per_page=100` |
| `FORGEJO_URL` | `src-tauri/src/api/rest.rs:811` | `https://git.dominusaxis.com/api/v1/repos/dominus/grindrx/releases?limit=50` |
| `STATS_URL` | `src-tauri/src/api/rest.rs:850` | `https://cam.dominusaxis.com/grindrx/stats` |
| `PING_BASE` | `src-tauri/src/api/rest.rs:882` | `https://cam.dominusaxis.com/grindrx/ping` |

---

## 7. Message-Type Registry (from `$lib/model/message.ts`)

### 7.1 Parsed Variants (Discriminated Union `messageSchema`)

| Type | Schema | Rendered? | Notes |
|------|--------|-----------|-------|
| `Text` | `textMessageSchema` | ✅ | Body: `{ text }` |
| `Image` | `imageMessageSchema` | ✅ | Body: `{ mediaId, url, width, height, imageHash, takenOnGrindr, createdAt }` |
| `ExpiringImage` | `expiringImageMessageSchema` | ✅ | Body: `{ mediaId, url, width, height, imageHash, viewsRemaining }` |
| `Album` | `albumMessageSchema` | ✅ | Body: album preview + expiration |
| `ExpiringAlbum` | `expiringAlbumMessageSchema` | ✅ | Extends Album |
| `ExpiringAlbumV2` | `expiringAlbumV2MessageSchema` | ✅ | Extends Album |
| `AlbumContentReaction` | `albumContentReactionMessageSchema` | ✅ | Body: `{ albumId, ownerProfileId, albumContentId, previewUrl, expiresAt, viewable }` |
| `AlbumContentReply` | `albumContentReplyMessageSchema` | ✅ | Extends reaction + `albumContentReply`, `contentType` |
| `Audio` | `audioMessageSchema` | ✅ | Body: `{ mediaId, mediaHash, url, contentType, length, expiresAt }` |
| `Video` | `videoMessageSchema` | ✅ | Body: `{ mediaId, url, fileCacheKey, contentType, length, maxViews, looping, viewsRemaining }` |
| `PrivateVideo` | `privateVideoMessageSchema` | ✅ | Extends Video + `viewCount` |
| `NonExpiringVideo` | `nonExpiringVideoMessageSchema` | ⚠️ `z.unknown()` | Body not modeled |
| `Gaymoji` | `gaymojiMessageSchema` | ✅ | Body: `{ imageHash }` |
| `Giphy` | `giphyMessageSchema` | ✅ | Body: `{ id, urlPath, stillPath, previewPath, width, height, imageHash }` |
| `Location` | `locationMessageSchema` | ✅ | Body: `{ lat, lon }` |
| `ProfileLink` | `profileLinkMessageSchema` | ⚠️ `z.unknown()` | Body not modeled |
| `ProfilePhotoReply` | `profilePhotoReplyMessageSchema` | ✅ | Body: `{ imageHash, photoContentReply }` |
| `Retract` | `retractMessageSchema` | ✅ | Body: `{ targetMessageId }` |
| `Generative` | `generativeMessageSchema` | ⚠️ `z.unknown()` | Body not modeled |
| `VideoCall` | `videoCallMessageSchema` | ⚠️ `z.unknown()` | Body not modeled |
| `Unknown` | `unknownMessageSchema` | ✅ | Fallback for unparseable |

### 7.2 Special Variants

| Variant | Schema | Purpose |
|---------|--------|---------|
| `Unsent` | `unsentMessageSchema` | Optimistic local state (`unsent: true`, `body: null`) |

### 7.3 Variants Parsed But Not Fully Rendered

| Type | Render Gap |
|------|------------|
| `NonExpiringVideo` | Body is `z.unknown()` — no preview fields extracted |
| `ProfileLink` | Body is `z.unknown()` — no profile info extracted |
| `Generative` | Body is `z.unknown()` — labeled "AI message" only |
| `VideoCall` | Body is `z.unknown()` — labeled "Video call" only |

### 7.4 Variants Documented But Not Modeled

- `chat.v1.message_reaction` — **Does not exist on server** (reactions arrive inline via `chat.v1.message_sent`)
- `chat.v1.message_retracted` — **Does not exist on server** (retracts arrive inline)
- `chat.v1.read` — **Does not exist on server** (read position from REST message list)

---

## 8. Explicitly Unverifiable Without Live Server

| Area | Why Unverifiable | Required to Verify |
|------|------------------|-------------------|
| All `/v2/taps/*` endpoints | No signed-in session available for probe | Live Grindr account + network capture |
| All `/v7/views/*`, `/v5/views/*` endpoints | No signed-in session available for probe | Live Grindr account + network capture |
| All `/v5/flags/*`, `/v1/flags/right-now/*` endpoints | Filing false abuse reports is unacceptable | Live Grindr account + test target (ethical issue) |
| `/v3/assignment` endpoint | `api.grindr.com` refusing TLS handshakes | Live Grindr account + working API host |
| `/v1/accounts` registration | Reference says "dynamic, WIP" — path not fixed | Live Grindr account creation flow |
| `/v3/users/email` change email | Request fields undocumented in repo | Live Grindr account + API probe |
| WebSocket event payloads (`chat.v1.*`, `tap.v1.*`) | No live WS connection captured | Live Grindr session + WS traffic capture |
| Push notification deep-link routing (`conversationId`) | Requires Android build + FCM/notification | Built APK + notification tap test |
| `rotate_api_params` Tauri command | No frontend caller — dead code | N/A (should be removed) |

---

## 9. Summary Counts

| Category | Count | Verified in Source | Live-Verified |
|----------|-------|-------------------|---------------|
| HTTP endpoints (via `fetchRest`) | **38** | 38 | 0 |
| Dedicated media upload commands | **3** | 3 | 0 |
| Media fetch commands | **2** | 2 | 0 |
| Telemetry/stats commands | **4** | 4 | 0 |
| Tauri commands registered | **21** | 21 | 0 |
| Tauri commands called from frontend | **20** | 20 | 0 |
| Dead Tauri commands (registered, not called) | **1** (`rotate_api_params`) | 1 | N/A |
| WebSocket server event types | **4** (`chat.v1.message_sent`, `chat.v1.conversation.delete`, `chat.v1.typing.start`, `chat.v1.typing.stop`) | 4 | 0 |
| WebSocket client command types | **0** (frontend never sends) | 0 | 0 |
| Frontend WS event listeners | **7** (3 lifecycle + 4 payload) | 7 | 0 |
| Message variants parsed | **22** (21 typed + `Unknown`) | 22 | 0 |
| Message variants with `z.unknown()` body | **4** (`NonExpiringVideo`, `ProfileLink`, `Generative`, `VideoCall`) | 4 | 0 |
| Environment variables (build-time) | **2** | 2 | N/A |
| Config keys (Rust constants) | **14** | 14 | N/A |
| Deep link schemes declared | **0** | 0 | N/A |

---

## 10. Critical Distinctions

> **A path observed in source is NOT an endpoint verified against a live server.**
> All HTTP endpoints and WebSocket events above are marked **`unverified`** for live behaviour.
> The only verification performed is static source analysis — confirming the path string exists in the codebase and is wired through the `fetchRest`/`invoke` plumbing.

**Known reconciled issue:** The auth fix removed duplicate password-reset transport (`forgot_password` Tauri command + `/v1/accounts/password/reset`), consolidating to a single `fetchRest("/v3/users/forgot-password", { public: true })` path. This is reflected in `auth-contract.ts` and enforced by `single-password-reset-path.test.ts`.

---

*End of Domain 4 Inventory — Observational Measurement Only*