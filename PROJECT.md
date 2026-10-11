# grindrx-work

| Field | Value |
|---|---|
| Project | `grindrx-work` |
| Purpose | See repository README / docs. Not restated here to avoid drift. |
| Canonical source | `/srv/projects/grindrx-work` on host **`axis`** |
| Build host | the **M1 Mac** — the only box with an Android SDK (JDK 17, NDK 27.0.12077973, build-tools 34/35/36). `opencode`/agents run on the M1 and `ssh axis` for repo work. |
| GitHub repository | `Tgbjr2025/grindrx` (public) — remote `github`, **authoritative** |
| Forgejo repository | `dominusaxis/grindrx-work` (public) — remote `origin`, **authoritative** |
| Git history preserved | yes |
| Current branch | `main` |
| Current HEAD (this checkout) | `d742ebfc` |
| Primary language | TypeScript |
| Build system | bun (`bun@1.3.11`) + Vite; Android via `tauri android build` |
| Test command | `bun run test` (vitest + `cargo test --lib`) |
| Deployed copy | not deployed on AXIS (source-only) |
| Secrets | **`/srv/secrets/` is EMPTY** — verified 2026-10-11. It is not where anything lives; see below. |
| Migrated from | OVH `vps-09a68cc5` (`/home/ubuntu/grindrx-work`) |
| Migration date | 2026-10-05T23:30:14+02:00 |

## Layout on AXIS

```
/srv/projects/grindrx-work     canonical source repository (this directory)
/srv/worktrees/                agent worktrees (R25 — never /tmp, which is tmpfs)
/home/axis/ping-server/        active-user tracker + the FCM token registry (POST /grindrx/register)
/home/axis/push-sender/        release-push sender (push.sh + push.js)
/home/axis/.secrets/           the ONLY place a secret lives on this host (mode 0600)
```

The source and runtime directories are deliberately separate. `/srv/projects/grindrx-work` holds
source only; runtime state, caches, databases and generated output are not tracked there.
**`/home/axis/grindrx-work` does not exist** — it was in an earlier version of this table and never
was; there is no deployed copy of the app on AXIS.

## Secrets — where they actually are

`/srv/secrets/` exists but is **empty**. An earlier version of this table pointed at it, which is how
a whole session worked from a wrong premise. The real locations, all on `axis`:

| What | Where | Mode |
|---|---|---|
| FCM service account | `axis:/home/axis/.secrets/grindrx-fbsvc.json` | `0600` |
| Android signing keystore | `~/.config/grindrx/keystore.properties` on the **M1** (0600) | `0600` |
| APK signing keys | `KEYS.md` / `KEYS.md.asc` in-repo (public half only) | — |

**Never in Git.** `google-services.json` is deliberately **not** in `.gitignore` — decide that before
any `git add -A`.

## ⚠ State is currently DIVERGED between the two hosts (verified 2026-10-11)

| Host | Path | Branch | HEAD | Ledger entries |
|---|---|---|---|---|
| M1 Mac (this checkout) | `/Users/thomasbateman/grindrx-work` | `main` | `d742ebfc` | 85 |
| `axis` | `/srv/projects/grindrx-work` | `main` | `71a03294` | 90 |

`axis` does **not** contain `48f34943` ("gender options never loaded, blocking ALL profile saves") or
`d742ebfc` ("restore two rescued diagnostics"). It **does** contain one unpushed commit of its own
(`71a03294`, a ledger/docs update). `main` on the M1 is clean and **identical to both forges**
(`origin` and `github` are both at `d742ebfc`).

**Do not describe either host as "the" canonical tree until this is reconciled.** Preserve both sides
before merging — `bb05c55` was already lost once for exactly this reason.

## State at migration

Branch `migration/ovh-state-2026-10-05` captures the working-tree state exactly as found on OVH,
including uncommitted source changes. Secrets, caches, generated artifacts and runtime databases
were excluded from that commit. **That migration branch is history, not the current branch** — `main`
is current and has advanced far beyond it.
