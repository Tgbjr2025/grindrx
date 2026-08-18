"""FastAPI ingestion + query API.

Auth: single bearer token (phone ↔ server ↔ GUI). Serve behind HTTPS
(reverse proxy) — see deploy/setup_server.sh.
"""

from __future__ import annotations

import json
import secrets
import tempfile
from datetime import timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, confirms, db, ingest, queue, timeutil
from .digest import build_digest

app = FastAPI(title="Anchor", version="0.1.0", docs_url=None, redoc_url=None)


def auth(request: Request) -> None:
    header = request.headers.get("authorization", "")
    expected = f"Bearer {config.api_token()}"
    if not secrets.compare_digest(header, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")


# --------------------------------------------------------------------------
# Ingestion (phone → server)
# --------------------------------------------------------------------------

@app.post("/v1/ingest", dependencies=[Depends(auth)])
async def ingest_upload(
    file: UploadFile,
    kind: str = Form(...),
    captured_at: str | None = Form(None),
    contact_hint: str | None = Form(None),
    phone_number: str | None = Form(None),
    source_path: str | None = Form(None),
    batch_id: str | None = Form(None),
    backfill: bool = Form(False),
    sha256: str | None = Form(None),
):
    if kind not in ("call", "voicemail", "photo", "note", "sms", "fix"):
        raise HTTPException(status_code=400, detail=f"Unknown kind {kind!r}")
    # Fast path: client already knows the hash and we already have it.
    if sha256:
        existing = db.q1("SELECT id FROM artifacts WHERE sha256 = ?", (sha256,))
        if existing:
            return {"artifact_id": existing["id"], "duplicate": True}
    with tempfile.NamedTemporaryFile(dir=config.DATA_DIR, delete=False) as tmp:
        while chunk := await file.read(1 << 20):
            tmp.write(chunk)
        tmp_path = Path(tmp.name)
    try:
        result = ingest.ingest_file(
            tmp_path,
            filename=file.filename or "upload.bin",
            kind=kind,
            captured_at=captured_at,
            contact_hint=contact_hint,
            phone_number=phone_number,
            source_path=source_path,
            batch_id=batch_id,
            backfill=backfill,
            mime=file.content_type,
        )
    finally:
        tmp_path.unlink(missing_ok=True)
    return result


class NoteIn(BaseModel):
    text: str
    kind: str = "note"  # note | sms | fix
    captured_at: str | None = None
    contact_hint: str | None = None
    phone_number: str | None = None
    batch_id: str | None = None
    backfill: bool = False


@app.post("/v1/ingest/text", dependencies=[Depends(auth)])
def ingest_text(body: NoteIn):
    if body.kind not in ("note", "sms", "fix"):
        raise HTTPException(status_code=400, detail=f"Unknown text kind {body.kind!r}")
    with tempfile.NamedTemporaryFile(
        dir=config.DATA_DIR, delete=False, suffix=".txt"
    ) as tmp:
        tmp.write(body.text.encode("utf-8"))
        tmp_path = Path(tmp.name)
    try:
        stamp = timeutil.now_local().strftime("%y%m%d_%H%M%S")
        result = ingest.ingest_file(
            tmp_path,
            filename=f"{body.kind}_{stamp}.txt",
            kind=body.kind,
            captured_at=body.captured_at,
            contact_hint=body.contact_hint,
            phone_number=body.phone_number,
            batch_id=body.batch_id,
            backfill=body.backfill,
            mime="text/plain",
            text_body=body.text,
        )
    finally:
        tmp_path.unlink(missing_ok=True)
    return result


# --------------------------------------------------------------------------
# Sync (reconciliation sweep + heartbeat)
# --------------------------------------------------------------------------

@app.get("/v1/sync/manifest", dependencies=[Depends(auth)])
def sync_manifest():
    rows = db.q("SELECT sha256 FROM artifacts")
    return {"sha256": [r["sha256"] for r in rows]}


class HeartbeatIn(BaseModel):
    device: str = "phone"
    detail: str = ""


@app.post("/v1/sync/heartbeat", dependencies=[Depends(auth)])
def sync_heartbeat(body: HeartbeatIn):
    db.heartbeat(body.device, body.detail)
    return {"ok": True}


# --------------------------------------------------------------------------
# Backfill report
# --------------------------------------------------------------------------

@app.get("/v1/backfill/report", dependencies=[Depends(auth)])
def backfill_report(batch_id: str):
    arts = db.q("SELECT * FROM artifacts WHERE batch_id = ?", (batch_id,))
    ids = [a["id"] for a in arts]
    if not ids:
        return {"batch_id": batch_id, "count": 0}
    marks = ",".join("?" * len(ids))
    pending = db.q1(
        f"SELECT COUNT(*) AS n FROM jobs WHERE artifact_id IN ({marks})"
        " AND state IN ('queued','processing')",
        ids,
    )["n"]
    events = db.q(
        f"SELECT * FROM events WHERE source_artifact_id IN ({marks}) AND status='active'"
        " AND start >= ? ORDER BY start",
        (*ids, timeutil.now_iso()),
    )
    tasks = db.q(
        f"SELECT * FROM tasks WHERE source_artifact_id IN ({marks}) AND status='open'", ids
    )
    needs_confirm = db.q(
        f"SELECT * FROM confirms WHERE source_artifact_id IN ({marks}) AND status='pending'", ids
    )
    return {
        "batch_id": batch_id,
        "count": len(arts),
        "transcribed": sum(1 for a in arts if a["transcript"]),
        "processed": sum(1 for a in arts if a["status"] == "processed"),
        "still_processing": pending,
        "upcoming_appointments": [
            {"id": e["id"], "title": e["title"], "start": e["start"]} for e in events
        ],
        "open_return_calls": [
            {"id": t["id"], "title": t["title"], "phone_number": t["phone_number"]}
            for t in tasks
        ],
        "needs_confirm": [{"id": c["id"], "summary": c["summary"]} for c in needs_confirm],
    }


# --------------------------------------------------------------------------
# Ask / fix (agent)
# --------------------------------------------------------------------------

class AskIn(BaseModel):
    question: str


@app.post("/v1/ask", dependencies=[Depends(auth)])
def ask(body: AskIn):
    from .agent import brain  # deferred: anthropic import

    answer = brain.run_ask(body.question)
    db.audit("user", "ask", detail={"question": body.question, "answer": answer[:500]})
    return {"answer": answer}


class FixIn(BaseModel):
    instruction: str


@app.post("/v1/fix", dependencies=[Depends(auth)])
def fix(body: FixIn):
    from .agent import brain

    result = brain.run_fix(body.instruction)
    db.audit("user", "fix", detail={"instruction": body.instruction, "result": result[:500]})
    return {"result": result}


# --------------------------------------------------------------------------
# GUI data
# --------------------------------------------------------------------------

@app.get("/v1/today", dependencies=[Depends(auth)])
def today():
    now = timeutil.now_local()
    end = now.replace(hour=23, minute=59, second=59)
    events = db.q(
        "SELECT * FROM events WHERE status='active' AND start >= ? AND start <= ? ORDER BY start",
        (timeutil.iso(now - timedelta(hours=1)), timeutil.iso(end)),
    )
    tasks = db.q(
        "SELECT * FROM tasks WHERE status='open' AND (due IS NULL OR due <= ?)"
        " ORDER BY due IS NULL, due, created_at",
        (timeutil.iso(end),),
    )
    pending = db.q1("SELECT COUNT(*) AS n FROM confirms WHERE status='pending'")["n"]
    return {
        "now": timeutil.now_iso(),
        "events": [dict(e) for e in events],
        "open_tasks": [dict(t) for t in tasks],
        "pending_confirms": pending,
    }


@app.get("/v1/confirms", dependencies=[Depends(auth)])
def list_confirms():
    rows = db.q("SELECT * FROM confirms WHERE status='pending' ORDER BY created_at")
    return {"confirms": [dict(r) for r in rows]}


class ResolveIn(BaseModel):
    action: str  # approve | fix | dismiss
    fix: dict | None = None


@app.post("/v1/confirms/{confirm_id}/resolve", dependencies=[Depends(auth)])
def resolve_confirm(confirm_id: int, body: ResolveIn):
    if body.action not in ("approve", "fix", "dismiss"):
        raise HTTPException(status_code=400, detail="action must be approve|fix|dismiss")
    try:
        return confirms.resolve(confirm_id, body.action, body.fix)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/timeline", dependencies=[Depends(auth)])
def timeline(limit: int = 50, before: str | None = None):
    params: list = []
    where = ""
    if before:
        where = "WHERE captured_at < ?"
        params.append(before)
    rows = db.q(
        f"SELECT id, kind, filename, contact_hint, phone_number, captured_at, privileged,"
        f" classification, agent_summary, status, duration_seconds FROM artifacts {where}"
        f" ORDER BY captured_at DESC LIMIT ?",
        (*params, min(limit, 200)),
    )
    return {"items": [dict(r) for r in rows]}


@app.get("/v1/artifacts/{artifact_id}", dependencies=[Depends(auth)])
def artifact_detail(artifact_id: int):
    row = db.q1("SELECT * FROM artifacts WHERE id = ?", (artifact_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="No such artifact")
    d = dict(row)
    d["transcript_segments"] = json.loads(d["transcript_segments"] or "[]")
    d.pop("stored_path", None)
    facts = db.q("SELECT * FROM facts WHERE source_artifact_id = ?", (artifact_id,))
    events = db.q("SELECT * FROM events WHERE source_artifact_id = ?", (artifact_id,))
    tasks = db.q("SELECT * FROM tasks WHERE source_artifact_id = ?", (artifact_id,))
    return {
        "artifact": d,
        "facts": [dict(f) for f in facts],
        "events": [dict(e) for e in events],
        "tasks": [dict(t) for t in tasks],
    }


def auth_or_query_token(request: Request) -> None:
    """Media links opened in a new tab can't set headers; accept ?token= too.
    Same single bearer token, same HTTPS requirement."""
    token = request.query_params.get("token", "")
    if token and secrets.compare_digest(token, config.api_token()):
        return
    auth(request)


@app.get("/v1/artifacts/{artifact_id}/audio", dependencies=[Depends(auth_or_query_token)])
def artifact_audio(artifact_id: int):
    row = db.q1("SELECT stored_path, mime FROM artifacts WHERE id = ?", (artifact_id,))
    if row is None or not row["stored_path"] or not Path(row["stored_path"]).is_file():
        raise HTTPException(status_code=404, detail="No stored media for this artifact")
    # FileResponse supports HTTP Range → the GUI can seek to the exact offset.
    return FileResponse(row["stored_path"], media_type=row["mime"] or "audio/mp4")


@app.get("/v1/tasks", dependencies=[Depends(auth)])
def list_tasks(status: str = "open"):
    rows = db.q("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC", (status,))
    return {"tasks": [dict(r) for r in rows]}


@app.get("/v1/contacts", dependencies=[Depends(auth)])
def list_contacts():
    rows = db.q("SELECT * FROM contacts ORDER BY name")
    return {"contacts": [dict(r) for r in rows]}


@app.get("/v1/digest/preview", dependencies=[Depends(auth)])
def digest_preview():
    return {"digest": build_digest()}


@app.get("/v1/health", dependencies=[Depends(auth)])
def health():
    depth = queue.depth()
    beats = {r["component"]: dict(r) for r in db.q("SELECT * FROM heartbeats")}
    failed_jobs = db.q(
        "SELECT id, type, artifact_id, last_error, finished_at FROM jobs"
        " WHERE state='failed' ORDER BY finished_at DESC LIMIT 10"
    )
    recent_errors = db.q(
        "SELECT ts, action, detail FROM audit_log WHERE action LIKE '%error%'"
        " OR action LIKE '%failed%' ORDER BY id DESC LIMIT 20"
    )
    return {
        "now": timeutil.now_iso(),
        "queue": depth,
        "heartbeats": beats,
        "failed_jobs": [dict(r) for r in failed_jobs],
        "recent_errors": [dict(r) for r in recent_errors],
        "dry_run": config.DRY_RUN,
        "llm_backend": config.LLM_BACKEND,
    }


@app.get("/ping")
def ping():
    """Unauthenticated liveness probe for systemd/uptime checks."""
    return {"ok": True, "service": "anchor"}


db.heartbeat("api", "started")

# Serve the built GUI (SvelteKit static build) if present.
_gui_dir = Path(__file__).resolve().parents[2] / "gui" / "build"
if _gui_dir.is_dir():
    app.mount("/", StaticFiles(directory=_gui_dir, html=True), name="gui")


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    # Rule 8: no swallowed exceptions — every 500 lands in the audit log.
    db.audit("api", "api.error", detail={"path": str(request.url.path), "error": repr(exc)})
    return JSONResponse(status_code=500, content={"detail": f"Internal error: {exc}"})


def main() -> None:
    import uvicorn

    config.ensure_dirs()
    uvicorn.run(app, host=config.API_HOST, port=config.API_PORT)


if __name__ == "__main__":
    main()
