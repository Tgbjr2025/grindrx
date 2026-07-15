"""Risk management: position sizing, exposure limits, loss limits, kill switch."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from .config import Config
from .costs import pip_value_usd

log = logging.getLogger("fxbot.risk")


@dataclass
class AccountState:
    equity: float
    balance: float
    peak_equity: float
    day_start_equity: float
    open_positions: list  # broker Position objects


@dataclass
class RiskVerdict:
    allowed: bool
    reason: str = ""


def position_size_lots(cfg: Config, equity: float, symbol: str, price: float, stop_pips: float) -> float:
    """Fixed-fractional sizing: risk `risk_per_trade_pct` of equity to the stop."""
    if stop_pips <= 0 or price <= 0:
        return 0.0
    risk_usd = equity * cfg.risk.risk_per_trade_pct / 100.0
    pv = pip_value_usd(symbol, price)
    lots = risk_usd / (stop_pips * pv)
    lots = min(lots, cfg.risk.max_lot_size)
    return max(round(lots, 2), 0.0)


def daily_loss_pct(state: AccountState) -> float:
    if state.day_start_equity <= 0:
        return 0.0
    return max(0.0, (state.day_start_equity - state.equity) / state.day_start_equity * 100.0)


def drawdown_pct(state: AccountState) -> float:
    if state.peak_equity <= 0:
        return 0.0
    return max(0.0, (state.peak_equity - state.equity) / state.peak_equity * 100.0)


def kill_switch_tripped(cfg: Config, state: AccountState) -> bool:
    return drawdown_pct(state) >= cfg.risk.max_drawdown_pct


def can_open(cfg: Config, state: AccountState, symbol: str) -> RiskVerdict:
    """All pre-trade gates except the news blackout (checked by the engine)."""
    if kill_switch_tripped(cfg, state):
        return RiskVerdict(False, f"KILL SWITCH: drawdown {drawdown_pct(state):.1f}% >= {cfg.risk.max_drawdown_pct}%")
    if daily_loss_pct(state) >= cfg.risk.max_daily_loss_pct:
        return RiskVerdict(False, f"daily loss limit hit ({daily_loss_pct(state):.1f}%)")
    if len(state.open_positions) >= cfg.risk.max_concurrent_positions:
        return RiskVerdict(False, "max concurrent positions reached")
    per_symbol = sum(1 for p in state.open_positions if getattr(p, "symbol", "") == symbol)
    if per_symbol >= cfg.risk.max_positions_per_symbol:
        return RiskVerdict(False, f"max positions for {symbol} reached")

    now = datetime.now(timezone.utc)
    start_h, end_h = cfg.engine.trading_hours_utc
    if not (start_h <= now.hour < end_h):
        return RiskVerdict(False, f"outside trading hours ({start_h}-{end_h} UTC)")

    # avoid opening right before the weekend (FX closes ~Fri 21:00-22:00 UTC)
    if now.weekday() == 4:  # Friday
        hours_to_close = 21 - now.hour
        if hours_to_close <= cfg.engine.avoid_weekend_open_hours:
            return RiskVerdict(False, "too close to weekend market close")
    if now.weekday() >= 5:
        return RiskVerdict(False, "market closed (weekend)")

    return RiskVerdict(True)
