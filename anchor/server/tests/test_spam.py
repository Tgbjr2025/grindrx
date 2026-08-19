"""Spam handling: known-spam calls skip transcription, one-tap mark blocks
future calls, audio purges on a timer, spam hidden from timeline/digest."""

import io
import json
from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from anchor_server import config, db, digest, ingest, timeutil, worker
from anchor_server.api import app

client = TestClient(app, raise_server_exceptions=False)
AUTH = {"Authorization": "Bearer test-token"}

SPAM_NUM = "+18005551234"


def _register_spam():
    db.execute(
        "INSERT INTO contacts (name, numbers, category, origin, created_at, updated_at)"
        " VALUES ('Robocaller', ?, 'spam', 'user', '2026-01-01T00:00:00-05:00',"
        " '2026-01-01T00:00:00-05:00')",
        (json.dumps([SPAM_NUM]),),
    )


def _call(number, stamp="260818_120000", body=b"ring-ring"):
    name = f"{number}_{stamp}.m4a"
    return client.post(
        "/v1/ingest", headers=AUTH, data={"kind": "call"},
        files={"file": (name, io.BytesIO(body + name.encode()), "audio/mp4")},
    ).json()


def test_known_spam_call_is_skipped_entirely():
    _register_spam()
    result = _call(SPAM_NUM)
    art = db.q1("SELECT * FROM artifacts WHERE id=?", (result["artifact_id"],))
    assert art["status"] == "spam"
    # No transcription, no agent turn — zero jobs.
    assert db.q1("SELECT * FROM jobs WHERE artifact_id=?", (art["id"],)) is None
    # Hidden from the timeline by default, visible with include_spam.
    items = client.get("/v1/timeline", headers=AUTH).json()["items"]
    assert all(i["id"] != art["id"] for i in items)
    items = client.get("/v1/timeline?include_spam=true", headers=AUTH).json()["items"]
    assert any(i["id"] == art["id"] for i in items)
    # Loud skip, not silent (audit trail).
    assert db.q1("SELECT * FROM audit_log WHERE action='spam.skipped'") is not None


def test_mark_spam_blocks_future_calls():
    first = _call("+13135550001", "260818_090000")
    r = client.post(f"/v1/artifacts/{first['artifact_id']}/spam", headers=AUTH)
    assert r.status_code == 200
    assert r.json()["blocked_number"] == "+13135550001"
    # Contact registered as spam...
    c = db.q1("SELECT * FROM contacts WHERE category='spam'")
    assert c is not None and "+13135550001" in c["numbers"]
    # ...so the NEXT call from that number is skipped automatically.
    second = _call("+13135550001", "260818_150000", b"different-audio")
    art2 = db.q1("SELECT * FROM artifacts WHERE id=?", (second["artifact_id"],))
    assert art2["status"] == "spam"
    assert db.q1("SELECT * FROM jobs WHERE artifact_id=?", (art2["id"],)) is None


def test_spam_audio_purged_after_window(monkeypatch):
    _register_spam()
    result = _call(SPAM_NUM)
    art = db.q1("SELECT * FROM artifacts WHERE id=?", (result["artifact_id"],))
    stored = Path(art["stored_path"])
    assert stored.exists()
    # Age the row past the purge window and run the housekeeping step.
    old = timeutil.iso(timeutil.now_local() - timedelta(days=config.SPAM_PURGE_DAYS + 1))
    db.execute("UPDATE artifacts SET created_at=? WHERE id=?", (old, art["id"]))
    worker.spam_purge()
    assert not stored.exists()
    row = db.q1("SELECT * FROM artifacts WHERE id=?", (art["id"],))
    assert row is not None                # metadata row kept — number stays blocked
    assert row["stored_path"] is None
    # Fresh spam inside the window is untouched.
    fresh = _call(SPAM_NUM, "260819_100000", b"fresh")
    fresh_path = Path(db.q1("SELECT stored_path FROM artifacts WHERE id=?",
                            (fresh["artifact_id"],))["stored_path"])
    worker.spam_purge()
    assert fresh_path.exists()


def test_digest_counts_spam_without_listing_it():
    _register_spam()
    _call(SPAM_NUM)
    body = digest.build_digest()
    assert "Ignored 1 spam call" in body
    assert "Robocaller" not in body  # not listed among captures


def test_safe_mode_holds_google_but_never_mutes_pushes(monkeypatch, tmp_path):
    """Regression: SAFE MODE (Google unconnected) silenced ALL ntfy pushes,
    so the 8 AM digest never reached the phone. Pushes must always send."""
    import sys
    from types import SimpleNamespace

    from anchor_server import gcal, notify, timeutil
    from datetime import timedelta

    monkeypatch.setattr(config, "DRY_RUN", False)
    monkeypatch.setattr(config, "SAFE_MODE", True)

    # Google writes are held in the outbox...
    start = timeutil.now_local() + timedelta(days=1)
    g = gcal.create_event("Checkup", start, start + timedelta(hours=1), None, "d")
    assert g["id"].startswith("dry-")
    assert db.q1("SELECT * FROM outbox WHERE channel='gcal'") is not None

    # ...but a push goes over the real wire (fake the requests lib to prove
    # the network path is taken, not the outbox).
    sent = {}

    def fake_post(url, data=None, headers=None, timeout=None):
        sent["url"] = url
        return SimpleNamespace(raise_for_status=lambda: None)

    monkeypatch.setitem(sys.modules, "requests", SimpleNamespace(post=fake_post))
    assert notify.push("Digest", "hello") is True
    assert "test-topic" in sent["url"]
    assert db.q1("SELECT * FROM outbox WHERE channel='ntfy'") is None
