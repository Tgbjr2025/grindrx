# Master Measurement Ledger — GrindrX v0.1.48

**Project:** GrindrX  
**Baseline Commit:** `7fffcec` (tagged `v0.1.49-p0.1`)  
**Branch:** `main` / `migration/ovh-state-2026-10-05`  
**Audit Date:** 2026-10-09  
**Measurement Agent:** OpenCode (sequential domain agents)  
**Directive:** `/docs/governance/MASTER_MEASUREMENT_DIRECTIVE.md`

---

## 1. Ledger Summary

| Domain | Description | Entries | Status |
|--------|-------------|---------|--------|
| 01 | Repository Baseline & Source Inventory | 51 | ✅ Complete |
| 02 | Language & Complexity Metrics | 51 | ✅ Complete |
| 03 | Architecture & Dependency Graph | 38 | ✅ Complete |
| 04 | API, Protocol & Data-Contract Inventory | 19 | ✅ Complete |
| 05 | Tests & CI | 53 | ✅ Complete |
| 06 | Security Audit | 41 | ✅ Complete |
| 07 | Privacy & Data Lifecycle | 30 | ✅ Complete |
| 08 | Performance & Resource Use | 64 | ✅ Complete |
| 09 | Reliability & Fault Handling | 75 | ✅ Complete |
| 10 | Platform & Build Readiness | 59 | ✅ Complete |
| 11 | Git History & Provenance | 49 | ✅ Complete |
| 12 | OpenGrind Upstream Reconciliation | 32 | ✅ Complete |
| **Total** | **All measurable domains** | **562** | **✅ Complete** |

---

## 2. Coverage Register

| Subsystem | Expected Scope | Inspected | Measurements | Limitations | Status |
|-----------|----------------|-----------|--------------|-------------|--------|
| Source inventory | 791 tracked files | 791 | 9 | Binary test file excluded | ✅ |
| Complexity metrics | 491 TS/Svelte, 13 Rust | 491/13 | 14 | Logical SLOC requires cloc/tokei | ✅ |
| Architecture | All internal deps | 100% | 15 | 0 cycles found | ✅ |
| API contracts | 38 HTTP + 21 Tauri + 4 WS | 100% | 12 | Live server unverifiable | ✅ |
| Tests | 953 vitest + 17 Rust | 953/17 | 11 | Rust tests unexecuted | ✅ |
| Security | All auth/net/crypto paths | 100% | 19 | No SAST/DAST tools | ✅ |
| Privacy | 23 localStorage + 7 caches | 100% | 12 | Real device purge untested | ✅ |
| Performance | Static config + code review | 100% | 14 | Runtime metrics require device | ✅ |
| Reliability | All fault paths | 100% | 15 | No fault injection | ✅ |
| Platform | Android + iOS + Desktop | 100% | 13 | Android APK unbuilt, iOS unbuilt | ✅ |
| Git provenance | 4 repos | 4 | 13 | Upstream corrupted | ✅ |
| OpenGrind reconciliation | 10 unique changes | 6/10 verified | 8 | 4 unverifiable (corruption) | ✅ |

**Overall Coverage:** 12/12 domains measured. 0 unmeasured domains. 7 unmeasured runtime metrics (explicitly recorded with prerequisites).

---

## 3. Critical Findings (P0)

| ID | Domain | Finding | Evidence | Risk |
|----|--------|---------|----------|------|
| P0-001 | 07 | `grindx_messages` notification channel lacks `VISIBILITY_PRIVATE` | `ws.rs:521-527`, `MainActivity.kt:107-118`, `NotificationService.kt:161-172` | Lock-screen chat leak |
| P0-002 | 07 | Authenticated media cache (32 blobs) was cross-account leak; fixed v0.1.33 but regression possible | `authed-image.ts:1-464`, purge tests | Privacy violation |
| P0-003 | 10 | Version drift: `tauri.conf.json` (0.1.48/1083) ≠ `tauri.properties` (0.1.33/1068) ≠ APKs (0.1.32/1065→1085) | `tauri.conf.json:22`, `tauri.properties`, `build.gradle.kts` | Wrong version ships |
| P0-004 | 10 | Android APK never built/validated on device | CI config, README | Release untested |
| P0-005 | 11 | Commit `5b69ca4` absent from all repos — rescued iOS provenance gap | `git log --all`, all 4 repos | Historical loss risk |
| P0-006 | 11 | Stale Android assets tracked: will ship `0.1.33/1068/org.opengrind` in APK | `src-tauri/gen/android/.../tauri.conf.json`, `tauri.properties` | Branding/version broken |
| P0-007 | 04 | 9 HTTP endpoints unprobed (source comments: UNPROBED) | `api/index.ts`, domain-04 report | Contract unverified |
| P0-008 | 06 | No dependency vulnerability scanning in CI (cargo-audit missing, Bun lockfile) | `package.json`, `Cargo.toml`, CI | Supply chain risk |
| P0-009 | 07 | PNG/WebP/HEIF EXIF not stripped on canvas fallback | `profile.ts:502-504` | Metadata leak |
| P0-010 | 07 | `rotate_api_params` unlimited (DoS keystore via `advertising_id` regeneration) | `ws.rs`, keyring usage | DoS / credential wear |

---

## 4. High-Priority Findings (P1)

| ID | Domain | Finding |
|----|--------|---------|
| P1-001 | 07 | No user consent mechanism for telemetry pings |
| P1-002 | 05 | WebSocket protocol completely untested against real server |
| P1-003 | 05 | 30/65 test files mock `invoke()` with no contract validation |
| P1-004 | 08 | WebSocket reconnect has no max attempts (infinite retry) |
| P1-005 | 08 | MessagesList renders all messages (no virtualization) |
| P1-006 | 08 | Image upload: double base64 round-trip (33% × 2 expansion) |
| P1-007 | 09 | Android back gesture handler registered but never unregistered (leak) |
| P1-008 | 09 | `rotate_api_params` called without guard (race on rotation) |
| P1-009 | 10 | iOS: no background modes for WebSocket keep-alive |
| P1-010 | 10 | No CI for Android cross-compile, iOS build, desktop builds |
| P1-011 | 12 | `bb05c55` provenance unverifiable — upstream git corruption |
| P1-012 | 12 | Message variant union divergence (OpenGrind has 2 extra) |

---

## 5. Methodology

### Measurement Approach
- **Observational only** — no source modifications during baseline
- **Reproducible commands** — every measurement records exact command/method
- **Static analysis** — code inspection, grep, wc, git, config parsing
- **Test execution** — `npx vitest run --coverage` (953 passing)
- **Explicit uncertainty** — unmeasurable items recorded with prerequisites

### Toolchain
- `git` 2.43+, `node` 20, `npx vitest`, `npx svelte-check`
- `cargo` 1.95.0 / `rustc` 1.95.0 (installed per mandate)
- `pkg-config` 2.88 (glib 2.88, webkit2gtk 2.52.6)
- `python3`, `jq`, `rg`, `wc`, `find`, `stat`, `du`

### Limitations
- **No physical Android device** — APK build, notification, camera, media picker unvalidated
- **No macOS/iOS environment** — iOS build, APNs, keychain, background modes unvalidated
- **No live Grindr server** — 9 HTTP endpoints, 4 WS events, auth contracts unverified
- **Upstream git corrupted** — 4 of 10 OpenGrind unique changes unverifiable
- **No cargo-audit / npm audit** — dependency vulnerabilities unscanned
- **Binary test file** — `src/lib/api/profile.test.ts` (21KB binary) excluded from analysis

---

## 6. Cross-Reference Index

| Finding ID | Domain Report | Measure File | Ledger Entries |
|------------|---------------|--------------|----------------|
| P0-001 | domain-07-privacy.md | measure-07-privacy.jsonl | PRV-001, PRV-002 |
| P0-002 | domain-07-privacy.md | measure-07-privacy.jsonl | PRV-003 |
| P0-003 | domain-10-platform.md | measure-10-platform.jsonl | PLT-015, PLT-016 |
| P0-004 | domain-10-platform.md | measure-10-platform.jsonl | PLT-001 |
| P0-005 | domain-11-provenance.md | measure-11-provenance.jsonl | PROV-003 |
| P0-006 | domain-11-provenance.md | measure-11-provenance.jsonl | PROV-012 |
| P0-007 | domain-04-api-contracts.md | measure-04-api-contracts.jsonl | API-008 |
| P0-008 | domain-06-security.md | measure-06-security.jsonl | SEC-008 |
| P0-009 | domain-07-privacy.md | measure-07-privacy.jsonl | PRV-008 |
| P0-010 | domain-07-privacy.md | measure-07-privacy.jsonl | PRV-009 |

---

## 7. Deliverable Locations

```
docs/governance/
├── MASTER_MEASUREMENT_LEDGER.md          # This file
├── master_measurement_ledger.jsonl        # 562 entries (all domains concatenated)
├── COVERAGE_REGISTER.md                   # Domain coverage tracking
├── PRIORITIZED_REMEDIATION_REGISTER.md    # Findings with owners/criteria
├── EXECUTIVE_MEASUREMENT_SUMMARY.md       # One-page for leadership
├── REPRODUCIBILITY_INSTRUCTIONS.md        # Safe commands to refresh
├── domain-01-baseline-inventory.md        # Domain reports (12)
├── measure-01-baseline.jsonl              # Domain ledgers (12)
├── domain-03-opengrind-provenance.md      # Audit 3 human report
├── domain-04-migration-provenance.md      # Audit 4 human report
└── findings/
    ├── audit-3-opengrind.json             # Audit 3 machine output
    └── audit-4-migration.json             # Audit 4 machine output
```

---

## 8. Verification

```bash
# Verify all domain outputs exist
ls -la docs/governance/domain-*.md docs/governance/measure-*.jsonl

# Count total ledger entries
cat docs/governance/measure-*.jsonl | wc -l
# Expected: 562

# Verify baseline commit
git rev-parse HEAD
# Expected: 7fffcec773b539a18b2f993cb9d8143fc2ec32c5

# Verify working tree clean
git status --porcelain | wc -l
# Expected: 0 (3 untracked only)

# Re-run key measurements
npx vitest run 2>&1 | grep -E "Tests|Test Files"
# Expected: 953 passed, 65 files

npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -1
# Expected: 0 errors

export PATH="$HOME/.cargo/bin:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml --lib 2>&1 | tail -1
# Expected: Finished `dev` profile
```

---

## 9. Next Actions (Per Remediation Register)

1. **P0-001** Fix notification `VISIBILITY_PRIVATE` → `MainActivity.kt`, `NotificationService.kt`
2. **P0-003** Sync version across `tauri.conf.json`, `tauri.properties`, CI gate
3. **P0-004** Configure Android CI build + device test pipeline
4. **P0-005/006** Investigate `5b69ca4` external backups; regenerate Android assets
5. **P0-007/008** Run cargo-audit; add release-version gate to CI
6. **P0-009/010** Add PNG/WebP EXIF strip; add `rotate_api_params` guard

---

*Generated by OpenCode measurement agents per MASTER_MEASUREMENT_DIRECTIVE.md §12-13.*
