"""Digest: always carries the system-health line; privileged content masked."""

from anchor_server import db, digest, ingest


def test_digest_contains_health_line():
    body = digest.build_digest()
    assert "Health:" in body
    assert "phone sync NEVER" in body  # no heartbeat yet → visibly broken


def test_digest_masks_privileged_content(tmp_path):
    import json

    db.execute(
        "INSERT INTO contacts (name, numbers, category, privileged, origin, created_at, updated_at)"
        " VALUES ('Attorney Jones', ?, 'legal', 1, 'user', '2026-01-01T00:00:00-05:00',"
        " '2026-01-01T00:00:00-05:00')",
        (json.dumps(["+13135550000"]),),
    )
    f = tmp_path / "+13135550000_260818_090000.m4a"
    f.write_bytes(b"attorney-call")
    art = ingest.ingest_file(f, f.name, "call")["artifact_id"]
    db.execute(
        "UPDATE artifacts SET agent_summary='Discussed settlement strategy' WHERE id=?",
        (art,),
    )
    body = digest.build_digest()
    assert "settlement" not in body
    assert "[privileged]" in body
