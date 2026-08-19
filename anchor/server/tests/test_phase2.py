"""Phase 2: SMS ingestion (dedupe salt + sender whitelist), symptom log + PDF,
task close endpoint."""

import json

from fastapi.testclient import TestClient

from anchor_server import db
from anchor_server.api import app

client = TestClient(app, raise_server_exceptions=False)
AUTH = {"Authorization": "Bearer test-token"}


def _sms(body, number, received, **extra):
    return client.post(
        "/v1/ingest/text",
        headers=AUTH,
        json={
            "text": body,
            "kind": "sms",
            "phone_number": number,
            "captured_at": received,
            "dedupe_salt": f"{number}|{received}",
            **extra,
        },
    )


def _register_contact(name, number, category="medical"):
    db.execute(
        "INSERT INTO contacts (name, numbers, category, origin, created_at, updated_at)"
        " VALUES (?, ?, ?, 'user', '2026-01-01T00:00:00-05:00', '2026-01-01T00:00:00-05:00')",
        (name, json.dumps([number]), category),
    )


def test_sms_dedupe_salt_separates_identical_bodies():
    r1 = _sms("Yes", "+13135551111", "2026-08-18T10:00:00")
    r2 = _sms("Yes", "+13135552222", "2026-08-18T10:00:00")
    r3 = _sms("Yes", "+13135551111", "2026-08-18T11:00:00")
    assert r1.json()["duplicate"] is False
    assert r2.json()["duplicate"] is False
    assert r3.json()["duplicate"] is False
    # Exact retry of the same message DOES dedupe.
    r4 = _sms("Yes", "+13135551111", "2026-08-18T10:00:00")
    assert r4.json()["duplicate"] is True
    assert r4.json()["artifact_id"] == r1.json()["artifact_id"]


def test_sms_from_unknown_sender_gets_agent_turn():
    # Appointment texts routinely come from unknown numbers — they must be
    # processed, not just stored (only spam-flagged senders are skipped).
    r = _sms("your appointment is tomorrow", "+19998887777", "2026-08-18T09:00:00")
    art = r.json()["artifact_id"]
    assert db.q("SELECT * FROM vault_fts WHERE vault_fts MATCH 'appointment'")
    job = db.q1("SELECT * FROM jobs WHERE artifact_id=?", (art,))
    assert job is not None and job["type"] == "agent_turn"


def test_sms_from_known_sender_gets_agent_turn():
    _register_contact("PT Office", "+13135554444", "medical")
    r = _sms("reminder: PT Thursday 10am", "+13135554444", "2026-08-18T09:30:00")
    art = r.json()["artifact_id"]
    job = db.q1("SELECT * FROM jobs WHERE artifact_id=?", (art,))
    assert job is not None and job["type"] == "agent_turn"
    a = db.q1("SELECT * FROM artifacts WHERE id=?", (art,))
    assert a["contact_id"] is not None


def test_sms_from_spam_sender_no_agent_turn():
    _register_contact("Robocaller", "+18005550000", "spam")
    r = _sms("FINAL NOTICE about your car warranty", "+18005550000", "2026-08-18T09:45:00")
    art = db.q1("SELECT * FROM artifacts WHERE id=?", (r.json()["artifact_id"],))
    assert art["status"] == "spam"
    assert db.q1("SELECT * FROM jobs WHERE artifact_id=?", (art["id"],)) is None


def test_requeue_orphans_rescues_stuck_texts():
    # Simulate a text left behind by the old whitelist: transcribed, no job.
    from anchor_server import worker

    art = db.execute(
        "INSERT INTO artifacts (sha256, kind, filename, transcript, status,"
        " captured_at, created_at) VALUES ('orphan1', 'sms', 'sms_x.txt',"
        " 'MRI scheduled for the 3rd', 'transcribed',"
        " '2026-08-18T09:00:00-04:00', '2026-08-18T09:00:00-04:00')"
    )
    worker.requeue_orphans()
    job = db.q1("SELECT * FROM jobs WHERE artifact_id=?", (art,))
    assert job is not None and job["type"] == "agent_turn"
    # Idempotent: a second sweep doesn't double-queue.
    worker.requeue_orphans()
    n = db.q1("SELECT COUNT(*) AS n FROM jobs WHERE artifact_id=?", (art,))["n"]
    assert n == 1


def test_symptom_log_and_pdf_report():
    r = client.post("/v1/symptoms", headers=AUTH, json={"text": "headache since lunch"})
    assert r.status_code == 200
    r2 = client.post("/v1/symptoms", headers=AUTH,
                     json={"text": "dizzy on standing", "logged_at": "2026-08-17T14:00:00"})
    assert r2.status_code == 200

    listing = client.get("/v1/symptoms", headers=AUTH).json()["symptoms"]
    assert len(listing) == 2
    assert listing[0]["body"] == "dizzy on standing"  # ordered by logged_at

    # Searchable from ask (vault FTS).
    assert db.q("SELECT * FROM vault_fts WHERE vault_fts MATCH 'headache'")

    pdf = client.get("/v1/symptoms/report.pdf?days=30&token=test-token")
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")
    assert client.get("/v1/symptoms/report.pdf").status_code == 401


def test_task_close_endpoint():
    from anchor_server import ingest

    import io
    up = client.post(
        "/v1/ingest", headers=AUTH, data={"kind": "call"},
        files={"file": ("Call recording T_270401_090000.m4a", io.BytesIO(b"t-audio"), "audio/mp4")},
    )
    art = up.json()["artifact_id"]
    task_id = db.execute(
        "INSERT INTO tasks (title, kind, source_artifact_id, created_at, updated_at)"
        " VALUES ('Call back', 'callback', ?, '2026-08-18T08:00:00-04:00', '2026-08-18T08:00:00-04:00')",
        (art,),
    )
    r = client.post(f"/v1/tasks/{task_id}/close", headers=AUTH,
                    json={"reason": "done from GUI"})
    assert r.status_code == 200
    row = db.q1("SELECT * FROM tasks WHERE id=?", (task_id,))
    assert row["status"] == "closed" and row["close_reason"] == "done from GUI"
    assert client.post("/v1/tasks/99999/close", headers=AUTH, json={}).status_code == 404
