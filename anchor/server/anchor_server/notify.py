"""ntfy push notifications.

Rule 8 (fail loud): if a push cannot be delivered, the failure itself is
recorded in the audit log and stderr — a notification system that fails
silently would defeat the whole design.
"""

from __future__ import annotations

import json
import sys

from . import config, db, timeutil

PRIORITIES = {"min": "1", "low": "2", "default": "3", "high": "4", "urgent": "5"}


def push(title: str, message: str, priority: str = "default", tags: str = "") -> bool:
    record = {"title": title, "message": message, "priority": priority, "tags": tags}
    if config.DRY_RUN:
        db.execute(
            "INSERT INTO outbox (ts, channel, payload) VALUES (?, 'ntfy', ?)",
            (timeutil.now_iso(), json.dumps(record)),
        )
        return True
    try:
        import requests

        headers = {
            "Title": title.encode("utf-8", "replace").decode("latin-1", "replace"),
            "Priority": PRIORITIES.get(priority, "3"),
        }
        if tags:
            headers["Tags"] = tags
        if config.NTFY_TOKEN:
            headers["Authorization"] = f"Bearer {config.NTFY_TOKEN}"
        resp = requests.post(
            f"{config.NTFY_URL.rstrip('/')}/{config.ntfy_topic()}",
            data=message.encode("utf-8"),
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()
        db.audit("system", "notify.sent", detail={"title": title, "priority": priority})
        return True
    except Exception as exc:  # noqa: BLE001 — recorded, never swallowed
        print(f"[anchor] ntfy push FAILED: {exc}: {title}", file=sys.stderr)
        db.audit("system", "notify.failed", detail={"title": title, "error": str(exc)})
        return False
