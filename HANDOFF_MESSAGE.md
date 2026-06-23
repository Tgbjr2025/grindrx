# HANDOFF_MESSAGE — grindrx-work

> Last reconciled 2026-06-23 08:16 UTC. Copy the block below verbatim as the bootstrap prompt for the next session.

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

**Context you must respect (current as of HEAD `b112cb3`, 2026-06-20 06:48 UTC; tree clean):**
- This is a **BUILD TREE**, not a running service. No daemon to babysit here.
- Version is **0.1.13** (committed — `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
  all agree). HEAD `b112cb3` "chore(api): log real HTTP status + body for non-2xx responses".
- The working tree is **CLEAN** in this checkout. The in-flight audit fixes that the previous handoff
  described as uncommitted (rest.rs token-leak/redirect, album.ts share-unlock, messages.ts dead-import,
  grid-state Explore geohash, conversation-state WS-leak) are now **all committed** in `17d47f3`. The
  old TEMP `[diag-mediaid]` probe in `profile.ts` is **gone** (the saved-photo 400 was root-caused —
  see below). **Do NOT discard, stash, reset, checkout, or clean the tree (R20).**
- **NEW temp trap:** HEAD `b112cb3` added a **TEMPORARY on-device diagnostic** — a `[GrindrX-API]`
  logcat probe (`adb logcat | grep GrindrX-API`) that logs the real HTTP status + body for non-2xx API
  responses, to surface the server-side cause of cascade error codes like `CAS-4001`. **Expected to be
  removed once CAS-4001 is root-caused.**
- **NOTE on a real BUILD checkout:** the 2 machine-specific gradle autogen files
  (`tauri.build.gradle.kts`, `tauri.settings.gradle`) will still show dirty ON PURPOSE on a host that
  has run a build (they carry that host's absolute paths). They are NOT in a fresh clone. Never commit
  them.
- Build via the **Nix** path in `BUILDING.md` only (`nix run .#build-android`). Sign only with the
  keystore in `KEYS.md`. Install is adb-over-Tailscale to the S26 Ultra (`100.64.176.13:5555`) — verify
  the phone is online first.
- Open issues: **CAS-4001 / cascade bare-text error codes** — the explore/cascade endpoint can answer
  with a bare code (not JSON); `3e1d412` now surfaces it as an actionable message and `b112cb3` logs the
  raw cause, but the *server-side reason* is still under investigation (the new logcat probe is hunting
  it). App freeze under image memory / WebView compositor — multiple fixes landed (`03f88f2` grid
  windowing, `bccb55d` blur-layer collapse + async decode, `b5d182e` lightbox border-radius morph,
  `3e1d412` map/location-picker blur) — confirm gone on-device. WS DNS flaky on cellular AND the phone
  keeps dropping off Tailscale (blocks adb installs).
- `grindx-ping.service` is a separate program — not this project.

**Immediate next action:**
Run `git status -s`, `git log --oneline -8`, and `git diff --stat`, compare against `SESSION_STATE.md`,
and report any delta to Tom. **Do NOT commit, build, sign, or push** without Tom's explicit
authorization, a rollback tag (R9), and FIX_NOTES (R10). The next substantive task is root-causing
CAS-4001 (then removing the temp `[GrindrX-API]` logcat probe) and field-verifying the freeze fixes.

---
