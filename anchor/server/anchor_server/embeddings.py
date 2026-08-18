"""Local semantic index over the vault (Phase 3).

Everything runs on-box (fastembed / ONNX — no third-party cloud, per the
security posture). The worker's housekeeping pass calls embed_sweep(), which
embeds any vault_fts rows that don't have vectors yet — incremental,
idempotent, and rebuildable by clearing the embeddings table.

The embedder is injectable (set_embedder) so tests run without model weights
and a future backend swap is one function.
"""

from __future__ import annotations

import struct
from typing import Callable

from . import config, db, timeutil

Embedder = Callable[[list[str]], list[list[float]]]

_embedder: Embedder | None = None
_disabled_reason: str | None = None


def set_embedder(fn: Embedder | None) -> None:
    global _embedder, _disabled_reason
    _embedder = fn
    _disabled_reason = None


def _get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        from fastembed import TextEmbedding  # lazy: pulls ONNX runtime

        model = TextEmbedding(model_name=config.EMBED_MODEL)
        _embedder = lambda texts: [list(map(float, v)) for v in model.embed(texts)]  # noqa: E731
    return _embedder


def pack_vector(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def unpack_vector(blob: bytes, dim: int) -> list[float]:
    return list(struct.unpack(f"{dim}f", blob))


def embed_texts(texts: list[str]) -> list[list[float]]:
    return _get_embedder()(texts)


def embed_sweep(batch: int | None = None) -> int:
    """Embed vault rows missing vectors. Returns rows embedded this pass.

    On failure the sweep disables itself until restart and notifies once
    (rule 8) — semantic search degrades, keyword search keeps working.
    """
    global _disabled_reason
    if not config.EMBED_ENABLED or _disabled_reason:
        return 0
    rows = db.q(
        "SELECT v.rowid AS rid, v.body, v.entity, v.entity_id, v.artifact_id FROM vault_fts v"
        " WHERE v.rowid NOT IN (SELECT fts_rowid FROM embeddings) LIMIT ?",
        (batch or config.EMBED_BATCH,),
    )
    if not rows:
        return 0
    try:
        vectors = embed_texts([r["body"] for r in rows])
    except Exception as exc:  # noqa: BLE001 — disable + loud, never spin
        _disabled_reason = repr(exc)
        db.audit("worker", "embed.disabled", detail={"error": _disabled_reason})
        from . import notify

        notify.push(
            "Anchor: semantic search is off",
            f"The embedding backend failed and was disabled until restart: {exc}\n"
            "Keyword search still works. Check System health.",
            priority="high",
            tags="warning",
        )
        return 0
    now = timeutil.now_iso()
    conn = db.connect()
    with conn:
        for row, vec in zip(rows, vectors):
            conn.execute(
                "INSERT OR IGNORE INTO embeddings"
                " (fts_rowid, entity, entity_id, artifact_id, model, dim, vector, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    row["rid"], row["entity"], row["entity_id"], row["artifact_id"],
                    config.EMBED_MODEL, len(vec), pack_vector(vec), now,
                ),
            )
    return len(rows)


def index_status() -> dict[str, int]:
    total = db.q1("SELECT COUNT(*) AS n FROM vault_fts")["n"]
    embedded = db.q1("SELECT COUNT(*) AS n FROM embeddings")["n"]
    return {"indexed": embedded, "total": total, "pending": max(0, total - embedded)}
