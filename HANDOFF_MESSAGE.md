# HANDOFF_MESSAGE — grindrx-work

> Last reconciled 2026-06-18 04:16 UTC. Copy the block below verbatim as the bootstrap prompt for the next session.

---

You are resuming work on **grindrx-work** (`/home/ubuntu/grindrx-work` on server `ovh`). Your operator is **Tom**.

**Before doing ANYTHING, read state (R3):**
1. Read `memory/MEMORY.md` (the index).
2. Read `memory/SESSION_STATE.md` (current step, decision gate, modified files, known open issues, timeline).
3. Then read `README_HANDOFF.md` for the project map, recent commits, and critical traps.

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
- **R20** Preserve the dirty tree (no stash/reset/checkout/clean).
- **R21** Build only via the documented Nix path.
- **R22** Sign only with the canonical keystore (KEYS.md cert SHA-256).
- **R23** Do not touch `README.md` or other upstream product docs.

**Context you must respect (current as of HEAD `03f88f2` + the 2026-06-18 04:16 UTC dirty tree):**
- This is a **BUILD TREE**, not a running service. No daemon to babysit here.
- Version is **0.1.9** (committed, `28b1648`). Branch is `audit/v0.1.9-fixes`.
- The working tree is **DIRTY** with **8 modified code files** as of the last probe (the set is
  MOVING — it grew from 3 to 8 between 03:58 and 04:16 UTC). It contains:
  - 2 machine-specific gradle autogen files (`tauri.build.gradle.kts`, `tauri.settings.gradle` —
    dirty ON PURPOSE, `/home/ubuntu/...` paths);
  - a **TEMP `[diag-mediaid]` probe in `src/lib/api/profile.ts`** (diagnostic, expected to be removed);
  - **five in-flight UNCOMMITTED audit fixes:** `src-tauri/src/api/rest.rs` (FIX 13 — enforce https
    before attaching the auth header + redirect-refusing client, closing a session-token leak),
    `src/lib/api/album.ts` (album-share now grants via `/v4/albums/{id}/shares` so the recipient can
    unlock), `src/lib/api/messages.ts` (dead-import cleanup), `grid-state.svelte.ts` (Explore-location
    routed through `exploreGeoHash`), `conversation-state.svelte.ts` (WS listener-leak + self
    read-receipt guard). These have NO rollback tag — tag + FIX_NOTES before any commit/ship (R9/R10).
  **Do NOT discard, stash, reset, checkout, or clean the tree (R20).**
- **Other agents are editing the code (Rust, chat, albums, grid) in parallel.** The commit log and
  dirty tree are moving targets — re-probe `git log --oneline -8` and `git status -s` / `git diff` (R7).
- Open issues: app freeze under image memory (windowing added in `03f88f2`, verify on-device);
  saved-photo-send 400 (Grindr dropped mediaId — pending the real source); album-share doesn't unlock
  for recipient (fix in progress, uncommitted in `album.ts`); WS DNS flaky on cellular AND the phone
  keeps dropping off Tailscale (blocks adb installs).
- Build via the **Nix** path in `BUILDING.md` only (`nix run .#build-android`). Sign only with the
  keystore in `KEYS.md`. Install is adb-over-Tailscale to the S26 Ultra (`100.64.176.13:5555`) — verify
  the phone is online first.
- `grindx-ping.service` is a separate program — not this project.

**Immediate next action:**
Run `git -C /home/ubuntu/grindrx-work status -s`, `git log --oneline -8`, and `git diff --stat`,
compare against `SESSION_STATE.md`, and report any delta to Tom (the tree moves because of concurrent
agents). **Do NOT commit, build, sign, or push.** The previous v0.1.9 R3 hold has been cleared (it was
committed); but do not ship anything new without Tom's explicit authorization, a rollback tag (R9), and
FIX_NOTES (R10).

---
