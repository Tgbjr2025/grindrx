# grindrx-work

| Field | Value |
|---|---|
| Project | `grindrx-work` |
| Purpose | See repository README / docs. Not restated here to avoid drift. |
| Canonical source | `/srv/projects/grindrx-work` |
| Forgejo repository | `dominusaxis/grindrx-work` (private) |
| Git history preserved | yes (397 commits, 65 tags) |
| Current branch | `migration/ovh-state-2026-10-05` |
| Current HEAD | `6f0226a941b6` |
| Primary language | TypeScript (227 files) |
| Build system | npm/yarn (package.json) |
| Test command | npm test |
| Deployed copy | not deployed on AXIS (source-only) |
| Secrets | `/srv/secrets/` (never in Git) |
| Migrated from | OVH `vps-09a68cc5` (`/home/ubuntu/grindrx-work`) |
| Migration date | 2026-10-05T23:30:14+02:00 |

## Layout on AXIS

```
/srv/projects/grindrx-work     canonical source repository (this directory)
/home/axis/grindrx-work       deployed/runtime copy, if the project runs as a service
```

The two are deliberately separate. This directory holds source only; runtime
state, caches, databases, virtualenvs and generated output are not tracked here.

## State at migration

Branch `migration/ovh-state-2026-10-05` captures the working-tree state exactly
as found on OVH, including uncommitted source changes. Secrets, caches, generated
artifacts and runtime databases were excluded from that commit.
