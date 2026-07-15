"""SQLite journal: every decision, trade, and equity snapshot is recorded.

The journal is the audit trail for reviewing what the bot did and why, and it
persists state (peak equity, day-start equity, halt flag) across restarts so
the kill switch cannot be reset by simply rebooting the process.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    symbol TEXT,
    action TEXT,
    confidence REAL,
    expected_move_pips REAL,
    reasoning TEXT,
    gate_result TEXT
);
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY,
    position_id TEXT,
    ts_open TEXT,
    symbol TEXT,
    direction TEXT,
    lots REAL,
    entry_price REAL,
    stop_loss REAL,
    take_profit REAL,
    ts_close TEXT,
    pnl REAL
);
CREATE TABLE IF NOT EXISTS equity (
    ts TEXT PRIMARY KEY,
    balance REAL,
    equity REAL
);
CREATE TABLE IF NOT EXISTS outlooks (
    ts TEXT PRIMARY KEY,
    outlook TEXT,
    llm_cost_usd REAL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Journal:
    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path)
        self.db.executescript(SCHEMA)
        self.db.commit()

    # ---------- meta k/v ----------

    def get(self, key: str, default=None):
        row = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set(self, key: str, value) -> None:
        self.db.execute(
            "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )
        self.db.commit()

    # ---------- records ----------

    def record_outlook(self, outlook: str, cost: float) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO outlooks(ts,outlook,llm_cost_usd) VALUES(?,?,?)",
            (_now(), outlook, cost),
        )
        self.db.commit()

    def record_decision(self, symbol: str, action: str, confidence: float,
                        expected_move: float, reasoning: str, gate_result: str) -> None:
        self.db.execute(
            "INSERT INTO decisions(ts,symbol,action,confidence,expected_move_pips,reasoning,gate_result) "
            "VALUES(?,?,?,?,?,?,?)",
            (_now(), symbol, action, confidence, expected_move, reasoning, gate_result),
        )
        self.db.commit()

    def record_open(self, pos) -> None:
        self.db.execute(
            "INSERT INTO trades(position_id,ts_open,symbol,direction,lots,entry_price,stop_loss,take_profit) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (pos.id, _now(), pos.symbol, pos.direction, pos.lots,
             pos.entry_price, pos.stop_loss, pos.take_profit),
        )
        self.db.commit()

    def record_close(self, position_id: str, pnl: float | None = None) -> None:
        self.db.execute(
            "UPDATE trades SET ts_close=?, pnl=? WHERE position_id=? AND ts_close IS NULL",
            (_now(), pnl, position_id),
        )
        self.db.commit()

    def snapshot_equity(self, balance: float, equity: float) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO equity(ts,balance,equity) VALUES(?,?,?)",
            (_now(), balance, equity),
        )
        self.db.commit()
