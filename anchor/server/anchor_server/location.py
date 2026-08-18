"""Google Timeline / location-history import (Phase 3).

Google's Timeline now lives on-device: export it from the phone
(Settings → Location → Location Services → Timeline → Export) and share the
JSON to Anchor (share-sheet or `anchor location-import`). Both the modern
on-device export ("semanticSegments") and the older Takeout Semantic
Location History ("timelineObjects") are parsed.

Visits become timeline facts with provenance to the uploaded file, so
"what did I do last Tuesday?" is answerable from the record.
"""

from __future__ import annotations

import json
from typing import Any

from . import db, timeutil


def _fact_exists(body: str) -> bool:
    return db.q1("SELECT 1 FROM facts WHERE body = ?", (body,)) is not None


def _add_visit(place: str, start: str, end: str, artifact_id: int) -> bool:
    try:
        start_l = timeutil.iso(timeutil.parse_iso(start))
        end_l = timeutil.iso(timeutil.parse_iso(end))
    except ValueError:
        return False
    body = f"Was at {place} from {start_l} to {end_l}"
    if _fact_exists(body):  # idempotent across overlapping exports
        return False
    fact_id = db.execute(
        "INSERT INTO facts (body, category, source_artifact_id, created_at)"
        " VALUES (?, 'location', ?, ?)",
        (body, artifact_id, timeutil.now_iso()),
    )
    db.fts_index(body, "fact", fact_id, artifact_id)
    return True


def _parse_semantic_segments(data: dict[str, Any], artifact_id: int) -> tuple[int, int]:
    """Modern on-device export: {"semanticSegments": [...]}."""
    visits = added = 0
    for seg in data.get("semanticSegments", []) or []:
        visit = seg.get("visit")
        if not visit:
            continue
        visits += 1
        top = visit.get("topCandidate", {}) or {}
        place = (
            top.get("label")
            or (top.get("placeLocation") or {}).get("name")
            or top.get("semanticType")
            or (top.get("placeLocation") or {}).get("latLng")
            or "an unlabeled place"
        )
        if _add_visit(str(place), seg.get("startTime", ""), seg.get("endTime", ""), artifact_id):
            added += 1
    return visits, added


def _parse_timeline_objects(data: dict[str, Any], artifact_id: int) -> tuple[int, int]:
    """Older Takeout format: {"timelineObjects": [{"placeVisit": ...}]}."""
    visits = added = 0
    for obj in data.get("timelineObjects", []) or []:
        pv = obj.get("placeVisit")
        if not pv:
            continue
        visits += 1
        loc = pv.get("location", {}) or {}
        place = loc.get("name") or loc.get("address") or "an unlabeled place"
        dur = pv.get("duration", {}) or {}
        if _add_visit(
            str(place), dur.get("startTimestamp", ""), dur.get("endTimestamp", ""), artifact_id
        ):
            added += 1
    return visits, added


def import_json(raw: bytes, artifact_id: int) -> dict[str, int]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("Unrecognized location export (expected a JSON object).")

    if "semanticSegments" in data:
        visits, added = _parse_semantic_segments(data, artifact_id)
    elif "timelineObjects" in data:
        visits, added = _parse_timeline_objects(data, artifact_id)
    else:
        raise ValueError(
            "Unrecognized location export: expected 'semanticSegments' (on-device "
            "Timeline export) or 'timelineObjects' (Takeout)."
        )
    db.audit("api", "location.import", "artifact", artifact_id,
             {"visits_found": visits, "facts_added": added})
    return {"visits_found": visits, "facts_added": added}
