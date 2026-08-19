"""Daily 8:00 AM digest (systemd timer runs this module).

Always ends with the system-health line (rule 8): items processed, queue
depth, last backup, last phone sync — so a dead component is visible every
single morning even if its own alert was missed.
"""

from __future__ import annotations

import json
from datetime import timedelta

from . import db, notify, queue, timeutil


def _health_line() -> str:
    depth = queue.depth()
    failed = depth.get("failed", 0)
    pending = depth.get("queued", 0) + depth.get("processing", 0)
    day_ago = timeutil.iso(timeutil.now_local() - timedelta(hours=24))
    processed = db.q1(
        "SELECT COUNT(*) AS n FROM artifacts WHERE status='processed' AND created_at > ?",
        (day_ago,),
    )["n"]
    beats = {r["component"]: r["last_seen"] for r in db.q("SELECT * FROM heartbeats")}

    def age(component: str) -> str:
        if component not in beats:
            return "NEVER"
        hours = (timeutil.now_local() - timeutil.parse_iso(beats[component])).total_seconds() / 3600
        return f"{hours:.1f}h ago"

    line = (
        f"Health: {processed} processed/24h, queue {pending} pending"
        + (f", {failed} FAILED" if failed else "")
        + f", phone sync {age('phone')}, last backup {age('backup')}"
    )
    return line


def build_digest() -> str:
    now = timeutil.now_local()
    today_end = timeutil.iso(now.replace(hour=23, minute=59, second=59))
    day_ago = timeutil.iso(now - timedelta(hours=24))

    events = db.q(
        "SELECT * FROM events WHERE status='active' AND start >= ? AND start <= ? ORDER BY start",
        (timeutil.now_iso(), today_end),
    )
    captures = db.q(
        "SELECT * FROM artifacts WHERE created_at > ? AND status != 'spam'"
        " ORDER BY captured_at",
        (day_ago,),
    )
    spam_count = db.q1(
        "SELECT COUNT(*) AS n FROM artifacts WHERE created_at > ? AND status = 'spam'",
        (day_ago,),
    )["n"]
    open_tasks = db.q("SELECT * FROM tasks WHERE status='open' ORDER BY created_at")
    confirms = db.q("SELECT * FROM confirms WHERE status='pending' ORDER BY created_at")

    lines = [f"Good morning — {now.strftime('%A, %B %-d')}", ""]

    lines.append(f"TODAY ({len(events)} event{'s' if len(events) != 1 else ''}):")
    for e in events:
        start = timeutil.parse_iso(e["start"])
        lines.append(
            f"• {start.strftime('%-I:%M %p')} — {e['title']}"
            + (f" ({e['location']})" if e["location"] else "")
        )
    if not events:
        lines.append("• nothing on the calendar")
    lines.append("")

    if captures:
        privileged = sum(1 for c in captures if c["privileged"])
        lines.append(f"CAPTURED yesterday: {len(captures)} item(s)"
                     + (f" ({privileged} privileged)" if privileged else ""))
        for c in captures[:10]:
            if c["privileged"]:
                lines.append(f"• [privileged] {c['kind']} at {c['captured_at']}")
            else:
                who = c["contact_hint"] or c["phone_number"] or "unknown"
                lines.append(f"• {c['kind']} — {who}" + (
                    f": {c['agent_summary'][:100]}" if c["agent_summary"] else ""))
        lines.append("")

    if spam_count:
        lines.append(f"🚫 Ignored {spam_count} spam call{'s' if spam_count != 1 else ''}.")
        lines.append("")

    if open_tasks:
        lines.append(f"OPEN LOOPS ({len(open_tasks)}):")
        for t in open_tasks[:10]:
            lines.append(f"• {t['title']}" + (f" — call {t['phone_number']}" if t["phone_number"] else ""))
        lines.append("")

    if confirms:
        lines.append(f"NEEDS CONFIRM ({len(confirms)}): open the Confirm inbox.")
        for c in confirms[:5]:
            lines.append(f"• {c['summary']}")
        lines.append("")

    lines.append(_health_line())
    return "\n".join(lines)


def main() -> None:
    body = build_digest()
    ok = notify.push("Anchor — morning digest", body, priority="default", tags="sunrise")
    db.audit("system", "digest.sent" if ok else "digest.send_failed",
             detail={"chars": len(body)})
    db.execute(
        "INSERT INTO outbox (ts, channel, payload) VALUES (?, 'digest', ?)",
        (timeutil.now_iso(), json.dumps({"body": body})),
    )


if __name__ == "__main__":
    main()
