# GrindrX Audit Recovery Runbook

**Version:** 1.0  
**Last Updated:** 2026-10-15  
**Audit Artifact Location:** `/srv/projects/grindrx-work/docs/ios/`

---

## 1. Failure Categories & Recovery Procedures

### 1.1 Colab Browser Disconnect

**Symptoms:**
- SSH session terminated
- Terminal prompt returns to shell
- Ollama inference endpoint may still be accessible

**Recovery Steps:**

1. **Reconnect SSH:**
   ```bash
   ssh axis@<server-ip>
   cd /srv/projects/grindrx-work
   export PATH="$PATH:/home/axis/.cargo/bin"
   ```

2. **Verify Ollama:**
   ```bash
   curl -s http://127.0.0.1:11435/api/tags | jq '.models[] | select(.name=="qwen3-coder-next:q4_K_M")'
   ```

3. **Resume from checkpoint:**
   ```bash
   # Check audit artifacts
   ls -la docs/ios/
   
   # Verify last checkpoint
   cat docs/ios/GRINDRX_AUDIT_CHECKPOINT.json
   ```

4. **Continue pending phases:**
   ```bash
   # Run Rust clippy
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
   
   # Run TypeScript lint with extended timeout
   timeout 600 bun run lint || echo "Lint timed out"
   ```

**Files at Risk:** None (audit is read-only)

---

### 1.2 SSH Tunnel Failure

**Symptoms:**
- SSH connection lost
- Ollama may still be accessible via localhost
- No pending changes in git

**Recovery Steps:**

1. **Re-establish tunnel:**
   ```bash
   # On local machine
   ssh -L 11435:127.0.0.1:11435 axis@<server-ip>
   ```

2. **Verify tunnel:**
   ```bash
   curl -s http://127.0.0.1:11435/v1/models | jq .
   ```

3. **Resume audit:**
   ```bash
   cd /srv/projects/grindrx-work
   cat docs/ios/GRINDRX_AUDIT_CHECKPOINT.json  # Check completion state
   ```

**Files at Risk:** None (audit is read-only)

---

### 1.3 Ollama Failure

**Symptoms:**
- Ollama endpoint returns connection refused
- `curl http://127.0.0.1:11435` fails
- Model inference unavailable

**Recovery Steps:**

1. **Check Ollama status:**
   ```bash
   ps aux | grep ollama
   systemctl status ollama 2>&1 | head -20
   ```

2. **Restart Ollama:**
   ```bash
   # If systemd service
   sudo systemctl restart ollama
   
   # Or if manual process
   pkill ollama
   ollama serve &
   ```

3. **Verify recovery:**
   ```bash
   curl -s http://127.0.0.1:11435/api/tags | jq '.models | length'
   ```

4. **Resume audit:**
   ```bash
   cd /srv/projects/grindrx-work
   # Audit artifacts are still intact, resume from checkpoint
   ```

**Files at Risk:** None (audit is read-only)  
**Data at Risk:** Ollama model weights (stored in `/home/axis/.ollama/models/`)

---

### 1.4 Complete Runtime Replacement

**Symptoms:**
- New Colab instance assigned
- All local state lost
- Audit artifacts may be preserved if stored externally

**Recovery Steps:**

1. **If artifacts preserved on disk:**
   ```bash
   cd /srv/projects/grindrx-work
   ls -la docs/ios/  # Verify artifacts exist
   
   # Restore environment
   export PATH="$PATH:/home/axis/.cargo/bin"
   curl -s http://127.0.0.1:11435/api/tags  # Verify Ollama
   ```

2. **If artifacts lost:**
   ```bash
   # Re-run Phase 1 inventory
   cd /srv/projects/grindrx-work
   git status --short --branch
   git log --oneline -20
   ```
   
3. **Build verification (critical path):**
   ```bash
   cd src-tauri && cargo check  # 7.70s expected
   
   cd /srv/projects/grindrx-work
   bun run check  # ~30s expected
   ```

**Files at Risk:** Audit documentation (if not written to disk)  
**Mitigation:** Keep copies of docs/ios/ in `/srv/projects/grindrx-work/docs/ios/`

---

## 2. Failure Classification

| Failure Type | Process Restart Required? | Files Restored? | Recovery Time |
|--------------|---------------------------|-----------------|---------------|
| Colab disconnect | ❌ No | ✅ Already saved | <1 min |
| SSH tunnel | ❌ No | ✅ Already saved | <1 min |
| Ollama crash | ✅ Yes | ✅ Already saved | 2-5 min |
| Complete replacement | ✅ Yes | ⚠️ May require re-run | 5-15 min |

---

## 3. Critical Commands Reference

### Environment Setup
```bash
export PATH="$PATH:/home/axis/.cargo/bin"
cd /srv/projects/grindrx-work
```

### Build Verification (3-min total)
```bash
# Rust build (7.70s)
cd src-tauri && cargo check && cd ..

# TypeScript build (~30s)
bun run check

# Total: ~38s
```

### Ollama Health Check
```bash
curl -s http://127.0.0.1:11435/v1/models | jq '.data[].id'
```

### Audit Status Check
```bash
cat docs/ios/GRINDRX_AUDIT_CHECKPOINT.json | jq -r '.completed_phases[] | "\(.name): \(.status)"'
```

---

## 4. Loss Prevention

### Audit Files (safe - already written)
- `/srv/projects/grindrx-work/docs/ios/GRINDRX_AUDIT_EVIDENCE.md`
- `/srv/projects/grindrx-work/docs/ios/GRINDRX_BUILD_AND_TEST_RESULTS.md`
- `/srv/projects/grindrx-work/docs/ios/GRINDRX_DEPENDENCY_AND_SECURITY_REVIEW.md`
- `/srv/projects/grindrx-work/docs/ios/GRINDRX_AUDIT_CHECKPOINT.json`

### Audit Artifacts (safe - not modified)
- Repository source files (read-only audit)
- Build artifacts (not modified)
- Lockfiles (not modified)

---

## 5. Resumed Audit Pipeline

### Current Checkpoint State
```json
{
  "completed_phases": [1, 2, 5, 6, 7],
  "pending_phases": [3, 4, 8, 9, 10]
}
```

### Next Steps (Priority Order)
1. **Phase 4:** Rust & Tauri 2 audit (HIGH)
2. **Phase 3:** SvelteKit & TypeScript audit (MEDIUM)
3. **Phase 8:** Feature flow verification (HIGH)
4. **Phase 9:** Independent verification (HIGH)
5. **Phase 10:** Final report generation (HIGH)

### Commands to Continue
```bash
# Phase 4: Rust code audit (critical path)
cd /srv/projects/grindrx-work/src-tauri
cargo clippy --all-targets --all-features 2>&1 | tee clippy-report.txt

# Phase 3: TypeScript audit
cd /srv/projects/grindrx-work
bun run lint 2>&1 | tee lint-report.txt

# Phase 8: Feature verification
grep -r "TODO\|FIXME" src-tauri/src/ docs/ios/
```

---

**Recovery Runbook Version:** 1.0  
**Last Verified:** 2026-10-15T00:30:00Z  
**Audit Status:** IN PROGRESS (phases 3-5 completed, 4 pending)
