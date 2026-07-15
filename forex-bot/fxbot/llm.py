"""Claude Sonnet decision engine.

Receives one compact JSON dossier per cycle (technicals per timeframe, live
costs, cross-market moves, news headlines, economic calendar, social sentiment,
open positions, account state) and returns schema-validated trade decisions.

Structured outputs (`output_config.format`) guarantee parseable JSON. The
model is only an *advisor*: everything it proposes still has to pass the cost
gate and the risk manager before an order is sent.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date
from typing import Any

from anthropic import AsyncAnthropic

from .config import LLMCfg

log = logging.getLogger("fxbot.llm")

# claude-sonnet-5 pricing (standard sticker, USD per 1M tokens)
PRICE_IN = 3.00
PRICE_OUT = 15.00

DECISION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "market_outlook": {
            "type": "string",
            "description": "2-4 sentence synthesis of the macro/news/technical picture",
        },
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "action": {
                        "type": "string",
                        "enum": ["open_long", "open_short", "close", "hold"],
                    },
                    "confidence": {
                        "type": "number",
                        "description": "0.0-1.0 probability the trade thesis plays out",
                    },
                    "expected_move_pips": {
                        "type": "number",
                        "description": "expected favourable move in pips if thesis is right",
                    },
                    "stop_loss_pips": {"type": "number"},
                    "take_profit_pips": {"type": "number"},
                    "holding_days": {
                        "type": "number",
                        "description": "expected holding period in days (0.2 = a few hours)",
                    },
                    "reasoning": {"type": "string"},
                },
                "required": [
                    "symbol",
                    "action",
                    "confidence",
                    "expected_move_pips",
                    "stop_loss_pips",
                    "take_profit_pips",
                    "holding_days",
                    "reasoning",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["market_outlook", "decisions"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """\
You are the decision engine of an autonomous forex trading bot running on live \
market data. You receive a JSON dossier with, for each tradable symbol: \
multi-timeframe technicals, the full round-trip cost of trading it, correlated \
cross-market moves (DXY, gold, oil, equities, yields, VIX, BTC), fresh news \
headlines, the economic calendar, social-media sentiment, the account state \
and currently open positions.

Rules you must follow:
- Costs are real. Only propose open_long/open_short when the expected \
favourable move comfortably exceeds the listed total_round_trip_pips - the \
harness enforces a hard multiple on top of your judgment.
- Be selective. "hold" on every symbol is a perfectly good answer; most \
15-minute cycles contain no edge. Overtrading loses money through costs.
- Respect event risk: avoid opening positions right before High-impact \
calendar events for either currency in a pair; consider closing exposed \
positions ahead of major events.
- stop_loss_pips must be sensible versus the ATR listed for the symbol \
(roughly 1-3x the 1h ATR) and take_profit_pips should give a reward:risk \
ratio of at least 1.5 unless there is a strong reason otherwise.
- For open positions you may propose "close" when the thesis is invalidated, \
event risk looms, or the weekend approaches.
- confidence must be your honest calibrated probability, not enthusiasm. \
Below 0.6 the harness will not act.
- Weigh ALL provided context: technicals, macro news, world events, central \
bank expectations, cross-market risk sentiment and positioning chatter. \
Contradictory signals lower confidence.
"""


@dataclass
class LLMDecision:
    symbol: str
    action: str
    confidence: float
    expected_move_pips: float
    stop_loss_pips: float
    take_profit_pips: float
    holding_days: float
    reasoning: str


@dataclass
class LLMResult:
    outlook: str
    decisions: list[LLMDecision]
    cost_usd: float


class DecisionEngine:
    def __init__(self, cfg: LLMCfg, api_key: str):
        self.cfg = cfg
        self.client = AsyncAnthropic(api_key=api_key)
        self._spend_day: date = date.today()
        self._spend_usd: float = 0.0

    @property
    def spend_today(self) -> float:
        if date.today() != self._spend_day:
            self._spend_day = date.today()
            self._spend_usd = 0.0
        return self._spend_usd

    def budget_exhausted(self) -> bool:
        return self.spend_today >= self.cfg.daily_budget_usd

    async def decide(self, dossier: dict[str, Any]) -> LLMResult | None:
        if self.budget_exhausted():
            log.warning("daily LLM budget exhausted ($%.2f) - skipping cycle", self.spend_today)
            return None

        response = await self.client.messages.create(
            model=self.cfg.model,
            max_tokens=self.cfg.max_tokens,
            system=SYSTEM_PROMPT,
            output_config={
                "effort": self.cfg.effort,
                "format": {"type": "json_schema", "schema": DECISION_SCHEMA},
            },
            messages=[
                {
                    "role": "user",
                    "content": "Market dossier:\n" + json.dumps(dossier, default=str)
                    + "\n\nReturn your trading decisions.",
                }
            ],
        )

        cost = (
            response.usage.input_tokens * PRICE_IN
            + response.usage.output_tokens * PRICE_OUT
        ) / 1_000_000
        _ = self.spend_today  # roll the day if needed
        self._spend_usd += cost

        if response.stop_reason == "refusal":
            log.warning("model refused the request; treating as no-op cycle")
            return LLMResult(outlook="(refusal)", decisions=[], cost_usd=cost)
        if response.stop_reason == "max_tokens":
            log.warning("response truncated at max_tokens; ignoring this cycle")
            return LLMResult(outlook="(truncated)", decisions=[], cost_usd=cost)

        text = "".join(b.text for b in response.content if b.type == "text")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            log.error("model returned unparseable JSON despite schema; skipping cycle")
            return LLMResult(outlook="(parse error)", decisions=[], cost_usd=cost)

        decisions = [LLMDecision(**d) for d in data.get("decisions", [])]
        return LLMResult(outlook=data.get("market_outlook", ""), decisions=decisions, cost_usd=cost)
