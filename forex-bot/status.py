#!/usr/bin/env python3
"""Quick status report: .venv/bin/python status.py"""

import json
import sqlite3
from pathlib import Path

DB = Path(__file__).parent / "fxbot.sqlite3"
STATE = Path(__file__).parent / "paper_state.json"

db = sqlite3.connect(DB)

print("=" * 62)
print("FXBOT STATUS")
print("=" * 62)

row = db.execute("SELECT ts, balance, equity FROM equity ORDER BY ts DESC LIMIT 1").fetchone()
if row:
    print(f"\nEquity:  ${row[2]:,.2f}   Balance: ${row[1]:,.2f}   (as of {row[0][:19]})")

halted = db.execute("SELECT value FROM meta WHERE key='halted'").fetchone()
print(f"Kill switch: {'*** HALTED ***' if halted else 'ok'}")

if STATE.exists():
    positions = json.loads(STATE.read_text()).get("positions", [])
    print(f"\nOpen positions ({len(positions)}):")
    for p in positions:
        print(f"  {p['direction'].upper():5} {p['symbol']} {p['lots']} lots @ {p['entry_price']:.5f} "
              f"sl {p['stop_loss']:.5f} tp {p['take_profit']:.5f} "
              f"uPnL ${p.get('unrealized_pnl', 0):+.2f}")

print("\nLatest market outlook:")
row = db.execute("SELECT ts, outlook FROM outlooks ORDER BY ts DESC LIMIT 1").fetchone()
if row:
    print(f"  [{row[0][:16]}] {row[1]}")

print("\nLast 8 decisions:")
for ts, sym, act, conf, gate in db.execute(
        "SELECT ts, symbol, action, confidence, gate_result FROM decisions ORDER BY id DESC LIMIT 8"):
    print(f"  {ts[11:16]} {sym:7} {act:10} conf={conf:.2f} -> {gate}")

print("\nClosed trades:")
rows = db.execute("SELECT ts_close, symbol, direction, lots, pnl FROM trades "
                  "WHERE ts_close IS NOT NULL ORDER BY ts_close DESC LIMIT 10").fetchall()
if not rows:
    print("  (none yet)")
for ts, sym, d, lots, pnl in rows:
    pnl_s = f"${pnl:+.2f}" if pnl is not None else "n/a"
    print(f"  {ts[:16]} {d:5} {sym} {lots} lots  pnl {pnl_s}")

n_dec = db.execute("SELECT COUNT(*) FROM decisions").fetchone()[0]
n_cyc = db.execute("SELECT COUNT(*) FROM outlooks").fetchone()[0]
print(f"\nTotals: {n_cyc} cycles, {n_dec} decisions journaled")
