# MEMORY — grindrx-work (index)

> Per HANDOFF_SYSTEM v1. Operator: **Tom**. Server: `ovh`. Root: `/home/ubuntu/grindrx-work`.
> Created 2026-06-09 06:57 UTC (bootstrap).

This is the index. Read it first, then the file the task points you to.

## Memory files

| File | Purpose |
|------|---------|
| `memory/SESSION_STATE.md` | Live state: current step, decision gate, files modified this session, timeline. **Read after this index, before acting (R3).** |
| `memory/PROJECT_ROADMAP.md` | What grindrx-work is, the phases, and the definition of success. |
| `memory/rules.md` | Canonical operating rules R1–R11 (+ project R20+). |

## Root handoff docs (outside memory/)

| File | Purpose |
|------|---------|
| `README_HANDOFF.md` | TL;DR, inventory, critical traps, how to resume. **Does NOT replace `README.md`.** |
| `HANDOFF_MESSAGE.md` | Verbatim bootstrap prompt for the next session. |

## Authoritative project docs (pre-existing, do not modify)

- `README.md` — product overview (upstream, leave as-is).
- `BUILDING.md` — Nix-based Android build pipeline.
- `CHANGES.md` — changelog of fork fixes/features.
- `KEYS.md` / `KEYS.md.asc` — PGP + APK signing keys.

## One-line state

BUILD TREE on branch `audit/v0.1.9-fixes`, **dirty** (12 modified + 2 untracked). Version 0.1.8. Last commit `45083f2` 2026-05-26. No running app service. Goal: a working **signed Android build**.
