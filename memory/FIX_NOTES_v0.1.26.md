# FIX_NOTES — v0.1.26 (share + stats batch)

**Date:** 2026-08-30 · **Base:** `b802080` (v0.1.25) · **Rollback tag:** `pre-v0.1.26` = `b802080`
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk` · **Operator:** Tom

Second batch this session (Tom added these asks mid-work): a "share with a friend" marketing
outlet, and stats for downloads (across versions + repos) and active users (across versions).

## Verification (all green before ship)
- vitest: **156 pass** across 20 files (was 149). +7 stats tests.
- svelte-check: **0 errors** (30 pre-existing warnings).
- eslint: clean on all changed files.
- **End-to-end infra smoke-tested** (see Active users below): nginx route, ping (query-param),
  stats, and both download-source APIs all verified over HTTPS.
- Rust: 3 new commands (`fetch_download_stats`, `fetch_active_users`, `send_usage_ping`) matching
  the `fetch_latest_release` pattern; no new crates. cargo not re-run here (no cargo on PATH).
- Version 0.1.25→0.1.26, androidVersionCode 1054→1055. Backups `*.bak.pre_v0.1.26.*`.

## 1. Share with a friend — NEW
- `src/lib/components/ShareWithFriend.svelte`: uses the Web Share API (`navigator.share`) to open
  the OS share sheet (user picks ANY method), falling back to copying the invite link via the
  clipboard plugin. Invite URL = `https://github.com/Tgbjr2025/grindrx/releases/latest`.
- Surfaced on the settings landing (`settings/(me)/+page.svelte`, Community section).

## 2. Downloads & active-users stats — NEW
- **Stats screen:** new subpage `settings/(subpage)/stats/+page.svelte` (registered in
  `SettingsNavBar.svelte`; linked from the landing via `StatsLink.svelte`). Shows total downloads
  across all versions + both repos, GitHub vs Forgejo totals, per-version breakdown; and active
  users 1h/24h/7d + by version.
- **Aggregation (pure, tested):** `src/lib/utils/stats.ts` — `aggregateDownloads` sums
  `assets[].download_count` per version/repo/combined; `parseActiveUsers` reads the aggregator
  shape. Tolerant of null/garbage. `src/lib/api/usage.ts` wraps the Rust calls + the install id.
- **Downloads source:** GitHub releases API (real APK download counts, e.g. v0.1.23=174,
  v0.1.11=175) + Forgejo releases API (currently 0 assets → 0, honest). Fetched via Rust
  `fetch_download_stats` which returns `{github, forgejo}` raw arrays; summed in the frontend.
- **Active users:** the existing `grindx-ping` service (`/home/ubuntu/ping-server`, systemd,
  :4242) already aggregates active installs by version over a 7-day window. Wired up:
  - App pings once on launch: `sendUsagePing()` in root `+layout.svelte` → Rust `send_usage_ping`
    → `POST https://cam.dominusaxis.com/grindrx/ping?id=<install-id>&v=<version>` (the aggregator
    reads id+v from the QUERY STRING, not the body — verified).
  - Anonymous per-install id (`grindrx-install-id`, uuid in localStorage). No PII.
  - Stats read via Rust `fetch_active_users` → `GET .../grindrx/stats`.
- **Infra change (this box):** added an nginx route so the app can reach the ping server over
  HTTPS. `/etc/nginx/sites-enabled/cam.dominusaxis.com.conf` — new `location /grindrx/ {
  auth_basic off; proxy_pass http://127.0.0.1:4242; }` inside the 443 server block. `nginx -t`
  passed, reloaded; verified `https://cam.dominusaxis.com/grindrx/stats` returns and cam root
  still 401s (basic-auth intact). Backup: `~/cam.dominusaxis.com.conf.bak.pre_grindrx.*`.
  Smoke-test pings were cleaned from `ping-server/pings.jsonl` + service restarted (stats back to 0).

## Notes / follow-ups
- Forgejo releases carry no APK assets yet, so Forgejo downloads read 0. If you want them counted,
  attach the APK to each Forgejo release (or we can script it). GitHub is where real downloads are.
- The stats screen has no auth on the ping endpoints (telemetry, no PII) — matches the existing
  ping-server design (public bind, no auth). Rate-limited server-side (120 req/IP/min).
