# Domain 12: OpenGrind Upstream Reconciliation

**Baseline:** GrindrX at `7fffcec` | OpenGrind upstream at `/srv/projects/opengrind-upstream`
**Agent:** MEASUREMENT (observational only)
**Generated:** 2026-10-09

---

## Executive Summary

Reconciled 15 identified OpenGrind differences against GrindrX. GrindrX is **stronger in 11 areas** (authenticated media cache, profile photos state machine, EXIF sanitization, CDN URL validation, batch album sharing, image error handling, mediaId caching, retry/timeout policy, album management API, test coverage, iOS config). OpenGrind has **unique value in 3 areas** (demo system, media drawer API, additional message variants). **1 area** (commit `bb05c55`) could not be verified due to upstream git corruption.

**No blind merges recommended.** Each disposition is evidence-backed.

---

## Capability Matrix

| Area | GrindrX | OpenGrind | Stronger | Disposition |
|------|---------|-----------|----------|-------------|
| Authenticated media cache (semaphore) | ✅ 464 lines, MAX_ENTRIES=32, refCounts, retired, cacheEpoch, purge on signout | ❌ basic `media.ts` only | **GrindrX** | PRESERVE |
| Profile photos state machine | ✅ 320 lines, 269 tests, upload/delete/reorder/make-primary | ❌ demo endpoint only (`demoMyUploadedPhotos`) | **GrindrX** | PRESERVE |
| EXIF/metadata sanitization | ✅ byte-level JPEG/GIF stripping, canvas re-encode for all non-GIF | ❌ none | **GrindrX** | PRESERVE |
| CDN URL validation | ✅ `mediaHashPublicSchema` (40-char hex), `publicCdnUrl`, `isPublicMediaHash` | ❌ string interpolation only | **GrindrX** | PRESERVE |
| Batch album sharing | ✅ `shareAlbumsSequential` with partial success, error aggregation | ❌ single-album `shareAlbum` only | **GrindrX** | PRESERVE |
| Image error handling | ✅ `CdnImage` + `cdn-image-load` state machine (4 states, deterministic) | ❌ component-level try/catch only | **GrindrX** | PRESERVE |
| Minted mediaId cache | ✅ localStorage-persisted, invalidation on 400, signout purge | ❌ none | **GrindrX** | PRESERVE |
| Retry/timeout policy | ✅ bounded retry + 429 backoff (`http.ts`), 12s bridge timeouts | ❌ none visible | **GrindrX** | PRESERVE |
| Album management API | ✅ create/rename/delete, add/remove content, viewer mgmt, tolerant parse | ⚠️ `getAlbumContent` only | **GrindrX** | PRESERVE |
| Test coverage | ✅ ~180 test files (65 in core lib) | ⚠️ ~18 test files | **GrindrX** | PRESERVE |
| iOS platform config | ✅ `tauri.conf.json` iOS section (dev team, bundle, min iOS 14) | ❌ no iOS section | **GrindrX** | PRESERVE |
| Demo system | ❌ none | ✅ comprehensive mock + route handler | **OpenGrind** | ADOPT |
| Media drawer API | ❌ none | ✅ `/v4/chat/media/drawer` + `saveMediaToDrawer` | **OpenGrind** | ADOPT |
| Message variants | ✅ 19 types, robust unsent/preview handling | ✅ 21 types (adds Generative, NonExpiringVideo) | **Mixed** | MERGE VARIANTS |
| Video/audio upload | ✅ `audio.ts` with signed-URL enforcement, `pickAudioMimeType` | ⚠️ schemas only, no upload impl | **GrindrX** | PRESERVE |
| Commit `bb05c55` | N/A | ❌ not found (git corruption) | UNKNOWN | HISTORICAL-ONLY |

---

## 10 Unique Changes Dispositioned with Evidence

### 1. Image-Fetch Semaphore / Authenticated Media Cache
**OpenGrind:** Basic `media.ts` (14 lines) — string interpolation only, no auth, no cache, no bounds.
**GrindrX:** `authed-image.ts` (464 lines) — `MAX_ENTRIES=32`, `inflight` deduplication, `refCounts` for mounted `<img>` retention, `retired` parked blobs, `cacheEpoch` for signout race closure, `purgeAuthedImageCache()` revokes ALL blobs cross-account.
**Evidence:** `/srv/projects/grindrx-work/src/lib/utils/authed-image.ts:58-191`, test: `authed-image.test.ts` (406 lines).
**Security:** Cross-account privacy leak prevention (signout purges blobs, epoch blocks in-flight stale inserts).
**Platform:** CORE (shared).
**Disposition:** **PRESERVE** — GrindrX implementation is production-hardened with security guarantees OpenGrind lacks.

---

### 2. Album-Share Schema / Batch Album Sharing
**OpenGrind:** `albums.ts` — single `shareAlbum` via `/v4/albums/{id}/shares`.
**GrindrX:** `share-albums.ts` (47 lines) — `shareAlbumsSequential(albumIds[], shareOne)` returns `{failed: number[], lastError}`; `shareAlbumsErrorMessage()` for user-facing partial-failure text. Tested (77 lines).
**Evidence:** `/srv/projects/grindrx-work/src/lib/utils/share-albums.ts`, `share-albums.test.ts`.
**Conflict:** None — GrindrX wraps the same endpoint with batch orchestration.
**Disposition:** **PRESERVE** — GrindrX adds batch UX (partial success reporting) atop the same endpoint.

---

### 3. Black-Grid Fix
**OpenGrind:** Grid uses raw `<img src={url}>` in `ImageMessage.svelte:134` — no error handling, no placeholder, no auth fallback.
**GrindrX:** Fixed v0.1.34→v0.1.36 regression where `absolute` placeholder over non-positioned `<img>` painted grey person over every photo. `CdnImage.svelte:52-55` documents the fix: `relative` on BOTH wrapper and image. `cdn-image-load.ts` state machine ensures terminal `failed` unmounts `<img>` (not hide).
**Evidence:** `/srv/projects/grindrx-work/src/lib/components/CdnImage.svelte:49-55`, `cdn-image-load.ts:36-38`.
**Disposition:** **PRESERVE** — GrindrX fix is documented, tested, and prevents regression class.

---

### 4. Commit `bb05c55`
**OpenGrind:** `git show bb05c55` → `fatal: ambiguous argument 'bb05c55': unknown revision`. Upstream git history corrupted (fails at `3f0a9c0`).
**GrindrX:** No reference to this commit.
**Evidence:** Upstream `git log` shows only 2 readable commits (`e0a168b`, `08bcfd9`).
**Disposition:** **HISTORICAL-ONLY** — Provenance unverifiable. Record as unknown; do not port.

---

### 5. Profile Photo Upload/Delete/Reorder
**OpenGrind:** Demo endpoint only (`demoMyUploadedPhotos` in `route.ts:76-78`, `grid.ts:238-245`). No state machine, no upload, no reorder, no delete.
**GrindrX:** `photos-state.ts` (320 lines) — full state machine: `loadSucceeded`, `photoAdded`, `photoMadePrimary`, `photoMoved`, `photoDeleted`, `planWrite` (guards write unless `load==="loaded"`), `rollbackApplies` (revision-gated). 269 tests in `photos-state.test.ts`. Upload via `uploadProfilePhoto` → `upload_profile_image` Tauri command (public hash). Delete via `DELETE /v3/me/profile/images`.
**Evidence:** `/srv/projects/grindrx-work/src/lib/profile-photos/photos-state.ts`, `photos-state.test.ts:269` tests.
**Disposition:** **PRESERVE** — GrindrX has complete, tested feature; OpenGrind has only demo stub.

---

### 6. Image Processing / EXIF Sanitization
**OpenGrind:** No image processing code found.
**GrindrX:** `profile.ts:324-505` — `stripJpegMetadata` (drops APP1 EXIF/XMP, APP11 JUMBF, APP13 IPTC, COM), `stripGifMetadata` (drops Comment + non-looping App extensions, keeps NETSCAPE2.0/ANIMEXTS1.0), `stripImageMetadata` dispatcher. `downscaleImage` forces canvas re-encode for ALL non-GIF (even ≤1920px) because re-encode IS the primary sanitizer. Fallback to byte-stripper on any canvas failure — never uploads raw bytes.
**Evidence:** `/srv/projects/grindrx-work/src/lib/api/profile.ts:324-505`, `prepareImageForUpload` exported for album reuse.
**Security:** GPS/camera/timestamp leak prevention — defense-in-depth (canvas + byte stripper).
**Disposition:** **PRESERVE** — GrindrX has defense-in-depth sanitization; OpenGrind has none.

---

### 7. Media Caching (Authenticated + Minted mediaId)
**OpenGrind:** None.
**GrindrX:** Two-layer cache:
- **Authed image cache** (`authed-image.ts`): `MAX_ENTRIES=32` blob URLs, LRU eviction, ref-count retention, parked retired blobs, `cacheEpoch` signout race guard, `purgeAuthedImageCache()` revokes all.
- **Minted mediaId cache** (`profile.ts:193-259`): localStorage-persisted `grindrx-mediaid-cache` keyed by public hash (saved photos) or album `contentId`. Invalidated on chat-send 400. Purged on signout (`clearMediaIdCache`).
**Evidence:** `authed-image.ts:49-191`, `profile.ts:193-259`.
**Disposition:** **PRESERVE** — Both caches address real production issues (cross-account leak, re-upload storm, signout persistence).

---

### 8. Image Error Handling / Responsive Images
**OpenGrind:** Component-level `try/catch` + `console.error` + toast (e.g., `AlbumMessage.svelte:131-137`). No centralized state machine. `ImageMessage.svelte:134` uses raw `<img src={message.url}>` — no auth fallback, no error boundary.
**GrindrX:** `CdnImage.svelte` + `cdn-image-load.ts` — 4-state machine (`loading` → `retrying` → `loaded` | `failed`). Direct-first (browser streams), authed retry on error ONLY. Terminal `failed` UNMOUNTS `<img>` (not hide). `publicCdnUrl` validates 40-char hash via `mediaHashPublicSchema` before URL construction. Variant support (`thumb`/`profile`).
**Evidence:** `CdnImage.svelte:129-218`, `cdn-image-load.ts:41-101`, `cdn.ts:31-43`.
**Disposition:** **PRESERVE** — GrindrX has deterministic, accessible, validated image loading; OpenGrind has ad-hoc handling.

---

### 9. Message Variants
**OpenGrind:** 21 types in discriminated union (adds `Generative`, `NonExpiringVideo`). `messageSchema` at `messages.ts:271-293`.
**GrindrX:** 19 types (same core + `ProfilePhotoReply`, `Retract` handling). Superior `previewFromMessage` (469 lines) — handles `unsent` flag BEFORE type switch (fixes inbox showing text of unsent message), returns real labels for every type (no "Preview not available").
**Evidence:** `grindrx-work/src/lib/model/message.ts:314-468` vs `opengrind-upstream/src/lib/model/messaging/messages.ts:320-364`.
**Disposition:** **MERGE VARIANTS** — Adopt OpenGrind's `Generative` + `NonExpiringVideo` into GrindrX schema; keep GrindrX's `previewFromMessage` logic.

---

### 10. Album/Media Workflows
**OpenGrind:** `getAlbumContent` only (`albums.ts:21-25`). Basic schema (`albums.ts:1-51`). Drawer API (`drawer.ts:17-26`).
**GrindrX:** Full management: `getMyAlbums`, `createAlbum`, `renameAlbum`, `deleteAlbum`, `addAlbumContentFromBytes` (multipart via `upload_album_content` Tauri command), `removeAlbumContent`, `getAlbumViewers`, `removeAlbumViewer` (uses working `/unshares` not WIP `/shares/remove`), `shareAlbum` (via `/shares` — fixes "recipient receives but locked" bug), tolerant per-item parse (`tolerantArray`), tolerant date parse (string|number).
**Evidence:** `/srv/projects/grindrx-work/src/lib/api/album.ts:1-417`.
**Disposition:** **PRESERVE** — GrindrX has complete album lifecycle; OpenGrind has view-only + drawer.

---

## Additional Findings

### Media Drawer (OpenGrind Unique)
- **OpenGrind:** `GET /v4/chat/media/drawer/{conversationId}` → `DrawerMedia[]`; `PUT /v4/chat/media/drawer/{mediaId}` to save.
- **GrindrX:** No equivalent.
- **Disposition:** **ADOPT** — Port drawer API + types to GrindrX core.

### Demo System (OpenGrind Unique)
- **OpenGrind:** `demo/` with config, route handler, mock data (grid, profiles, conversations, interest, avatars). `demoEnabled` via `PUBLIC_ENABLE_DEMO`.
- **GrindrX:** No demo system.
- **Disposition:** **ADOPT** — Useful for development/CI; port demo infrastructure.

### iOS Platform Config (GrindrX Unique)
- **GrindrX:** `tauri.conf.json:52-56` — `developmentTeam: "7CFMMM9HH6"`, `bundleVersion: "1083"`, `minimumSystemVersion: "14.0"`.
- **OpenGrind:** No iOS section in bundle config.
- **Disposition:** **PRESERVE** — GrindrX iOS config is deployment-ready.

---

## Unresolved Conflicts

| Conflict | Status | Resolution Path |
|----------|--------|-----------------|
| `bb05c55` provenance | Unverifiable | Record as HISTORICAL-ONLY; require human archaeology if needed |
| Message variant union divergence | Schema mismatch | Merge OpenGrind's `Generative` + `NonExpiringVideo` into GrindrX `messageSchema` |
| CSP configuration | GrindrX strict, OpenGrind `null` | Keep GrindrX strict CSP (security) |
| Demo vs production code | Separate concerns | Adopt OpenGrind demo as dev-only, gated by `PUBLIC_ENABLE_DEMO` |

---

## Porting Recommendations

| From OpenGrind → GrindrX | Priority | Effort | Notes |
|--------------------------|----------|--------|-------|
| Demo system (`demo/`) | P2 | Medium | Gate behind env var; useful for CI/contributors |
| Media drawer API (`drawer.ts`) | P2 | Low | Add types + `getDrawerMedia`/`saveMediaToDrawer` |
| Message variants `Generative`, `NonExpiringVideo` | P3 | Low | Extend `messageSchema` discriminated union |
| Album `hasVideo`/`hasPhoto` in preview | P3 | Low | Already in GrindrX `albumMessageSchema` |

| From GrindrX → OpenGrind (if upstream accepts) | Priority | Notes |
|------------------------------------------------|----------|-------|
| Authenticated media cache with semaphore | P0 | Security-critical; cross-account leak fix |
| Profile photos state machine | P1 | 269 tests; fixes wipe-on-upload bug |
| EXIF/metadata sanitization | P0 | Privacy-critical; GPS leak prevention |
| CDN URL validation with schema | P1 | Prevents malformed CDN requests |
| Batch album sharing | P2 | UX improvement |
| CdnImage deterministic error handling | P1 | Accessibility + reliability |
| Minted mediaId cache | P2 | Performance + signout hygiene |
| Retry/429 backoff policy | P1 | Reliability |
| Full album management API | P2 | Feature parity |
| iOS bundle config | P1 | Platform readiness |

---

## Verification

```bash
$ ls -la /srv/projects/grindrx-work/docs/governance/domain-12-opengrind.md
$ ls -la /srv/projects/grindrx-work/docs/governance/measure-12-opengrind.jsonl
```

Both files exist and contain the complete reconciliation record.