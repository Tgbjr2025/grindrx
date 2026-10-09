# Reproducibility Instructions — GrindrX Measurement Baseline

**Baseline Commit:** `7fffcec` | **Directive:** MASTER_MEASUREMENT_DIRECTIVE.md §11, §13.11

---

## Prerequisites

```bash
# System (Ubuntu 26.04 LTS verified)
sudo apt-get update && sudo apt-get install -y \
  git curl pkg-config libglib2.0-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libsoup-3.0-dev build-essential

# Node.js 20+ (Bun used in project)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Rust 1.95.0 (pinned in rust-toolchain.toml)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
  --default-toolchain 1.95.0 --profile minimal --no-modify-path
source "$HOME/.cargo/env"

# Verify
bun --version      # 1.1.x
rustc --version    # 1.95.0
cargo --version    # 1.95.0
git --version      # 2.43+
```

---

## Repository Setup

```bash
# Clone canonical repo
git clone /srv/projects/grindrx-work grindrx-measure
cd grindrx-measure

# Verify baseline
git checkout 7fffcec
git status --porcelain | wc -l          # Expected: 0 (clean)
git rev-parse HEAD                       # Expected: 7fffcec773b539a18b2f993cb9d8143fc2ec32c5

# Install dependencies (Bun lockfile)
bun install --frozen-lockfile

# Verify Rust compiles
export PATH="$HOME/.cargo/bin:$PATH"
cd src-tauri && cargo check --lib 2>&1 | tail -1
# Expected: Finished `dev` profile [unoptimized + debuginfo] target(s) in ...
```

---

## Measurement Commands (Safe, Non-Destructive)

### 1. Repository Baseline (Domain 01)

```bash
# Tracked files
git ls-files | wc -l                                    # 791
git ls-files -z | xargs -0 wc -c                        # Tracked bytes

# By extension
git ls-files | awk -F. '{print $NF}' | sort | uniq -c | sort -rn

# Source lines (non-test)
git ls-files '*.ts' '*.svelte' '*.rs' | grep -vE '\.test\.ts$|\.dom\.test\.ts$|\.d\.ts$' | xargs wc -l

# Test files
git ls-files '*.test.ts' '*.dom.test.ts' | wc -l        # 65
git ls-files '*.test.ts' '*.dom.test.ts' | xargs wc -l  # Test LOC

# Backup artifacts
find . -name '*.bak.*' -type f ! -path './.git/*' ! -path './node_modules/*' | wc -l

# Git storage
du -sh .git                                             # ~28 MB
git rev-list --all --count                              # 493
git tag | wc -l                                         # 68
git branch -a | wc -l                                   # 41
```

### 2. Complexity Metrics (Domain 02)

```bash
# Function/class/interface counts (heuristic)
grep -r "^\s*function\|^\s*const.*=.*=>\|^\s*export.*function" --include="*.ts" --include="*.svelte" | wc -l
grep -r "class \|interface \|type \|enum " --include="*.ts" --include="*.svelte" | wc -l
grep -r "fn \|struct \|enum \|trait " --include="*.rs" src-tauri/src | wc -l

# Circular deps (TS) - requires madge or manual
# npx madge --circular --extensions ts,svelte src/

# Unsafe/unchecked
grep -r "unsafe\|unwrap()\|expect()\|as any\|@ts-ignore\|@ts-expect-error" --include="*.rs" --include="*.ts" --include="*.svelte" src/ src-tauri/src/ | grep -v test | grep -v "\.bak"
```

### 3. Architecture (Domain 03)

```bash
# Package structure
cat package.json | jq '.workspaces // "none"'
cat src-tauri/Cargo.toml | grep -A5 '\[workspace\]'

# Import graph (TS) - requires madge
# npx madge --extensions ts,svelte src/ > import-graph.txt

# Native bridges
grep -r "JavascriptInterface\|invoke(" --include="*.kt" --include="*.ts" src-tauri/gen/android/ src/lib/

# External deps
cat package.json | jq '.dependencies, .devDependencies'
cat src-tauri/Cargo.toml | grep '^.*='
```

### 4. API Contracts (Domain 04)

```bash
# HTTP endpoints
grep -r 'fetchRest\|fetchAuthed\|fetchMedia' --include="*.ts" src/lib/api/ | grep -o '"/v[^"]*"' | sort -u

# Tauri commands
grep -r 'invoke(' --include="*.ts" src/ | grep -o 'invoke("[^"]*")' | sort -u
grep 'invoke_handler' src-tauri/src/lib.rs -A 30 | grep '\.invoke(' | sed 's/.*invoke(\([^)]*\)).*/\1/'

# WebSocket events
grep -r 'ws_event\|emit_event\|on_event' --include="*.rs" --include="*.ts" src-tauri/src/ src/lib/
```

### 5. Tests (Domain 05)

```bash
# Run full suite (requires display for jsdom)
npx vitest run --reporter=verbose 2>&1 | tee vitest-results.txt
# Expected: 65 files, 953 tests passing

# Coverage
npx vitest run --coverage 2>&1 | tee coverage.txt
# Expected: ~77% statements, ~69% branches

# Rust tests (if cargo available)
cd src-tauri && cargo test --lib 2>&1 | tail -5
# Expected: 17 passed
```

### 6. Security (Domain 06)

```bash
# Dependency audit (requires tools)
# cargo install cargo-audit
# cargo audit
# npm audit  # requires package-lock.json

# Security patterns
grep -r "redirect\|host.*allow\|size.*limit\|https.*enforce" --include="*.rs" src-tauri/src/
grep -r "keystore\|keychain\|secure.*storage" --include="*.rs" --include="*.ts" src-tauri/src/ src/lib/
```

### 7. Privacy (Domain 07)

```bash
# localStorage keys
grep -r 'localStorage\.' --include="*.ts" src/ | grep -o '\.setItem([^)]*)' | sed 's/.*setItem(\([^)]*\)).*/\1/' | tr -d '"' | sort -u

# Cache purge
grep -r 'purge\|clear.*cache\|revoke.*blob' --include="*.ts" src/lib/

# EXIF handling
grep -r 'exif\|EXIF\|orientation\|strip' --include="*.ts" src/lib/
```

### 8. Performance (Domain 08)

```bash
# Cache bounds
grep -r 'MAX_ENTRIES\|cacheEpoch\|MAX_SIZE' --include="*.ts" src/lib/

# Retry config
grep -r 'maxAttempts\|baseDelay\|maxWallClock\|maxSleep' --include="*.ts" src/lib/net/

# Polling intervals
grep -r 'setInterval\|setTimeout.*reconcile\|heartbeat' --include="*.ts" src/lib/
```

### 9. Reliability (Domain 09)

```bash
# Retry/backoff
cat src/lib/net/retry.ts

# Timeouts
grep -r 'timeout\|TIMEOUT' --include="*.ts" --include="*.rs" src/lib/ src-tauri/src/ | grep -v test

# WS reconnect
grep -r 'reconnect\|backoff' --include="*.ts" src/lib/ws*.ts
```

### 10. Platform (Domain 10)

```bash
# Android config
cat src-tauri/gen/android/app/build.gradle.kts
cat src-tauri/gen/android/app/src/main/AndroidManifest.xml
cat src-tauri/tauri.conf.json | jq '.tauri.bundle.android'

# iOS config
cat src-tauri/gen/Info.plist 2>/dev/null || echo "No gen/Info.plist"
cat src-tauri/tauri.conf.json | jq '.tauri.bundle.ios'

# Version consistency
grep -r '0\.1\.' --include="*.json" --include="*.toml" --include="*.properties" --include="*.kt" | grep -v node_modules | grep -v target
```

### 11. Git Provenance (Domain 11)

```bash
# All repos
for repo in /srv/projects/grindrx-work /srv/projects/opengrind-upstream /srv/projects/dominusaxis /srv/projects/anchor-ext; do
  echo "=== $repo ==="
  cd "$repo" && git rev-parse HEAD && git log --oneline -1 && git branch -a | wc -l
done

# Missing commits
git log --all --oneline | grep -E '5b69ca4|bb05c55' || echo "NOT FOUND"
```

### 12. OpenGrind Reconciliation (Domain 12)

```bash
# Upstream structure
ls -la /srv/projects/opengrind-upstream/
cat /srv/projects/grindrx-recon/findings/audit-3-opengrind.json | jq '.findings[] | {id, disposition, priority}'
```

---

## Full Automated Refresh Script

```bash
#!/usr/bin/env bash
# refresh-measurements.sh — Run from repo root at baseline commit

set -euo pipefail

BASELINE="7fffcec"
OUT_DIR="docs/governance"
DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "=== Refreshing measurements at $DATE ==="
echo "Baseline: $BASELINE"

# 0. Verify baseline
git rev-parse HEAD | grep -q "^$BASELINE" || { echo "ERROR: Not at baseline $BASELINE"; exit 1; }

# 1. Domain 01 - Baseline
git ls-files | wc -l > "$OUT_DIR/measure-01-count.txt"
git ls-files '*.test.ts' '*.dom.test.ts' | wc -l >> "$OUT_DIR/measure-01-count.txt"

# 2. Domain 05 - Tests (full run)
npx vitest run --reporter=basic 2>&1 | tail -10 > "$OUT_DIR/measure-05-vitest.txt"
npx vitest run --coverage 2>&1 | grep -A4 "All files" > "$OUT_DIR/measure-05-coverage.txt"

# 3. Domain 10 - Version check
grep -r 'version.*0\.1\.' --include="*.json" --include="*.toml" --include="*.properties" | grep -v node_modules > "$OUT_DIR/measure-10-versions.txt"

# 4. Svelte typecheck
npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -3 > "$OUT_DIR/measure-svelte-check.txt"

# 5. Rust check
export PATH="$HOME/.cargo/bin:$PATH"
cd src-tauri && cargo check --lib 2>&1 | tail -1 > "$OUT_DIR/measure-rust-check.txt"

echo "=== Refresh complete ==="
echo "Results in $OUT_DIR/"
```

---

## Evidence Preservation

- **Command outputs** → Store in `docs/governance/evidence/` (gitignored)
- **Ledger entries** → Append to `master_measurement_ledger.jsonl` with new timestamps
- **Secrets** → NEVER include in evidence; redact with `sed 's/[A-Za-z0-9_\-]\{20,\}/[REDACTED]/g'`

---

## Verification Checklist

After any change, re-run:

- [ ] `git status --porcelain | wc -l` (should be 0 for baseline)
- [ ] `npx vitest run` → 953 passing
- [ ] `npx svelte-check` → 0 errors
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml --lib` → compiles
- [ ] Version consistency across `tauri.conf.json`, `tauri.properties`, `package.json`
- [ ] Ledger updated with post-change measurements

---

*Per MASTER_MEASUREMENT_DIRECTIVE.md §11, §13.11 — Reproducibility Instructions.*
