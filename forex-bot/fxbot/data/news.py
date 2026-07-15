"""News headlines and the economic calendar.

- Headlines: free RSS feeds (ForexLive, FXStreet, MarketWatch, Investing.com...).
- Calendar: ForexFactory weekly JSON mirror (high/medium impact events with times),
  used both as LLM context and to enforce the news-blackout window in risk.py.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import feedparser
import httpx

log = logging.getLogger("fxbot.news")


@dataclass
class CalendarEvent:
    when: datetime
    currency: str
    title: str
    impact: str  # High / Medium / Low

    def to_json(self) -> dict[str, Any]:
        return {
            "time_utc": self.when.strftime("%Y-%m-%d %H:%M"),
            "currency": self.currency,
            "title": self.title,
            "impact": self.impact,
        }


async def fetch_headlines(client: httpx.AsyncClient, feeds: list[str], per_feed: int = 8) -> list[str]:
    async def one(url: str) -> list[str]:
        try:
            r = await client.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            parsed = await asyncio.to_thread(feedparser.parse, r.text)
            return [e.get("title", "").strip() for e in parsed.entries[:per_feed] if e.get("title")]
        except Exception as e:  # noqa: BLE001
            log.warning("feed failed %s: %s", url, e)
            return []

    results = await asyncio.gather(*(one(u) for u in feeds))
    seen: set[str] = set()
    headlines: list[str] = []
    for titles in results:
        for t in titles:
            if t not in seen:
                seen.add(t)
                headlines.append(t)
    return headlines[:60]


async def fetch_calendar(client: httpx.AsyncClient, url: str) -> list[CalendarEvent]:
    if not url:
        return []
    try:
        r = await client.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        events = []
        for item in r.json():
            try:
                when = datetime.fromisoformat(item["date"]).astimezone(timezone.utc)
            except (KeyError, ValueError):
                continue
            events.append(
                CalendarEvent(
                    when=when,
                    currency=item.get("country", ""),
                    title=item.get("title", ""),
                    impact=item.get("impact", ""),
                )
            )
        return events
    except Exception as e:  # noqa: BLE001
        log.warning("calendar fetch failed: %s", e)
        return []


def upcoming_events(events: list[CalendarEvent], hours: int = 48) -> list[CalendarEvent]:
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=hours)
    return [e for e in events if now - timedelta(hours=2) <= e.when <= horizon and e.impact in ("High", "Medium")]


def in_news_blackout(events: list[CalendarEvent], symbol: str, minutes: int) -> CalendarEvent | None:
    """Return the blocking high-impact event if `symbol` trades into one, else None."""
    now = datetime.now(timezone.utc)
    ccys = {symbol[:3].upper(), symbol[3:6].upper()}
    for e in events:
        if e.impact != "High" or e.currency.upper() not in ccys:
            continue
        if abs((e.when - now).total_seconds()) <= minutes * 60:
            return e
    return None
