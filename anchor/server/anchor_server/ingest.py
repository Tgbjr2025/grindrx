"""Artifact ingestion.

Idempotent by construction (rule 4): the sha256 UNIQUE constraint means
re-running a backfill, a sweep re-upload, or a crashed upload retry can never
duplicate an artifact.
"""

from __future__ import annotations

import hashlib
import re
import shutil
from pathlib import Path
from typing import Any

from . import config, db, queue, timeutil

AUDIO_EXTENSIONS = {".m4a", ".mp3", ".amr", ".3gp", ".wav", ".ogg", ".opus", ".aac", ".mp4"}

# Samsung call recordings: "Call recording John Smith_250812_143022.m4a"
# Voicemails / voice notes:  "Voice 001_250812_143022.m4a", "+13135551212_250601_090000.amr"
_CALL_NAME = re.compile(
    r"^(?:Call recording |Call_|Rec_)?(?:(?P<name>.*?)[_ ])?(?P<stamp>\d{6}_\d{6})(?:[_ ]?\(\d+\))?$",
    re.IGNORECASE,
)
_PHONEISH = re.compile(r"^\+?\d[\d\-\s().]{6,}$")


def normalize_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"[^\d+]", "", raw)
    if not digits:
        return None
    if digits.startswith("+"):
        return digits
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return digits


def parse_recording_filename(filename: str) -> dict[str, Any]:
    """Extract contact hint and captured-at from a Samsung recording filename."""
    stem = Path(filename).stem
    out: dict[str, Any] = {"contact_hint": None, "phone_number": None, "captured_at": None}
    m = _CALL_NAME.match(stem)
    if m:
        name = (m.group("name") or "").strip(" _-")
        stamp = timeutil.parse_samsung_stamp(m.group("stamp"))
        if stamp:
            out["captured_at"] = timeutil.iso(stamp)
        if name:
            if _PHONEISH.match(name):
                out["phone_number"] = normalize_phone(name)
            else:
                out["contact_hint"] = name
    return out


def match_contact(contact_hint: str | None, phone_number: str | None) -> db.sqlite3.Row | None:
    if phone_number:
        row = db.q1(
            "SELECT * FROM contacts WHERE numbers LIKE ? ORDER BY id LIMIT 1",
            (f'%"{phone_number}"%',),
        )
        if row:
            return row
    if contact_hint:
        return db.q1(
            "SELECT * FROM contacts WHERE LOWER(name) = LOWER(?) ORDER BY id LIMIT 1",
            (contact_hint,),
        )
    return None


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ingest_file(
    tmp_path: Path,
    filename: str,
    kind: str,
    *,
    captured_at: str | None = None,
    contact_hint: str | None = None,
    phone_number: str | None = None,
    source_path: str | None = None,
    batch_id: str | None = None,
    backfill: bool = False,
    mime: str | None = None,
    text_body: str | None = None,
) -> dict[str, Any]:
    """Store one artifact and enqueue its processing. Returns
    {artifact_id, duplicate}."""
    digest = sha256_file(tmp_path)
    existing = db.q1("SELECT id FROM artifacts WHERE sha256 = ?", (digest,))
    if existing:
        db.audit("api", "ingest.duplicate", "artifact", existing["id"], {"filename": filename})
        return {"artifact_id": existing["id"], "duplicate": True}

    parsed = parse_recording_filename(filename)
    captured = captured_at or parsed["captured_at"] or timeutil.iso(
        timeutil.from_epoch(tmp_path.stat().st_mtime)
    )
    hint = contact_hint or parsed["contact_hint"]
    phone = normalize_phone(phone_number) or parsed["phone_number"]
    contact = match_contact(hint, phone)
    privileged = bool(contact and contact["privileged"])

    # Vault layout: vault/YYYY/MM/<sha256><ext> — content-addressed, immutable.
    dt = timeutil.parse_iso(captured)
    dest_dir = config.VAULT_DIR / f"{dt.year:04d}" / f"{dt.month:02d}"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / (digest + Path(filename).suffix.lower())
    if not dest.exists():
        shutil.copy2(tmp_path, dest)

    artifact_id = db.execute(
        "INSERT INTO artifacts (sha256, kind, filename, source_path, stored_path, mime, size,"
        " contact_hint, contact_id, phone_number, captured_at, backfill, batch_id, privileged,"
        " transcript, status, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            digest,
            kind,
            filename,
            source_path,
            str(dest),
            mime,
            dest.stat().st_size,
            hint,
            contact["id"] if contact else None,
            phone,
            captured,
            int(backfill),
            batch_id,
            int(privileged),
            text_body,
            "transcribed" if text_body is not None else "ingested",
            timeutil.now_iso(),
        ),
    )
    db.audit(
        "api",
        "ingest.new",
        "artifact",
        artifact_id,
        {"kind": kind, "filename": filename, "captured_at": captured, "privileged": privileged},
    )

    is_audio = Path(filename).suffix.lower() in AUDIO_EXTENSIONS
    if text_body is not None:
        db.fts_index(text_body, "artifact", artifact_id, artifact_id)
        queue.enqueue("agent_turn", artifact_id)
    elif is_audio:
        queue.enqueue("transcribe", artifact_id)
    else:
        # Photos and other binary captures skip transcription; the agent turn
        # still records them on the timeline and cross-references metadata.
        queue.enqueue("agent_turn", artifact_id)
    return {"artifact_id": artifact_id, "duplicate": False}
