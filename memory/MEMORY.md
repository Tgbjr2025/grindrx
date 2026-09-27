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
**AUDITED + REMEDIATED (unbuilt).** A 100% line-by-line audit of v0.1.33 (`89e2e41`) is done —
30,107 lines TS/Svelte + 3,410 lines Rust, 7 partitions, every line read. **Read
`memory/AUDIT_REPORT_v0.1.33.md`** (NEW) before touching this code: 4 CRITICAL (incl. the PIN
lockout that bricked every PIN set in v0.1.25–v0.1.32, a 1000× weight-filter unit error, the
dead `retainAuthedImage` ref-count, and lock-screen notifications leaking chat text past the app
lock), 11 HIGH, ~30 MEDIUM, all in 8 batches. All are fixed with regression tests: **0 type
errors / 4 warnings** (was 30), **442 tests** (was 244), eslint clean on all 127 changed files.

**The Rust is now machine-verified — that is the new thing.** The previous round shipped three
Rust files that had never been compiled. The **M1 Mac is reachable over Tailscale**: `ssh mac`
(user is `thomasbateman@100.92.26.108` — the `ubuntu@`/`mac@` names from `tailscale status` are
WRONG). It has a prebuilt 3.8 GB `target/`, cargo 1.95.0, bun 1.4.2, Temurin JDK 21. Verified
`cargo check --lib` clean, `cargo test --lib` **17/17**, and `cargo check --lib --target
aarch64-linux-android` **clean** (the android leg needs the NDK clang dir on PATH). The M1
checkout is at `e155a35` and diverges from OVH; rsync + verify by sha256 (R5) before building.

**NOT built, NOT installed, NOT pushed** (R11). 164 files touched. **NOT device-tested** —
everything compiles, nothing has run on hardware. Highest-risk open item: the two stacked
keyboard-compensation mechanisms may double-count the IME height; needs a real S26 Ultra.
Open items needing the operator are listed in the report — notably the password-reset endpoint
contradiction, which needs a live Grindr account.

**v0.1.33 remains the shipped release** (tag `v0.1.33`, `e155a35` + release commits; signed
`GrindrX-v0.1.33.apk`, versionCode 1068, on both hosts). The audit remediation is **not** part of
it. `memory/FIX_NOTES_v0.1.33.md` still records the previous round's build record and the
`autoIncrementVersionCode` trap.
