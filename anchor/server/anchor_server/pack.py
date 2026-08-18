"""`anchor pack <topic>` — dated, source-linked export bundle (Phase 3).

Deterministic assembly (no LLM): hybrid search finds everything related to
the topic; the bundle is a zip with a human-readable pack.md plus the full
transcripts, every item source-linked (artifact id, capture date, original
filename). Rule 7: privileged content is EXCLUDED by default and the report
says how many items were withheld — exclusion is visible, never silent.
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import timedelta
from pathlib import Path
from typing import Any

from . import db, search, timeutil


def _collect(topic: str, days: int | None, include_privileged: bool) -> dict[str, Any]:
    results = search.hybrid_search(topic, limit=100)
    since = timeutil.iso(timeutil.now_local() - timedelta(days=days)) if days else None

    artifact_ids: set[int] = set()
    excluded_privileged = 0
    hits = []
    for r in results:
        if since and r["captured_at"] and r["captured_at"] < since:
            continue
        if r["privileged"] and not include_privileged:
            excluded_privileged += 1
            continue
        hits.append(r)
        if r["artifact_id"]:
            artifact_ids.add(r["artifact_id"])

    artifacts = []
    events: list[dict] = []
    tasks: list[dict] = []
    facts: list[dict] = []
    for aid in sorted(artifact_ids):
        a = db.q1("SELECT * FROM artifacts WHERE id = ?", (aid,))
        if a is None:
            continue
        artifacts.append(dict(a))
        events += [dict(r) for r in db.q("SELECT * FROM events WHERE source_artifact_id=?", (aid,))]
        tasks += [dict(r) for r in db.q("SELECT * FROM tasks WHERE source_artifact_id=?", (aid,))]
        facts += [dict(r) for r in db.q("SELECT * FROM facts WHERE source_artifact_id=?", (aid,))]
    return {
        "hits": hits,
        "artifacts": sorted(artifacts, key=lambda a: a["captured_at"] or ""),
        "events": sorted(events, key=lambda e: e["start"]),
        "tasks": tasks,
        "facts": sorted(facts, key=lambda f: f["created_at"]),
        "excluded_privileged": excluded_privileged,
    }


def _src(artifact: dict[str, Any]) -> str:
    return (f"[artifact #{artifact['id']} — {artifact['kind']}, "
            f"{artifact['captured_at']}, {artifact['filename']}]")


def build_pack(topic: str, days: int | None = None,
               include_privileged: bool = False, include_audio: bool = False) -> bytes:
    data = _collect(topic, days, include_privileged)
    now = timeutil.now_local()
    by_id = {a["id"]: a for a in data["artifacts"]}

    lines = [
        f"# Anchor pack — “{topic}”",
        f"Generated {now.strftime('%B %d, %Y %I:%M %p')} ({timeutil.config.TIMEZONE_NAME})"
        + (f" — window: last {days} days" if days else " — all time"),
        "Every item below links to its source artifact; transcripts are included in this bundle.",
        "",
    ]
    if data["excluded_privileged"]:
        lines += [
            f"> **{data['excluded_privileged']} privileged (attorney) item(s) were EXCLUDED** "
            "from this pack by default.", "",
        ]
    if include_privileged:
        lines += ["> ⚠ This pack INCLUDES privileged attorney material — handle accordingly.", ""]

    if data["events"]:
        lines.append("## Appointments / events")
        for e in data["events"]:
            src = by_id.get(e["source_artifact_id"])
            lines.append(
                f"- **{e['title']}** — {e['start']}"
                + (f", {e['location']}" if e["location"] else "")
                + f" ({e['status']})"
                + (f"\n  source: “{e['source_quote']}” {_src(src)}" if src else "")
            )
        lines.append("")
    if data["facts"]:
        lines.append("## Facts on the record")
        for f in data["facts"]:
            src = by_id.get(f["source_artifact_id"])
            lines.append(
                f"- {f['body']} ({f['status']})"
                + (f"\n  source: {_src(src)}" if src else "")
            )
        lines.append("")
    if data["tasks"]:
        lines.append("## Tasks / open loops")
        for t in data["tasks"]:
            lines.append(f"- [{'x' if t['status'] == 'closed' else ' '}] {t['title']}"
                         + (f" — {t['close_reason']}" if t["close_reason"] else ""))
        lines.append("")

    lines.append("## Matched captures")
    for h in data["hits"]:
        a = by_id.get(h["artifact_id"])
        lines.append(
            f"- ({h['match']}) “{h['snippet'][:160]}”"
            + (f" {_src(a)}" if a else f" [{h['entity']} #{h['entity_id']}]")
        )
    lines.append("")
    lines.append(f"Included artifacts: {len(data['artifacts'])}. "
                 f"Search hits: {len(data['hits'])}.")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("pack.md", "\n".join(lines))
        z.writestr("pack.json", json.dumps(
            {k: v for k, v in data.items() if k != "hits"} | {"topic": topic},
            default=str, indent=2,
        ))
        for a in data["artifacts"]:
            if a["transcript"]:
                z.writestr(
                    f"transcripts/{a['id']}_{Path(a['filename'] or 'item').stem}.txt",
                    f"{_src(a)}\n\n{a['transcript']}",
                )
            if include_audio and a["stored_path"] and Path(a["stored_path"]).is_file():
                z.write(a["stored_path"], f"audio/{a['id']}_{Path(a['stored_path']).name}")

    db.audit("user", "pack.build", detail={
        "topic": topic, "days": days, "artifacts": len(data["artifacts"]),
        "excluded_privileged": data["excluded_privileged"],
        "include_privileged": include_privileged,
    })
    return buf.getvalue()
