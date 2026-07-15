"""Paper broker: realistic fill simulation with spread + slippage, persisted to disk.

This is the default mode. It exercises the entire pipeline (data -> LLM ->
cost gate -> risk -> orders -> journal) without risking money, and its state
survives restarts via a JSON file next to the database.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

from ..config import Config
from ..costs import pip_value_usd
from ..data.market import pip_size, yahoo_fx_symbol, YAHOO_CHART, UA
from .base import AccountInfo, Broker, Position, Quote

log = logging.getLogger("fxbot.paper")

STATE_FILE = "paper_state.json"


class PaperBroker(Broker):
    def __init__(self, cfg: Config, http: httpx.AsyncClient):
        self.cfg = cfg
        self.http = http
        self.balance = cfg.paper.starting_balance
        self._positions: dict[str, Position] = {}
        self._last_price: dict[str, float] = {}
        self._state_path = Path(cfg.journal.db_path).parent / STATE_FILE
        self._load_state()

    # ---------- persistence ----------

    def _load_state(self) -> None:
        if not self._state_path.exists():
            return
        try:
            data = json.loads(self._state_path.read_text())
            self.balance = data.get("balance", self.balance)
            for p in data.get("positions", []):
                p["opened_at"] = datetime.fromisoformat(p["opened_at"])
                pos = Position(**p)
                self._positions[pos.id] = pos
            log.info("paper state restored: balance=%.2f positions=%d", self.balance, len(self._positions))
        except Exception as e:  # noqa: BLE001
            log.warning("could not restore paper state: %s", e)

    def _save_state(self) -> None:
        data = {
            "balance": self.balance,
            "positions": [
                {**p.__dict__, "opened_at": p.opened_at.isoformat()} for p in self._positions.values()
            ],
        }
        self._state_path.write_text(json.dumps(data, indent=2, default=str))

    # ---------- broker interface ----------

    async def connect(self) -> None:
        log.info("paper broker ready (balance %.2f %s)", self.balance, self.cfg.base_currency)

    async def account(self) -> AccountInfo:
        equity = self.balance + sum(p.unrealized_pnl for p in self._positions.values())
        return AccountInfo(balance=self.balance, equity=equity, currency=self.cfg.base_currency)

    async def positions(self) -> list[Position]:
        return list(self._positions.values())

    async def quote(self, symbol: str) -> Quote:
        mid = self._last_price.get(symbol) or await self._fetch_price(symbol)
        spread = self.cfg.paper.spread_pips.get(symbol, 1.5) * pip_size(symbol)
        return Quote(symbol=symbol, bid=mid - spread / 2, ask=mid + spread / 2)

    async def _fetch_price(self, symbol: str) -> float:
        r = await self.http.get(
            YAHOO_CHART.format(symbol=yahoo_fx_symbol(symbol)),
            params={"interval": "1m", "range": "1d"},
            headers=UA,
            timeout=15,
        )
        r.raise_for_status()
        meta = r.json()["chart"]["result"][0]["meta"]
        price = float(meta["regularMarketPrice"])
        self._last_price[symbol] = price
        return price

    async def open_position(
        self, symbol: str, direction: str, lots: float, stop_loss: float, take_profit: float
    ) -> Position | None:
        q = await self.quote(symbol)
        slip = self.cfg.costs.slippage_pips * pip_size(symbol)
        fill = (q.ask + slip) if direction == "long" else (q.bid - slip)
        commission = self.cfg.costs.commission_per_lot_usd * lots
        self.balance -= commission
        pos = Position(
            id=uuid.uuid4().hex[:12],
            symbol=symbol,
            direction=direction,
            lots=lots,
            entry_price=fill,
            stop_loss=stop_loss,
            take_profit=take_profit,
        )
        self._positions[pos.id] = pos
        self._save_state()
        log.info(
            "PAPER OPEN %s %s %.2f lots @ %.5f sl=%.5f tp=%.5f (commission $%.2f)",
            direction.upper(), symbol, lots, fill, stop_loss, take_profit, commission,
        )
        return pos

    async def close_position(self, position_id: str) -> bool:
        pos = self._positions.pop(position_id, None)
        if not pos:
            return False
        q = await self.quote(pos.symbol)
        slip = self.cfg.costs.slippage_pips * pip_size(pos.symbol)
        exit_price = (q.bid - slip) if pos.direction == "long" else (q.ask + slip)
        pnl = self._pnl(pos, exit_price)
        self.balance += pnl
        self._save_state()
        log.info("PAPER CLOSE %s %s @ %.5f pnl=$%.2f balance=$%.2f",
                 pos.direction.upper(), pos.symbol, exit_price, pnl, self.balance)
        return True

    # ---------- simulation ----------

    def _pnl(self, pos: Position, price: float) -> float:
        ps = pip_size(pos.symbol)
        pips = (price - pos.entry_price) / ps
        if pos.direction == "short":
            pips = -pips
        return pips * pip_value_usd(pos.symbol, price) * pos.lots

    async def mark_to_market(self) -> list[Position]:
        """Refresh prices, trigger SL/TP fills, return positions closed by them."""
        closed: list[Position] = []
        for pos in list(self._positions.values()):
            try:
                price = await self._fetch_price(pos.symbol)
            except Exception as e:  # noqa: BLE001
                log.warning("mark-to-market price failed for %s: %s", pos.symbol, e)
                continue
            pos.unrealized_pnl = self._pnl(pos, price)
            hit_sl = price <= pos.stop_loss if pos.direction == "long" else price >= pos.stop_loss
            hit_tp = price >= pos.take_profit if pos.direction == "long" else price <= pos.take_profit
            if (pos.stop_loss > 0 and hit_sl) or (pos.take_profit > 0 and hit_tp):
                level = pos.stop_loss if hit_sl else pos.take_profit
                pnl = self._pnl(pos, level)
                self.balance += pnl
                del self._positions[pos.id]
                closed.append(pos)
                log.info("PAPER %s hit on %s @ %.5f pnl=$%.2f",
                         "SL" if hit_sl else "TP", pos.symbol, level, pnl)
        self._save_state()
        return closed
