# rules.md — canonical operating rules (grindrx-work)

> Per HANDOFF_SYSTEM v1. Operator: **Tom**. These are binding. Read before acting (R3).
> R24/R25/R26 **re-verified 2026-10-11** — all three still exist, still say what they said, and the
> filesystem claim in R25 (`/srv/worktrees/`) was confirmed to exist on `axis`. R20–R23 are older and
> were last checked when they were written; R20 in particular describes a tree state that no longer
> exists and its *intent* is what matters.

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

- **R20 — Preserve the dirty tree.** The `audit/v0.1.9-fixes` working tree carried uncommitted
  v0.1.9 audit work; that work is long since committed, but the rule's intent stands. Never
  `stash`, `reset`, `checkout`, `clean`, or otherwise discard uncommitted work without Tom's
  explicit instruction. (Project-specific corollary of R3/R4; warranted by the trap that this dirty
  state had no prior session tracking it.)
- **R21 — Build only via the documented Nix path.** Use `nix run .#build-android` per `BUILDING.md`;
  do not hand-roll cargo/gradle toolchains. (Warranted by the reproducible-build requirement.)
  **Superseded in practice since 2026-10-10:** releases are built on the **M1** with
  `bun run tauri android build --apk` plus the M1's own JDK/NDK, because the Nix path was never
  available off the old `ovh` host. The reproducible-build *intent* is why
  `memory/FIX_NOTES_android_build_toolchain.md` exists. **Operator decision needed** on which path
  is canonical — do not silently pick one.
- **R22 — Sign only with the canonical keystore.** A release is valid only if its cert SHA-256 matches `KEYS.md`. Never invent, rotate, or substitute signing keys. (Warranted by KEYS.md being load-bearing for release authenticity.)
- **R23 — Do not touch `README.md` or other upstream product docs.** Handoff content goes in `README_HANDOFF.md` and `memory/`. (Warranted by the no-clobber requirement.)

- **R24 — Agents commit every verified increment to their OWN branch.** Never leave verified work
  uncommitted in a worktree. Commit at each increment, not once at the end: an agent that holds work
  until a final commit and then hits a context limit loses the same work this rule exists to save.
  Committing is NOT pushing — R11 still forbids publishing. The supervisor reviews the branch before
  merging to `main`. (Warranted: six P2/P3 agents were dispatched 2026-10-10 and three died to a
  context limit. Their branches were `Created from main` and held ZERO commits; 1067 lines of real
  work sat uncommitted in /tmp/wt until rescued. They were reported to the operator as "merged in".)
- **R25 — Never put a worktree on `/tmp`.** `/tmp` is tmpfs (RAM). Uncommitted files there are lost
  on reboot. Git OBJECTS are safe — they live in `<repo>/.git/worktrees/<name>` on `/dev/sda1` —
  so R24 makes a `/tmp` worktree survivable, but the working files still are not. Create worktrees
  under `/srv/worktrees/`. (Warranted: the same 2026-10-10 loss sat on tmpfs with no second copy.)
- **R26 — The ledger records LOSSES, not just results.** A dispatched batch that dies, produces
  nothing, or is abandoned gets a ledger entry stating the batch, what was lost, and whether it was
  recovered. An empty ledger section reads as "nothing happened", which is how three empty branches
  were reported as merged. The ledger is the living record; silence in it is a false claim.
  (Warranted: the ledger held zero P2/P3 entries and was ~14h stale while the report claimed success.)

## Incident that produced R24–R26 (2026-10-10, for future reference)

Six agents dispatched across P2/P3. Three (p2-ws-deadcode, p3-branch-cleanup, p3-version-refs)
wrote nothing at all. Three wrote real code and died before committing, leaving 8 changed/untracked
files in /tmp/wt on tmpfs. A supervisor report described all six as "merged into main"; they were
not — every branch was `Created from main` at the same tip with zero commits. 1067 lines were
recovered from disk, checksum-verified per R5, committed to their original branches (`4200787`,
`6a1115f`, `3a324d5`), and remain UNVERIFIED and UNMERGED pending review.

**Update 2026-10-10 (later the same day):** the three rescued commits were reviewed, corrected and
merged to `main` as `eca61c2`. **The rescue commit `6a1115f` shipped a live mutation** — a
`// MUTATION-1: release removed` line inside the fetch-semaphore's `finally` block, which starved 30
tests and, through the same code path, 5 `api/index` purge tests. Fixed in `c760de9`, `12bbe09` and
`4b1df26`. **This is the second-order lesson: R24/R25/R26 stop the work being lost, but not the work
being wrong.** A rescued commit is untrusted until its tests are re-run, and "recovered" must never
be reported as "verified". [verified: `docs/governance/PRIORITIZED_REMEDIATION_REGISTER.md` §P2
evidence, P2-004 row]

**Update 2026-10-11:** the rules themselves have held up. A ledger retraction entry was written the
same day a false VERIFIED claim was found (`my_own_ws_claim_was_wrong`) — that is R26 working as
designed, and is the behaviour to copy.
