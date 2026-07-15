"""Optional webhook notifications (Discord/Slack-compatible JSON payload)."""

from __future__ import annotations

import logging

import httpx

log = logging.getLogger("fxbot.notify")


async def notify(client: httpx.AsyncClient, webhook_url: str, message: str) -> None:
    if not webhook_url:
        return
    try:
        await client.post(webhook_url, json={"content": message, "text": message}, timeout=10)
    except Exception as e:  # noqa: BLE001
        log.warning("notification failed: %s", e)
