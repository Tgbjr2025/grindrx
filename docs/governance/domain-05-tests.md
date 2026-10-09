# Domain 5: Tests & CI — Measurement Report

**Repository:** `/srv/projects/grindrx-work` at commit `7fffcec` (branch `main`)
**Measurement Date:** 2026-10-09
**Agent:** measurement-agent-v5@nvidia/nemotron-3-ultra

---

## Executive Summary

| Metric | Value | Status |
|--------|-------|--------|
| Frontend test files | 65 | ✅ Measured |
| Frontend test cases | 953 | ✅ Measured (all passing) |
| Rust test cases | 16 | ⚠️ Discovered (not executable) |
| DOM test files | 3 | ✅ Measured (42 tests) |
| Statement coverage | 77.48% | ✅ Measured |
| Branch coverage | 69.37% | ✅ Measured |
| Function coverage | 77.29% | ✅ Measured |
| Line coverage | 79.16% | ✅ Measured |
| Flaky tests (3 runs) | 0 | ✅ Measured |
| Skipped/disabled tests | 0 | ✅ Measured |
| CI validation scope | lint + typecheck + unit + rust-lib | ✅ Measured |

**Critical Finding:** The test suite is **comprehensive at the unit/integration level** (953 passing tests) but has **significant gaps at the platform/integration level**: no Android target compilation in CI, no e2e tests, no Tauri plugin tests, and WebSocket/realtime layer at only 32.75% coverage.

---

## 1. Test Inventory by Category

### 1.1 By Framework & Environment

| Category | Files | Tests | Notes |
|----------|-------|-------|-------|
| Vitest (node env) | 62 | 911 | `src/**/*.test.ts` excluding `*.dom.test.ts` |
| Vitest (jsdom + browser resolve) | 3 | 42 | `*.dom.test.ts` suffix; 20s timeout due to `vi.resetModules()` |
| Rust `#[test]` | 2 files | 16 | `src-tauri/src/api/headers.rs` (2), `msgpack_depth.rs` (14) |

### 1.2 By Test Type (Manual Classification)

| Type | Count | Description |
|------|-------|-------------|
| Unit (pure logic, mocked deps) | ~875 | Majority; heavy mocking of Tauri IPC |
| Integration (real module state) | ~25 | `purge.test.ts`, `index.test.ts` session-lost purge, `CdnImage.dom.test.ts` |
| Contract/Guard (static assertions) | 36 | API endpoints, request/response schemas, registration gaps |
| End-to-end | 0 | No Playwright/Cypress/Tauri driver tests |
| Platform (Android/iOS) | 0 | Manual only on macOS build host |
| Native (Rust) | 16 | Linux host only; Android `cfg` blocks uncompiled |

### 1.3 By Subsystem

| Subsystem | Files | Tests | Coverage (Stmts) |
|-----------|-------|-------|------------------|
| `src/lib/api/` | 23 | 328 | 78.36% |
| `src/lib/model/` | 8 | 114 | 98.29% |
| `src/lib/utils/` | 13 | 147 | 90.78% |
| `src/lib/app-data/` | 4 | 71 | 83.44% |
| `src/routes/**` | 5 | 82 | 35.63–100% |
| `src/lib/stores/` | 3 | 23 | 88.57% |
| `src/lib/profile-photos/` | 1 | 28 | 100% |
| `src/lib/profile-tags/` | 1 | 29 | 100% |
| `src/lib/components/` | 3 | 22 | 95.08% |
| `src/lib/net/` | 1 | 71 | 98.24% |
| Other | 6 | 64 | Varies |

---

## 2. Test Execution Results

### 2.1 Frontend (Vitest) — 3 Consecutive Runs

| Run | Duration | Test Files | Tests Passed | Tests Failed |
|-----|----------|------------|--------------|--------------|
| 1 | 13.50s | 65 | 953 | 0 |
| 2 | 14.04s | 65 | 953 | 0 |
| 3 | 15.65s | 65 | 953 | 0 |

**No flaky tests observed.** All 953 tests pass consistently.

### 2.2 Rust Tests — Not Executable

```bash
$ cargo test --manifest-path src-tauri/Cargo.toml --lib
# cargo not installed in this environment
```

CI runs this on `ubuntu-latest` but **only for Linux host target** (see CI gaps below).

### 2.3 Coverage Details (v8 provider)

| Scope | Statements | Branches | Functions | Lines |
|-------|------------|----------|-----------|-------|
| **All files** | **77.48%** | **69.37%** | **77.29%** | **79.16%** |
| src/lib/model | 98.29% | 96.84% | 82.35% | 98.66% |
| src/lib/net | 98.24% | 90.00% | 100% | 97.82% |
| src/lib/profile-photos | 100% | 95.55% | 100% | 100% |
| src/lib/profile-tags | 100% | 95.00% | 100% | 100% |
| src/lib/components | 95.08% | 75.00% | 100% | 97.87% |
| src/lib/api | 78.36% | 75.17% | 78.34% | 80.17% |
| src/lib/app-data | 83.44% | 73.23% | 88.88% | 85.23% |
| src/lib/utils | 90.78% | 83.84% | 91.17% | 92.07% |
| src/lib/stores | 88.57% | 79.06% | 100% | 89.47% |
| **src/lib/ws.svelte.ts** | **32.75%** | **8.33%** | **13.04%** | **35.84%** |
| **src/routes/.../grid-state.svelte.ts** | **15.10%** | **42.50%** | **43.33%** | **38.55%** |

---

## 3. Critical Path Coverage

### 3.1 Security / Privacy / Auth / Data-Loss (P0)

| Path | Tests | Coverage | Method |
|------|-------|----------|--------|
| Session-lost media purge | 10 | 95.94% (index.ts) | **Real blob cache exercised** — not mocked |
| Sign-out data purge | 5 | 96% (purge.ts) | **Real authed-image + viewers store** |
| Auth redirect deduplication | 6 | 95.94% | Mocked Tauri, real latch logic |
| App-lock deferral | 4 | 86.27% | Mocked, but tests deferral ordering |
| Cross-account viewer leak | 2 | 83.44% (app-data) | Real viewers store + localStorage |

**These are the strongest tests in the suite** — they exercise real in-memory state (blob URLs, viewer lists) rather than mocking the purge functions, proving bytes are actually revoked.

### 3.2 Migration / Data-Loss

| Path | Tests | Status |
|------|-------|--------|
| Schema migrations | 0 | No migration tests |
| Sign-out data clearing | 15 | Covered by purge.test.ts + index.test.ts |
| Account switching | 3 | Covered by session-lost purge tests |

### 3.3 Low-Coverage High-Risk Modules

| Module | Stmts | Branches | Functions | Risk |
|--------|-------|----------|-----------|------|
| `ws.svelte.ts` | 32.75% | 8.33% | 13.04% | **WebSocket lifecycle, reconnection, message framing untested** |
| `grid-state.svelte.ts` | 15.10% | 42.50% | 43.33% | Core grid mutations, cache invalidation, explore/nearby switching |
| `authed-image.ts` | 82.48% | 73.62% | 80% | Authenticated media fetch + cache — security sensitive |
| `conversation-state.svelte.ts` | 67.79% | 50% | 68.08% | Message reconciliation, optimistic UI, album-share identity |

---

## 4. Mock Fidelity Analysis

### 4.1 Tauri IPC (`@tauri-apps/api/core::invoke`)

- **30/65 test files** mock `invoke()`
- Mock pattern: `vi.fn(() => Promise.resolve())` or resolved with base64-encoded msgpack
- **Gap:** No contract validation against real Rust command signatures
- **Risk:** HIGH — Android-only commands (`tauri-plugin-biometric`, keyring backends) **never compiled in CI**

### 4.2 WebSocket (`$lib/ws.svelte.ts`)

- Mocked entirely in conversation tests (`vi.mock` with fake listeners)
- **Gap:** No test against real Grindr WS protocol (auth, reconnection, backoff, message framing)
- **Risk:** HIGH — WS layer at 32.75% coverage; real protocol behavior unverified

### 4.3 Tauri Events (`@tauri-apps/api/event::listen`)

- Mocked with `vi.fn(() => Promise.resolve(() => {}))`
- No verification of event names or payload shapes against Rust emitters

### 4.4 Svelte Navigation (`$app/navigation::goto`)

- Mocked with `vi.fn().mockResolvedValue(undefined)`
- No integration test of actual routing behavior

---

## 5. Dead Code / Unimplemented Interface References

| Finding | Location | Status |
|---------|----------|--------|
| Backup test file | `src/lib/model/message.test.ts.bak.pre_b8.20260926_155309` | Not executed (`.bak` extension) |
| UNVERIFIED endpoints | `auth-contract.test.ts` lines 62-68, 97-108 | **Explicitly asserted** as unimplemented (age-gate, terms, email-verification, change-email) |
| Audio URL TODO | `audio.contract.test.ts` line 15 | **Explicitly guarded** against reintroduction |

**No tests reference deleted or unimplemented interfaces** — the guard tests actively prevent drift.

---

## 6. Implementation Detail vs. Behavioral Assertions

| Pattern | Count | Assessment |
|---------|-------|------------|
| Internal state assertions (`batchIndex`, `pendingKey`, `__cachedAuthedImageCount`) | ~40 tests | **Deliberate** — regression tests for specific defects (CAS-4001, album-share duplicate, media leak) |
| User-visible behavior only | ~913 tests | Majority |
| Private method calls | 0 | No direct private method testing |

**Verdict:** Implementation-detail assertions are **targeted and justified** by defect history, not pervasive.

---

## 7. Duplicate Setup & Repeated Tests

### 7.1 Repeated Mock Setup (Moderate)

~30 files independently declare:
```typescript
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
```
No shared test utilities. Explicit per-file but verbose.

### 7.2 Actual Duplicate Test Cases

**None found.** Overlap between `grid.test.ts` and `grid-state.query.test.ts` on `cascadeV3QuerySchema` but different angles:
- `grid.test.ts`: Schema serialization/deserialization
- `grid-state.query.test.ts`: `buildCascadeQuery` integration with filter units

---

## 8. Test Performance

| Metric | Value | Notes |
|--------|-------|-------|
| Total suite time | 13.5–15.7s | 3 runs |
| Transform phase | ~65–75s | Svelte compilation |
| Import phase | ~115–138s | DOM project rebuilds module graph per test |
| Test execution | ~17–21s | Actual test runtime |
| Slowest file | `conversation-state.methods.test.ts` | ~3.8s (25 tests, async `vi.waitFor`) |
| DOM test timeout | 20,000ms | Configured in `vite.config.mjs` for module rebuild headroom |

**Bottleneck:** DOM project's `vi.resetModules()` per test forces full module graph rebuild (~2.3s unloaded, ~5.5s under contention).

---

## 9. High-Risk Missing Tests

| # | Gap | Impact | Evidence |
|---|-----|--------|----------|
| 1 | **No Android target compilation in CI** | Android-only `cfg` blocks (biometric, keyring, geolocation, fs plugins) never compiled | CI yaml lines 52-77 explicitly document this |
| 2 | **No e2e/device tests** | Full user flows (auth → grid → chat → media) untested on real WebView | No Playwright/Cypress/Tauri driver config |
| 3 | **No Tauri plugin integration tests** | Biometric auth, FS access, geolocation, notifications untested | Plugins behind `cfg(target_os = "android")` |
| 4 | **WebSocket protocol untested** | Real Grindr WS handshake, reconnection, message framing, CAS-4001 on WS | `ws.svelte.ts` at 32.75% coverage; mocked in all tests |
| 5 | **No migration tests** | Schema/data migrations between versions untested | No migration test files or scripts |
| 6 | **Grid state mutations under-tested** | Explore/nearby switching, cache invalidation, partial batch resolution | `grid-state.svelte.ts` at 15.1% coverage |

---

## 10. CI Configuration Analysis (`.github/workflows/ci.yml`)

### 10.1 What CI Actually Validates

| Job | Steps | Validates |
|-----|-------|-----------|
| `frontend` | `bun install --frozen-lockfile` → `lint` → `check` (svelte-check) → `test:unit` | Dependency lockfile, ESLint, TypeScript/Svelte types, 953 unit tests |
| `rust` | `cargo test --lib` (Linux host) | 16 Rust unit tests **for Linux desktop only** |

### 10.2 What CI Claims vs. Reality

| Claim (from CI comments) | Reality |
|--------------------------|---------|
| "minimum that would have caught a broken `svelte-check` or a red test before a release is tagged" | ✅ True for frontend + Rust lib |
| "does NOT build an APK (needs NDK, JDK, Android Rust targets)" | ✅ Honest — documented gap |
| "`tauri-plugin-biometric`... not compiled at all here" | ✅ Honest — Android `cfg` blocks invisible |
| "Nothing here is cross-compiled for aarch64-linux-android" | ✅ Honest — target-specific breaks invisible |

### 10.3 CI Gaps (Documented in CI File)

1. **Android compilation** — `cargo check --target aarch64-linux-android` not run
2. **Tauri plugins** — biometric, keychain, fs, geolocation, notification, opener, os, clipboard-manager untested
3. **APK build/sign** — Manual only on macOS
4. **Nix androidenv** — Could not resolve Tauri plugin projects

### 10.4 CI Strengths

- Frozen lockfile enforcement (`bun install --frozen-lockfile`)
- Concurrency control with cancel-in-progress
- Explicit version pinning (bun 1.3.11, rust 1.95.0)
- Cache keyed on lockfiles, not source tree

---

## 11. Ledger Compliance

All measurements recorded in `/srv/projects/grindrx-work/docs/governance/measure-05-tests.jsonl` with full ledger fields (ID, timestamp, actor, metric, value, unit, method, target, result, limitations, notes).

**Verification:** `ls -la /srv/projects/grindrx-work/docs/governance/measure-05-tests.jsonl` confirms file exists.

---

## 12. Conclusions & Recommendations

### Immediate (P0)
1. **Add Android target compilation to CI** — `cargo check --target aarch64-linux-android` to compile `cfg(target_os = "android")` blocks
2. **Add WebSocket integration tests** — At minimum, test reconnection logic and message framing against a mock server that mimics Grindr protocol
3. **Exercise grid-state mutations** — Current 15% coverage leaves core explore/nearby switching untested

### Short-term (P1)
4. **Centralize Tauri mocks** — Reduce duplication, improve fidelity with shared `vi.mock` utilities
5. **Add migration test harness** — Even synthetic migration tests for schema changes
6. **Profile DOM test performance** — `vi.resetModules()` per test costs ~5s under contention; evaluate caching strategy

### Long-term (P2)
7. **E2E test infrastructure** — Tauri driver or Playwright for desktop/WebView flows
8. **Contract testing against real Tauri commands** — Generate TypeScript types from Rust command signatures
9. **Device farm integration** — For Android/iOS platform tests

---

## Appendix: Test File Index

<details>
<summary>All 65 test files with test counts</summary>

| File | Tests | Environment |
|------|-------|-------------|
| `src/lib/api/index.test.ts` | 52 | node |
| `src/lib/net/retry.test.ts` | 71 | node |
| `src/lib/api/retry.test.ts` | 41 | node |
| `src/routes/(protected)/chat/[conversationId]/conversation-state.methods.test.ts` | 25 | node |
| `src/lib/app-data/app-lock.svelte.test.ts` | 23 | node |
| `src/lib/app-data/viewers.svelte.test.ts` | 23 | node |
| `src/lib/model/geohash.test.ts` | 23 | node |
| `src/lib/model/message.test.ts` | 24 | node |
| `src/lib/model/profile.test.ts` | 30 | node |
| `src/lib/api/profile.test.ts` | 30 | node |
| `src/lib/api/album.test.ts` | 30 | node |
| `src/lib/profile-tags/tags-state.test.ts` | 29 | node |
| `src/lib/profile-photos/photos-state.test.ts` | 28 | node |
| `src/lib/utils/authed-image.test.ts` | 24 | node |
| `src/lib/api/auth-contract.guard.test.ts` | 13 | node |
| `src/routes/(protected)/(navbar)/(root)/grid.cache.test.ts` | 13 | node |
| `src/lib/api/favorites-notes.test.ts` | 11 | node |
| `src/lib/stores/saved-phrases.svelte.test.ts` | 12 | node |
| `src/lib/utils/pin.test.ts` | 14 | node |
| `src/lib/utils/measurements.test.ts` | 13 | node |
| `src/lib/api/tags.test.ts` | 9 | node |
| `src/lib/api/messages.test.ts` | 9 | node |
| `src/lib/api/view.test.ts` | 8 | node |
| `src/lib/model/conversation.test.ts` | 8 | node |
| `src/lib/utils/version.test.ts` | 8 | node |
| `src/lib/api/auth-contract.test.ts` | 10 | node |
| `src/lib/api/grid.test.ts` | 10 | node |
| `src/lib/model/grid/cascade/response/v3.test.ts` | 10 | node |
| `src/routes/(protected)/(navbar)/(root)/grid-state.query.test.ts` | 10 | node |
| `src/lib/app-data/preferences.test.ts` | 10 | node |
| `src/lib/api/report.test.ts` | 12 | node |
| `src/lib/utils/cdn-image-load.test.ts` | 17 | node |
| `src/lib/components/CdnImage.dom.test.ts` | 12 | dom |
| `src/lib/android-native-bridge.dom.test.ts` | 21 | dom |
| `src/routes/(protected)/(navbar)/profile/[profileId]/profile-actions.test.ts` | 20 | node |
| `src/routes/(protected)/chat/[conversationId]/conversation-state.reconcile.test.ts` | 14 | node |
| `src/lib/api/audio.test.ts` | 16 | node |
| `src/lib/api/assignment.test.ts` | 16 | node |
| `src/lib/app-data/purge.test.ts` | 15 | node |
| `src/lib/utils/cdn.test.ts` | 15 | node |
| `src/lib/utils/note-extract.test.ts` | 12 | node |
| `src/lib/utils/share-albums.test.ts` | 7 | node |
| `src/lib/utils/stats.test.ts` | 7 | node |
| `src/lib/utils/distance.test.ts` | 7 | node |
| `src/lib/utils/linkify.paren.test.ts` | 7 | node |
| `src/lib/utils/day-group.test.ts` | 7 | node |
| `src/lib/api/biometric.test.ts` | 6 | node |
| `src/lib/api/taps.test.ts` | 5 | node |
| `src/lib/api/app-lock-gate.test.ts` | 5 | node |
| `src/lib/api/cache-bounds.test.ts` | 4 | node |
| `src/lib/api/no-broken-opener.test.ts` | 4 | node |
| `src/lib/api/hide.test.ts` | 7 | node |
| `src/lib/api/grid.api.test.ts` | 5 | node |
| `src/lib/api/audio.contract.test.ts` | 7 | node |
| `src/lib/components/cdn-image-layout.guard.test.ts` | 6 | node |
| `src/lib/components/filters/filters.test.ts` | 4 | node |
| `src/lib/back-gesture-event.dom.test.ts` | 9 | dom |
| `src/lib/update-gate.test.ts` | 19 | node |
| `src/lib/data/whats-new.test.ts` | 5 | node |
| `src/lib/model/album.test.ts` | 6 | node |
| `src/lib/model/engagement.test.ts` | 14 | node |
| `src/lib/model/right-now.test.ts` | 4 | node |
| `src/lib/stores/explore-location.svelte.test.ts` | 9 | node |
| `src/lib/stores/onboarding.svelte.test.ts` | 2 | node |
| `src/lib/utils/linkify.test.ts` | 6 | node |

**Total: 953 tests**
</details>