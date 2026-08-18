"""Confirm-inbox resolution: one-tap approve / fix / dismiss.

Approve executes the stored machine-readable proposal through the same tool
layer the agent uses, so every guard (past-date diversion, forced reminders,
provenance checks) applies identically.
"""

from __future__ import annotations

import json
from typing import Any

from . import db, timeutil
from .agent import tools


def resolve(confirm_id: int, action: str, fix: dict[str, Any] | None = None) -> dict[str, Any]:
    row = db.q1("SELECT * FROM confirms WHERE id = ?", (confirm_id,))
    if row is None:
        raise ValueError(f"Confirm {confirm_id} not found")
    if row["status"] != "pending":
        return {"result": "already_resolved", "status": row["status"]}

    outcome: dict[str, Any] = {"action": action}
    if action in ("approve", "fix"):
        proposal = json.loads(row["proposal"] or "{}")
        tool_name = proposal.get("tool")
        tool_input = dict(proposal.get("input") or {})
        if action == "fix" and fix:
            tool_input.update(fix)
        if tool_name:
            output, is_error = tools.dispatch(tool_name, tool_input)
            outcome["tool"] = tool_name
            outcome["tool_result"] = json.loads(output)
            outcome["tool_error"] = is_error
            if is_error:
                # Leave it pending so the failure is visible and retryable —
                # a confirm that silently half-applied would violate rule 8.
                db.audit("user", "confirm.apply_failed", "confirm", confirm_id, outcome)
                return {"result": "apply_failed", **outcome}
        else:
            outcome["note"] = "No executable proposal; recorded as acknowledged."

    status = {"approve": "approved", "fix": "fixed", "dismiss": "dismissed"}[action]
    db.execute(
        "UPDATE confirms SET status=?, resolution=?, resolved_at=? WHERE id=?",
        (status, json.dumps(outcome, default=str), timeutil.now_iso(), confirm_id),
    )
    db.audit("user", f"confirm.{status}", "confirm", confirm_id, outcome,
             row["source_artifact_id"])
    return {"result": status, **outcome}
