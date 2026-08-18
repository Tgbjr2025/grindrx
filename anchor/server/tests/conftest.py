"""Test environment: isolated data dir, dry-run side effects, dummy secrets.

Env vars must be set before anchor_server.config is imported anywhere.
"""

import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="anchor-test-")
os.environ["ANCHOR_DATA_DIR"] = _tmp
os.environ["ANCHOR_DB_PATH"] = str(Path(_tmp) / "anchor.db")
os.environ["ANCHOR_VAULT_DIR"] = str(Path(_tmp) / "vault")
os.environ["ANCHOR_DRY_RUN"] = "1"
os.environ["ANCHOR_API_TOKEN"] = "test-token"
os.environ["ANCHOR_NTFY_TOPIC"] = "test-topic"
os.environ["ANCHOR_ENV_FILE"] = str(Path(_tmp) / "nonexistent.env")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from anchor_server import db  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db():
    """Each test starts from an empty database."""
    conn = db.connect()
    tables = [
        "artifacts", "jobs", "events", "tasks", "facts", "contacts",
        "confirms", "audit_log", "heartbeats", "outbox", "agent_runs", "vault_fts",
    ]
    for t in tables:
        conn.execute(f"DELETE FROM {t}")  # test fixture only — rule 4 applies to prod code
    conn.commit()
    yield


@pytest.fixture
def audio_file(tmp_path):
    p = tmp_path / "Call recording Dr Smith_260812_143000.m4a"
    p.write_bytes(b"fake-audio-bytes-" + os.urandom(16))
    return p
