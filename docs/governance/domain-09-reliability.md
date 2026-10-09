# Domain 9: Reliability & Fault Handling — Measurement Report

**Repository:** `/srv/projects/grindrx-work` at commit `7fffcec`, branch `main`
**Agent:** MEASUREMENT (observational only)
**Date:** 2026-10-09

---

## 1. Executive Summary

The codebase implements a layered fault-handling strategy spanning the TypeScript API client (`$lib/api`), WebSocket manager (`$lib/ws.svelte.ts`), Rust backend (`src-tauri/src/api`), and UI state machines (`conversation-state.svelte.ts`). Key strengths: bounded retry policy with `Retry-After` support, explicit idempotency gating, msgpack depth guard preventing stack overflow, epoch-based WebSocket session invalidation, and a comprehensive sign-out purge that revokes cross-account data leaks. Gaps remain in: Retry-After header plumbing (bridge drops headers), background task failure visibility, duplicate event dedup on WS reconnect, and partial upload cleanup verification.

---

## 2. Fault Handling Inventory by Category

### 2.1 Retry & Backoff Policies (`$lib/net/retry.ts`, `$lib/api/index.ts`)

| Policy Knob | Default | Purpose |
|-------------|---------|---------|
| `maxAttempts` | 3 | Hard cap on total request issuances (initial + retries) |
| `baseDelayMs` | 250 ms | First backoff window, doubled per attempt |
| `maxDelayMs` | 4,000 ms | Ceiling for jittered backoff (not applied to `Retry-After`) |
| `maxElapsedMs` | 45,000 ms | Wall-clock budget across all attempts + sleeps |
| `maxSleepMs` | 6,000 ms | Cumulative sleep budget independent of elapsed |
| `idempotent` | false | Caller assertion required for non-GET/HEAD/OPTIONS |
| `signal` | undefined | `AbortSignal` for cancellation |

**Transient triggers retried:**
- HTTP 429 (with `Retry-After` parsing per RFC 9110 §10.2.3)
- HTTP 500, 502, 503, 504
- Bridge `AppError::Http` (covers DNS failure, connection reset, TLS failure, reqwest 30s timeout)

**Explicitly NOT retried:**
- Non-idempotent verbs (POST/PUT/PATCH/DELETE) without `idempotent: true`
- 4xx except 429 (definite answers)
- 501 (permanent "Not Implemented")
- `AppError::Auth`, `AppError::CredentialStore`, `AppError::Api`, `AppError::NotInitialized`
- Cloudflare/WAF 429 interstitial (classified via `classifyResponseBody`)

**Jitter:** Full-ish jitter — uniform in `[ceiling/2, ceiling]` to break thundering herds.

**Test coverage:** 97 tests in `retry.test.ts` + 44 tests in `api/retry.test.ts` cover all policy knobs, `Retry-After` forms, budget exhaustion, abort signals, and verb gating.

### 2.2 Timeouts & Cancellation

| Layer | Timeout | Mechanism |
|-------|---------|-----------|
| Rust `reqwest::Client` | 30s request / 10s connect | `Client::builder().timeout().connect_timeout()` |
| WS handshake | 15s | `tokio::time::timeout(CONNECT_TIMEOUT, connect_async_tls_with_config)` |
| WS heartbeat | 45s interval | Ping/Pong with `waiting_for_pong` flag; timeout tears down socket |
| `fetch_authed_bytes` / `fetch_media_bytes` | 12s | JS-side `Promise.race` with `setTimeout` |
| `fetch_latest_release` / stats | 15s / 10s | Dedicated clients with caps |
| Backoff sleep | Cancellable | `sleepWithSignal` respects `AbortSignal` |

**No JS-side `AbortController` for `fetchRest`** — documented rationale: Tauri IPC has no cancellation channel; a client timer would only stop awaiting while backend keeps running. Cancellation is enforced at the Rust layer.

### 2.3 Partial Network Failure Handling

- **Connection reset / DNS / TLS / timeout** → `AppError::Http` → retried for idempotent verbs
- **Cloudflare interstitial (403/429 non-JSON)** → classified as `cloudflare-block` → NOT retried; surfaces "request blocked" dialog
- **Bare error codes (e.g., `CAS-4001`)** → classified as `error-code` → `ApiHttpError` with status + code
- **Redirects** → refused at `reqwest` level (`redirect::Policy::none()`) on ALL clients (shared + dedicated) to prevent bearer token leakage across scheme/host changes

### 2.4 Service Unavailability

- **WS disconnect** → exponential backoff (1s → 2s → 4s … max 30s) with ±20% jitter
- **Auth errors during WS loop** (`AppError::Auth`, `AppError::NotInitialized`) → reset backoff to 1s, wait for `auth_notify` (login)
- **Other WS errors** → jittered backoff, re-enter connect loop
- **Epoch check** on every loop iteration + after each frame → stale socket drops on session change (logout/account switch)

### 2.5 Corrupt/Unexpected Responses

| Guard | Location | Protection |
|-------|----------|------------|
| msgpack depth ≤ 64 | `src-tauri/src/api/msgpack_depth.rs` | Prevents stack overflow from deeply nested payloads (8 MB body = ~8M levels possible) |
| Response byte caps | `stream_capped_body` in `rest.rs` | 32 MB API, 10 MB media, 1 MB auth, 32 MB upload, 256 KB public JSON |
| Request payload cap | 8 MB base64 → msgpack | Before decode |
| JSON parse fallback | `classifyResponseBody` | Handles bare codes (`CAS-4001`), Cloudflare HTML, malformed JSON |
| Zod `safeParse` on all responses | API modules | Graceful degradation: `conversationsSchema` drops bad entries, `coerceApiResponseMessage` converts unparseable → `Unknown` with synthetic ID |
| MIME sniffing | `authed-image.ts` | Correctly distinguishes HEIC/AVIF (images) from MP4 (video) via ISO-BMFF major brand |

### 2.6 Cache Invalidation & Stale Data

| Cache | Bound | Invalidation |
|-------|-------|--------------|
| `objectUrlCache` (authed images) | 32 entries LRU | `purgeAuthedImageCache()` on sign-out + session expiry; epoch guard prevents in-flight re-cache |
| `mediaIdCache` (profile) | localStorage key | `clearMediaIdCache()` on sign-out |
| `genders` / `pronouns` | Single-slot memo | `clearGendersCache()` / `clearPronounsCache()` |
| `storedViewers` (last-50) | rune store + localStorage | `clearStoredViewers()` on sign-out + session expiry |
| Conversation cache | Per-conversation, newest-first | `#syncCache()` on every mutate; 60s safety-net reconcile |
| `grindrx-geohash-user-pinned` flag | localStorage | Purged WITH geohash on sign-out (dangling reference guard) |

**Critical fix:** `purgeAuthedImageCache` revokes `blob:` URLs (including parked `retired` set) and bumps `cacheEpoch` so in-flight fetches discard stale bytes.

### 2.7 Concurrent Updates & Race Conditions

- **Conversation reconcile:** `#reconcileInFlight` guard prevents overlapping polls; `reconcile()` pure function merges local optimistic + server page with structural signature compare
- **Album share duplicate bubble:** Fixed via `pendingKey = album:${id}:${tempId}` (per-attempt) + prefix match oldest-unconsumed
- **WS echo vs HTTP response race:** Both paths call `removeDuplicateMessages` immediately after adoption
- **Reaction rollback:** Re-finds by `messageId` after `chat.v1.message_sent` echo may have replaced array slot
- **Delete revert:** Re-derives insertion point from timestamp, not stale index
- **Read receipt debounce:** 500ms queue, reports highest timestamp only

### 2.8 Duplicate Event Processing

- **WS `chat.v1.message_sent`**: Exact `messageId` match first, then `pendingKey` prefix for album shares, then existing-message update (reactions/retracts), finally prepend
- **Reconcile poll**: Adopts server data onto pending entries via `pendingKey` or type+timestamp (±60s); drops failed (`status: "error"`) images to prevent UI lock from re-decoding
- **Dedup key**: `messageId` everywhere; synthetic IDs for unparseable payloads use FNV-1a hash of raw payload + index

### 2.9 Offline & Reconnect Behavior (WebSocket)

| State | Behavior |
|-------|----------|
| `disconnected` | 10s poll (`#startPolling`) + 60s safety-net (`#startSafetyNet`) |
| `connecting` | No poll; safety-net runs but no-ops while `ws.status !== "connected"` |
| `connected` | Poll stopped; safety-net runs every 60s as recovery for missed echoes (album shares) |
| Transition `disconnected` → `connected` | Stop poll, restart safety-net, immediate `#reconcileMessages()` catch-up |
| Transition `connected` → `disconnected` | Start poll, restart safety-net |
| Session change (logout/login) | `ws_epoch` bump → message loop exits → outer loop waits for `auth_notify` → fresh connect |

**Gap:** No persistent offline queue for outbound messages; failed sends surface as `status: "error"` bubbles with manual retry button.

### 2.10 Process Termination & Restart

- **WS task**: Spawned via `tauri::async_runtime::spawn`; outer loop breaks on `ChannelClosed` (command sender dropped)
- **Conversation state**: `destroy()` clears all intervals, awaits listener promises, idempotent
- **App lock**: Persists failure count + cooldown epoch to localStorage; survives restart; clock tampering detected (forward/backward/hand-edited)
- **Sign-out purge**: Idempotent, collects failures, never throws; `Promise.allSettled` isolates steps

### 2.11 Background Task Failure

- **WS message loop**: Runs on Tauri async runtime; failures emit `ws:disconnected` / `ws:ws_error` events; no structured retry telemetry
- **Reconcile poll**: Swallows errors (`console.error` only); no backoff on repeated failures
- **Read receipt flush**: Debounced 500ms; server failure logs + toasts but doesn't retry
- **Media fetch**: 12s timeout; failure returns `null`, caller falls back to raw URL
- **Usage ping / stats / release check**: Fire-and-forget / best-effort; failures contribute `null` to aggregate

### 2.12 Recovery After Expired Credentials

- **Token refresh**: `authorization_header()` refreshes on 401; only clears session on genuine 401 from server
- **Expired session at startup**: Kept if refresh token present; discarded only if no token (post-reinstall)
- **Session expiry during WS handshake**: Epoch snapshot before connect; re-checked after handshake; mismatch → abort
- **401 on REST**: Centralized in `fetchRest` → `handleSessionLost()` → clears caches, revokes media, disconnects WS, calls `logout`, navigates to sign-in (once via `authRedirectLatched`)

### 2.13 Data Consistency After Interrupted Operations

- **Optimistic UI**: All sends create `status: "pending"` bubbles; adopted on WS echo or reconcile; failed → `status: "error"` with retry
- **Album share**: No server `messageId` returned; `pendingKey` ties echo to attempt
- **Delete/unsend**: Revert closures capture full original shape; re-find by ID on revert
- **Read receipt**: Local cursor advances immediately; server call best-effort

### 2.14 Idempotency & Duplicate Submissions

- **Retry policy**: Only GET/HEAD/OPTIONS retried by default; non-idempotent requires explicit `idempotent: true`
- **Album share**: Per-attempt `pendingKey` prevents cross-adoption
- **Reaction**: `already-held` guard prevents double-tap stacking
- **Read receipt**: Cursor deduplicates; only highest timestamp reported

### 2.15 Cleanup After Failed Uploads / Partial Migrations

- **Image upload**: 30 MB base64 cap; `stream_capped_body` on response; no partial cleanup (atomic POST)
- **Album content**: Multipart upload; same caps; no rollback on failure
- **Profile image**: Square crop computed client-side; upload to dedicated endpoint
- **Sign-out purge**: `purgeAccountLocalData()` — isolated steps, collects failures, overwrites `preferences.data` if delete fails
- **Media cache purge**: Revokes all `blob:` URLs including parked set; epoch guard prevents race

---

## 3. Configured Policies (Measured)

| Policy | Value | Source |
|--------|-------|--------|
| REST max attempts | 3 | `DEFAULT_RETRY_POLICY.maxAttempts` |
| REST base delay | 250 ms | `DEFAULT_RETRY_POLICY.baseDelayMs` |
| REST max backoff | 4,000 ms | `DEFAULT_RETRY_POLICY.maxDelayMs` |
| REST max elapsed | 45,000 ms | `DEFAULT_RETRY_POLICY.maxElapsedMs` |
| REST max cumulative sleep | 6,000 ms | `DEFAULT_RETRY_POLICY.maxSleepMs` |
| WS connect timeout | 15 s | `CONNECT_TIMEOUT` in `ws.rs` |
| WS heartbeat interval | 45 s | `HEARTBEAT_INTERVAL` in `ws.rs` |
| WS backoff base | 1 s | `Duration::from_secs(1)` in `run_ws_loop` |
| WS backoff max | 30 s | `.min(Duration::from_secs(30))` |
| WS backoff jitter | ±20% | `jitter()` function |
| Media fetch timeout | 12 s | `Promise.race` in `authed-image.ts` |
| Authed image cache size | 32 entries | `MAX_ENTRIES` in `authed-image.ts` |
| Retired cache cap | 32 entries | `MAX_RETIRED = MAX_ENTRIES` |
| Conversation poll interval | 10 s | `POLL_INTERVAL_MS` |
| Safety-net reconcile | 60 s | `SAFETY_NET_INTERVAL_MS` |
| Read receipt debounce | 500 ms | `#readTimer` in `conversation-state.svelte.ts` |
| PIN attempt threshold | 5 | `app-lock.svelte.ts` |
| PIN lockout ladder | 30s / 60s / 300s / ... | Persisted in localStorage |

---

## 4. Gap Analysis

| Gap | Category | Severity | Evidence |
|-----|----------|----------|----------|
| `Retry-After` header not plumbed through Rust bridge | Retry | P1 | `RawResponse` in `rest.rs` has optional `headers` but `request_raw` never populates it; 429 falls back to jittered backoff |
| No persistent offline outbound queue | Offline | P2 | Failed sends become `status: "error"` bubbles; no background retry on reconnect |
| Reconcile poll has no backoff on repeated failures | Background | P2 | `#reconcileMessages` swallows errors; 10s fixed interval continues hammering |
| WS `Notify` wakeup is lossy; epoch check is primary | WS | P1 | `ws_reset_notify` documented as lossy; long-term fix needs `watch::Sender<u64>` |
| No structured telemetry for background task failures | Observability | P2 | Only `console.error` / `eprintln`; no metrics export |
| Duplicate event dedup on WS reconnect relies solely on `messageId` | Duplicate | P2 | No server-side dedup token; client-side `messageId` collision possible if clock skew |
| Partial upload cleanup not verified | Cleanup | P3 | Upload commands are atomic POST; no multipart rollback test |
| Cache epoch is process-global; no per-account isolation beyond purge | Cache | P1 | `cacheEpoch` bumped on purge; in-flight fetch checks epoch — correct but single global |
| `grindrx-tour-done` purged but `grindrx-last-seen-version` kept — inconsistency documented | Data lifecycle | P3 | Decision recorded in `purge.ts:119-124` |

---

## 5. Tested vs Unverified Paths

| Path | Test Status | Notes |
|------|-------------|-------|
| Retry policy (all knobs) | **Measured** | 141 unit tests in `retry.test.ts` + `api/retry.test.ts` |
| `Retry-After` delta-seconds & HTTP-date | **Measured** | Fake timers + `vi.setSystemTime` |
| `Retry-After` budget rejection | **Measured** | 1h `Retry-After` → gives up |
| Cloudflare 429 non-retry | **Measured** | Multiple template variants tested |
| Non-idempotent verb gating | **Measured** | POST/PUT/PATCH/DELETE not retried by default |
| AbortSignal during backoff | **Measured** | Timer cleared, no second request |
| WS reconnect backoff + jitter | **Inferred** | Code inspection; no integration test with real socket |
| WS epoch invalidation on logout | **Measured** | `ws_epoch` bump + `auth_notify`; `run_message_loop` checks |
| WS heartbeat timeout | **Inferred** | `waiting_for_pong` flag; no test with real timeout |
| Authed image cache eviction + retain | **Measured** | 12 tests covering LRU, retain, parked set, purge |
| Authed image purge race (epoch) | **Measured** | In-flight fetch during purge → discarded |
| Conversation reconcile dedup | **Measured** | 50+ tests for `reconcile()` pure function |
| Album share duplicate prevention | **Measured** | Per-attempt `pendingKey` + prefix match |
| Sign-out purge completeness | **Measured** | 17 tests covering all keys, media, viewers, preferences |
| App lock clock tampering | **Measured** | Forward/backward/hand-edited deadline tests |
| Legacy PIN migration | **Measured** | v0.1.25–0.1.32 SHA-256 → PBKDF2 upgrade |
| Msgpack depth guard | **Measured** | 20 tests including 1M-level rejection |
| Response byte caps | **Inferred** | `stream_capped_body` tested indirectly via rest.rs unit tests |
| Redirect refusal | **Measured** | Rust test `shared_client_does_not_follow_redirects` |
| Cross-account media leak | **Measured** | `purgeAuthedImageCache` + session expiry tests |

---

## 6. Race Condition Candidates

| Location | Race | Mitigation | Status |
|----------|------|------------|--------|
| `fetchRest` retry loop + `AbortSignal` | Request issued after abort | `throwIfAborted` before each attempt + `sleepWithSignal` | **Mitigated** |
| WS message loop + epoch bump | Frame processed after logout | Epoch check at loop start + after each frame | **Mitigated** |
| Album share WS echo + HTTP response | Both adopt pending bubble | `removeDuplicateMessages` called by both | **Mitigated** |
| Reconcile poll + WS echo | Both merge server data | Structural signature compare; in-place adoption | **Mitigated** |
| Authed image purge + in-flight fetch | Stale bytes re-cached | `cacheEpoch` bumped before clear; fetch checks epoch | **Mitigated** |
| Read receipt queue + flush | Timer fires mid-push | Queue swapped atomically; `this.#readQueue = []` | **Mitigated** |
| Reaction rollback + WS echo | `msg` reference orphaned | Re-find by `messageId` on catch | **Mitigated** |
| Delete revert + new message arrival | Stale index | Timestamp-derived insertion point | **Mitigated** |
| `rotate_api_params` + WS epoch | User-Agent mismatch | `bump_ws_epoch()` + `auth_notify.notify_one()` pair | **Mitigated** |

---

## 7. Retry Amplification Risks

| Risk | Analysis |
|------|----------|
| **Thundering herd on 429/503** | Jitter (full-ish) breaks sync; `maxSleepMs=6s` bounds cumulative wait; `maxElapsedMs=45s` bounds total |
| **Retry-After amplification** | Server `Retry-After: 3600` → rejected by `maxElapsedMs` (gives up, returns 429); never shortened to `maxDelayMs` |
| **Non-idempotent retry opt-in** | Caller must assert `idempotent: true`; `retry: false` overrides even idempotent verbs |
| **Concurrent callers (grid + conversations + poll)** | All share same policy; jitter desynchronizes; safety-net only runs when connected |
| **WS reconnect storm** | ±20% jitter on exponential backoff; epoch check prevents stale reconnect attempts |

---

## 8. Measurement Evidence Index

| Artifact | Location | Type |
|----------|----------|------|
| Retry policy defaults | `src/lib/net/retry.ts:97-103` | Source |
| Retry policy tests | `src/lib/net/retry.test.ts` | Unit |
| `fetchRest` retry integration | `src/lib/api/retry.test.ts` | Unit (mocked IPC) |
| WS reconnect logic | `src-tauri/src/api/ws.rs:68-98` | Source |
| Msgpack depth guard | `src-tauri/src/api/msgpack_depth.rs` | Source + 20 tests |
| Authed image cache + purge | `src/lib/utils/authed-image.ts` + `.test.ts` | Source + 24 tests |
| Sign-out purge | `src/lib/app-data/purge.ts` + `.test.ts` | Source + 17 tests |
| Conversation reconcile | `src/routes/(protected)/chat/[conversationId]/conversation-state.svelte.ts` + `.test.ts` | Source + 2 test files |
| App lock backoff | `src/lib/app-data/app-lock.svelte.test.ts` | 33 tests |
| Response classification | `src/lib/api/index.ts:243-294` + `index.test.ts:220-312` | Source + tests |
| Error types | `src-tauri/src/error.rs` | Source |

---

## 9. Limitations & Unmeasured Areas

1. **No end-to-end WS fault injection** — Unit tests mock Tauri IPC; no integration test against real Grindr WS with simulated drops, 401 mid-stream, or oversized frames.
2. **Retry-After header path unexercised** — Rust bridge drops headers; the parsing logic in `parseRetryAfter` is tested but the plumbing is absent.
3. **Background task failure telemetry** — No metrics exported; only logs.
4. **Partial upload cleanup** — Not tested; upload endpoints are atomic POSTs.
5. **Cross-process cache isolation** — WebView process lifetime only; no multi-process scenario.
6. **Network partition during optimistic send** — No test for "sent locally, server received, response lost" — duplicate detection relies on `messageId` match.
7. **Android Doze / captive portal WS behavior** — `CONNECT_TIMEOUT=15s` and heartbeat timeout cover this but not verified on device.

---

## 10. Risk/Impact Summary

| Finding | Priority | Rationale |
|---------|----------|-----------|
| Missing `Retry-After` header plumbing | P1 | 429 responses fall back to jittered backoff instead of honouring server instruction; increases load on rate-limited endpoint |
| Lossy WS `Notify` wakeup | P1 | Documented in `state.rs:32-45`; epoch check mitigates but adds up to 45s latency (heartbeat interval) |
| No offline outbound queue | P2 | User must manually retry failed sends; no background reconciliation on reconnect |
| Reconcile poll no backoff | P2 | Persistent failures hammer server every 10s indefinitely |
| Partial upload cleanup unverified | P3 | Low probability (atomic POSTs) but no evidence |
| Cache epoch global, not per-account | P3 | Correct for single-account WebView; would need revision for multi-account support |

---

## 11. Reproducibility

All measurements derived from static source inspection at commit `7fffcec` and unit test execution via `vitest` (where runnable). Rust tests in `src-tauri/src/api/client.rs` (redirect refusal) and `msgpack_depth.rs` are part of the crate test suite. No destructive fault injection performed against production infrastructure.