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
**SHIPPED v0.1.33** (`e155a35` + release commits). Full 8-batch audit remediation,
built, signed and published. Branch `claude/grindrx-freeze-json-audit-gp4lnk` and
Forgejo `main` both at `e155a35`; tag `v0.1.33` on Forgejo + GitHub. Signed
`GrindrX-v0.1.33.apk` (universal, 70,950,792 B, versionName 0.1.33, versionCode
**1068**, sha256 `b0fe1204…f098af`, cert `22d6…4c01`) released on **both** hosts
with `grindrx-v0.1.33-sources.zip`; both APKs downloaded back and sha256-verified
identical. GitHub `main` still `a547f8e` (diverged, anchor/ history — PR #49 is the
merge path). Tests **244** frontend + **17** Rust; svelte-check 0 errors.

**The M1 (`mac`, 100.92.26.108) is the build host** — the OVH host cannot build
Android (its Nix androidenv cannot resolve the Tauri plugin projects). Provisioned
there: NDK 27.0.12077973, platform-36, build-tools 35.0.0, cmake 3.22.1, the four
Android Rust targets, bun, and **Temurin JDK 21 at `~/jdks/jdk-21.0.12.1+1`** —
AGP 8.13.2 rejects the machine's default JDK 25 with the useless error
`> 25.0.2`. Rust 1.95.0 and the signing keystore were already present.
`~/open-grind` is a stale v0.1.10 checkout; build in `~/grindrx-work`.
Build: `PATH=~/.bun/bin:~/.cargo/bin`, `JAVA_HOME=~/jdks/jdk-21.0.12.1+1/Contents/Home`,
`ANDROID_HOME=~/Library/Android/sdk`, `NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973`,
then `bun run tauri android build --apk`.

**Read `memory/FIX_NOTES_v0.1.33.md` before touching this code** — it records
three shipped compile breaks, the `autoIncrementVersionCode` trap, and the CSP
`unsafe-inline` constraint. Not device-tested: everything is compiled, nothing is
verified on hardware.
