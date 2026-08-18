"""Durable queue: claim, reclaim after crash, retry backoff, terminal failure."""

from anchor_server import config, db, queue


def test_enqueue_claim_done():
    job_id = queue.enqueue("transcribe", artifact_id=1)
    job = queue.claim_next()
    assert job is not None and job["id"] == job_id
    assert job["type"] == "transcribe"
    assert job["attempts"] == 1
    assert queue.claim_next() is None  # nothing else runnable while processing
    queue.mark_done(job_id)
    assert db.q1("SELECT state FROM jobs WHERE id=?", (job_id,))["state"] == "done"


def test_reclaim_after_crash():
    queue.enqueue("agent_turn", artifact_id=2)
    job = queue.claim_next()
    assert job is not None
    # Simulate a crash: the job is stuck in `processing`.
    assert db.q1("SELECT state FROM jobs WHERE id=?", (job["id"],))["state"] == "processing"
    reclaimed = queue.reclaim_stale()
    assert reclaimed == 1
    job2 = queue.claim_next()
    assert job2 is not None and job2["id"] == job["id"]
    assert job2["attempts"] == 2


def test_retry_backoff_then_terminal_failure():
    job_id = queue.enqueue("transcribe")
    for attempt in range(1, len(config.JOB_BACKOFF) + 1):
        outcome = queue.mark_failed(job_id, attempt, "boom")
        assert outcome == "retry"
        row = db.q1("SELECT * FROM jobs WHERE id=?", (job_id,))
        assert row["state"] == "queued"
        assert row["next_run_at"] > db.q1("SELECT datetime('now') AS n")["n"][:10]
    outcome = queue.mark_failed(job_id, len(config.JOB_BACKOFF) + 1, "boom")
    assert outcome == "failed"
    assert db.q1("SELECT state FROM jobs WHERE id=?", (job_id,))["state"] == "failed"


def test_backoff_delays_job():
    job_id = queue.enqueue("transcribe")
    job = queue.claim_next()
    queue.mark_failed(job_id, job["attempts"], "transient")
    # Requeued with a future next_run_at → not immediately claimable.
    assert queue.claim_next() is None
