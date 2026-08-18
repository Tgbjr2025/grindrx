"""Time handling. Rule 5: times are explicit — America/Detroit, stored with
timezone. Everything persisted is ISO-8601 with a UTC offset."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from . import config


def now_local() -> datetime:
    return datetime.now(tz=config.TZ)


def now_iso() -> str:
    return now_local().isoformat(timespec="seconds")


def to_local(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        # Naive datetimes are interpreted as local time — the only place in
        # the system where an assumption about tz is made, and it is the
        # documented one (rule 5).
        return dt.replace(tzinfo=config.TZ)
    return dt.astimezone(config.TZ)


def parse_iso(value: str) -> datetime:
    """Parse an ISO-8601 string; naive values are treated as America/Detroit."""
    return to_local(datetime.fromisoformat(value))


def iso(dt: datetime) -> str:
    return to_local(dt).isoformat(timespec="seconds")


_SAMSUNG_STAMP = re.compile(r"(?P<d>\d{6})_(?P<t>\d{6})")


def parse_samsung_stamp(text: str) -> datetime | None:
    """Parse the YYMMDD_HHMMSS stamp Samsung embeds in recording filenames."""
    m = _SAMSUNG_STAMP.search(text)
    if not m:
        return None
    d, t = m.group("d"), m.group("t")
    try:
        return datetime(
            2000 + int(d[0:2]), int(d[2:4]), int(d[4:6]),
            int(t[0:2]), int(t[2:4]), int(t[4:6]),
            tzinfo=config.TZ,
        )
    except ValueError:
        return None


def from_epoch(seconds: float) -> datetime:
    return datetime.fromtimestamp(seconds, tz=timezone.utc).astimezone(config.TZ)
