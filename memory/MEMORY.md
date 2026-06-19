# MEMORY — grindrx-work (index)

> Per HANDOFF_SYSTEM v1. Operator: **Tom**. Server: `ovh`. Root: `/home/ubuntu/grindrx-work`.
> Created 2026-06-09 06:57 UTC (bootstrap). Last reconciled 2026-06-18 04:16 UTC.

This is the index. Read it first, then the file the task points you to.

## Memory files

| File | Purpose |
|------|---------|
| `memory/SESSION_STATE.md` | Live state: current step, decision gate, files modified this session, timeline, known open issues. **Read after this index, before acting (R3).** |
| `memory/PROJECT_ROADMAP.md` | What grindrx-work is, the phases, and the definition of success. |
| `memory/rules.md` | Canonical operating rules R1–R11 (+ project R20–R23). |
| `memory/FIX_NOTES_v0.1.9.md` | FIX_NOTES for the v0.1.9 audit ship (commit `28b1648`) + rollback tag. |
| `memory/FIX_NOTES_media_features.md` | FIX_NOTES for the post-v0.1.9 media-compat + 3-feature + grid-windowing commits (`eaf60dc`, `1d09c10`, `03f88f2`), plus the in-flight UNCOMMITTED audit fixes (rest.rs token-leak, album-share unlock, +3). |

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

BUILD TREE on branch `audit/v0.1.9-fixes`, **dirty** (8 modified code files as of 2026-06-18 04:16
UTC: 2 machine-specific gradle autogen + the TEMP `[diag-mediaid]` probe in `profile.ts` + five
in-flight UNCOMMITTED audit fixes — `rest.rs` token-leak, `album.ts` share-unlock, `messages.ts`
dead-import, `grid-state` Explore routing, `conversation-state` WS-leak/self-read). Version **0.1.9**
(committed). HEAD `03f88f2` (2026-06-18) = grid viewport windowing for the WebView freeze. No running
app service. **Other agents are concurrently editing the code** — re-probe `git status`/`git log`/
`git diff` before trusting state (R7). Goal: a working **signed Android build**. Open issues:
image-memory freeze (windowing added, verify); saved-photo-send 400 (Grindr dropped mediaId, pending
real source); album-share unlock (fix in progress, uncommitted); WS DNS flaky on cellular + phone
keeps dropping off Tailscale.
