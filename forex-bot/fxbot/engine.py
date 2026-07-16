"""The orchestrator: data -> Sonnet decision -> cost gate -> risk gate -> orders.

Cycle (default every 15 min):
  1. Mark positions to market (paper) / refresh account state.
  2. Kill-switch + daily-loss checks (persisted in the journal, restart-proof).
  3. Gather in parallel: candles+indicators, cross-markets, headlines,
     economic calendar, social sentiment, live spreads.
  4. Build one JSON dossier and ask claude-sonnet-5 for decisions.
  5. Every proposed trade must pass, in order: confidence floor, news
     blackout, risk limits, stop-distance sanity, and the cost gate
     (expected move >= min_edge_multiple x full round-trip cost).
  6. Size the position off equity and stop distance, place the order, journal it.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone
from typing import Any

import httpx

from . import costs as costmod
from . import risk as riskmod
from .broker.base import Broker
from .broker.paper import PaperBroker
from .config import Config
from .data import news as newsmod
from .data import sentiment as sentmod
from .data.market import get_cross_markets, get_symbol_snapshot, pip_size
from .journal import Journal
from .llm import DecisionEngine, LLMDecision
from .notify import notify

log = logging.getLogger("fxbot.engine")


class Engine:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.http = httpx.AsyncClient(follow_redirects=True)
        self.journal = Journal(cfg.journal.db_path)
        if cfg.llm.backend == "claude_cli":
            from .llm_cli import CLIDecisionEngine

            self.llm = CLIDecisionEngine(cfg.llm)
        else:
            self.llm = DecisionEngine(cfg.llm, cfg.anthropic_api_key)
        self.broker: Broker
        if cfg.mode == "live":
            from .broker.metaapi_broker import MetaApiBroker

            self.broker = MetaApiBroker(cfg)
        else:
            self.broker = PaperBroker(cfg, self.http)

    # ---------- state helpers ----------

    async def _account_state(self) -> riskmod.AccountState:
        acct = await self.broker.account()
        positions = await self.broker.positions()

        peak = self.journal.get("peak_equity", acct.equity)
        peak = max(peak, acct.equity)
        self.journal.set("peak_equity", peak)

        today = date.today().isoformat()
        if self.journal.get("day") != today:
            self.journal.set("day", today)
            self.journal.set("day_start_equity", acct.equity)
        day_start = self.journal.get("day_start_equity", acct.equity)

        return riskmod.AccountState(
            equity=acct.equity,
            balance=acct.balance,
            peak_equity=peak,
            day_start_equity=day_start,
            open_positions=positions,
        )

    async def _notify(self, msg: str) -> None:
        log.info("NOTIFY: %s", msg)
        await notify(self.http, self.cfg.notify_webhook_url, msg)

    # ---------- dossier ----------

    async def _build_dossier(self, state: riskmod.AccountState,
                             events: list[newsmod.CalendarEvent]) -> dict[str, Any]:
        e = self.cfg.engine
        snapshots, cross, headlines, social = await asyncio.gather(
            asyncio.gather(*(
                get_symbol_snapshot(self.http, s, e.timeframes, e.candles_per_timeframe)
                for s in e.symbols
            )),
            get_cross_markets(self.http, self.cfg.data.cross_markets),
            newsmod.fetch_headlines(self.http, self.cfg.data.news_feeds),
            sentmod.fetch_reddit_titles(self.http, self.cfg.data.reddit_subs),
        )

        symbols_block: dict[str, Any] = {}
        self._live_spreads: dict[str, float] = {}
        for snap in snapshots:
            try:
                q = await self.broker.quote(snap.symbol)
                spread = q.spread_pips(pip_size(snap.symbol))
            except Exception as ex:  # noqa: BLE001
                log.warning("quote failed for %s: %s", snap.symbol, ex)
                spread = self.cfg.paper.spread_pips.get(snap.symbol, 1.5)
            self._live_spreads[snap.symbol] = spread
            cost_long = costmod.estimate_costs(
                self.cfg.costs, snap.symbol, "long", snap.price, spread, holding_days=1.0)
            cost_short = costmod.estimate_costs(
                self.cfg.costs, snap.symbol, "short", snap.price, spread, holding_days=1.0)
            symbols_block[snap.symbol] = {
                "technicals_by_timeframe": snap.summary,
                "live_spread_pips": round(spread, 2),
                "round_trip_cost_if_long_1day": cost_long.to_json(),
                "round_trip_cost_if_short_1day": cost_short.to_json(),
            }

        return {
            "utc_now": datetime.now(timezone.utc).isoformat(),
            "account": {
                "equity": round(state.equity, 2),
                "balance": round(state.balance, 2),
                "daily_loss_pct": round(riskmod.daily_loss_pct(state), 2),
                "drawdown_from_peak_pct": round(riskmod.drawdown_pct(state), 2),
                "risk_limits": {
                    "risk_per_trade_pct": self.cfg.risk.risk_per_trade_pct,
                    "max_daily_loss_pct": self.cfg.risk.max_daily_loss_pct,
                    "max_concurrent_positions": self.cfg.risk.max_concurrent_positions,
                    "min_edge_multiple_over_costs": self.cfg.costs.min_edge_multiple,
                },
            },
            "open_positions": [
                {
                    "symbol": p.symbol, "direction": p.direction, "lots": p.lots,
                    "entry_price": p.entry_price, "stop_loss": p.stop_loss,
                    "take_profit": p.take_profit, "unrealized_pnl_usd": round(p.unrealized_pnl, 2),
                    "opened_at": p.opened_at.isoformat(),
                }
                for p in state.open_positions
            ],
            "symbols": symbols_block,
            "cross_markets": cross,
            "economic_calendar_next_48h": [ev.to_json() for ev in newsmod.upcoming_events(events)],
            "news_headlines": headlines,
            "social_sentiment_raw": social,
        }

    # ---------- decision execution ----------

    async def _execute(self, d: LLMDecision, state: riskmod.AccountState,
                       events: list[newsmod.CalendarEvent]) -> str:
        """Run all gates; return a human-readable gate result for the journal."""
        symbol = d.symbol.upper()
        if symbol not in self.cfg.engine.symbols:
            return "rejected: unknown symbol"

        if d.action == "hold":
            return "hold"

        if d.action == "close":
            closed = 0
            for p in state.open_positions:
                if p.symbol == symbol:
                    if await self.broker.close_position(p.id):
                        self.journal.record_close(p.id, getattr(p, "unrealized_pnl", None))
                        closed += 1
            if closed:
                await self._notify(f"Closed {closed} position(s) on {symbol}: {d.reasoning[:180]}")
            return f"closed {closed} position(s)"

        # ----- open_long / open_short -----
        direction = "long" if d.action == "open_long" else "short"

        if d.confidence < self.cfg.llm.min_confidence:
            return f"rejected: confidence {d.confidence:.2f} < {self.cfg.llm.min_confidence}"

        blocking = newsmod.in_news_blackout(events, symbol, self.cfg.risk.news_blackout_minutes)
        if blocking:
            return f"rejected: news blackout ({blocking.currency} {blocking.title})"

        verdict = riskmod.can_open(self.cfg, state, symbol)
        if not verdict.allowed:
            return f"rejected: {verdict.reason}"

        try:
            q = await self.broker.quote(symbol)
        except Exception as ex:  # noqa: BLE001
            return f"rejected: no quote ({ex})"
        price = q.ask if direction == "long" else q.bid
        ps = pip_size(symbol)

        # stop distance sanity vs ATR
        atr_1h = 10.0
        snap_atrs = getattr(self, "_atr_cache", {}).get(symbol)
        if snap_atrs:
            atr_1h = snap_atrs.get("1h") or next(iter(snap_atrs.values()), 10.0)
        min_stop = self.cfg.risk.min_stop_distance_atr * atr_1h
        stop_pips = max(d.stop_loss_pips, min_stop)
        tp_pips = max(d.take_profit_pips, stop_pips)  # never worse than 1:1

        # cost gate with the model's own holding estimate and live spread
        spread = self._live_spreads.get(symbol, 1.5)
        cb = costmod.estimate_costs(self.cfg.costs, symbol, direction, price, spread,
                                    holding_days=max(d.holding_days, 0.1))
        if not costmod.edge_clears_costs(self.cfg.costs, d.expected_move_pips, cb):
            return (f"rejected: edge {d.expected_move_pips:.1f}p < "
                    f"{self.cfg.costs.min_edge_multiple}x costs ({cb.total_pips:.1f}p)")

        lots = riskmod.position_size_lots(self.cfg, state.equity, symbol, price, stop_pips)
        if lots < 0.01:
            return "rejected: computed size below broker minimum (0.01 lots)"

        sl = price - stop_pips * ps if direction == "long" else price + stop_pips * ps
        tp = price + tp_pips * ps if direction == "long" else price - tp_pips * ps

        pos = await self.broker.open_position(symbol, direction, lots, round(sl, 5), round(tp, 5))
        if not pos:
            return "rejected: broker order failed"
        self.journal.record_open(pos)
        state.open_positions.append(pos)
        await self._notify(
            f"OPENED {direction.upper()} {symbol} {lots} lots @ ~{price:.5f} "
            f"(sl {stop_pips:.0f}p / tp {tp_pips:.0f}p, conf {d.confidence:.2f}, "
            f"costs {cb.total_pips:.1f}p). {d.reasoning[:200]}"
        )
        return f"OPENED {direction} {lots} lots"

    # ---------- main loop ----------

    async def run_cycle(self) -> None:
        if self.cfg.mode == "paper":
            for closed in await self.broker.mark_to_market():  # type: ignore[attr-defined]
                self.journal.record_close(closed.id)

        state = await self._account_state()
        self.journal.snapshot_equity(state.balance, state.equity)

        # restart-proof kill switch
        if self.journal.get("halted"):
            log.error("bot is HALTED (kill switch tripped earlier). Manual reset required: "
                      "delete the 'halted' key from the meta table after reviewing.")
            return
        if riskmod.kill_switch_tripped(self.cfg, state):
            await self.broker.close_all()
            self.journal.set("halted", True)
            await self._notify(
                f"🛑 KILL SWITCH: drawdown {riskmod.drawdown_pct(state):.1f}% >= "
                f"{self.cfg.risk.max_drawdown_pct}%. All positions closed, bot halted."
            )
            return

        # Friday flatten
        now = datetime.now(timezone.utc)
        if (self.cfg.engine.close_all_before_weekend and now.weekday() == 4
                and now.hour >= 21 - self.cfg.engine.avoid_weekend_open_hours
                and state.open_positions):
            await self.broker.close_all()
            for p in state.open_positions:
                self.journal.record_close(p.id, getattr(p, "unrealized_pnl", None))
            await self._notify("Weekend approaching - flattened all positions.")
            state.open_positions = []

        events = await newsmod.fetch_calendar(self.http, self.cfg.data.economic_calendar_url)
        dossier = await self._build_dossier(state, events)
        self._atr_cache = {
            s: dossier["symbols"][s]["technicals_by_timeframe"]
            and {tf: v.get("atr_pips") for tf, v in dossier["symbols"][s]["technicals_by_timeframe"].items()}
            for s in dossier["symbols"]
        }

        result = await self.llm.decide(dossier)
        if result is None:
            return
        self.journal.record_outlook(result.outlook, result.cost_usd)
        log.info("outlook: %s (LLM cost $%.4f, today $%.2f)",
                 result.outlook, result.cost_usd, self.llm.spend_today)

        for d in result.decisions:
            try:
                gate = await self._execute(d, state, events)
            except Exception as ex:  # noqa: BLE001
                log.exception("decision execution failed for %s", d.symbol)
                gate = f"error: {ex}"
            self.journal.record_decision(
                d.symbol, d.action, d.confidence, d.expected_move_pips, d.reasoning, gate)
            log.info("decision %s %s conf=%.2f -> %s", d.symbol, d.action, d.confidence, gate)

    async def run_forever(self) -> None:
        await self.broker.connect()
        mode_banner = "PAPER (simulated)" if self.cfg.mode == "paper" else "LIVE (REAL MONEY)"
        log.info("FXBot starting in %s mode; cycle every %d min; symbols: %s",
                 mode_banner, self.cfg.engine.cycle_minutes, ", ".join(self.cfg.engine.symbols))
        await self._notify(f"FXBot started in {mode_banner} mode.")
        while True:
            try:
                await self.run_cycle()
            except Exception:  # noqa: BLE001
                log.exception("cycle failed; continuing")
            await asyncio.sleep(self.cfg.engine.cycle_minutes * 60)
