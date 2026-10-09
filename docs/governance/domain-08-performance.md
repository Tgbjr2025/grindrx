# Domain 8: Performance & Resource Use — Static Analysis

**Repository:** `/srv/projects/grindrx-work`  
**Commit:** `7fffcec` (branch `main`)  
**Agent:** MEASUREMENT (Domain 8)  
**Date:** 2026-10-09  
**Scope:** Observational only — no source modifications. All findings derived from static code analysis.

---

## 1. Executive Summary

This report catalogues **static performance risks** and **configured resource limits** discoverable from source code at rest. No runtime benchmarks were executed; all values are compile-time constants, configuration literals, or algorithmic bounds evident in the code. Measurements requiring a live device, server, or build are explicitly marked `UNMEASURED` with the prerequisite stated.

**Key risk themes:**
- **Memory pressure from image handling:** 32 full-resolution `blob:` URLs retained in memory (reduced from 96), plus a retired set of up to 32 more. No runtime measurement of actual PSS on device.
- **Retry amplification:** REST retry policy permits up to 3 attempts × 45 s wall-clock budget; WebSocket reconnect uses exponential backoff capped at 30 s with ±20% jitter.
- **Polling surface:** Three concurrent periodic timers per open conversation (10 s reconcile, 60 s safety-net, 45 s WS heartbeat) plus grid/navigation timers.
- **Large allocation paths:** Base64 encoding of multi-MB images via 32 KiB chunked loop; msgpack depth checks prevent stack overflow but not heap pressure.
- **Virtualization gaps:** Grid uses chunk-based windowing (4 rows/chunk, 1 chunk overscan); conversation message list has **no virtualization** — renders entire history.

---

## 2. Applicable Indicators — Static Findings

### 2.1 Build Time (frontend, Rust, Tauri)

| Metric | Status | Notes |
|--------|--------|-------|
| Frontend (`vite build`) | UNMEASURED | Requires `bun run build` on clean worktree |
| Rust (`cargo build --release`) | UNMEASURED | Requires Android NDK + Rust toolchain (1.95.0) |
| Tauri bundle (`tauri build`) | UNMEASURED | Requires full Android SDK/NDK/JDK 21 env |

**Static observation:** `flake.nix` pins Android SDK 36, NDK 27.0.12077973, CMake 3.22.1, Gradle 8. JVM heap `-Xmx2048m`. Build parallelism disabled (`org.gradle.parallel` commented).

---

### 2.2 Test Execution Time

| Suite | Status | Notes |
|-------|--------|-------|
| `vitest run` (node project) | UNMEASURED | 668 tests, `environment: "node"` |
| `vitest run` (dom project) | UNMEASURED | `*.dom.test.ts`, `environment: "jsdom"`, `testTimeout: 20000` |
| `cargo test --lib` | UNMEASURED | Rust unit tests only |

**Static observation:** DOM project rebuilds module graph per test (`vi.resetModules()`), measured at 2.28 s unloaded / 5.09–5.56 s under contention. This is a known CI bottleneck.

---

### 2.3 Startup & Initialization Latency

| Phase | Static Indicators |
|-------|-------------------|
| Tauri `setup` hook | `GrindrClient::new()` sync keystore read + HTTP client build (30 s / 10 s timeouts) |
| WS spawn | `spawn_ws_task` → `auth_notify.notified()` waits for session |
| Geolocation | `onMount` requests permission + `getCurrentPosition()` on mobile |
| Auth redirect latch | Single `authRedirectLatched` flag prevents N concurrent 401 toasts/navigations |

**UNMEASURED:** Time-to-interactive, first paint, cold-start PSS.

---

### 2.4 API Latency (from code: timeouts, retry config)

#### REST Client (`src-tauri/src/api/client.rs:30-32`)
```rust
.timeout(Duration::from_secs(30))
.connect_timeout(Duration::from_secs(10))
.redirect(Policy::none())
```

#### Media Fetch (JS side, `src/lib/utils/authed-image.ts:330-334`)
```typescript
setTimeout(() => reject(new Error("fetch_authed_bytes timed out")), 12000)
```

#### WebSocket (`src-tauri/src/api/ws.rs:19-22`)
```rust
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(45);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
```

#### Retry Policy (`src/lib/net/retry.ts:97-103`)
```typescript
DEFAULT_RETRY_POLICY: ResolvedRetryPolicy = {
  maxAttempts: 3,        // initial + 2 retries
  baseDelayMs: 250,      // 250, 500, 1000, 2000, 4000 (capped)
  maxDelayMs: 4_000,
  maxElapsedMs: 45_000,  // wall-clock budget across ALL attempts
  maxSleepMs: 6_000,     // total sleep budget
}
```

**Retry amplification factor:**  
- Best case (fast failures): ~1 s total (3 × 250 ms backoff)  
- Worst case (slow failures): up to 45 s (one 30 s attempt + one more)  
- 429 `Retry-After` honored **without clamping to `maxDelayMs`** — a 60 s `Retry-After` forces give-up, not shortened sleep.

**Non-idempotent safety:** POST/PUT/PATCH/DELETE never retried unless caller asserts `idempotent: true`.

---

### 2.5 Memory & Disk Consumption (cache sizes, limits in code)

| Cache / Store | Limit | Eviction | Location |
|---------------|-------|----------|----------|
| Authed image blob URLs | `MAX_ENTRIES = 32` (was 96) | LRU + ref-count | `src/lib/utils/authed-image.ts:58` |
| Retired (evicted but referenced) | `MAX_RETIRED = 32` | FIFO sacrifice oldest | `src/lib/utils/authed-image.ts:73` |
| Full grid profiles | `MAX_PROFILE_CACHE = 1000` | LRU | `src/routes/(protected)/(navbar)/(root)/grid.ts:129` |
| Viewers list | `MAX_STORED_VIEWERS` (see `viewers.svelte.ts`) | FIFO slice | `src/lib/app-data/viewers.svelte.ts:152` |
| PIN backoff ladder | Unbounded attempts → capped by backoff deadline | Time-based expiry | `src/lib/app-data/app-lock.svelte.ts` |
| Saved phrases | No explicit cap (localStorage quota) | Manual delete | `src/lib/stores/saved-phrases.svelte.ts` |
| Explore location | Single geohash | Overwrite | `src/lib/stores/explore-location.svelte.ts` |

**Disk:** All persistent state in `localStorage` (keys: `grindrx-pinlock-*`, `grindrx-explore-location`, `grindrx-saved-phrases`, `grindrx-onboarding-*`, `grindrx-geohash-user-pinned`, preferences). No IndexedDB, no Opus/SQLite on frontend.

---

### 2.6 Cache Hit/Miss Behavior & Eviction

- **Authed image cache:** Dedupes by source URL; `inflight` map prevents duplicate fetches. On eviction, if `refCount > 0` → parked in `retired` until last release. `purgeAuthedImageCache()` revokes **all** blobs (including retired) and clears maps.
- **Profile cache:** LRU, cleared on grid reset (location change, refresh, logout).
- **Viewers:** FIFO, persisted to `localStorage` + `$state` rune.

---

### 2.7 Network Request Counts & Transferred Bytes (limits in code)

| Path | Inbound Cap | Outbound Cap | Notes |
|------|-------------|--------------|-------|
| Generic `request` bridge | `MAX_API_RESPONSE_BYTES = 32 MiB` | `MAX_REQUEST_PAYLOAD_BYTES = 8 MiB` | msgpack depth check (`MAX_DEPTH`) |
| `fetch_authed_bytes` / `fetch_media_bytes` | `MAX_FETCH_BYTES = 10 MiB` | — | Stream-capped, no redirect |
| `upload_image` / `upload_album_content` / `upload_profile_image` | `MAX_UPLOAD_RESPONSE_BYTES = 32 MiB` | `MAX_IMAGE_BASE64 = 30 MiB base64 (~22 MiB binary)` | Base64 decoded before size check |
| `fetch_latest_release` / `fetch_download_stats` / `fetch_active_users` | `MAX_PUBLIC_JSON_BYTES = 256 KiB` | — | Fixed URLs, no auth |
| WS frames | `max_message_size = 1 MiB`, `max_frame_size = 1 MiB` | — | Tungstenite config |

**Observation:** Image uploads dominate bandwidth. A 12 MP photo → downscaled to 1920 px edge → JPEG 0.85 → base64 (~33% inflation) → IPC → Tauri decodes → re-sends as raw bytes. Two full round-trips through base64.

---

### 2.8 Image/Media Dimensions & Processing Cost

| Parameter | Value | Location |
|-----------|-------|----------|
| Max upload edge | 1920 px | `src/lib/api/profile.ts:319` |
| Re-encode quality | 0.85 (JPEG) | `src/lib/api/profile.ts:322` |
| Re-encode path | **All non-GIF** images via `canvas.toBlob()` (EXIF strip) | `src/lib/api/profile.ts:513-525` |
| GIF handling | Metadata strip in-place, no re-encode | `src/lib/api/profile.ts:519-521` |
| Base64 chunk size | 32 KiB (`0x8000`) | `src/lib/base64.ts:28` |
| Media fetch cap | 10 MiB per image | `src-tauri/src/api/rest.rs:577` |

**Cost note:** Canvas re-encode runs on main thread. Large images (even ≤ 1920 px) still allocate bitmap + canvas + blob sequentially.

---

### 2.9 Large Allocations & Repeated Serialization

| Pattern | Location | Mitigation |
|---------|----------|------------|
| Base64 encode multi-MB `Uint8Array` | `src/lib/base64.ts:24-34` | Chunked 32 KiB `String.fromCharCode(...chunk)` |
| Base64 decode → `Uint8Array` | `src/lib/base64.ts:1-9` | `Uint8Array.fromBase64` native if available |
| msgpack decode unbounded nesting | `src-tauri/src/api/rest.rs:204, 318, 957, 1007` | `msgpack_depth::check_depth(bytes, MAX_DEPTH)` |
| Response body streaming | `src-tauri/src/api/rest.rs:609-623` | `stream_capped_body` with running counter |
| WS message parse | `src-tauri/src/api/ws.rs:291` | `serde_json::from_str` per frame (1 MiB cap) |

---

### 2.10 List Virtualization & Rendering Workload

#### Grid (`src/routes/(protected)/(navbar)/(root)/GridWindow.svelte`)
- **Chunking:** `ROWS_PER_CHUNK = 4`, `itemsPerChunk = columns × 4`
- **Overscan:** `OVERSCAN_CHUNKS = 1` (mounts 1 chunk above/below viewport)
- **Observer:** `IntersectionObserver` with `rootMargin: "600px 0px 600px 0px"`
- **Collapsed spacer:** Exact pixel height (`rows × rowHeight + gaps`) — measured, not assumed
- **Accessibility:** `sr-only` text list inside spacer for screen readers

#### Conversation MessagesList (`src/routes/(protected)/chat/[conversationId]/MessagesList.svelte`)
- **No virtualization** — renders entire `messages` array
- Pagination via `IntersectionObserver` sentinel at top (`rootMargin: "400px"`)
- `loadMore()` guards against zero-progress pages
- Skeleton widths precomputed to avoid layout jitter

**Risk:** Long conversations (hundreds of messages with images) mount all `<img>` elements → decoded bitmaps accumulate in GPU/native heap. No unmount-on-scroll.

---

### 2.11 Polling Frequency & Background Work

| Timer | Interval | Condition | Location |
|-------|----------|-----------|----------|
| Conversation reconcile (poll) | 10 s | WS **disconnected** | `src/routes/(protected)/chat/[conversationId]/conversation-state.svelte.ts:25, 479` |
| Safety-net reconcile | 60 s | **Always** (even WS connected) | `src/routes/(protected)/chat/[conversationId]/conversation-state.svelte.ts:28, 506` |
| WS heartbeat | 45 s | WS connected | `src-tauri/src/api/ws.rs:19` |
| WS reconnect backoff | 1 s → 2 s → 4 s → … → 30 s | WS disconnected | `src-tauri/src/api/ws.rs:70, 92-94` |
| Conversations `ensureLoaded` | 2 s throttle | New message arrives | `src/routes/(protected)/chat/conversations.svelte.ts:350` |
| Grid GPS updater | On mount + location change | Mobile only | `src/routes/(protected)/(navbar)/(root)/+page.svelte:73-98` |

**Concurrency:** Each open conversation holds two `setInterval` timers (poll + safety-net). No global coordinator — N conversations = N × 2 timers.

---

### 2.12 Retry Amplification (retry policy: max attempts, backoff, jitter)

#### REST (`src/lib/net/retry.ts`)
| Parameter | Value | Effect |
|-----------|-------|--------|
| `maxAttempts` | 3 | Initial + 2 retries |
| `baseDelayMs` | 250 | Exponential: 250, 500, 1000, 2000, 4000 (capped) |
| `maxDelayMs` | 4000 | Ceiling per sleep |
| `maxElapsedMs` | 45000 | Wall-clock budget |
| `maxSleepMs` | 6000 | Total sleep budget |
| Jitter | Full-ish: `ceiling/2 + random() × ceiling/2` | Uniform in `[ceiling/2, ceiling]` |
| `Retry-After` | Honored as floor | Never clamped down |

**Amplification scenario:**  
Grid + conversations + 10 s reconcile all fire concurrently → N × 3 attempts in first second if transient failure.

#### WebSocket (`src-tauri/src/api/ws.rs:62-66, 92-94`)
```rust
fn jitter(d: Duration) -> Duration {
  let factor = 0.8 + rand::random::<f64>() * 0.4; // ±20%
  d.mul_f64(factor)
}
backoff = (backoff * 2).min(Duration::from_secs(30));
```
- No `maxAttempts` — retries indefinitely until `ChannelClosed`
- Backoff reset **only on first inbound frame** (not on handshake)

---

### 2.13 Concurrency Limits & Resource Contention

| Resource | Limit | Mechanism |
|----------|-------|-----------|
| WS send channel | 64 pending commands | `mpsc::channel(64)` in `lib.rs:19` |
| WS send timeout | 5 s | `tokio::time::timeout(WS_SEND_TIMEOUT, ...)` |
| Authed image inflight dedup | Per URL | `inflight: Map<url, Promise>` |
| Grid batch resolution | Per `batchIndex` | `#loadingBatches: Set<number>` |
| Conversations `ensureLoaded` | Per conversation + 2 s global | `#ensureLoadedInFlight: Set<string>` + `#lastEnsureLoadedAt` |
| Auth redirect | Process-wide | `authRedirectLatched: boolean` |
| Rust HTTP client | Shared `reqwest::Client` (connection pool) | `RwLock<Client>` |

**Observation:** No semaphore limiting concurrent image fetches. `fetch_authed_bytes` called per image → N concurrent Rust HTTP requests (bounded only by reqwest pool default).

---

### 2.14 Battery-/Lifecycle-Sensitive Work

| Behavior | Implementation |
|----------|----------------|
| Background WS | Android foreground service keeps process alive; WS loop continues |
| Notifications suppressed | `AppState::locked` + `prefs_loaded` + `notify_messages/taps` gates |
| Foreground tracking | `set_foreground` command from WebView → `AtomicBool` |
| GPS updates | Only on mobile (`platform()` check), only when not pinned/exploring |
| App lock | PIN/biometric gate; defers auth redirect until unlock |

---

## 3. Static Performance Risks (Code-Derived)

| ID | Risk | Evidence | Severity |
|----|------|----------|----------|
| PERF-01 | **Unbounded conversation message list** — no virtualization, all messages + images mounted | `MessagesList.svelte` renders `messages` array directly | P1 |
| PERF-02 | **Authed image cache retains 32 full-res blobs + 32 retired** — no runtime PSS measurement on mid-range device | `authed-image.ts:58,73`; comment cites "~562 MB PSS observed on-device" at 96 entries | P1 |
| PERF-03 | **No concurrency limit on image fetches** — scrolling grid fires N `fetch_authed_bytes` simultaneously | `authed-image.ts` has per-URL dedup but no global semaphore | P2 |
| PERF-04 | **WS reconnect has no attempt cap** — exponential backoff to 30 s indefinitely | `ws.rs:70, 94` | P2 |
| PERF-05 | **Three timers per open conversation** (10 s poll, 60 s safety-net, 45 s heartbeat) — no coalescing | `conversation-state.svelte.ts:25,28`; `ws.rs:19` | P2 |
| PERF-06 | **Base64 round-trip for uploads** — image → base64 (JS) → decode (Rust) → raw bytes (HTTP) → response base64 → decode (JS) | `profile.ts:609, 637`; `rest.rs:361-363` | P2 |
| PERF-07 | **Canvas re-encode on main thread** for every non-GIF upload, even ≤ 1920 px | `profile.ts:564-590` | P3 |
| PERF-08 | **DOM project test rebuild per test** — 2.28 s → 5.56 s under contention | `vite.config.mjs:88-98` | P3 (CI) |
| PERF-09 | **Profile cache 1000 entries** — each holds photo hash arrays (~200 B) → ~200 KB, but survives logout until grid reset | `grid.ts:128-129`; cleared in `grid-state.svelte.ts:219` | P3 |
| PERF-10 | **`request` bridge 8 MiB payload cap but 32 MiB response cap** — asymmetry permits large inbound | `rest.rs:126, 583` | P3 |

---

## 4. Unmeasurable Without Device/Server

| Metric | Prerequisite |
|--------|--------------|
| Actual build time (clean / incremental) | `bun run build` + `cargo build --release` on target hardware |
| Test suite wall time (node / dom / rust) | `bun run test` in CI environment |
| Cold-start latency (TTI, first paint) | Physical Android device + `tauri android build --apk` |
| Runtime PSS / GPU memory (grid scroll, album open, chat with images) | Android Studio Profiler / `adb shell dumpsys meminfo` |
| Network RTT / throughput to `grindr.mobi` / `cdns.grindr.com` | Live network + valid session |
| Battery drain (foreground / background WS) | Battery Historian / `adb bugreport` over hours |
| Image decode time (1920 px JPEG / HEIC / AVIF) | Device GPU + WebView version |
| WS reconnect storm behavior under Doze | Real Android Doze mode + server disconnect |

---

## 5. Measurement Methodology (for future runtime verification)

| Metric | Method | Tool |
|--------|--------|------|
| Build time | `time bun run build && time cargo build --release --manifest-path src-tauri/Cargo.toml` | `time` |
| Test time | `time bun run test:unit && time bun run test:rust` | `time` |
| Startup latency | `tauri android build --apk`, install, `adb logcat -b events` + `ActivityManager` timestamps | Android Studio / Perfetto |
| PSS / GPU mem | `adb shell dumpsys meminfo <pkg>` during grid scroll / album / chat | `dumpsys` / Perfetto |
| API latency | Instrument `fetchRest` / `fetch_authed_bytes` with `performance.now()` | DevTools / custom metric |
| Battery | `adb bugreport` → Battery Historian | Battery Historian |
| Cache hit rate | Instrument `resolveAuthedImage` cache hit/miss counters | DevTools console |

---

## 6. Ledger Entries (JSONL Format)

See companion file: `measure-08-performance.jsonl`

---

## 7. Conclusion

The codebase contains **well-bounded caches** (32 / 1000 entries), **explicit caps** on all network I/O (8–32 MiB), and **structured retry/backoff** with wall-clock budgets. The primary static risks are:

1. **Conversation message list lacks virtualization** — unbounded DOM growth with media.
2. **Image fetch concurrency unbounded** — no semaphore, only per-URL dedup.
3. **WS reconnect has no max attempts** — indefinite exponential backoff.
4. **Base64 double-encoding on upload path** — 33% size inflation × 2 round-trips.
5. **No runtime measurements exist** — all above are code-derived upper bounds.

**Next step:** Execute runtime measurements on physical Android device (API 28+) with a valid Grindr session to populate actual latency, memory, and battery numbers.