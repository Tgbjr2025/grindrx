"""Broker abstraction. The engine talks only to this interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Position:
    id: str
    symbol: str
    direction: str  # long | short
    lots: float
    entry_price: float
    stop_loss: float
    take_profit: float
    opened_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    unrealized_pnl: float = 0.0


@dataclass
class AccountInfo:
    balance: float
    equity: float
    currency: str = "USD"


@dataclass
class Quote:
    symbol: str
    bid: float
    ask: float

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2

    def spread_pips(self, pip: float) -> float:
        return (self.ask - self.bid) / pip


class Broker(ABC):
    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def account(self) -> AccountInfo: ...

    @abstractmethod
    async def positions(self) -> list[Position]: ...

    @abstractmethod
    async def quote(self, symbol: str) -> Quote: ...

    @abstractmethod
    async def open_position(
        self, symbol: str, direction: str, lots: float, stop_loss: float, take_profit: float
    ) -> Position | None: ...

    @abstractmethod
    async def close_position(self, position_id: str) -> bool: ...

    async def close_all(self) -> None:
        for p in await self.positions():
            await self.close_position(p.id)
