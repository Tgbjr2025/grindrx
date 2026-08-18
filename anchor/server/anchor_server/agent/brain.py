"""The Claude agent loop — one turn per ingested artifact, plus ask/fix turns.

A manual agentic loop (not the SDK tool runner) so every tool call flows
through tools.dispatch(), which audit-logs and enforces the trust rules in
code. The full message log of every run is stored in agent_runs for audit.
"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from .. import config, db, timeutil
from . import prompts, tools

_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic(api_key=config.anthropic_api_key())
    return _client


def _open_loops_context() -> str:
    tasks = db.q(
        "SELECT id, title, kind, phone_number, due, created_at FROM tasks"
        " WHERE status='open' ORDER BY created_at DESC LIMIT 25"
    )
    events = db.q(
        "SELECT id, title, start, location FROM events"
        " WHERE status='active' AND start >= ? ORDER BY start LIMIT 25",
        (timeutil.now_iso(),),
    )
    lines = ["OPEN TASKS:"]
    lines += [
        f"  task #{t['id']} [{t['kind']}] {t['title']}"
        + (f" (call {t['phone_number']})" if t["phone_number"] else "")
        + (f" due {t['due']}" if t["due"] else "")
        for t in tasks
    ] or ["  (none)"]
    lines.append("UPCOMING EVENTS (local record):")
    lines += [
        f"  event #{e['id']} {e['title']} at {e['start']}"
        + (f" — {e['location']}" if e["location"] else "")
        for e in events
    ] or ["  (none)"]
    return "\n".join(lines)


def _artifact_context(artifact: db.sqlite3.Row) -> str:
    contact = None
    if artifact["contact_id"]:
        contact = db.q1("SELECT * FROM contacts WHERE id = ?", (artifact["contact_id"],))
    segments = json.loads(artifact["transcript_segments"] or "[]")
    seg_lines = "\n".join(
        f"  [{s['start']:.0f}s] {s['text']}" for s in segments
    ) or "  (no audio segments)"
    parts = [
        f"NEW ARTIFACT #{artifact['id']}",
        f"kind: {artifact['kind']}"
        + ("  (BACKFILL — historical)" if artifact["backfill"] else ""),
        f"captured_at: {artifact['captured_at']}  (now: {timeutil.now_iso()})",
        f"filename: {artifact['filename']}",
        f"contact hint: {artifact['contact_hint'] or '(none)'}",
        f"phone number: {artifact['phone_number'] or '(unknown)'}",
    ]
    if contact:
        parts.append(
            f"known contact: #{contact['id']} {contact['name']} category={contact['category']}"
            + ("  PRIVILEGED (attorney)" if contact["privileged"] else "")
        )
    if artifact["privileged"]:
        parts.append("PRIVILEGED artifact — never quote its content in notifications.")
    parts += [
        "",
        "TRANSCRIPT:",
        artifact["transcript"] or "(no transcript — non-audio artifact)",
        "",
        "TRANSCRIPT SEGMENTS (for offsets):",
        seg_lines,
        "",
        _open_loops_context(),
    ]
    return "\n".join(parts)


def _run_loop(system: str, user_content: str, trigger: str,
              artifact_id: int | None = None) -> str:
    client = _get_client()
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_content}]
    run_id = db.execute(
        "INSERT INTO agent_runs (artifact_id, trigger, transcript, started_at) VALUES (?, ?, '[]', ?)",
        (artifact_id, trigger, timeutil.now_iso()),
    )
    final_text = ""
    for _ in range(config.AGENT_MAX_ITERATIONS):
        response = client.messages.create(
            model=config.AGENT_MODEL,
            max_tokens=config.AGENT_MAX_TOKENS,
            system=system,
            tools=tools.TOOL_DEFINITIONS,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": [b.model_dump() for b in response.content]})
        if response.stop_reason == "pause_turn":
            continue
        tool_uses = [b for b in response.content if b.type == "tool_use"]
        if not tool_uses:
            final_text = "\n".join(b.text for b in response.content if b.type == "text")
            break
        results = []
        for block in tool_uses:
            output, is_error = tools.dispatch(block.name, dict(block.input))
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": output,
                    **({"is_error": True} if is_error else {}),
                }
            )
        messages.append({"role": "user", "content": results})
    else:
        final_text = f"(agent stopped: hit iteration cap of {config.AGENT_MAX_ITERATIONS})"
        db.audit("agent", "run.iteration_cap", "agent_run", run_id)

    db.execute(
        "UPDATE agent_runs SET transcript=?, result=?, finished_at=? WHERE id=?",
        (json.dumps(messages, default=str), final_text, timeutil.now_iso(), run_id),
    )
    return final_text


def run_artifact_turn(artifact_id: int) -> str:
    """The per-artifact turn: classify → extract → cross-reference → act."""
    artifact = db.q1("SELECT * FROM artifacts WHERE id = ?", (artifact_id,))
    if artifact is None:
        raise ValueError(f"Artifact {artifact_id} not found")
    summary = _run_loop(
        prompts.SYSTEM_PROMPT, _artifact_context(artifact), "artifact", artifact_id
    )
    # Persist classification if the agent registered/matched a contact meanwhile.
    updated = db.q1("SELECT contact_id FROM artifacts WHERE id = ?", (artifact_id,))
    classification = None
    if updated and updated["contact_id"]:
        c = db.q1("SELECT category FROM contacts WHERE id = ?", (updated["contact_id"],))
        classification = c["category"] if c else None
    db.execute(
        "UPDATE artifacts SET agent_summary=?, classification=COALESCE(?, classification),"
        " status='processed' WHERE id=?",
        (summary, classification, artifact_id),
    )
    db.audit("agent", "artifact.processed", "artifact", artifact_id, {"summary": summary[:500]})
    return summary


def run_ask(question: str) -> str:
    """Answer a user question from the record, with source citations."""
    context = (
        f"(now: {timeutil.now_iso()})\n\n{_open_loops_context()}\n\nQUESTION:\n{question}"
    )
    return _run_loop(prompts.ASK_SYSTEM_PROMPT, context, "ask")


def run_fix(instruction: str) -> str:
    """One-command correction path: 'anchor fix event 12 it's at 1pm not 12:30'."""
    context = (
        f"(now: {timeutil.now_iso()})\n\n{_open_loops_context()}\n\n"
        "The user is CORRECTING the record. Apply the correction using "
        "calendar_write (action=update or supersede), task tools, or fact_write "
        "with supersedes_fact_id — originals are kept automatically (rule 3). "
        "His correction is authoritative; if it is too ambiguous to apply, "
        "flag_needs_confirm instead. For provenance, reference the artifact "
        "the original entry came from (look it up if needed).\n\n"
        f"CORRECTION:\n{instruction}"
    )
    return _run_loop(prompts.SYSTEM_PROMPT, context, "fix")


def match_open_callbacks(phone_number: str | None) -> list[dict[str, Any]]:
    """Helper used by housekeeping to link outbound calls to open callbacks."""
    if not phone_number:
        return []
    rows = db.q(
        "SELECT * FROM tasks WHERE status='open' AND kind='callback' AND phone_number=?",
        (phone_number,),
    )
    return [dict(r) for r in rows]


def upcoming_events(hours: int = 24) -> list[dict[str, Any]]:
    end = timeutil.now_local() + timedelta(hours=hours)
    return [
        dict(r)
        for r in db.q(
            "SELECT * FROM events WHERE status='active' AND start >= ? AND start < ? ORDER BY start",
            (timeutil.now_iso(), timeutil.iso(end)),
        )
    ]
