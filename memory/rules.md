# rules.md — canonical operating rules (grindrx-work)

> Per HANDOFF_SYSTEM v1. Operator: **Tom**. These are binding. Read before acting (R3).

## R1–R11 (canonical, verbatim)

- **R1 — Honesty over completion.** Report what is true, even if the task is unfinished. Never fake done.
- **R2 — Cite, don't infer.** Back claims with a verified source. Any inference must be explicitly flagged as inference.
- **R3 — Read state before acting.** Load `memory/MEMORY.md` then `memory/SESSION_STATE.md` (and relevant prod state) before making changes.
- **R4 — Backup before every prod write.** Copy the existing file before overwriting it.
- **R5 — Cross-host sync via checksums.** When syncing between hosts, verify with checksums, not assumptions.
- **R6 — Lock prod files when not editing.** Keep production files locked except during an active, intended edit.
- **R7 — Raw probe, not inference.** Verify current state by directly probing it; do not infer it from memory or prior output.
- **R8 — Smoke before scale.** Run a small smoke test before any large or wide-scale action.
- **R9 — Single-batch ships with rollback tags.** Ship in a single batch and tag a rollback point before shipping.
- **R10 — FIX_NOTES per ship.** Write FIX_NOTES for every ship.
- **R11 — Pushes from agent loops forbidden.** Never `git push` (or equivalent remote publish) from inside an autonomous agent loop.

## Project rules (R20+)

- **R20 — Preserve the dirty tree.** The `audit/v0.1.9-fixes` working tree carries uncommitted v0.1.9 audit work. Never `stash`, `reset`, `checkout`, `clean`, or otherwise discard it without Tom's explicit instruction. (Project-specific corollary of R3/R4; warranted by the trap that this dirty state had no prior session tracking it.)
- **R21 — Build only via the documented Nix path.** Use `nix run .#build-android` per `BUILDING.md`; do not hand-roll cargo/gradle toolchains. (Warranted by the reproducible-build requirement.)
- **R22 — Sign only with the canonical keystore.** A release is valid only if its cert SHA-256 matches `KEYS.md`. Never invent, rotate, or substitute signing keys. (Warranted by KEYS.md being load-bearing for release authenticity.)
- **R23 — Do not touch `README.md` or other upstream product docs.** Handoff content goes in `README_HANDOFF.md` and `memory/`. (Warranted by the no-clobber requirement.)
