"""File-bridge broker: talks to a MetaTrader 5 terminal through the
TradingComBridgeEA (see ea/TradingComBridgeEA.mq5) over Tailscale SSH.

The EA runs inside MT5 (Mac/Wine) and exchanges JSON/CSV files in its
MQL5/Files folder. This adapter reads heartbeat/ticks/positions and writes
order requests, so the bot on the OVH server can trade the trading.com
account without MetaApi. The EA's own EA_DryRun flag is a final hardware-
style safety: while true, orders are acknowledged but never sent.

Requires: key-based SSH from the bot host to the Mac (BatchMode).
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import shlex
import time
from datetime import datetime, timezone

import pandas as pd

from ..config import Config
from .base import AccountInfo, Broker, Position, Quote

log = logging.getLogger("fxbot.bridge")

HEARTBEAT_MAX_AGE = 90          # seconds before we declare the bridge dead
TICK_MAX_AGE = 900              # seconds before a quote is considered stale


class BridgeError(RuntimeError):
    pass


class FileBridgeBroker(Broker):
    def __init__(self, cfg: Config):
        self.cfg = cfg
        fb = cfg.file_bridge
        self.host = fb.host
        self.user = fb.user
        self.files_dir = fb.files_dir.rstrip("/")
        self.order_timeout = fb.order_timeout_seconds
        self.magic = fb.magic

    # ---------- ssh plumbing ----------

    async def _ssh(self, remote_cmd: str, stdin: bytes | None = None) -> str:
        proc = await asyncio.create_subprocess_exec(
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
            f"{self.user}@{self.host}", remote_cmd,
            stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(input=stdin), timeout=30)
        if proc.returncode != 0:
            raise BridgeError(f"ssh failed ({proc.returncode}): {err.decode(errors='replace')[:200]}")
        return out.decode(errors="replace")

    def _q(self, filename: str) -> str:
        return shlex.quote(f"{self.files_dir}/{filename}")

    async def _read_json(self, filename: str) -> dict:
        raw = await self._ssh(f"cat {self._q(filename)}")
        return json.loads(raw)

    async def _write_json(self, filename: str, payload: dict) -> None:
        await self._ssh(f"cat > {self._q(filename)}", stdin=json.dumps(payload).encode())

    # ---------- broker interface ----------

    async def connect(self) -> None:
        hb = await self._heartbeat()
        log.info(
            "bridge connected: account %s on %s | balance %.2f equity %.2f | "
            "terminal connected=%s EA dry-run=%s",
            hb.get("account"), hb.get("server"), hb.get("balance", 0.0),
            hb.get("equity", 0.0), hb.get("connected", "?"), hb.get("ea_dry_run", "?"),
        )
        if hb.get("ea_dry_run"):
            log.warning("EA is in DRY-RUN mode: orders will be acknowledged but NOT executed")

    async def _heartbeat(self) -> dict:
        mtime_raw = await self._ssh(
            f"stat -f %m {self._q('tc_heartbeat.json')} 2>/dev/null || stat -c %Y {self._q('tc_heartbeat.json')}")
        age = time.time() - float(mtime_raw.strip())
        if age > HEARTBEAT_MAX_AGE:
            raise BridgeError(
                f"bridge heartbeat is {age:.0f}s old - is the Mac awake and MT5 running?")
        return await self._read_json("tc_heartbeat.json")

    async def account(self) -> AccountInfo:
        hb = await self._heartbeat()
        return AccountInfo(balance=float(hb["balance"]), equity=float(hb["equity"]))

    async def positions(self) -> list[Position]:
        try:
            data = await self._read_json("tc_positions.json")
        except (BridgeError, json.JSONDecodeError):
            log.warning("tc_positions.json unavailable - EA may still be v2.0; "
                        "recompile the v2.1 EA for position tracking")
            return []
        out = []
        for p in data.get("positions", []):
            out.append(Position(
                id=str(p["ticket"]),
                symbol=p["symbol"],
                direction="long" if p["side"] == "BUY" else "short",
                lots=float(p["volume"]),
                entry_price=float(p["price_open"]),
                stop_loss=float(p.get("sl") or 0.0),
                take_profit=float(p.get("tp") or 0.0),
                opened_at=datetime.fromtimestamp(int(p.get("time", 0)), tz=timezone.utc),
                unrealized_pnl=float(p.get("profit", 0.0)) + float(p.get("swap", 0.0)),
            ))
        return out

    async def quote(self, symbol: str) -> Quote:
        t = await self._read_json(f"tc_tick_{symbol}.json")
        written = int(t.get("written_at") or t.get("time") or 0)
        if written and time.time() - written > TICK_MAX_AGE:
            raise BridgeError(f"quote for {symbol} is stale ({time.time() - written:.0f}s) - "
                              "MT5 may be disconnected from the broker")
        return Quote(symbol=symbol, bid=float(t["bid"]), ask=float(t["ask"]))

    async def get_rates_m15(self, symbol: str) -> pd.DataFrame | None:
        """Real broker M15 candles exported by the EA (better than Yahoo for entries)."""
        try:
            raw = await self._ssh(f"cat {self._q(f'tc_rates_{symbol}_M15.csv')}")
            df = pd.read_csv(io.StringIO(raw))
            df.index = pd.to_datetime(df["time"], unit="s", utc=True)
            return df[["open", "high", "low", "close"]]
        except Exception as e:  # noqa: BLE001
            log.debug("bridge rates unavailable for %s: %s", symbol, e)
            return None

    # ---------- orders ----------

    async def _send_order(self, payload: dict) -> dict:
        order_id = int(time.time() * 1000)
        payload = {"has_order": True, "id": order_id, "magic": self.magic,
                   "comment": "fxbot", **payload}
        await self._write_json("tc_next_order.json", payload)
        deadline = time.monotonic() + self.order_timeout
        while time.monotonic() < deadline:
            await asyncio.sleep(2.5)
            try:
                report = await self._read_json("tc_order_report.json")
            except (BridgeError, json.JSONDecodeError):
                continue
            if int(report.get("id", 0)) == order_id:
                return report
        raise BridgeError(f"no EA report for order {order_id} within {self.order_timeout}s")

    async def open_position(
        self, symbol: str, direction: str, lots: float, stop_loss: float, take_profit: float
    ) -> Position | None:
        try:
            report = await self._send_order({
                "symbol": symbol,
                "side": "BUY" if direction == "long" else "SELL",
                "volume": round(lots, 2),
                "stop_loss": round(stop_loss, 5),
                "take_profit": round(take_profit, 5),
            })
        except BridgeError as e:
            log.error("bridge order failed: %s", e)
            return None

        status = report.get("status", "")
        if status == "EA_DRY_RUN":
            log.info("EA DRY-RUN acknowledged %s %s %.2f lots (no real order sent)",
                     direction.upper(), symbol, lots)
            return None
        if status != "EA_SENT":
            log.error("EA rejected order: %s (retcode=%s %s)",
                      status, report.get("retcode"), report.get("comment"))
            return None

        log.info("BRIDGE OPEN %s %s %.2f lots (order %s deal %s)",
                 direction.upper(), symbol, lots,
                 report.get("order_ticket"), report.get("deal_ticket"))
        await asyncio.sleep(3)  # let the EA re-export positions
        for p in await self.positions():
            if p.symbol == symbol and str(p.id) == str(report.get("order_ticket")):
                return p
        candidates = [p for p in await self.positions() if p.symbol == symbol]
        return max(candidates, key=lambda p: p.opened_at, default=Position(
            id=str(report.get("order_ticket")), symbol=symbol, direction=direction,
            lots=lots, entry_price=0.0, stop_loss=stop_loss, take_profit=take_profit))

    async def close_position(self, position_id: str) -> bool:
        try:
            report = await self._send_order({"side": "CLOSE", "ticket": int(position_id)})
        except (BridgeError, ValueError) as e:
            log.error("bridge close failed for %s: %s", position_id, e)
            return False
        ok = report.get("status") in ("EA_SENT", "EA_DRY_RUN")
        if report.get("status") == "EA_DRY_RUN":
            log.info("EA DRY-RUN acknowledged CLOSE of %s", position_id)
        elif ok:
            log.info("BRIDGE CLOSE position %s", position_id)
        else:
            log.error("EA close rejected: %s", report)
        return ok

    async def modify_stops(self, position_id: str, stop_loss: float, take_profit: float = 0.0) -> bool:
        try:
            report = await self._send_order({
                "side": "MODIFY", "ticket": int(position_id),
                "stop_loss": round(stop_loss, 5), "take_profit": round(take_profit, 5),
            })
        except (BridgeError, ValueError) as e:
            log.error("bridge modify failed for %s: %s", position_id, e)
            return False
        return report.get("status") in ("EA_SENT", "EA_DRY_RUN")
