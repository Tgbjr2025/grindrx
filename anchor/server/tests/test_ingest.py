"""Ingestion: sha256 idempotency, Samsung filename parsing, privileged flag."""

import json

from anchor_server import db, ingest


def test_filename_parsing_contact_and_stamp():
    parsed = ingest.parse_recording_filename("Call recording Dr Smith_260812_143000.m4a")
    assert parsed["contact_hint"] == "Dr Smith"
    assert parsed["captured_at"].startswith("2026-08-12T14:30:00")


def test_filename_parsing_phone_number():
    parsed = ingest.parse_recording_filename("+13135551212_260601_090000.amr")
    assert parsed["phone_number"] == "+13135551212"
    assert parsed["contact_hint"] is None


def test_filename_parsing_no_stamp():
    parsed = ingest.parse_recording_filename("random-voicemail.mp3")
    assert parsed["captured_at"] is None


def test_normalize_phone():
    assert ingest.normalize_phone("(313) 555-1212") == "+13135551212"
    assert ingest.normalize_phone("1-313-555-1212") == "+13135551212"
    assert ingest.normalize_phone("+44 20 7946 0958") == "+442079460958"
    assert ingest.normalize_phone(None) is None


def test_ingest_dedupes_by_content(audio_file):
    first = ingest.ingest_file(audio_file, audio_file.name, "call")
    assert first["duplicate"] is False
    second = ingest.ingest_file(audio_file, "different-name.m4a", "call")
    assert second["duplicate"] is True
    assert second["artifact_id"] == first["artifact_id"]
    assert db.q1("SELECT COUNT(*) AS n FROM artifacts")["n"] == 1
    # Only one processing job even after the re-upload.
    assert db.q1("SELECT COUNT(*) AS n FROM jobs")["n"] == 1


def test_ingest_audio_enqueues_transcription(audio_file):
    result = ingest.ingest_file(audio_file, audio_file.name, "call")
    job = db.q1("SELECT * FROM jobs WHERE artifact_id=?", (result["artifact_id"],))
    assert job["type"] == "transcribe"
    art = db.q1("SELECT * FROM artifacts WHERE id=?", (result["artifact_id"],))
    assert art["contact_hint"] == "Dr Smith"
    assert art["captured_at"].startswith("2026-08-12T14:30")


def test_privileged_flag_from_contact(tmp_path):
    db.execute(
        "INSERT INTO contacts (name, numbers, category, privileged, origin, created_at, updated_at)"
        " VALUES ('Attorney Jones', ?, 'legal', 1, 'user', '2026-01-01T00:00:00-05:00',"
        " '2026-01-01T00:00:00-05:00')",
        (json.dumps(["+13135550000"]),),
    )
    f = tmp_path / "+13135550000_260810_120000.m4a"
    f.write_bytes(b"privileged-call-audio")
    result = ingest.ingest_file(f, f.name, "call")
    art = db.q1("SELECT * FROM artifacts WHERE id=?", (result["artifact_id"],))
    assert art["privileged"] == 1
    assert art["contact_id"] is not None


def test_text_ingest_skips_transcription(tmp_path):
    f = tmp_path / "note.txt"
    f.write_bytes(b"pick up meds Thursday")
    result = ingest.ingest_file(f, f.name, "note", text_body="pick up meds Thursday")
    job = db.q1("SELECT * FROM jobs WHERE artifact_id=?", (result["artifact_id"],))
    assert job["type"] == "agent_turn"
    # Indexed for vault search immediately.
    rows = db.q("SELECT * FROM vault_fts WHERE vault_fts MATCH 'meds'")
    assert len(rows) == 1
