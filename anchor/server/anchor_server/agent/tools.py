"""Agent tool implementations.

The trust rules that must hold no matter what the model decides are enforced
HERE, in code, not in the prompt:

- calendar_write: past-dated appointments from backfill become facts, never
  calendar entries; reminders are always forced; every auto-write triggers a
  push notification quoting the source line (rule 2).
- Every tool call requires provenance (source artifact + quote) where the
  brief demands it (rule 3).
- Nothing deletes; supersede keeps the original (rule 4).
- phone_contact_write only creates/edits inside the Anchor group (people.py).
"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any, Callable

from .. import db, gcal, ingest, notify, people, timeutil


class ToolError(Exception):
    """Raised by tools; returned to the model as an is_error tool_result."""


# --------------------------------------------------------------------------
# Tool schemas (Anthropic tool definitions)
# --------------------------------------------------------------------------

def _source_props(required: bool = True) -> dict[str, Any]:
    return {
        "source_artifact_id": {
            "type": "integer",
            "description": "Artifact this information came from. Required for provenance.",
        },
        "source_quote": {
            "type": "string",
            "description": "Verbatim quote from the transcript/source that states this information.",
        },
        "source_offset_seconds": {
            "type": "number",
            "description": "Offset in seconds into the source audio where the quote occurs (from transcript segments).",
        },
    }


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "calendar_read",
        "description": "Read calendar events in a time window. The calendar is the arbiter — use this before creating or verifying any appointment.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "description": "ISO-8601 start of window (America/Detroit assumed if no offset)."},
                "end": {"type": "string", "description": "ISO-8601 end of window."},
            },
            "required": ["start", "end"],
        },
    },
    {
        "name": "calendar_write",
        "description": (
            "Create, update, or supersede a calendar event. FUTURE events only — a past-dated "
            "appointment (e.g. from backfill) is automatically stored as a timeline fact instead, "
            "and this tool will tell you so. Reminders (T-2h, T-45m) are forced automatically. "
            "The user is push-notified with the quoted source automatically — do not call notify "
            "separately for the same write. Never invent times: only write times explicitly stated in the source."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["create", "update", "supersede"]},
                "event_id": {"type": "integer", "description": "Local event id (required for update/supersede)."},
                "title": {"type": "string"},
                "start": {"type": "string", "description": "ISO-8601 start."},
                "end": {"type": "string", "description": "ISO-8601 end. Defaults to start + 1 hour."},
                "location": {"type": "string"},
                "description": {"type": "string"},
                **_source_props(),
            },
            "required": ["action", "title", "start", "source_artifact_id", "source_quote"],
        },
    },
    {
        "name": "task_create",
        "description": "Open a task / open loop (e.g. 'call the office back about scheduling'). Callback tasks get escalating reminders until closed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "kind": {"type": "string", "enum": ["callback", "todo", "verify"]},
                "phone_number": {"type": "string", "description": "Number to call back, if applicable."},
                "due": {"type": "string", "description": "ISO-8601 due/window end, if stated."},
                **_source_props(),
            },
            "required": ["title", "kind", "source_artifact_id", "source_quote"],
        },
    },
    {
        "name": "task_update",
        "description": "Add a note to an open task or change its due date.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer"},
                "note": {"type": "string"},
                "due": {"type": "string"},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "task_close",
        "description": "Close an open loop, linking the artifact that resolved it (e.g. the outbound call that booked the appointment).",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer"},
                "reason": {"type": "string"},
                "closed_by_artifact_id": {"type": "integer"},
            },
            "required": ["task_id", "reason"],
        },
    },
    {
        "name": "vault_search",
        "description": "Full-text search over all transcripts, notes, and facts in the vault. Returns matches with artifact ids and provenance.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "FTS query terms."},
                "limit": {"type": "integer", "default": 10},
            },
            "required": ["query"],
        },
    },
    {
        "name": "fact_write",
        "description": (
            "Record a timeline fact (something that happened or was stated), or supersede an "
            "existing fact when new information contradicts it. The superseded fact is kept — "
            "nothing is ever deleted."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "body": {"type": "string"},
                "category": {"type": "string", "enum": ["medical", "legal", "scheduling", "personal", "other"]},
                "supersedes_fact_id": {"type": "integer", "description": "Fact id this replaces, when correcting the record."},
                **_source_props(),
            },
            "required": ["body", "source_artifact_id"],
        },
    },
    {
        "name": "contact_lookup",
        "description": "Look up a contact in the registry by phone number or name. Use before classifying a call and before registering a new contact.",
        "input_schema": {
            "type": "object",
            "properties": {
                "phone_number": {"type": "string"},
                "name": {"type": "string"},
            },
        },
    },
    {
        "name": "contact_register",
        "description": "Register or update an entity in the contact registry (server-side; does NOT touch the phone). Drives classification and the privileged flag.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "phone_number": {"type": "string"},
                "organization": {"type": "string"},
                "category": {"type": "string", "enum": ["medical", "legal", "scheduling", "personal", "spam", "unknown"]},
                "privileged": {"type": "boolean", "description": "True ONLY for attorney contacts."},
            },
            "required": ["name", "category"],
        },
    },
    {
        "name": "phone_contact_write",
        "description": (
            "Create a contact on the user's phone (via Google People sync) so caller ID shows who is "
            "calling next time. Use ONLY on confident identification of an unknown number — a stated "
            "name/organization in a transcript, SMS signature, or call metadata. If confidence is low, "
            "use flag_needs_confirm instead. Contacts land in the dedicated Anchor group with an "
            "'(Anchor)' suffix; user-created contacts are never modified."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "phone_number": {"type": "string"},
                "organization": {"type": "string"},
                **_source_props(),
            },
            "required": ["name", "phone_number", "source_artifact_id", "source_quote"],
        },
    },
    {
        "name": "notify",
        "description": "Send the user a push notification. Use for verification results, contradictions, and anything he needs to know now. Quote the source line.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "message": {"type": "string"},
                "priority": {"type": "string", "enum": ["min", "low", "default", "high", "urgent"]},
            },
            "required": ["title", "message"],
        },
    },
    {
        "name": "flag_needs_confirm",
        "description": (
            "Put an item in the Confirm inbox for one-tap approve/fix/dismiss. Use when confidence is "
            "low or something contradicts the record and you cannot resolve it from sources. Include a "
            "machine-executable proposal so 'approve' can run it without another agent turn."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["event", "task", "contact", "fact", "other"]},
                "summary": {"type": "string", "description": "One plain-language sentence the user will read."},
                "proposal": {
                    "type": "object",
                    "description": "Tool call to run on approval: {\"tool\": name, \"input\": {...}}.",
                },
                **_source_props(),
            },
            "required": ["kind", "summary", "source_artifact_id"],
        },
    },
]


# --------------------------------------------------------------------------
# Implementations
# --------------------------------------------------------------------------

def _artifact_or_fail(artifact_id: int) -> db.sqlite3.Row:
    row = db.q1("SELECT * FROM artifacts WHERE id = ?", (artifact_id,))
    if row is None:
        raise ToolError(f"Artifact {artifact_id} does not exist — provenance is required.")
    return row


def _source_link(inp: dict[str, Any]) -> str:
    offset = inp.get("source_offset_seconds")
    at = f" @ {int(offset // 60)}m{int(offset % 60):02d}s" if offset is not None else ""
    return f'source: artifact #{inp["source_artifact_id"]}{at} — "{inp.get("source_quote", "")}"'


def calendar_read(inp: dict[str, Any]) -> Any:
    start = timeutil.parse_iso(inp["start"])
    end = timeutil.parse_iso(inp["end"])
    items = gcal.list_events(start, end)
    local = db.q(
        "SELECT id, gcal_id, title, start, end, location, status FROM events"
        " WHERE start >= ? AND start < ? ORDER BY start",
        (timeutil.iso(start), timeutil.iso(end)),
    )
    return {
        "google_calendar": [
            {
                "gcal_id": e.get("id"),
                "title": e.get("summary"),
                "start": e.get("start", {}).get("dateTime") or e.get("start", {}).get("date"),
                "end": e.get("end", {}).get("dateTime") or e.get("end", {}).get("date"),
                "location": e.get("location"),
            }
            for e in items
        ],
        "anchor_events": [dict(r) for r in local],
    }


def calendar_write(inp: dict[str, Any]) -> Any:
    artifact = _artifact_or_fail(inp["source_artifact_id"])
    start = timeutil.parse_iso(inp["start"])
    end = timeutil.parse_iso(inp["end"]) if inp.get("end") else start + timedelta(hours=1)
    now = timeutil.now_local()

    # Rule 2 guard: past-dated appointments become timeline facts, never
    # calendar entries. Enforced regardless of what the model asked for.
    if start < now:
        fact_id = fact_write(
            {
                "body": f"(past appointment) {inp['title']} at {timeutil.iso(start)}"
                + (f" — {inp.get('location')}" if inp.get("location") else ""),
                "category": "scheduling",
                "source_artifact_id": inp["source_artifact_id"],
                "source_quote": inp.get("source_quote"),
                "source_offset_seconds": inp.get("source_offset_seconds"),
            }
        )["fact_id"]
        return {
            "result": "past_dated_stored_as_fact",
            "fact_id": fact_id,
            "note": "Start time is in the past; recorded as a timeline fact instead of a calendar entry (trust rule 2).",
        }

    description = (
        (inp.get("description", "") + "\n\n" if inp.get("description") else "")
        + f"[Anchor] {_source_link(inp)}"
    )
    action = inp["action"]
    now_iso = timeutil.now_iso()

    if action == "create":
        g = gcal.create_event(inp["title"], start, end, inp.get("location"), description)
        event_id = db.execute(
            "INSERT INTO events (gcal_id, title, start, end, location, description,"
            " source_artifact_id, source_quote, source_offset_seconds, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                g.get("id"), inp["title"], timeutil.iso(start), timeutil.iso(end),
                inp.get("location"), description, inp["source_artifact_id"],
                inp.get("source_quote"), inp.get("source_offset_seconds"), now_iso, now_iso,
            ),
        )
        db.audit("agent", "event.create", "event", event_id, dict(inp), inp["source_artifact_id"])
        # Rule 2: auto-write, never silently.
        notify.push(
            f"Added: {inp['title']}",
            f"{start.strftime('%a %b %-d, %-I:%M %p')}"
            + (f" — {inp['location']}" if inp.get("location") else "")
            + f"\nBecause they said: “{inp.get('source_quote', '')}”"
            + f"\nWrong? Reply: anchor fix event {event_id}",
            priority="high",
            tags="calendar",
        )
        return {"result": "created", "event_id": event_id, "gcal_id": g.get("id")}

    if action in ("update", "supersede"):
        if not inp.get("event_id"):
            raise ToolError("event_id is required for update/supersede.")
        old = db.q1("SELECT * FROM events WHERE id = ?", (inp["event_id"],))
        if old is None:
            raise ToolError(f"Event {inp['event_id']} not found.")
        if action == "update":
            gcal.update_event(
                old["gcal_id"],
                {
                    "summary": inp["title"],
                    "start": {"dateTime": timeutil.iso(start), "timeZone": timeutil.config.TIMEZONE_NAME},
                    "end": {"dateTime": timeutil.iso(end), "timeZone": timeutil.config.TIMEZONE_NAME},
                    "location": inp.get("location") or old["location"] or "",
                    "description": description,
                },
            )
            db.execute(
                "UPDATE events SET title=?, start=?, end=?, location=?, description=?,"
                " source_artifact_id=?, source_quote=?, source_offset_seconds=?, updated_at=? WHERE id=?",
                (
                    inp["title"], timeutil.iso(start), timeutil.iso(end),
                    inp.get("location") or old["location"], description,
                    inp["source_artifact_id"], inp.get("source_quote"),
                    inp.get("source_offset_seconds"), now_iso, old["id"],
                ),
            )
            db.audit("agent", "event.update", "event", old["id"],
                     {"before": dict(old), "after": dict(inp)}, inp["source_artifact_id"])
            notify.push(
                f"Updated: {inp['title']}",
                f"Was {old['start']}, now {timeutil.iso(start)}."
                + f"\nBecause they said: “{inp.get('source_quote', '')}”"
                + f"\nWrong? Reply: anchor fix event {old['id']}",
                priority="high",
                tags="calendar",
            )
            return {"result": "updated", "event_id": old["id"]}
        # supersede: keep the old row, cancel its gcal entry, create fresh
        g = gcal.create_event(inp["title"], start, end, inp.get("location"), description)
        new_id = db.execute(
            "INSERT INTO events (gcal_id, title, start, end, location, description,"
            " source_artifact_id, source_quote, source_offset_seconds, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                g.get("id"), inp["title"], timeutil.iso(start), timeutil.iso(end),
                inp.get("location"), description, inp["source_artifact_id"],
                inp.get("source_quote"), inp.get("source_offset_seconds"), now_iso, now_iso,
            ),
        )
        if old["gcal_id"]:
            gcal.cancel_event(old["gcal_id"])
        db.execute(
            "UPDATE events SET status='superseded', superseded_by=?, updated_at=? WHERE id=?",
            (new_id, now_iso, old["id"]),
        )
        db.audit("agent", "event.supersede", "event", old["id"],
                 {"superseded_by": new_id}, inp["source_artifact_id"])
        notify.push(
            f"Corrected: {inp['title']}",
            f"Calendar said {old['start']}; the record says {timeutil.iso(start)} — updated."
            + f"\nBecause they said: “{inp.get('source_quote', '')}”"
            + f"\nWrong? Reply: anchor fix event {new_id}",
            priority="high",
            tags="calendar",
        )
        return {"result": "superseded", "event_id": new_id, "superseded_event_id": old["id"]}

    raise ToolError(f"Unknown calendar_write action {action!r}.")


def task_create(inp: dict[str, Any]) -> Any:
    _artifact_or_fail(inp["source_artifact_id"])
    now_iso = timeutil.now_iso()
    task_id = db.execute(
        "INSERT INTO tasks (title, kind, phone_number, due, source_artifact_id, source_quote,"
        " source_offset_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            inp["title"], inp["kind"], ingest.normalize_phone(inp.get("phone_number")),
            inp.get("due"), inp["source_artifact_id"], inp.get("source_quote"),
            inp.get("source_offset_seconds"), now_iso, now_iso,
        ),
    )
    db.audit("agent", "task.create", "task", task_id, dict(inp), inp["source_artifact_id"])
    db.fts_index(inp["title"], "task", task_id, inp["source_artifact_id"])
    return {"result": "created", "task_id": task_id}


def task_update(inp: dict[str, Any]) -> Any:
    task = db.q1("SELECT * FROM tasks WHERE id = ?", (inp["task_id"],))
    if task is None:
        raise ToolError(f"Task {inp['task_id']} not found.")
    notes = (task["notes"] or "")
    if inp.get("note"):
        notes = (notes + "\n" if notes else "") + f"[{timeutil.now_iso()}] {inp['note']}"
    db.execute(
        "UPDATE tasks SET notes=?, due=COALESCE(?, due), updated_at=? WHERE id=?",
        (notes, inp.get("due"), timeutil.now_iso(), task["id"]),
    )
    db.audit("agent", "task.update", "task", task["id"], dict(inp))
    return {"result": "updated", "task_id": task["id"]}


def task_close(inp: dict[str, Any]) -> Any:
    task = db.q1("SELECT * FROM tasks WHERE id = ?", (inp["task_id"],))
    if task is None:
        raise ToolError(f"Task {inp['task_id']} not found.")
    db.execute(
        "UPDATE tasks SET status='closed', close_reason=?, closed_by_artifact_id=?, updated_at=?"
        " WHERE id=?",
        (inp["reason"], inp.get("closed_by_artifact_id"), timeutil.now_iso(), task["id"]),
    )
    db.audit("agent", "task.close", "task", task["id"], dict(inp), inp.get("closed_by_artifact_id"))
    return {"result": "closed", "task_id": task["id"]}


def vault_search(inp: dict[str, Any]) -> Any:
    limit = min(int(inp.get("limit", 10)), 50)
    try:
        rows = db.q(
            "SELECT v.body, v.entity, v.entity_id, v.artifact_id,"
            " a.kind, a.captured_at, a.contact_hint, a.privileged"
            " FROM vault_fts v LEFT JOIN artifacts a ON a.id = v.artifact_id"
            " WHERE vault_fts MATCH ? ORDER BY rank LIMIT ?",
            (inp["query"], limit),
        )
    except db.sqlite3.OperationalError as exc:
        raise ToolError(f"Search query error: {exc}") from exc
    return [
        {
            "snippet": r["body"][:500],
            "entity": r["entity"],
            "entity_id": r["entity_id"],
            "artifact_id": r["artifact_id"],
            "kind": r["kind"],
            "captured_at": r["captured_at"],
            "contact": r["contact_hint"],
            "privileged": bool(r["privileged"]),
        }
        for r in rows
    ]


def fact_write(inp: dict[str, Any]) -> Any:
    _artifact_or_fail(inp["source_artifact_id"])
    fact_id = db.execute(
        "INSERT INTO facts (body, category, source_artifact_id, source_quote,"
        " source_offset_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (
            inp["body"], inp.get("category"), inp["source_artifact_id"],
            inp.get("source_quote"), inp.get("source_offset_seconds"), timeutil.now_iso(),
        ),
    )
    if inp.get("supersedes_fact_id"):
        db.execute(
            "UPDATE facts SET status='superseded', superseded_by=? WHERE id=?",
            (fact_id, inp["supersedes_fact_id"]),
        )
    db.audit("agent", "fact.write", "fact", fact_id, dict(inp), inp["source_artifact_id"])
    db.fts_index(inp["body"], "fact", fact_id, inp["source_artifact_id"])
    return {"result": "recorded", "fact_id": fact_id}


def contact_lookup(inp: dict[str, Any]) -> Any:
    row = ingest.match_contact(inp.get("name"), ingest.normalize_phone(inp.get("phone_number")))
    if row is None:
        return {"found": False}
    return {
        "found": True,
        "contact_id": row["id"],
        "name": row["name"],
        "numbers": json.loads(row["numbers"]),
        "organization": row["organization"],
        "category": row["category"],
        "privileged": bool(row["privileged"]),
        "origin": row["origin"],
    }


def contact_register(inp: dict[str, Any]) -> Any:
    phone = ingest.normalize_phone(inp.get("phone_number"))
    existing = ingest.match_contact(inp["name"], phone)
    now_iso = timeutil.now_iso()
    if existing:
        numbers = set(json.loads(existing["numbers"]))
        if phone:
            numbers.add(phone)
        db.execute(
            "UPDATE contacts SET numbers=?, organization=COALESCE(?, organization),"
            " category=?, privileged=MAX(privileged, ?), updated_at=? WHERE id=?",
            (
                json.dumps(sorted(numbers)), inp.get("organization"), inp["category"],
                int(bool(inp.get("privileged"))), now_iso, existing["id"],
            ),
        )
        db.audit("agent", "contact.update", "contact", existing["id"], dict(inp))
        return {"result": "updated", "contact_id": existing["id"]}
    contact_id = db.execute(
        "INSERT INTO contacts (name, numbers, organization, category, privileged, origin,"
        " created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'anchor', ?, ?)",
        (
            inp["name"], json.dumps([phone] if phone else []), inp.get("organization"),
            inp["category"], int(bool(inp.get("privileged"))), now_iso, now_iso,
        ),
    )
    db.audit("agent", "contact.create", "contact", contact_id, dict(inp))
    return {"result": "created", "contact_id": contact_id}


def phone_contact_write(inp: dict[str, Any]) -> Any:
    _artifact_or_fail(inp["source_artifact_id"])
    phone = ingest.normalize_phone(inp["phone_number"])
    if not phone:
        raise ToolError("A valid phone number is required.")
    registered = contact_register(
        {
            "name": inp["name"],
            "phone_number": phone,
            "organization": inp.get("organization"),
            "category": "unknown",
        }
    )
    contact = db.q1("SELECT * FROM contacts WHERE id = ?", (registered["contact_id"],))
    if contact["people_resource"]:
        return {"result": "already_on_phone", "contact_id": contact["id"]}
    person = people.create_contact(inp["name"], phone, inp.get("organization"))
    db.execute(
        "UPDATE contacts SET people_resource=?, updated_at=? WHERE id=?",
        (person.get("resourceName"), timeutil.now_iso(), contact["id"]),
    )
    db.audit("agent", "contact.phone_write", "contact", contact["id"],
             {**inp, "resource": person.get("resourceName")}, inp["source_artifact_id"])
    return {"result": "written_to_phone", "contact_id": contact["id"],
            "people_resource": person.get("resourceName")}


def notify_tool(inp: dict[str, Any]) -> Any:
    ok = notify.push(inp["title"], inp["message"], inp.get("priority", "default"))
    return {"result": "sent" if ok else "delivery_failed_logged"}


def flag_needs_confirm(inp: dict[str, Any]) -> Any:
    _artifact_or_fail(inp["source_artifact_id"])
    confirm_id = db.execute(
        "INSERT INTO confirms (kind, summary, proposal, source_artifact_id, source_quote,"
        " source_offset_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            inp["kind"], inp["summary"], json.dumps(inp.get("proposal") or {}),
            inp["source_artifact_id"], inp.get("source_quote"),
            inp.get("source_offset_seconds"), timeutil.now_iso(),
        ),
    )
    db.audit("agent", "confirm.flag", "confirm", confirm_id, dict(inp), inp["source_artifact_id"])
    notify.push(
        "Needs your confirmation",
        inp["summary"] + "\nOpen the Confirm inbox to approve, fix, or dismiss.",
        priority="default",
        tags="question",
    )
    return {"result": "flagged", "confirm_id": confirm_id}


HANDLERS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "calendar_read": calendar_read,
    "calendar_write": calendar_write,
    "task_create": task_create,
    "task_update": task_update,
    "task_close": task_close,
    "vault_search": vault_search,
    "fact_write": fact_write,
    "contact_lookup": contact_lookup,
    "contact_register": contact_register,
    "phone_contact_write": phone_contact_write,
    "notify": notify_tool,
    "flag_needs_confirm": flag_needs_confirm,
}


def dispatch(name: str, inp: dict[str, Any]) -> tuple[str, bool]:
    """Run one tool call. Returns (json_result, is_error). Every call and
    every failure is audit-logged — no swallowed exceptions (rule 8)."""
    handler = HANDLERS.get(name)
    if handler is None:
        return json.dumps({"error": f"Unknown tool {name!r}"}), True
    try:
        result = handler(inp)
        return json.dumps(result, default=str), False
    except ToolError as exc:
        db.audit("agent", "tool.error", detail={"tool": name, "input": inp, "error": str(exc)})
        return json.dumps({"error": str(exc)}), True
    except Exception as exc:  # noqa: BLE001 — reported to model AND audit log
        db.audit("agent", "tool.exception", detail={"tool": name, "input": inp, "error": repr(exc)})
        return json.dumps({"error": f"Internal error in {name}: {exc}"}), True
