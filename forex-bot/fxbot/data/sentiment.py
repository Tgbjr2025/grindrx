"""Social sentiment: top posts from finance/forex subreddits via Reddit's public JSON.

This is intentionally lightweight - raw titles are handed to the Sonnet model,
which is far better at judging sentiment in context than a keyword scorer.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

log = logging.getLogger("fxbot.sentiment")

UA = {"User-Agent": "fxbot/0.1 (research; contact via repo)"}


async def fetch_reddit_titles(client: httpx.AsyncClient, subs: list[str], per_sub: int = 10) -> list[str]:
    async def one(sub: str) -> list[str]:
        url = f"https://www.reddit.com/r/{sub}/hot.json"
        try:
            r = await client.get(url, params={"limit": per_sub}, headers=UA, timeout=15)
            r.raise_for_status()
            children = r.json().get("data", {}).get("children", [])
            return [
                f"r/{sub}: {c['data'].get('title', '').strip()}"
                for c in children
                if not c["data"].get("stickied")
            ]
        except Exception as e:  # noqa: BLE001
            log.warning("reddit fetch failed r/%s: %s", sub, e)
            return []

    results = await asyncio.gather(*(one(s) for s in subs))
    return [t for titles in results for t in titles if t][:40]
