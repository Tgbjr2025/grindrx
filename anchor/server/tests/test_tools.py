"""Agent tool layer: code-enforced trust rules."""

import json

from anchor_server import db, ingest, timeutil
from anchor_server.agent import tools


def _make_artifact(tmp_path, name="Call recording Office_260812_100000.m4a"):
    f = tmp_path / name
    f.write_bytes(b"audio" + name.encode())
    return ingest.ingest_file(f, name, "call")["artifact_id"]


def _future(hours=48):
    from datetime import timedelta

    return timeutil.iso(timeutil.now_local() + timedelta(hours=hours))


def test_calendar_write_requires_real_artifact():
    out, is_error = tools.dispatch(
        "calendar_write",
        {
            "action": "create", "title": "PT", "start": _future(),
            "source_artifact_id": 9999, "source_quote": "x",
        },
    )
    assert is_error
    assert "provenance" in json.loads(out)["error"]


def test_calendar_write_creates_event_and_notifies(tmp_path):
    art = _make_artifact(tmp_path)
    out, is_error = tools.dispatch(
        "calendar_write",
        {
            "action": "create",
            "title": "Physical therapy",
            "start": _future(),
            "location": "Lakeside PT",
            "source_artifact_id": art,
            "source_quote": "we have you down for Thursday at ten",
            "source_offset_seconds": 42.5,
        },
    )
    assert not is_error, out
    result = json.loads(out)
    event = db.q1("SELECT * FROM events WHERE id=?", (result["event_id"],))
    assert event["source_artifact_id"] == art
    assert event["source_quote"] == "we have you down for Thursday at ten"
    # Rule 2: auto-write, never silently — a push went out quoting the source.
    pushes = db.q("SELECT * FROM outbox WHERE channel='ntfy'")
    assert any("we have you down" in p["payload"] for p in pushes)
    # Reminders forced on the gcal payload.
    gcal_calls = db.q("SELECT * FROM outbox WHERE channel='gcal'")
    payload = json.loads(gcal_calls[0]["payload"])
    minutes = [o["minutes"] for o in payload["reminders"]["overrides"]]
    assert minutes == [120, 45]


def test_past_dated_becomes_fact_not_event(tmp_path):
    art = _make_artifact(tmp_path)
    out, is_error = tools.dispatch(
        "calendar_write",
        {
            "action": "create",
            "title": "Old MRI appointment",
            "start": "2026-01-05T09:00:00",
            "source_artifact_id": art,
            "source_quote": "your MRI on January fifth",
        },
    )
    assert not is_error
    result = json.loads(out)
    assert result["result"] == "past_dated_stored_as_fact"
    assert db.q1("SELECT COUNT(*) AS n FROM events")["n"] == 0
    fact = db.q1("SELECT * FROM facts WHERE id=?", (result["fact_id"],))
    assert "Old MRI appointment" in fact["body"]


def test_supersede_keeps_original(tmp_path):
    art = _make_artifact(tmp_path)
    out, _ = tools.dispatch(
        "calendar_write",
        {
            "action": "create", "title": "Follow-up", "start": _future(24),
            "source_artifact_id": art, "source_quote": "twelve thirty",
        },
    )
    old_id = json.loads(out)["event_id"]
    out2, is_error = tools.dispatch(
        "calendar_write",
        {
            "action": "supersede", "event_id": old_id, "title": "Follow-up",
            "start": _future(25),
            "source_artifact_id": art, "source_quote": "office says one o'clock",
        },
    )
    assert not is_error, out2
    new_id = json.loads(out2)["event_id"]
    old = db.q1("SELECT * FROM events WHERE id=?", (old_id,))
    assert old["status"] == "superseded"
    assert old["superseded_by"] == new_id
    assert db.q1("SELECT status FROM events WHERE id=?", (new_id,))["status"] == "active"


def test_callback_task_and_close(tmp_path):
    art = _make_artifact(tmp_path)
    out, _ = tools.dispatch(
        "task_create",
        {
            "title": "Call imaging center back to schedule",
            "kind": "callback", "phone_number": "(313) 555-9000",
            "source_artifact_id": art, "source_quote": "call us back to schedule",
        },
    )
    task_id = json.loads(out)["task_id"]
    task = db.q1("SELECT * FROM tasks WHERE id=?", (task_id,))
    assert task["phone_number"] == "+13135559000"
    out2, _ = tools.dispatch(
        "task_close",
        {"task_id": task_id, "reason": "booked on outbound call", "closed_by_artifact_id": art},
    )
    assert json.loads(out2)["result"] == "closed"
    task = db.q1("SELECT * FROM tasks WHERE id=?", (task_id,))
    assert task["status"] == "closed"
    assert task["closed_by_artifact_id"] == art


def test_fact_supersede_chain(tmp_path):
    art = _make_artifact(tmp_path)
    out, _ = tools.dispatch(
        "fact_write",
        {"body": "PT is on Thursdays", "source_artifact_id": art, "category": "scheduling"},
    )
    f1 = json.loads(out)["fact_id"]
    out2, _ = tools.dispatch(
        "fact_write",
        {
            "body": "PT moved to Fridays", "source_artifact_id": art,
            "category": "scheduling", "supersedes_fact_id": f1,
        },
    )
    f2 = json.loads(out2)["fact_id"]
    old = db.q1("SELECT * FROM facts WHERE id=?", (f1,))
    assert old["status"] == "superseded" and old["superseded_by"] == f2
    assert old["body"] == "PT is on Thursdays"  # original text intact


def test_contact_register_and_phone_write(tmp_path):
    art = _make_artifact(tmp_path)
    out, is_error = tools.dispatch(
        "phone_contact_write",
        {
            "name": "Sarah - Lakeside Imaging",
            "phone_number": "313-555-7777",
            "organization": "Lakeside Imaging",
            "source_artifact_id": art,
            "source_quote": "this is Sarah from Lakeside Imaging",
        },
    )
    assert not is_error, out
    contact = db.q1("SELECT * FROM contacts WHERE people_resource IS NOT NULL")
    assert contact is not None
    assert "+13135557777" in contact["numbers"]
    people_calls = db.q("SELECT * FROM outbox WHERE channel='people'")
    payload = json.loads(people_calls[0]["payload"])
    assert payload["name"].endswith("(Anchor)")  # unmistakably agent-created


def test_needs_confirm_flag_and_pushes(tmp_path):
    art = _make_artifact(tmp_path)
    out, _ = tools.dispatch(
        "flag_needs_confirm",
        {
            "kind": "event",
            "summary": "They said 'Tuesday at 1' with no date — which Tuesday?",
            "proposal": {"tool": "calendar_write", "input": {"action": "create"}},
            "source_artifact_id": art,
        },
    )
    confirm_id = json.loads(out)["confirm_id"]
    row = db.q1("SELECT * FROM confirms WHERE id=?", (confirm_id,))
    assert row["status"] == "pending"
    pushes = db.q("SELECT * FROM outbox WHERE channel='ntfy'")
    assert any("confirmation" in p["payload"].lower() for p in pushes)


def test_vault_search_finds_transcript(tmp_path):
    art = _make_artifact(tmp_path)
    db.execute("UPDATE artifacts SET transcript='appointment with cardiology Tuesday' WHERE id=?", (art,))
    db.fts_index("appointment with cardiology Tuesday", "artifact", art, art)
    out, is_error = tools.dispatch("vault_search", {"query": "cardiology"})
    assert not is_error
    results = json.loads(out)
    assert results and results[0]["artifact_id"] == art
