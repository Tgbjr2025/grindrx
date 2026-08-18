"""The worker daemon: drains the durable job queue and runs housekeeping.

Startup reclaims any `processing` jobs a crash left behind; every handler is
idempotent, so a re-run is clean. Terminal failures notify the user (rule 8).
"""

from __future__ import annotations

import json
import signal
import sys
import time
import traceback
from datetime import timedelta

from . import config, db, notify, queue, timeutil
from .agent import brain

POLL_SECONDS = 3
HOUSEKEEPING_SECONDS = 60

_shutdown = False


def _handle_signal(signum, frame):  # noqa: ARG001
    global _shutdown
    _shutdown = True


def handle_transcribe(job: dict) -> None:
    from . import transcribe  # heavy import deferred to first audio job

    artifact = db.q1("SELECT * FROM artifacts WHERE id = ?", (job["artifact_id"],))
    if artifact is None:
        raise RuntimeError(f"transcribe job for missing artifact {job['artifact_id']}")
    if artifact["transcript"] is not None:
        # Idempotency: already transcribed (crash after transcribe, before
        # enqueueing the agent turn). Fall through to enqueue the next stage.
        pass
    else:
        result = transcribe.transcribe_file(artifact["stored_path"])
        db.execute(
            "UPDATE artifacts SET transcript=?, transcript_segments=?, duration_seconds=?,"
            " status='transcribed' WHERE id=?",
            (result["text"], transcribe.segments_json(result), result["duration"], artifact["id"]),
        )
        db.fts_index(result["text"], "artifact", artifact["id"], artifact["id"])
        db.audit("worker", "artifact.transcribed", "artifact", artifact["id"],
                 {"duration": result["duration"], "chars": len(result["text"])})
    if not db.q1(
        "SELECT id FROM jobs WHERE type='agent_turn' AND artifact_id=? AND state != 'failed'",
        (artifact["id"],),
    ):
        queue.enqueue("agent_turn", artifact["id"])


def handle_agent_turn(job: dict) -> None:
    brain.run_artifact_turn(job["artifact_id"])


HANDLERS = {
    "transcribe": handle_transcribe,
    "agent_turn": handle_agent_turn,
}


def process_one() -> bool:
    """Claim and run one job. Returns False when the queue is idle."""
    job = queue.claim_next()
    if job is None:
        return False
    handler = HANDLERS.get(job["type"])
    try:
        if handler is None:
            raise RuntimeError(f"No handler for job type {job['type']!r}")
        handler(job)
        queue.mark_done(job["id"])
    except Exception as exc:  # noqa: BLE001 — recorded, retried, then loud
        error = f"{exc}\n{traceback.format_exc()}"
        outcome = queue.mark_failed(job["id"], job["attempts"], error)
        print(f"[anchor-worker] job {job['id']} ({job['type']}) {outcome}: {exc}", file=sys.stderr)
        if outcome == "failed":
            artifact_note = f" (artifact #{job['artifact_id']})" if job["artifact_id"] else ""
            notify.push(
                "Anchor: a job failed permanently",
                f"{job['type']}{artifact_note} failed after {job['attempts']} attempts: {exc}\n"
                "The item is safe in the vault; check System health.",
                priority="urgent",
                tags="rotating_light",
            )
    return True


# --------------------------------------------------------------------------
# Housekeeping: stale phone sync, escalating callback reminders, event checks
# --------------------------------------------------------------------------

def _waking_hours() -> bool:
    hour = timeutil.now_local().hour
    return config.WAKING_HOURS[0] <= hour < config.WAKING_HOURS[1]


def check_phone_sync() -> None:
    if not _waking_hours():
        return
    row = db.q1("SELECT * FROM heartbeats WHERE component='phone'")
    if row is None:
        return  # phone has never synced; setup incomplete, surfaced in digest
    last = timeutil.parse_iso(row["last_seen"])
    age = (timeutil.now_local() - last).total_seconds()
    if age > config.PHONE_STALE_SECONDS:
        already = db.q1(
            "SELECT id FROM audit_log WHERE action='alert.phone_stale' AND ts > ?",
            (timeutil.iso(last),),
        )
        if not already:  # one alert per stale episode, not one per minute
            notify.push(
                "Phone sync is stale",
                f"The phone hasn't synced in {age / 3600:.1f} hours. New calls are "
                "NOT being captured. Open Termux or reboot the phone.",
                priority="urgent",
                tags="warning",
            )
            db.audit("worker", "alert.phone_stale", detail={"age_hours": age / 3600})


def escalate_callbacks() -> None:
    tasks = db.q("SELECT * FROM tasks WHERE status='open' AND kind='callback'")
    now = timeutil.now_local()
    for task in tasks:
        created = timeutil.parse_iso(task["created_at"])
        age = (now - created).total_seconds()
        level = task["escalation_level"]
        if level >= len(config.TASK_ESCALATION_SECONDS):
            continue
        if age >= config.TASK_ESCALATION_SECONDS[level]:
            notify.push(
                f"Still open: {task['title']}",
                (f"Call {task['phone_number']}. " if task["phone_number"] else "")
                + f"Open since {task['created_at']} (reminder {level + 1})."
                + (f"\nSource: “{task['source_quote']}”" if task["source_quote"] else ""),
                priority="high" if level < 2 else "urgent",
                tags="phone",
            )
            db.execute(
                "UPDATE tasks SET escalation_level=?, last_reminded_at=?, updated_at=? WHERE id=?",
                (level + 1, timeutil.now_iso(), timeutil.now_iso(), task["id"]),
            )
            db.audit("worker", "task.escalate", "task", task["id"], {"level": level + 1})


def housekeeping() -> None:
    check_phone_sync()
    escalate_callbacks()
    db.heartbeat("worker", json.dumps(queue.depth()))


def main() -> None:
    config.ensure_dirs()
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    reclaimed = queue.reclaim_stale()
    if reclaimed:
        print(f"[anchor-worker] reclaimed {reclaimed} interrupted job(s)")
    db.heartbeat("worker", "started")
    db.audit("worker", "worker.start", detail={"reclaimed": reclaimed})
    last_housekeeping = 0.0
    while not _shutdown:
        worked = process_one()
        if time.monotonic() - last_housekeeping > HOUSEKEEPING_SECONDS:
            try:
                housekeeping()
            except Exception as exc:  # noqa: BLE001
                print(f"[anchor-worker] housekeeping error: {exc}", file=sys.stderr)
                db.audit("worker", "housekeeping.error", detail={"error": repr(exc)})
            last_housekeeping = time.monotonic()
        if not worked:
            time.sleep(POLL_SECONDS)
    db.audit("worker", "worker.stop")
    print("[anchor-worker] clean shutdown")


if __name__ == "__main__":
    main()
