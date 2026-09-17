# PROJECT GUARDRAILS TEMPLATE — grindrx

> **Blank, reusable template.** Copy this file into any new grindrx module / sub-project
> and fill in every `<PLACEHOLDER>`. It carries the full set of **rules, guardrails,
> cleanup, hardening, and structure** so a project starts compliant instead of being
> retrofitted later.
>
> **How to use:**
> 1. Copy to the project root (or `docs/`) as `GUARDRAILS.md`.
> 2. Find/replace every `<PLACEHOLDER>` token.
> 3. Delete any section that genuinely does not apply — but record *why* in the changelog
>    at the bottom. Silence is not a deletion reason.
> 4. Once filled, this file is **binding** (per R1–R11). Read it before acting (R3).

---

## 0. Project Identity

| Field | Value |
|---|---|
| Project name | `<PROJECT_NAME>` |
| Operator / owner | `<OPERATOR>` (e.g. Tom) |
| Repo | `<REPO_URL>` |
| Default branch | `<DEFAULT_BRANCH>` (e.g. `main`) |
| Stack | `<STACK>` (grindrx default: Tauri + SvelteKit + Rust, Android target) |
| Build system | `<BUILD>` (grindrx default: Nix — `nix run .#build-android`) |
| Release signing | `<SIGNING>` (grindrx default: canonical keystore, cert SHA-256 in `KEYS.md`) |
| HANDOFF_SYSTEM version | `v1` |
| Created | `<DATE>` |

---

## 1. Canonical Operating Rules (R1–R11) — binding, verbatim

These are stack-agnostic and apply to **every** grindrx project unchanged.

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

---

## 2. Project Rules (R20+) — fill in per project

Project-specific corollaries. Each rule must state **what** and **why it was warranted**
(the trap it prevents). Start numbering at R20. grindrx's current set is shown as examples —
keep, adapt, or replace.

- **R20 — Preserve the dirty tree.** `<WHICH WORKING TREE / BRANCH>` carries uncommitted work. Never `stash`, `reset`, `checkout`, `clean`, or otherwise discard it without `<OPERATOR>`'s explicit instruction. *(Warranted by: `<TRAP>`.)*
- **R21 — Build only via the documented path.** Use `<BUILD COMMAND>` per `BUILDING.md`; do not hand-roll toolchains. *(Warranted by: reproducible-build requirement.)*
- **R22 — Sign only with the canonical keystore.** A release is valid only if its cert SHA-256 matches `KEYS.md`. Never invent, rotate, or substitute signing keys. *(Warranted by: `KEYS.md` being load-bearing for release authenticity.)*
- **R23 — Do not touch upstream product docs.** Handoff content goes in `README_HANDOFF.md` and `memory/`; never clobber `README.md`. *(Warranted by: no-clobber requirement.)*
- **R24 — `<NEW RULE>`** *(Warranted by: `<TRAP>`.)*

---

## 3. Repository Structure (scaffold)

The expected shape. Create what's missing; do not relocate what exists without a rule update.

```
<PROJECT_ROOT>/
├── README.md                # upstream product doc — DO NOT clobber (R23)
├── README_HANDOFF.md        # operator/agent-facing handoff
├── BUILDING.md              # the ONE documented build path (R21)
├── KEYS.md                  # signing cert SHA-256 — load-bearing (R22)
├── CHANGES.md               # human changelog
├── CONTRIBUTING.md / GOVERNANCE.md / CODE_OF_CONDUCT.md / LICENSE
├── docs/
│   ├── templates/           # this template lives here
│   └── <domain docs>/
├── memory/                  # HANDOFF_SYSTEM state (see §7)
│   ├── MEMORY.md
│   ├── SESSION_STATE.md
│   ├── PROJECT_ROADMAP.md
│   ├── rules.md             # the binding rules for THIS project
│   └── FIX_NOTES_<ver>.md   # one per ship (R10)
├── scripts/
├── src/                     # app source
└── src-tauri/ (or platform)
```

---

## 4. Guardrails (prevention)

Controls that stop bad states from being created. Check `[x]` when enforced.

- [ ] **Branch protection** on `<DEFAULT_BRANCH>`: no direct push, PR + 1 review required.
- [ ] **Agent-loop push ban** enforced in practice (R11) — agents open PRs, humans/CI merge.
- [ ] **No secrets in tree.** `.gitignore` covers keystores, `.env`, tokens; secret-scanning enabled.
- [ ] **One build path only** (R21). CI fails any build not invoked via `<BUILD COMMAND>`.
- [ ] **Lint + format gate.** `<eslint/prettier/clippy/rustfmt>` run in CI; merge blocked on failure.
- [ ] **Type/compile gate.** `<tsc / cargo check>` clean before merge.
- [ ] **Lockfile integrity.** `<bun.lock / Cargo.lock>` committed; CI installs `--frozen`.
- [ ] **Reproducible env.** `<flake.nix / devcontainer>` pinned; toolchain versions locked.
- [ ] **Rollback tag before ship** (R9). Tag format: `<rollback/<ver>>`.
- [ ] **FIX_NOTES required** to merge a release PR (R10).
- [ ] **State-read gate** (R3): no change lands without referencing current `memory/SESSION_STATE.md`.

---

## 5. Cleanup Checklist (cure)

Run when a project is inherited messy or before a milestone. Each item: probe (R7), don't assume.

- [ ] **Working tree audit.** `git status` clean? If dirty, identify and preserve intentional work (R20) before anything else.
- [ ] **Dead branches.** List merged/stale branches; delete only with operator sign-off.
- [ ] **Untracked/ignored cruft.** Identify build artifacts, logs, temp files; ensure `.gitignore` covers them. Never `git clean -fdx` blind (R20).
- [ ] **Secret sweep.** Probe history + tree for committed keys/tokens. Rotate anything exposed.
- [ ] **Dependency hygiene.** Remove unused deps; resolve duplicate/conflicting versions; `<audit cmd>` for known CVEs.
- [ ] **Doc drift.** Reconcile `README_HANDOFF.md` / `memory/` against actual code state.
- [ ] **State file compaction.** Trim `MEMORY.md` / `SESSION_STATE.md` to current truth — **backup first (R4)**, then compact.
- [ ] **Orphan files.** Find files referenced nowhere and files referenced but missing.
- [ ] **Test reality.** Do listed tests actually run and pass? Report honestly (R1).
- [ ] **Checksum cross-host state** if the project spans hosts (R5).

---

## 6. Hardening Checklist (security)

- [ ] **Signing chain verified.** Release cert SHA-256 == `KEYS.md` (R22). No alternate keys exist.
- [ ] **Keystore custody.** Keystore stored outside the repo, access-controlled, backed up offline.
- [ ] **Secrets management.** Runtime secrets via `<vault/env injection>`, never in source or client bundle.
- [ ] **Least privilege.** Tokens/API keys scoped to minimum; rotate on schedule; document expiry.
- [ ] **Dependency provenance.** Pin versions; verify lockfile; prefer vendored/Nix-pinned sources.
- [ ] **Transport security.** TLS enforced; cert pinning where the client supports it.
- [ ] **Input boundaries.** Validate/encode all external input (API responses, deep links, IPC).
- [ ] **Tauri/IPC surface** (if applicable): allowlist commands, restrict `tauri.conf` capabilities, CSP set.
- [ ] **Permissions minimized** (mobile): request only required Android/iOS permissions; document each.
- [ ] **Logging hygiene.** No PII/tokens in logs; redact before persist; log levels gated by build.
- [ ] **Build integrity.** Reproducible build via `<BUILD COMMAND>`; verify output hash before signing.
- [ ] **Incident path.** Documented: who to contact, how to revoke, how to roll back (R9 tag).

---

## 7. Memory / State System (HANDOFF_SYSTEM v1)

Every project keeps its operating state in `memory/`. Order of read on session start (R3):

1. `memory/MEMORY.md` — durable facts, decisions, invariants.
2. `memory/SESSION_STATE.md` — what's in flight right now.
3. `memory/rules.md` — the binding R-rules for this project.
4. Relevant prod state (probe it, R7).

Write discipline: backup before overwrite (R4), keep prod files locked otherwise (R6),
compact only after backup. Every ship appends a `FIX_NOTES_<ver>.md` (R10).

---

## 8. Ship / Release Procedure

1. **Read state** (R3) and **probe prod** (R7).
2. **Smoke test** the change in isolation (R8).
3. **Backup** anything prod you'll overwrite (R4).
4. **Tag rollback point**: `<rollback/<ver>>` (R9).
5. **Ship in a single batch** (R9). Build only via `<BUILD COMMAND>` (R21).
6. **Verify signature** against `KEYS.md` (R22).
7. **Write `FIX_NOTES_<ver>.md`** (R10).
8. **Open PR** for the change; do not auto-merge from an agent loop (R11).

---

## 9. Definition of Done (acceptance gate)

A task is done only when **all** are true — and you can say so honestly (R1):

- [ ] Code compiles / lint clean / types clean.
- [ ] Smoke test passed and was actually run (R8).
- [ ] State files updated and backed up (R3, R4).
- [ ] Build produced via the one documented path (R21) and signed correctly (R22).
- [ ] Rollback tag exists (R9); FIX_NOTES written (R10).
- [ ] PR opened, not loop-pushed (R11).
- [ ] No secrets in tree; hardening checklist (§6) re-confirmed for touched surfaces.

---

## 10. Template Changelog

Record edits to *this* file so divergence between projects is auditable.

| Date | Editor | Change |
|---|---|---|
| `<DATE>` | `<NAME>` | Instantiated from `docs/templates/PROJECT_GUARDRAILS_TEMPLATE.md`. |
