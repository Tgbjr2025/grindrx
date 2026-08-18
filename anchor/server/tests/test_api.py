"""API surface: auth, upload, manifest, confirms, backfill report."""

import io
import json

from fastapi.testclient import TestClient

from anchor_server import db, queue
from anchor_server.api import app
from anchor_server.worker import process_one

client = TestClient(app, raise_server_exceptions=False)
AUTH = {"Authorization": "Bearer test-token"}


def _upload(name="Call recording Dentist_270301_090000.m4a", **form):
    data = {"kind": "call", **form}
    return client.post(
        "/v1/ingest",
        headers=AUTH,
        data=data,
        files={"file": (name, io.BytesIO(b"audio-" + name.encode()), "audio/mp4")},
    )


def test_auth_required():
    assert client.get("/v1/today").status_code == 401
    assert client.get("/v1/today", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/ping").status_code == 200  # liveness stays open


def test_upload_and_dedupe():
    r1 = _upload()
    assert r1.status_code == 200, r1.text
    body = r1.json()
    assert body["duplicate"] is False
    r2 = _upload()
    assert r2.json()["duplicate"] is True
    assert r2.json()["artifact_id"] == body["artifact_id"]


def test_manifest_reflects_uploads():
    _upload()
    manifest = client.get("/v1/sync/manifest", headers=AUTH).json()
    assert len(manifest["sha256"]) == 1
    art = db.q1("SELECT sha256 FROM artifacts")
    assert manifest["sha256"][0] == art["sha256"]


def test_heartbeat_recorded():
    r = client.post("/v1/sync/heartbeat", headers=AUTH, json={"device": "phone", "detail": "sweep ok"})
    assert r.status_code == 200
    row = db.q1("SELECT * FROM heartbeats WHERE component='phone'")
    assert row is not None and row["detail"] == "sweep ok"


def test_text_note_ingest():
    r = client.post(
        "/v1/ingest/text", headers=AUTH,
        json={"text": "remember to fax the disability form", "kind": "note"},
    )
    assert r.status_code == 200
    art = db.q1("SELECT * FROM artifacts WHERE kind='note'")
    assert art["transcript"] == "remember to fax the disability form"


def test_confirm_resolution_approve_executes_proposal():
    # Seed an artifact + a pending confirm whose proposal creates a task.
    r = _upload()
    art = r.json()["artifact_id"]
    confirm_id = db.execute(
        "INSERT INTO confirms (kind, summary, proposal, source_artifact_id, created_at)"
        " VALUES ('task', 'Call back?', ?, ?, '2026-08-18T08:00:00-04:00')",
        (
            json.dumps({
                "tool": "task_create",
                "input": {
                    "title": "Call dentist back", "kind": "callback",
                    "source_artifact_id": art, "source_quote": "call us back",
                },
            }),
            art,
        ),
    )
    r = client.post(
        f"/v1/confirms/{confirm_id}/resolve", headers=AUTH, json={"action": "approve"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["result"] == "approved"
    assert db.q1("SELECT * FROM tasks WHERE title='Call dentist back'") is not None
    assert db.q1("SELECT status FROM confirms WHERE id=?", (confirm_id,))["status"] == "approved"


def test_confirm_dismiss():
    r = _upload()
    confirm_id = db.execute(
        "INSERT INTO confirms (kind, summary, proposal, source_artifact_id, created_at)"
        " VALUES ('other', 'Ambiguous', '{}', ?, '2026-08-18T08:00:00-04:00')",
        (r.json()["artifact_id"],),
    )
    resp = client.post(
        f"/v1/confirms/{confirm_id}/resolve", headers=AUTH, json={"action": "dismiss"}
    )
    assert resp.json()["result"] == "dismissed"
    # Nothing deleted: row is kept with resolution recorded.
    row = db.q1("SELECT * FROM confirms WHERE id=?", (confirm_id,))
    assert row is not None and row["resolution"] is not None


def test_backfill_report(monkeypatch):
    _upload("Call recording Clinic_260101_090000.m4a", batch_id="bf-1", backfill="true")
    report = client.get("/v1/backfill/report", headers=AUTH, params={"batch_id": "bf-1"}).json()
    assert report["count"] == 1
    assert report["still_processing"] == 1  # transcription queued


def test_worker_failed_job_notifies(monkeypatch):
    from anchor_server import config

    _upload("Call recording X_260101_100000.m4a")
    monkeypatch.setattr(config, "JOB_BACKOFF", ())  # first failure is terminal

    import anchor_server.worker as worker

    monkeypatch.setitem(worker.HANDLERS, "transcribe", lambda job: 1 / 0)
    assert process_one() is True
    assert db.q1("SELECT * FROM jobs WHERE state='failed'") is not None
    pushes = db.q("SELECT * FROM outbox WHERE channel='ntfy'")
    assert any("failed permanently" in p["payload"] for p in pushes)


def test_health_endpoint():
    r = client.get("/v1/health", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["dry_run"] is True
    assert "queue" in body and "heartbeats" in body


def test_audio_accepts_query_token():
    r = _upload("Call recording Y_270105_110000.m4a")
    art = r.json()["artifact_id"]
    assert client.get(f"/v1/artifacts/{art}/audio").status_code == 401
    assert client.get(f"/v1/artifacts/{art}/audio?token=wrong").status_code == 401
    ok = client.get(f"/v1/artifacts/{art}/audio?token=test-token")
    assert ok.status_code == 200
    assert ok.content.startswith(b"audio-")
