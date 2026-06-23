# MEMORY — grindrx-work (index)

> Per HANDOFF_SYSTEM v1. Operator: **Tom**. Server: `ovh`. Root: `/home/ubuntu/grindrx-work`.
> Created 2026-06-09 06:57 UTC (bootstrap). Last reconciled 2026-06-23 08:16 UTC.

This is the index. Read it first, then the file the task points you to.

## Memory files

| File | Purpose |
|------|---------|
| `memory/SESSION_STATE.md` | Live state: current step, decision gate, files modified this session, timeline, known open issues. **Read after this index, before acting (R3).** |
| `memory/PROJECT_ROADMAP.md` | What grindrx-work is, the phases, and the definition of success. |
| `memory/rules.md` | Canonical operating rules R1–R11 (+ project R20–R23). |
| `memory/FIX_NOTES_v0.1.9.md` | FIX_NOTES for the v0.1.9 audit ship (commit `28b1648`) + rollback tag. |
| `memory/FIX_NOTES_media_features.md` | FIX_NOTES for the post-v0.1.9 media-compat + 3-feature + grid-windowing commits (`eaf60dc`, `1d09c10`, `03f88f2`), plus §4 — the audit fixes (rest.rs token-leak, album-share unlock, +3) now **committed in `17d47f3`**. |

## Root handoff docs (outside memory/)

| File | Purpose |
|------|---------|
| `README_HANDOFF.md` | TL;DR, inventory, critical traps, how to resume. **Does NOT replace `README.md`.** |
| `HANDOFF_MESSAGE.md` | Verbatim bootstrap prompt for the next session. |

## Authoritative project docs (pre-existing, do not modify — R23)

- `README.md` — product overview (upstream, leave as-is).
- `BUILDING.md` — Nix-based Android build pipeline.
- `CHANGES.md` — changelog of fork fixes/features.
- `KEYS.md` / `KEYS.md.asc` — PGP + APK signing keys.

## One-line state

BUILD TREE, version **0.1.13** (committed; package.json / tauri.conf.json / Cargo.toml agree), working
tree **CLEAN** at HEAD `b112cb3` (2026-06-20) — a temp `[GrindrX-API]` logcat diagnostic for CAS-4001.
The prior handoff's "dirty tree" audit fixes (`rest.rs` token-leak, `album.ts` share-unlock,
`messages.ts`, `grid-state` Explore, `conversation-state` WS-leak) are now **committed** (`17d47f3`);
the old `[diag-mediaid]` probe is **gone** (saved-photo 400 fixed in `a6fed16`). No running app
service. Re-probe `git status`/`git log`/`git diff` before trusting state (R7); on a build host the 2
gradle autogen files stay dirty on purpose. Goal: a working **signed Android build**. Open issues:
**CAS-4001 cascade bare-error codes** (surfaced + logged, server cause under investigation, temp probe
to remove); image-memory / WebView compositor freezes (multiple fixes landed — verify on-device); WS
DNS flaky on cellular + phone keeps dropping off Tailscale.
