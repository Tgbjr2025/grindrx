"""Durable SQLite job queue.

Guarantees (brief: "Durability — must survive restart of anything"):
- Every unit of work is a row; a crash mid-job leaves it in `processing`,
  and `reclaim_stale()` (called at worker startup) requeues it.
- Every job handler is idempotent, so a re-run after a crash is clean.
- Failures retry on the JOB_BACKOFF schedule, then go to `failed` and are
  surfaced via rule 8 (fail loud) by the worker's housekeeping pass.
"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from . import config, db, timeutil


def enqueue(job_type: str, artifact_id: int | None = None, payload: dict[str, Any] | None = None) -> int:
    now = timeutil.now_iso()
    job_id = db.execute(
        "INSERT INTO jobs (type, artifact_id, payload, state, next_run_at, created_at)"
        " VALUES (?, ?, ?, 'queued', ?, ?)",
        (job_type, artifact_id, json.dumps(payload or {}), now, now),
    )
    db.audit("system", "job.enqueue", "job", job_id, {"type": job_type, "artifact_id": artifact_id})
    return job_id


def claim_next() -> dict[str, Any] | None:
    """Atomically claim the next runnable job. Returns None when idle."""
    conn = db.connect()
    now = timeutil.now_iso()
    with conn:  # single transaction: select + mark
        row = conn.execute(
            "SELECT * FROM jobs WHERE state='queued' AND next_run_at <= ?"
            " ORDER BY next_run_at, id LIMIT 1",
            (now,),
        ).fetchone()
        if row is None:
            return None
        conn.execute(
            "UPDATE jobs SET state='processing', claimed_at=?, attempts=attempts+1 WHERE id=?",
            (now, row["id"]),
        )
    job = dict(row)
    job["payload"] = json.loads(job["payload"])
    job["attempts"] = job["attempts"] + 1
    return job


def mark_done(job_id: int) -> None:
    db.execute(
        "UPDATE jobs SET state='done', finished_at=? WHERE id=?",
        (timeutil.now_iso(), job_id),
    )


def mark_failed(job_id: int, attempts: int, error: str) -> str:
    """Record a failure. Returns 'retry' or 'failed' (terminal)."""
    if attempts <= len(config.JOB_BACKOFF):
        delay = config.JOB_BACKOFF[attempts - 1]
        next_run = timeutil.iso(timeutil.now_local() + timedelta(seconds=delay))
        db.execute(
            "UPDATE jobs SET state='queued', next_run_at=?, last_error=? WHERE id=?",
            (next_run, error[:4000], job_id),
        )
        db.audit("worker", "job.retry", "job", job_id, {"attempt": attempts, "delay_s": delay, "error": error[:500]})
        return "retry"
    db.execute(
        "UPDATE jobs SET state='failed', finished_at=?, last_error=? WHERE id=?",
        (timeutil.now_iso(), error[:4000], job_id),
    )
    db.audit("worker", "job.failed", "job", job_id, {"error": error[:500]})
    return "failed"


def reclaim_stale() -> int:
    """Requeue jobs left in `processing` by a crashed/killed worker."""
    conn = db.connect()
    with conn:
        cur = conn.execute(
            "UPDATE jobs SET state='queued', next_run_at=? WHERE state='processing'",
            (timeutil.now_iso(),),
        )
    if cur.rowcount:
        db.audit("worker", "job.reclaim", detail={"count": cur.rowcount})
    return cur.rowcount


def depth() -> dict[str, int]:
    rows = db.q("SELECT state, COUNT(*) AS n FROM jobs GROUP BY state")
    return {r["state"]: r["n"] for r in rows}
