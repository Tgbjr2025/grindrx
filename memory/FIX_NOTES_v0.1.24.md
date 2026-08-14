# FIX_NOTES — v0.1.24 (audit-driven fix batch)

**Date:** 2026-08-14 · **Base:** `ddda25c` (v0.1.23) · **Rollback tag:** `pre-v0.1.24` = `ddda25c`
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk` · **Operator:** Tom

Produced by a 9-dimension parallel audit (48 findings: 5 high / 18 medium / 25 low) → Fable
design plan → 8 file-disjoint Sonnet implementation packages (P1–P8). 45 files changed/created.

## Verification (all green before ship)
- `bun run check` (svelte-check): **0 errors** (warnings only).
- `bun run test` (vitest): **112 tests pass** across 14 files (was 52/9). Includes new regression
  tests for BOTH of Tom's known issues.
- `cargo test --lib`: **3 pass**, incl. new `shared_client_does_not_follow_redirects`.
- Android build via `nix run .#build-android`: see SESSION_STATE (build validated the P8 CSP/
  capabilities/manifest changes).

---

## Tom's two known issues — root-caused + fixed

### #1 Photos (saved images can't be reused for re-sending without re-uploading)
Two distinct defects were behind this:
- **(1a, HIGH bug) Private/album "tap to send" was throwing.** `prepareAuthedUrlForSend` sent every
  URL through `fetchAuthedBytes`, which returns `null` for any non-grindr host — but album content is
  served from signed CloudFront URLs. Result: "Could not fetch the private photo to re-send it."
  **Fix:** new Rust command **`fetch_media_bytes`** (no Authorization header, signed-CDN host
  allowlist `*.cloudfront.net` + `cdns.grindr.com`, https-only, `redirect::Policy::none()`, size cap)
  + JS `fetchMediaBytes` wrapper. `prepareAuthedUrlForSend` now branches on host: grindr → bearer
  fetch, signed/direct CDN → no-auth `fetchMediaBytes`. (P1 + P2)
- **(1b, the re-upload-every-time design) No mediaId cache.** Saved photos carry only a `mediaHash`;
  the chat-send endpoint needs a numeric `mediaId`, minted only by re-uploading bytes. Nothing was
  cached, so every send re-downloaded + re-uploaded the same photo. **Fix:** persistent
  `mediaHash → {mediaId}` cache (localStorage `grindrx-mediaid-cache`, keyed by public hash for saved
  photos and `contentId` for album photos). A cache hit skips fetch+upload entirely. On an HTTP-400
  (invalidated id), the entry is evicted so the next send re-mints. Now N sends of one photo = 1
  upload. (P1)

### #2 Location (browsing other areas "produces errors")
- **Root cause (verified, NOT a client bug):** `exploreGeoHash` is declared in `gridQuerySchema`,
  inherited by `cascadeV3QuerySchema`, added to the query in `grid-state`, and serialized verbatim
  onto `/v3/cascade?...` by `urlSearchParamsCodec`. It reaches the wire correctly. **CAS-4001 is a
  server-side Grindr XTRA/Unlimited (and region) gate** returned to unentitled accounts — a
  limitation, not a fixable query bug. A dedicated regression test (`grid.test.ts`) now pins the
  serialization so a future refactor can't silently drop the param.
- **Fix (UX honesty):** `toGridError` now special-cases `ApiHttpError.code === 'CAS-4001'` and frames
  it as a premium/region gate ("browsing other areas needs Grindr XTRA/Unlimited or isn't available
  in your region") with the reset-to-my-location affordance, instead of a misleading transient
  "try another spot" that invited futile retries. (P7)

---

## Other fixes shipped

### Bugs
- **Profile taps were completely broken (HIGH).** `sendTap` hit the wrong endpoint (`/v2/taps/{id}`
  vs documented `/v2/taps/add`), double-encoded the body (`JSON.stringify` through a bridge that
  re-serializes), never sent `recipientId`, used wrong tap IDs (had 1–4; real set is 0 FRIENDLY /
  1 HOT / 2 LOOKING), and toasted "Tap sent!" even on failure. Rewritten as `sendTapWithType` →
  `POST /v2/taps/add {recipientId, tapType}` (plain object), with a status check. (P4)
- **Password-change & delete-account discarded the real server error (MED).** The non-2xx branch
  called `res.json()`, which *throws* `ApiHttpError` (caught + ignored) → always generic message.
  Now reads `res.text()` and surfaces the actual server message. (P4)
- **Favorite / hide / unhide failed silently (MED).** `fetchRest` resolves (doesn't throw) on
  non-2xx; these mutations never checked status, so a server rejection left the UI toggled and
  reverted on next refetch. Added an `assertOk(res)` guard so the revert + error toast fire. (P4)
- **Chat read-receipts showed wrong info (MED correctness).** `lastReadTimestamp` conflated our own
  read cursor with the recipient's read position; the authoritative `result.lastReadTimestamp` from
  the message-list endpoint was dropped, and a phantom `chat.v1.read` WS handler (never emitted) drove
  it. Split into `recipientReadTimestamp` (from the server) for the "Read" label vs local read cursor.
  (P3)
- **Concurrent-send duplicate race (MED).** Two quick sends could render a duplicate until a later
  disconnect-time reconcile. Now `removeDuplicateMessages` runs after `#resolveMessage` rewrites the
  temp id. (P3)
- **Drifted-but-successful send marked "failed" → double-send on retry (MED).** Send responses were
  parsed with the strict message schema; a 2xx with a drifted body threw and flagged the (delivered)
  message as failed. Now parsed with a lenient `{messageId}` schema. (P3)
- **Reconcile rebuilt the whole message array every 10s poll (perf).** Every server-echoed message was
  marked "updated", defeating the no-op early return. Now only counts a real diff. (P3)
- **Preferences could be wiped by a degraded read (MED).** `setPreferences` merged onto a
  degrade-to-defaults read and persisted it, clobbering saved geohash/filters after a corrupt/half-
  written file. Now distinguishes missing (safe) vs unreadable (abort the write). (P7)

### Security (Rust)
- **Bearer token could leak on redirect (MED).** FIX-13 redirect refusal only guarded
  `fetch_authed_bytes`; the shared client used by `request`/`upload_image` followed redirects. Built
  the shared client with `redirect::Policy::none()`. New test asserts it. (P2)
- **WebSocket wasn't torn down on logout (MED).** The prior account's realtime events + notifications
  kept flowing after logout / on account-switch. Added a `ws_reset` signal fired by logout+login that
  drops the socket. (P2)
- **Unbounded request payloads (LOW).** Capped the base64 envelope + decoded body at 8 MB in
  `request`/`request_public`. (P2)

### Unimplemented features completed
- **Incoming voice notes / GIFs / videos / gaymoji now render (HIGH).** They previously showed
  "Unsupported message type" though fully parsed. New `AudioMessage`, `GiphyMessage`, `VideoMessage`,
  `GaymojiMessage` components wired into `Message.svelte` before the fallback. (P5)
- **"Reveal profile views" was a dead toggle.** Now wired to `GET/PUT /v3/me/prefs/settings`
  (`src/lib/api/prefs.ts`), mapping to `hideViewedMe`, with 402/403 (subscription-gated) handled by
  reverting + honest copy. (P6)
- **"Reveal message read status" was mislabeled "coming soon"** though actually implemented — copy
  corrected. (P6)

### Reactivity / a11y / config
- Fixed 2 `state_referenced_locally` reactivity bugs (`ImageMessage.displayUrl`,
  `ConversationRelativeTimeDynamic.relativeTime`) + the new `GiphyMessage.imgSrc` (→ `$derived`). (P6)
- Conversation delete popover: Escape-to-close, `role="menu"/"menuitem"`, focus management. (P6)
- Imperial height in EditProfileSheet now edited as feet+inches (was raw total-inches). (P6)
- CSP `connect-src` tightened — dropped hosts the WebView never fetches (grindr.mobi,
  *.cloudfront.net, git.dominusaxis.com; all API/media go through Rust reqwest). `img-src`/`media-src`
  kept for the CDN hosts the WebView renders. Dropped unused `WAKE_LOCK` permission. (P8)
- Removed dead WS handlers (`chat.v1.message_reaction`, `chat.v1.message_retracted`) and fixed the
  dead typing subscription (`chat.v1.typing.start/.stop`). (P3)

### Tests added (regression + coverage)
- `profile.test.ts` (16): mediaId cache reuse (issue #1), CloudFront album-send (issue #1a),
  bytesToBase64 chunk-boundary round-trip.
- `grid.test.ts` (10): `exploreGeoHash` serialization (issue #2), partial-batch splitting.
- `conversation-state.reconcile.test.ts` (7): dedup, optimistic-adopt, error-image drop, retract flip.
- `preferences.test.ts` (8): missing vs unreadable degrade, no-clobber write.
- `explore-location.svelte.test.ts` (9): persistence + tolerant read.
- `index.test.ts` (+10 → 18): CAS-4001 / Cloudflare-block classification.
- `cargo`: `shared_client_does_not_follow_redirects`.

---

## DEFERRED (documented, NOT in this batch — follow-up work)
- **Auth endpoint divergence** (password-change/forgot-password POST to `/v1/accounts/*` vs documented
  `/v3/users/update-password` + `/v3/users/forgot-password`, with a working-but-bypassed Rust
  `forgot_password` command already present). **Needs LIVE Grindr API verification** — swapping a
  possibly-working endpoint could break login for Google/Apple/Facebook signups (for whom "set a
  password" is the only entry). Flagged for on-device verification, not changed blind. (R7)
- **Voice message SENDING** (MediaRecorder + audio-upload pipeline). Receiving IS fixed (AudioMessage);
  the mic button remains a stub (#35).
- **PIN app-lock** — new subsystem.
- **Notification-settings subpage** — new subpage + schema.
- **Native Kotlin notification-tap deep-link** (conversationId intent extra via JNI) — needs on-device
  testing; the foreground toast "Open" action already works.
- **Atomic tmp+rename preference write** — needs a primitive in `app-data/index.ts` (out of P7 scope);
  the higher-priority no-clobber fix shipped.
