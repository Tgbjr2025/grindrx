"""Trade cost model.

Every candidate trade is priced for ALL round-trip costs before it is allowed:

  total_cost_pips = spread + 2 * slippage + commission (converted to pips)
                    + expected overnight swap for the planned holding period

The engine only opens a trade when the model's expected favourable move covers
`min_edge_multiple` times this cost. If the edge doesn't clear costs, no trade.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from .config import CostsCfg
from .data.market import pip_size

STANDARD_LOT = 100_000


def pip_value_usd(symbol: str, price: float) -> float:
    """USD value of one pip for one standard lot.

    Exact for USD-quoted pairs (EURUSD, GBPUSD... = $10/pip) and USD-base pairs
    (USDJPY, USDCAD... converted at the pair's own price). Crosses would need a
    conversion pair; the majors this bot trades are covered.
    """
    ps = pip_size(symbol)
    quote = symbol[3:6].upper()
    if quote == "USD":
        return ps * STANDARD_LOT  # 10.0
    if symbol[:3].upper() == "USD" and price > 0:
        return ps * STANDARD_LOT / price
    # fallback approximation for unsupported crosses
    return 10.0


@dataclass
class CostBreakdown:
    spread_pips: float
    slippage_pips: float
    commission_pips: float
    swap_pips: float
    total_pips: float

    def to_json(self) -> dict:
        return {
            "spread_pips": round(self.spread_pips, 2),
            "slippage_pips": round(self.slippage_pips, 2),
            "commission_pips": round(self.commission_pips, 2),
            "expected_swap_pips": round(self.swap_pips, 2),
            "total_round_trip_pips": round(self.total_pips, 2),
        }


def expected_swap_pips(
    cfg: CostsCfg, symbol: str, direction: str, holding_days: float, now: datetime | None = None
) -> float:
    """Expected swap cost in pips (positive = cost) over the planned hold."""
    table = cfg.swap_long_pips_per_day if direction == "long" else cfg.swap_short_pips_per_day
    per_day = table.get(symbol.upper(), -0.5)  # pessimistic default
    nights = max(0, round(holding_days))
    now = now or datetime.now(timezone.utc)
    # triple-swap day adds 2 extra nights if the hold spans it
    if nights >= 1 and now.weekday() <= cfg.swap_triple_weekday <= now.weekday() + nights:
        nights += 2
    # per_day is credit(+)/debit(-) from broker's perspective; cost = -credit
    return -per_day * nights


def estimate_costs(
    cfg: CostsCfg,
    symbol: str,
    direction: str,
    price: float,
    spread_pips: float,
    holding_days: float,
) -> CostBreakdown:
    pv = pip_value_usd(symbol, price)
    commission_pips = cfg.commission_per_lot_usd / pv if pv > 0 else 0.7
    swap = expected_swap_pips(cfg, symbol, direction, holding_days)
    total = spread_pips + 2 * cfg.slippage_pips + commission_pips + max(swap, 0.0)
    return CostBreakdown(
        spread_pips=spread_pips,
        slippage_pips=2 * cfg.slippage_pips,
        commission_pips=commission_pips,
        swap_pips=swap,
        total_pips=total,
    )


def edge_clears_costs(cfg: CostsCfg, expected_move_pips: float, costs: CostBreakdown) -> bool:
    return expected_move_pips >= cfg.min_edge_multiple * costs.total_pips
