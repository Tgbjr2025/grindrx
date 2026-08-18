"""Gmail ingestion (Phase 3) — opt-in, READ-ONLY, label-filtered.

Setup: create a Gmail filter that applies the "Anchor" label to confirmation
emails (doctor portals, scheduling systems), set ANCHOR_GMAIL_ENABLED=1, and
re-run `python -m anchor_server.google_auth` once (the token needs the
gmail.readonly scope added). The worker polls on GMAIL_POLL_SECONDS.

Each email becomes a kind="email" artifact and gets a normal agent turn — so
appointment confirmations land on the calendar with provenance, and phone
numbers in signatures feed contact write-back like any other source.
"""

from __future__ import annotations

import base64
import re
from email.utils import parsedate_to_datetime
from typing import Any

from . import config, db, ingest, timeutil

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"


def _service():
    from googleapiclient.discovery import build

    from .gcal import _credentials

    return build("gmail", "v1", credentials=_credentials(), cache_discovery=False)


def _walk_text(payload: dict[str, Any]) -> str:
    """Extract the plain-text body from a Gmail message payload tree."""
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", "replace")
    for part in payload.get("parts", []) or []:
        text = _walk_text(part)
        if text:
            return text
    # Fallback: strip tags from an html-only message.
    if payload.get("mimeType") == "text/html" and payload.get("body", {}).get("data"):
        html = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", "replace")
        return re.sub(r"<[^>]+>", " ", html)
    return ""


def _headers(msg: dict[str, Any]) -> dict[str, str]:
    return {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}


def already_ingested(gmail_id: str) -> bool:
    return db.q1("SELECT 1 FROM artifacts WHERE source_path = ?", (f"gmail:{gmail_id}",)) is not None


def ingest_message(msg: dict[str, Any]) -> dict[str, Any]:
    """Turn one fetched Gmail message into an email artifact."""
    import tempfile
    from pathlib import Path

    headers = _headers(msg)
    sender = headers.get("from", "")
    subject = headers.get("subject", "(no subject)")
    m = re.match(r"^(?P<name>.*?)\s*<(?P<addr>[^>]+)>$", sender)
    from_name = (m.group("name").strip(' "') if m else sender) or sender
    captured = None
    if headers.get("date"):
        try:
            captured = timeutil.iso(parsedate_to_datetime(headers["date"]))
        except (TypeError, ValueError):
            captured = None

    body = _walk_text(msg.get("payload", {})) or msg.get("snippet", "")
    text = f"Subject: {subject}\nFrom: {sender}\n\n{body.strip()}"

    with tempfile.NamedTemporaryFile(dir=config.DATA_DIR, delete=False, suffix=".txt") as tmp:
        tmp.write(text.encode("utf-8"))
        tmp_path = Path(tmp.name)
    try:
        result = ingest.ingest_file(
            tmp_path,
            filename=f"email_{msg['id']}.txt",
            kind="email",
            captured_at=captured,
            contact_hint=from_name,
            source_path=f"gmail:{msg['id']}",
            mime="text/plain",
            text_body=text,
            dedupe_salt=f"gmail|{msg['id']}",
        )
    finally:
        tmp_path.unlink(missing_ok=True)
    return result


def poll(max_results: int = 25) -> int:
    """Fetch new labeled emails. Returns count ingested. Raises on API errors
    (the worker housekeeping audit-logs those — rule 8)."""
    if not config.GMAIL_ENABLED:
        return 0
    svc = _service()
    listing = (
        svc.users()
        .messages()
        .list(userId="me", q=f"label:{config.GMAIL_LABEL}", maxResults=max_results)
        .execute()
    )
    ingested = 0
    for ref in listing.get("messages", []) or []:
        if already_ingested(ref["id"]):
            continue
        msg = svc.users().messages().get(userId="me", id=ref["id"], format="full").execute()
        result = ingest_message(msg)
        if not result["duplicate"]:
            ingested += 1
    if ingested:
        db.audit("worker", "gmail.ingested", detail={"count": ingested})
    return ingested
