"""Phase 3: semantic index + hybrid search, pack export, Gmail ingestion,
location-history import.

The embedder is stubbed (letter-frequency vectors) so tests run without model
weights while still exercising storage, sweep idempotency, and cosine ranking.
"""

import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from anchor_server import db, embeddings, ingest, location, search
from anchor_server.api import app

client = TestClient(app, raise_server_exceptions=False)
AUTH = {"Authorization": "Bearer test-token"}


def _letter_vec(text: str) -> list[float]:
    vec = [0.0] * 26
    for ch in text.lower():
        if "a" <= ch <= "z":
            vec[ord(ch) - 97] += 1.0
    return vec


@pytest.fixture(autouse=True)
def stub_embedder():
    embeddings.set_embedder(lambda texts: [_letter_vec(t) for t in texts])
    yield
    embeddings.set_embedder(None)


def _note(text, **extra):
    return client.post(
        "/v1/ingest/text", headers=AUTH,
        json={"text": text, "kind": "note", **extra},
    ).json()["artifact_id"]


# --- semantic index ---------------------------------------------------------

def test_embed_sweep_fills_and_is_idempotent():
    _note("cardiology appointment on Thursday")
    _note("grocery list bananas")
    assert embeddings.embed_sweep() == 2
    assert embeddings.embed_sweep() == 0  # nothing left to embed
    status = embeddings.index_status()
    assert status["indexed"] == 2 and status["pending"] == 0


def test_hybrid_search_keyword_first_then_semantic():
    a1 = _note("cardiology appointment on Thursday")
    _note("zzzz qqqq xxxx unrelated")
    embeddings.embed_sweep()
    # Exact keyword: FTS finds it, marked keyword.
    results = search.hybrid_search("cardiology", limit=5)
    assert results and results[0]["match"] == "keyword"
    assert results[0]["artifact_id"] == a1
    # 'cardiologist' misses FTS (no stemming) but the semantic index finds
    # the cardiology note as the nearest neighbor.
    results = search.hybrid_search("cardiologist", limit=1)
    assert results and results[0]["match"] == "semantic"
    assert results[0]["artifact_id"] == a1


def test_embed_failure_disables_loudly(monkeypatch):
    _note("some new content")
    embeddings.set_embedder(None)

    def boom():
        raise RuntimeError("onnx exploded")

    monkeypatch.setattr(embeddings, "_get_embedder", boom)
    assert embeddings.embed_sweep() == 0
    pushes = db.q("SELECT * FROM outbox WHERE channel='ntfy'")
    assert any("semantic search is off" in p["payload"] for p in pushes)
    # Disabled until restart — no repeat notifications.
    assert embeddings.embed_sweep() == 0
    assert sum("semantic search is off" in p["payload"]
               for p in db.q("SELECT * FROM outbox WHERE channel='ntfy'")) == 1


# --- pack -------------------------------------------------------------------

def _privileged_artifact(tmp_path):
    db.execute(
        "INSERT INTO contacts (name, numbers, category, privileged, origin, created_at, updated_at)"
        " VALUES ('Attorney Jones', ?, 'legal', 1, 'user', '2026-01-01T00:00:00-05:00',"
        " '2026-01-01T00:00:00-05:00')",
        (json.dumps(["+13135550000"]),),
    )
    f = tmp_path / "+13135550000_260810_120000.m4a"
    f.write_bytes(b"privileged-audio")
    art = ingest.ingest_file(f, f.name, "call")["artifact_id"]
    db.execute("UPDATE artifacts SET transcript='cardiology case strategy' WHERE id=?", (art,))
    db.fts_index("cardiology case strategy", "artifact", art, art)
    return art


def test_pack_excludes_privileged_by_default(tmp_path):
    normal = _note("cardiology appointment with Dr Smith")
    _privileged_artifact(tmp_path)
    resp = client.get("/v1/pack", headers=AUTH, params={"topic": "cardiology"})
    assert resp.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(resp.content))
    md = z.read("pack.md").decode()
    assert "cardiology appointment" in md
    assert "case strategy" not in md
    assert "privileged (attorney) item(s) were EXCLUDED" in md
    names = z.namelist()
    assert any(n.startswith("transcripts/") and f"{normal}_" in n for n in names)


def test_pack_can_include_privileged_explicitly(tmp_path):
    _privileged_artifact(tmp_path)
    resp = client.get(
        "/v1/pack", headers=AUTH,
        params={"topic": "cardiology", "include_privileged": "true"},
    )
    md = zipfile.ZipFile(io.BytesIO(resp.content)).read("pack.md").decode()
    assert "case strategy" in md
    assert "INCLUDES privileged" in md


# --- gmail ------------------------------------------------------------------

def _gmail_msg(mid, subject, body, sender="Lakeside Imaging <appt@lakeside.example>"):
    import base64

    return {
        "id": mid,
        "snippet": body[:50],
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "From", "value": sender},
                {"name": "Subject", "value": subject},
                {"name": "Date", "value": "Tue, 18 Aug 2026 09:00:00 -0400"},
            ],
            "body": {"data": base64.urlsafe_b64encode(body.encode()).decode()},
        },
    }


def test_gmail_poll_ingests_and_dedupes(monkeypatch):
    from anchor_server import config, gmail_ingest

    monkeypatch.setattr(config, "GMAIL_ENABLED", True)

    msgs = {"m1": _gmail_msg("m1", "Appointment confirmed",
                             "Your MRI is confirmed for Sept 3 at 2:00 PM. Call 313-555-7777.")}

    class FakeSvc:
        def users(self): return self
        def messages(self): return self
        def list(self, **kw): return self._wrap({"messages": [{"id": "m1"}]})
        def get(self, userId, id, format): return self._wrap(msgs[id])
        @staticmethod
        def _wrap(value):
            class R:
                def execute(self_inner): return value
            return R()

    monkeypatch.setattr(gmail_ingest, "_service", lambda: FakeSvc())
    assert gmail_ingest.poll() == 1
    art = db.q1("SELECT * FROM artifacts WHERE kind='email'")
    assert art is not None
    assert art["source_path"] == "gmail:m1"
    assert "MRI is confirmed" in art["transcript"]
    assert art["contact_hint"] == "Lakeside Imaging"
    # Agent turn queued like any other text artifact.
    job = db.q1("SELECT * FROM jobs WHERE artifact_id=?", (art["id"],))
    assert job is not None and job["type"] == "agent_turn"
    # Second poll: nothing new.
    assert gmail_ingest.poll() == 0


def test_gmail_disabled_is_noop():
    from anchor_server import gmail_ingest

    assert gmail_ingest.poll() == 0  # GMAIL_ENABLED defaults off


# --- location ---------------------------------------------------------------

ON_DEVICE = {
    "semanticSegments": [
        {
            "startTime": "2026-08-11T10:00:00-04:00",
            "endTime": "2026-08-11T11:30:00-04:00",
            "visit": {"topCandidate": {"placeLocation": {"name": "Lakeside Imaging"}}},
        },
        {"startTime": "x", "endTime": "y", "timelinePath": []},  # non-visit segment
    ]
}

TAKEOUT = {
    "timelineObjects": [
        {
            "placeVisit": {
                "location": {"name": "Henry Ford Hospital"},
                "duration": {
                    "startTimestamp": "2026-08-12T09:00:00-04:00",
                    "endTimestamp": "2026-08-12T10:00:00-04:00",
                },
            }
        }
    ]
}


def test_location_import_both_formats_and_idempotent():
    r = client.post(
        "/v1/location/import", headers=AUTH,
        files={"file": ("timeline.json", io.BytesIO(json.dumps(ON_DEVICE).encode()), "application/json")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["facts_added"] == 1
    fact = db.q1("SELECT * FROM facts WHERE category='location'")
    assert "Lakeside Imaging" in fact["body"]
    # No jobs for location artifacts (no transcription/agent turn on huge JSON).
    assert db.q1("SELECT * FROM jobs WHERE artifact_id=?", (r.json()["artifact_id"],)) is None

    r2 = client.post(
        "/v1/location/import", headers=AUTH,
        files={"file": ("takeout.json", io.BytesIO(json.dumps(TAKEOUT).encode()), "application/json")},
    )
    assert r2.json()["facts_added"] == 1

    # Re-importing an overlapping export adds nothing new.
    merged = {"semanticSegments": ON_DEVICE["semanticSegments"] + [
        {
            "startTime": "2026-08-13T08:00:00-04:00",
            "endTime": "2026-08-13T08:30:00-04:00",
            "visit": {"topCandidate": {"label": "Pharmacy"}},
        }
    ]}
    r3 = client.post(
        "/v1/location/import", headers=AUTH,
        files={"file": ("merged.json", io.BytesIO(json.dumps(merged).encode()), "application/json")},
    )
    assert r3.json()["facts_added"] == 1  # only the pharmacy visit is new
    # Answerable via search.
    hits = search.keyword_search("Pharmacy", 5)
    assert hits and hits[0]["entity"] == "fact"


def test_location_import_rejects_garbage():
    r = client.post(
        "/v1/location/import", headers=AUTH,
        files={"file": ("junk.json", io.BytesIO(b'{"foo": 1}'), "application/json")},
    )
    assert r.status_code == 400
    assert "Unrecognized" in r.json()["detail"]
