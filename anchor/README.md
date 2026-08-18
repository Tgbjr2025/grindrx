# Anchor

A personal memory-prosthetic assistant: every phone call, voicemail, note,
and photo is captured automatically, transcribed, understood by a Claude
agent, and turned into calendar events, tasks, contacts, and searchable
facts — each one linked to a playable source. Built for one user, one server,
maximum trustworthiness. See `CHEATSHEET.md` for the daily-use page.

## Layout

```
anchor/
├── server/            FastAPI + worker + Claude agent brain (Python 3.11)
│   ├── anchor_server/
│   │   ├── api.py         HTTP surface (ingest, sync, ask, confirms, GUI data)
│   │   ├── worker.py      durable-queue drain + housekeeping (stale sync, escalations)
│   │   ├── queue.py       SQLite job queue (reclaim on restart, retry w/ backoff)
│   │   ├── ingest.py      sha256-idempotent artifact intake, Samsung filename parsing
│   │   ├── transcribe.py  faster-whisper
│   │   ├── agent/         the brain: manual tool-use loop + code-enforced trust rules
│   │   ├── gcal.py        Google Calendar (forced T-2h/T-45m reminders)
│   │   ├── people.py      phone contact write-back (Anchor group only)
│   │   ├── notify.py      ntfy push
│   │   ├── digest.py      8 AM digest with the system-health line
│   │   └── confirms.py    Confirm-inbox approve/fix/dismiss
│   └── tests/         37 tests, no network needed (ANCHOR_DRY_RUN)
├── deploy/            systemd units, setup_server.sh, backup.sh, RESTORE.md
├── phone/             Termux scripts: anchor CLI, sweep, watcher, Termux:Boot
├── gui/               Anchor Console (SvelteKit static PWA): Today / Confirm / Ask
├── .env.example       every secret in one file
└── CHEATSHEET.md      the bad-memory-day page
```

## The trust rules → where they're enforced

| Rule | Enforcement |
|---|---|
| Capture during, not after | Samsung auto-records; watcher + 15-min sweep upload with zero actions (`phone/bin/anchor-sweep`) |
| Auto-write, never silently | `agent/tools.py:calendar_write` pushes a quote-bearing notification on every write |
| Provenance on everything | tool schemas require `source_artifact_id` + quote; `/v1/artifacts/{id}/audio` supports Range for offset playback |
| Nothing is deleted | no DELETEs in prod code; supersede chains in `events`/`facts`; full audit_log |
| Times are explicit | `timeutil.py` — America/Detroit, ISO-8601 with offset everywhere |
| Calendar is the arbiter | ask-prompt + `calendar_read` before writes |
| Privileged segregation | contact flag propagates to artifacts; digest masks content (`test_digest.py`) |
| Fail loud | worker terminal failures push urgent ntfy; digest always ends with the health line; heartbeats for phone/worker/api/backup |

## Durability

- Server: `systemd` units with `Restart=always`; every unit of work is a row
  in the `jobs` table; worker startup reclaims `processing` jobs; handlers
  are idempotent; retries back off 1m/5m/30m then fail loud.
- Phone: Termux:Boot re-arms capture on reboot; the inotify watcher is a
  latency optimization only — the 15-minute reconciliation sweep diffs local
  files against `/v1/sync/manifest` and uploads anything missing.
- Backups: nightly `age`-encrypted tar (DB snapshot + vault) via
  `anchor-backup.timer`; restore procedure in `deploy/RESTORE.md`.

## Install

**Server (Ubuntu):**
```bash
sudo bash anchor/deploy/setup_server.sh
sudo nano /etc/anchor/anchor.env          # ANTHROPIC_API_KEY, ntfy topic, age key
sudo -u anchor /opt/anchor/venv/bin/python -m anchor_server.google_auth   # one-time
sudo systemctl restart anchor-api anchor-worker
```
Put the API behind your HTTPS reverse proxy (it listens on 127.0.0.1:8300).

**GUI:** `cd anchor/gui && npm install && npm run build` — the API serves
`gui/build/` automatically; install it from the browser as a PWA.

**Phone (Termux from F-Droid, + Termux:API + Termux:Boot):**
```bash
bash anchor/phone/setup_termux.sh     # asks for server URL + token
anchor backfill                        # ingest the existing recording backlog
anchor backfill-report                 # what it found
```

**Dev/tests:** `cd anchor/server && uv venv .venv && . .venv/bin/activate &&
uv pip install -e '.[dev]' && pytest`

## Phase status

- **Phase 1 (this tree): done.** Durable core, ingestion→transcription→agent
  pipeline, backfill + report, live auto-sync, CLI, minimal GUI (Today /
  Confirm / Ask), digest + backups + health.
- **Phase 2 next:** SMS poller, Timeline GUI with offset playback, contacts &
  system-health views, bad-day mode toggle, symptom log/report.
- **Phase 3:** embeddings search, `anchor pack`, Gmail ingestion, location
  history, widget capture.

## Notes for the user's attorneys

Recordings involving counsel are flagged `privileged`, stored locally only,
excluded from exports and reports by default, and visibly marked. Counsel
must be informed these recordings exist.
