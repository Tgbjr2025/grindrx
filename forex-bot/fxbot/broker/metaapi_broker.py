"""MetaApi adapter: bridges the bot to a trading.com MetaTrader 5 account.

trading.com is an MT5 broker with no public REST API, and MetaTrader's own
Python bindings are Windows-only. MetaApi (https://metaapi.cloud) hosts the
MT5 connection in the cloud and exposes it over websockets, which is the
standard way to trade an MT5 account from a Linux server.

Setup: create the MT5 account at trading.com (demo first!), register it on
metaapi.cloud, then put METAAPI_TOKEN and METAAPI_ACCOUNT_ID in .env.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from ..config import Config
from .base import AccountInfo, Broker, Position, Quote

log = logging.getLogger("fxbot.metaapi")


class MetaApiBroker(Broker):
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._connection = None

    async def connect(self) -> None:
        # imported lazily so paper mode doesn't need the SDK installed/working
        from metaapi_cloud_sdk import MetaApi

        api = MetaApi(self.cfg.metaapi_token)
        account = await api.metatrader_account_api.get_account(self.cfg.metaapi_account_id)
        if account.state not in ("DEPLOYED",):
            log.info("deploying MetaApi account (state=%s)...", account.state)
            await account.deploy()
        await account.wait_connected()
        self._connection = account.get_rpc_connection()
        await self._connection.connect()
        await self._connection.wait_synchronized()
        info = await self._connection.get_account_information()
        log.info(
            "connected to %s (%s): balance %.2f %s",
            info.get("broker", "?"), info.get("server", "?"),
            info.get("balance", 0.0), info.get("currency", "?"),
        )

    async def account(self) -> AccountInfo:
        info = await self._connection.get_account_information()
        return AccountInfo(
            balance=float(info["balance"]),
            equity=float(info["equity"]),
            currency=info.get("currency", "USD"),
        )

    async def positions(self) -> list[Position]:
        raw = await self._connection.get_positions()
        out = []
        for p in raw:
            out.append(
                Position(
                    id=str(p["id"]),
                    symbol=p["symbol"],
                    direction="long" if p["type"] == "POSITION_TYPE_BUY" else "short",
                    lots=float(p["volume"]),
                    entry_price=float(p["openPrice"]),
                    stop_loss=float(p.get("stopLoss") or 0.0),
                    take_profit=float(p.get("takeProfit") or 0.0),
                    opened_at=datetime.fromisoformat(str(p["time"]).replace("Z", "+00:00"))
                    if p.get("time")
                    else datetime.now(timezone.utc),
                    unrealized_pnl=float(p.get("unrealizedProfit") or p.get("profit") or 0.0),
                )
            )
        return out

    async def quote(self, symbol: str) -> Quote:
        price = await self._connection.get_symbol_price(symbol)
        return Quote(symbol=symbol, bid=float(price["bid"]), ask=float(price["ask"]))

    async def open_position(
        self, symbol: str, direction: str, lots: float, stop_loss: float, take_profit: float
    ) -> Position | None:
        try:
            if direction == "long":
                result = await self._connection.create_market_buy_order(
                    symbol, lots, stop_loss, take_profit,
                    {"comment": "fxbot", "clientId": "fxbot"},
                )
            else:
                result = await self._connection.create_market_sell_order(
                    symbol, lots, stop_loss, take_profit,
                    {"comment": "fxbot", "clientId": "fxbot"},
                )
        except Exception as e:  # noqa: BLE001
            log.error("order failed %s %s %.2f lots: %s", direction, symbol, lots, e)
            return None
        log.info("LIVE OPEN %s %s %.2f lots (order %s)", direction.upper(), symbol, lots,
                 result.get("orderId"))
        for p in await self.positions():
            if str(p.id) == str(result.get("positionId", "")):
                return p
        return Position(
            id=str(result.get("positionId") or result.get("orderId")),
            symbol=symbol, direction=direction, lots=lots,
            entry_price=0.0, stop_loss=stop_loss, take_profit=take_profit,
        )

    async def close_position(self, position_id: str) -> bool:
        try:
            await self._connection.close_position(position_id)
            log.info("LIVE CLOSE position %s", position_id)
            return True
        except Exception as e:  # noqa: BLE001
            log.error("close failed for %s: %s", position_id, e)
            return False
