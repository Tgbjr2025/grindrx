"""Hybrid vault search: FTS keyword hits + local semantic neighbors (Phase 3).

Keyword results come first (exact evidence beats similar-sounding evidence);
semantic results fill the remainder so "cardiologist" still finds the
"cardiology appointment" call. Falls back to pure FTS when the semantic
index is empty or disabled — search never breaks because embeddings did.
"""

from __future__ import annotations

import math
from typing import Any

from . import db, embeddings


def _row_payload(rid: int, body: str, entity: str, entity_id: int,
                 artifact_id: int | None, match: str, score: float | None = None) -> dict[str, Any]:
    art = db.q1(
        "SELECT kind, captured_at, contact_hint, privileged FROM artifacts WHERE id = ?",
        (artifact_id,),
    ) if artifact_id else None
    return {
        "snippet": body[:500],
        "entity": entity,
        "entity_id": entity_id,
        "artifact_id": artifact_id,
        "kind": art["kind"] if art else None,
        "captured_at": art["captured_at"] if art else None,
        "contact": art["contact_hint"] if art else None,
        "privileged": bool(art["privileged"]) if art else False,
        "match": match,
        **({"score": round(score, 4)} if score is not None else {}),
        "_rid": rid,
    }


def keyword_search(query: str, limit: int) -> list[dict[str, Any]]:
    try:
        rows = db.q(
            "SELECT rowid AS rid, body, entity, entity_id, artifact_id FROM vault_fts"
            " WHERE vault_fts MATCH ? ORDER BY rank LIMIT ?",
            (query, limit),
        )
    except db.sqlite3.OperationalError:
        # FTS query syntax error (stray quotes etc.) — retry as a plain phrase.
        rows = db.q(
            "SELECT rowid AS rid, body, entity, entity_id, artifact_id FROM vault_fts"
            " WHERE vault_fts MATCH ? ORDER BY rank LIMIT ?",
            ('"' + query.replace('"', " ") + '"', limit),
        )
    return [
        _row_payload(r["rid"], r["body"], r["entity"], r["entity_id"], r["artifact_id"], "keyword")
        for r in rows
    ]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def semantic_search(query: str, limit: int) -> list[dict[str, Any]]:
    rows = db.q("SELECT fts_rowid, dim, vector FROM embeddings")
    if not rows:
        return []
    qvec = embeddings.embed_texts([query])[0]
    scored = sorted(
        ((r["fts_rowid"], _cosine(qvec, embeddings.unpack_vector(r["vector"], r["dim"])))
         for r in rows),
        key=lambda t: t[1],
        reverse=True,
    )[:limit]
    out = []
    for rid, score in scored:
        v = db.q1(
            "SELECT rowid AS rid, body, entity, entity_id, artifact_id FROM vault_fts WHERE rowid = ?",
            (rid,),
        )
        if v is not None:
            out.append(
                _row_payload(v["rid"], v["body"], v["entity"], v["entity_id"],
                             v["artifact_id"], "semantic", score)
            )
    return out


def hybrid_search(query: str, limit: int = 10) -> list[dict[str, Any]]:
    results = keyword_search(query, limit)
    seen = {r["_rid"] for r in results}
    if len(results) < limit:
        try:
            for r in semantic_search(query, limit):
                if r["_rid"] not in seen:
                    results.append(r)
                    seen.add(r["_rid"])
                if len(results) >= limit:
                    break
        except Exception as exc:  # noqa: BLE001 — degrade to keyword, loudly
            db.audit("system", "search.semantic_error", detail={"error": repr(exc)})
    for r in results:
        r.pop("_rid", None)
    return results
