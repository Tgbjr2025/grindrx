"""SQLite layer: schema, connections, audit log.

Single-user, single-box: SQLite in WAL mode is the whole persistence story.
Rule 4 (nothing is deleted) is enforced here — there are no DELETE statements
in this codebase outside of test fixtures; corrections supersede.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from typing import Any

from . import config, timeutil

_local = threading.local()

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,              -- call | voicemail | photo | note | sms | fix
    filename TEXT,
    source_path TEXT,                -- original path on the phone
    stored_path TEXT,                -- path inside the vault
    mime TEXT,
    size INTEGER,
    contact_hint TEXT,               -- name parsed from filename / provided by client
    contact_id INTEGER,
    phone_number TEXT,
    captured_at TEXT,                -- ISO-8601 with offset (America/Detroit)
    backfill INTEGER NOT NULL DEFAULT 0,
    batch_id TEXT,
    privileged INTEGER NOT NULL DEFAULT 0,
    transcript TEXT,
    transcript_segments TEXT,        -- JSON [{start, end, text}]
    duration_seconds REAL,
    classification TEXT,             -- medical | legal | scheduling | personal | spam
    agent_summary TEXT,
    status TEXT NOT NULL DEFAULT 'ingested',  -- ingested | transcribed | processed | error
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,              -- transcribe | agent_turn | ask
    artifact_id INTEGER,
    payload TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT 'queued',  -- queued | processing | done | failed
    attempts INTEGER NOT NULL DEFAULT 0,
    next_run_at TEXT NOT NULL,
    claimed_at TEXT,
    finished_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, next_run_at);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    gcal_id TEXT,
    title TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT,
    location TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',   -- active | superseded | cancelled
    superseded_by INTEGER,
    source_artifact_id INTEGER,
    source_quote TEXT,
    source_offset_seconds REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'todo',       -- callback | todo | verify
    phone_number TEXT,
    due TEXT,
    status TEXT NOT NULL DEFAULT 'open',     -- open | closed
    close_reason TEXT,
    escalation_level INTEGER NOT NULL DEFAULT 0,
    last_reminded_at TEXT,
    notes TEXT,
    source_artifact_id INTEGER,
    source_quote TEXT,
    source_offset_seconds REAL,
    closed_by_artifact_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY,
    body TEXT NOT NULL,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'active',   -- active | superseded
    superseded_by INTEGER,
    source_artifact_id INTEGER,
    source_quote TEXT,
    source_offset_seconds REAL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    numbers TEXT NOT NULL DEFAULT '[]',      -- JSON array of E.164-ish strings
    organization TEXT,
    category TEXT NOT NULL DEFAULT 'unknown',-- medical | legal | scheduling | personal | spam | unknown
    privileged INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'anchor',   -- user | phone | backfill | anchor
    people_resource TEXT,                    -- Google People resourceName if written back
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS confirms (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                      -- event | task | contact | fact | other
    summary TEXT NOT NULL,
    proposal TEXT NOT NULL DEFAULT '{}',     -- JSON: the action to run on approve
    source_artifact_id INTEGER,
    source_quote TEXT,
    source_offset_seconds REAL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | fixed | dismissed
    resolution TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,                     -- agent | api | worker | user | system
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    detail TEXT,                             -- JSON
    source_artifact_id INTEGER
);

CREATE TABLE IF NOT EXISTS heartbeats (
    component TEXT PRIMARY KEY,              -- phone | worker | api | backup
    last_seen TEXT NOT NULL,
    detail TEXT
);

-- Dry-run / test capture of outbound side effects (ntfy, gcal, people).
CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    channel TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY,
    artifact_id INTEGER,
    trigger TEXT NOT NULL,                   -- artifact | ask | fix | confirm
    transcript TEXT NOT NULL,                -- JSON message log for audit
    result TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
    body, entity, entity_id UNINDEXED, artifact_id UNINDEXED
);
"""


def connect() -> sqlite3.Connection:
    """Per-thread connection with WAL + busy timeout + row factory."""
    conn: sqlite3.Connection | None = getattr(_local, "conn", None)
    if conn is not None:
        return conn
    config.ensure_dirs()
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    conn.commit()
    _local.conn = conn
    return conn


def reset_thread_connection() -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None


def q(sql: str, params: tuple | dict = ()) -> list[sqlite3.Row]:
    return connect().execute(sql, params).fetchall()


def q1(sql: str, params: tuple | dict = ()) -> sqlite3.Row | None:
    return connect().execute(sql, params).fetchone()


def execute(sql: str, params: tuple | dict = ()) -> int:
    conn = connect()
    cur = conn.execute(sql, params)
    conn.commit()
    return cur.lastrowid or cur.rowcount


def audit(
    actor: str,
    action: str,
    entity: str | None = None,
    entity_id: int | None = None,
    detail: dict[str, Any] | None = None,
    source_artifact_id: int | None = None,
) -> None:
    execute(
        "INSERT INTO audit_log (ts, actor, action, entity, entity_id, detail, source_artifact_id)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            timeutil.now_iso(),
            actor,
            action,
            entity,
            entity_id,
            json.dumps(detail, default=str) if detail is not None else None,
            source_artifact_id,
        ),
    )


def heartbeat(component: str, detail: str = "") -> None:
    execute(
        "INSERT INTO heartbeats (component, last_seen, detail) VALUES (?, ?, ?)"
        " ON CONFLICT(component) DO UPDATE SET last_seen=excluded.last_seen, detail=excluded.detail",
        (component, timeutil.now_iso(), detail),
    )


def fts_index(body: str, entity: str, entity_id: int, artifact_id: int | None) -> None:
    if body and body.strip():
        execute(
            "INSERT INTO vault_fts (body, entity, entity_id, artifact_id) VALUES (?, ?, ?, ?)",
            (body, entity, entity_id, artifact_id),
        )
