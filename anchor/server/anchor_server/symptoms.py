"""Symptom log: `anchor log "..."` entries and the dated PDF report for
medical visits (Phase 2).

Entries are rows, not artifacts — they have no external source; the user's
own statement is the source. They are FTS-indexed so `anchor ask` can see
them. Nothing is ever deleted (rule 4).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from . import db, timeutil


def add_entry(body: str, logged_at: str | None = None) -> dict[str, Any]:
    when = timeutil.iso(timeutil.parse_iso(logged_at)) if logged_at else timeutil.now_iso()
    entry_id = db.execute(
        "INSERT INTO symptoms (body, logged_at, created_at) VALUES (?, ?, ?)",
        (body, when, timeutil.now_iso()),
    )
    db.audit("user", "symptom.log", "symptom", entry_id, {"body": body[:200]})
    db.fts_index(body, "symptom", entry_id, None)
    return {"symptom_id": entry_id, "logged_at": when}


def list_entries(days: int | None = None) -> list[dict[str, Any]]:
    if days:
        since = timeutil.iso(timeutil.now_local() - timedelta(days=days))
        rows = db.q(
            "SELECT * FROM symptoms WHERE logged_at >= ? ORDER BY logged_at", (since,)
        )
    else:
        rows = db.q("SELECT * FROM symptoms ORDER BY logged_at")
    return [dict(r) for r in rows]


def build_pdf(days: int | None = None) -> bytes:
    """Clean dated table, large type, one line of context per entry."""
    from fpdf import FPDF

    entries = list_entries(days)
    now = timeutil.now_local()

    pdf = FPDF(format="letter")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_font("helvetica", "B", 16)
    pdf.cell(0, 10, "Symptom Log", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("helvetica", "", 10)
    scope = f"last {days} days" if days else "all entries"
    pdf.cell(
        0, 6,
        f"Generated {now.strftime('%B %d, %Y %I:%M %p')} ({timeutil.config.TIMEZONE_NAME}) - {scope} - {len(entries)} entries",
        new_x="LMARGIN", new_y="NEXT",
    )
    pdf.ln(4)

    pdf.set_font("helvetica", "B", 11)
    pdf.set_fill_color(230, 230, 230)
    pdf.cell(45, 8, "Date", border=1, fill=True)
    pdf.cell(0, 8, "Symptom / note", border=1, fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("helvetica", "", 11)
    for e in entries:
        when = timeutil.parse_iso(e["logged_at"]).strftime("%a %b %d, %I:%M %p")
        # Row height driven by the wrapped body text.
        y_before = pdf.get_y()
        pdf.set_x(pdf.l_margin + 45)
        pdf.multi_cell(0, 8, e["body"], border=1, new_x="LMARGIN", new_y="NEXT")
        y_after = pdf.get_y()
        pdf.set_xy(pdf.l_margin, y_before)
        pdf.cell(45, y_after - y_before, when, border=1)
        pdf.set_y(y_after)
    if not entries:
        pdf.cell(0, 8, "No entries in this period.", border=1, new_x="LMARGIN", new_y="NEXT")

    db.audit("user", "symptom.report", detail={"days": days, "entries": len(entries)})
    return bytes(pdf.output())
