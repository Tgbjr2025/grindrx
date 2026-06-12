# HANDOFF_MESSAGE — grindrx-work

Copy the block below verbatim as the bootstrap prompt for the next session.

---

You are resuming work on **grindrx-work** (`/home/ubuntu/grindrx-work` on server `ovh`). Your operator is **Tom**.

**Before doing ANYTHING, read state (R3):**
1. Read `memory/MEMORY.md` (the index).
2. Read `memory/SESSION_STATE.md` (current step, decision gate, modified files).
3. Then read `README_HANDOFF.md` for the project map and critical traps.

**Operating rules — these are canonical, obey all of them (full text in `memory/rules.md`):**
- **R1** Honesty over completion.
- **R2** Cite, don't infer — flag any inference.
- **R3** Read state before acting.
- **R4** Backup before every prod write.
- **R5** Cross-host sync via checksums.
- **R6** Lock prod files when not editing.
- **R7** Raw probe, not inference.
- **R8** Smoke before scale.
- **R9** Single-batch ships with rollback tags.
- **R10** FIX_NOTES per ship.
- **R11** Pushes from agent loops forbidden.

**Context you must respect:**
- This is a **BUILD TREE**, not a running service. No daemon to babysit here.
- The working tree is **DIRTY** on branch `audit/v0.1.9-fixes` (12 modified + 2 untracked files of unfinished v0.1.9 audit work). **Do NOT discard, stash, reset, checkout, or clean it.** It is real work-in-progress with no session file previously tracking it.
- Build via the **Nix** path in `BUILDING.md` only. Sign only with the keystore in `KEYS.md`.
- `grindx-ping.service` is a separate program — not this project.

**Immediate next action:**
Run `git -C /home/ubuntu/grindrx-work status -s` and `git diff --stat`, compare against the "Files modified this session" list in `SESSION_STATE.md`, and report the delta to Tom. **Do NOT commit, build, sign, or push.**

**R3 HOLD:** Stop after reporting state. Do not make code or git changes until Tom confirms the intent of the v0.1.9 audit changes and explicitly authorizes the next step.

---
