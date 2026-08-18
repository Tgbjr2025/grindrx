"""Google Calendar client.

Rule 2 is enforced one level up (agent tools): this module only knows how to
read and write events. Every created/updated event carries the forced
reminder set (T-2h, T-45m) and an extended property marking it Anchor-managed.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from . import config, db, timeutil

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/contacts",
]


def _credentials():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    # No scopes arg: honor whatever the stored token was granted (the gmail
    # scope is optional — google_auth requests it only when Gmail ingestion
    # is enabled).
    creds = Credentials.from_authorized_user_file(config.GOOGLE_TOKEN_PATH)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return creds


def _service():
    from googleapiclient.discovery import build

    return build("calendar", "v3", credentials=_credentials(), cache_discovery=False)


def _reminders() -> dict[str, Any]:
    return {
        "useDefault": False,
        "overrides": [{"method": "popup", "minutes": m} for m in config.EVENT_REMINDER_MINUTES],
    }


def _dry(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    db.execute(
        "INSERT INTO outbox (ts, channel, payload) VALUES (?, 'gcal', ?)",
        (timeutil.now_iso(), json.dumps({"action": action, **payload}, default=str)),
    )
    return {"id": f"dry-{action}-{timeutil.now_iso()}", "htmlLink": "(dry run)"}


def create_event(
    title: str,
    start: datetime,
    end: datetime,
    location: str | None,
    description: str,
) -> dict[str, Any]:
    body = {
        "summary": title,
        "location": location or "",
        "description": description,
        "start": {"dateTime": timeutil.iso(start), "timeZone": config.TIMEZONE_NAME},
        "end": {"dateTime": timeutil.iso(end), "timeZone": config.TIMEZONE_NAME},
        "reminders": _reminders(),
        "extendedProperties": {"private": {"anchor": "1"}},
    }
    if config.DRY_RUN:
        return _dry("create", body)
    return (
        _service().events().insert(calendarId=config.GOOGLE_CALENDAR_ID, body=body).execute()
    )


def update_event(gcal_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    # Reminders are re-forced on every update so a correction can never
    # accidentally drop them.
    patch = {**patch, "reminders": _reminders()}
    if config.DRY_RUN:
        return _dry("update", {"gcal_id": gcal_id, **patch})
    return (
        _service()
        .events()
        .patch(calendarId=config.GOOGLE_CALENDAR_ID, eventId=gcal_id, body=patch)
        .execute()
    )


def cancel_event(gcal_id: str) -> None:
    """Mark an event cancelled on Google Calendar. The local row is kept
    (status='superseded'/'cancelled') — nothing is deleted (rule 4)."""
    if config.DRY_RUN:
        _dry("cancel", {"gcal_id": gcal_id})
        return
    _service().events().patch(
        calendarId=config.GOOGLE_CALENDAR_ID, eventId=gcal_id, body={"status": "cancelled"}
    ).execute()


def list_events(start: datetime, end: datetime) -> list[dict[str, Any]]:
    if config.DRY_RUN:
        # In dry-run mode the local events table is the source of truth.
        rows = db.q(
            "SELECT * FROM events WHERE status='active' AND start >= ? AND start < ? ORDER BY start",
            (timeutil.iso(start), timeutil.iso(end)),
        )
        return [
            {
                "id": r["gcal_id"],
                "summary": r["title"],
                "start": {"dateTime": r["start"]},
                "end": {"dateTime": r["end"]},
                "location": r["location"],
            }
            for r in rows
        ]
    result = (
        _service()
        .events()
        .list(
            calendarId=config.GOOGLE_CALENDAR_ID,
            timeMin=timeutil.to_local(start).isoformat(),
            timeMax=timeutil.to_local(end).isoformat(),
            singleEvents=True,
            orderBy="startTime",
            maxResults=250,
        )
        .execute()
    )
    return result.get("items", [])
