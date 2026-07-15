"""Typed configuration loaded from config.yaml + environment (.env)."""

from __future__ import annotations

import os
from pathlib import Path

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field, model_validator


class EngineCfg(BaseModel):
    cycle_minutes: int = 15
    symbols: list[str] = ["EURUSD"]
    timeframes: list[str] = ["15m", "1h", "4h"]
    candles_per_timeframe: int = 120
    trading_hours_utc: tuple[int, int] = (0, 24)
    avoid_weekend_open_hours: int = 2
    close_all_before_weekend: bool = True


class LLMCfg(BaseModel):
    model: str = "claude-sonnet-5"
    effort: str = "high"
    max_tokens: int = 4096
    min_confidence: float = 0.62
    daily_budget_usd: float = 5.0


class CostsCfg(BaseModel):
    commission_per_lot_usd: float = 7.0
    slippage_pips: float = 0.3
    min_edge_multiple: float = 2.0
    swap_long_pips_per_day: dict[str, float] = {}
    swap_short_pips_per_day: dict[str, float] = {}
    swap_triple_weekday: int = 3


class RiskCfg(BaseModel):
    risk_per_trade_pct: float = 0.5
    max_concurrent_positions: int = 3
    max_positions_per_symbol: int = 1
    max_daily_loss_pct: float = 2.0
    max_drawdown_pct: float = 10.0
    max_lot_size: float = 1.0
    min_stop_distance_atr: float = 1.0
    news_blackout_minutes: int = 30


class PaperCfg(BaseModel):
    starting_balance: float = 10_000.0
    spread_pips: dict[str, float] = {}


class DataCfg(BaseModel):
    economic_calendar_url: str = ""
    news_feeds: list[str] = []
    reddit_subs: list[str] = []
    cross_markets: dict[str, str] = {}


class JournalCfg(BaseModel):
    db_path: str = "fxbot.sqlite3"


class Config(BaseModel):
    mode: str = "paper"
    confirm_live: bool = False
    base_currency: str = "USD"
    engine: EngineCfg = Field(default_factory=EngineCfg)
    llm: LLMCfg = Field(default_factory=LLMCfg)
    costs: CostsCfg = Field(default_factory=CostsCfg)
    risk: RiskCfg = Field(default_factory=RiskCfg)
    paper: PaperCfg = Field(default_factory=PaperCfg)
    data: DataCfg = Field(default_factory=DataCfg)
    journal: JournalCfg = Field(default_factory=JournalCfg)

    # populated from environment
    anthropic_api_key: str = ""
    metaapi_token: str = ""
    metaapi_account_id: str = ""
    notify_webhook_url: str = ""

    @model_validator(mode="after")
    def _check_live(self) -> "Config":
        if self.mode == "live":
            if not self.confirm_live:
                raise ValueError(
                    "mode=live requires confirm_live: true in config.yaml. "
                    "Live trading risks real money - set it deliberately."
                )
            if not (self.metaapi_token and self.metaapi_account_id):
                raise ValueError("mode=live requires METAAPI_TOKEN and METAAPI_ACCOUNT_ID in .env")
        if self.mode not in ("paper", "live"):
            raise ValueError(f"mode must be 'paper' or 'live', got {self.mode!r}")
        return self


def load_config(path: str | Path = "config.yaml") -> Config:
    load_dotenv()
    raw = {}
    p = Path(path)
    if p.exists():
        raw = yaml.safe_load(p.read_text()) or {}
    cfg = Config(**raw)
    cfg.anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    cfg.metaapi_token = os.environ.get("METAAPI_TOKEN", "")
    cfg.metaapi_account_id = os.environ.get("METAAPI_ACCOUNT_ID", "")
    cfg.notify_webhook_url = os.environ.get("NOTIFY_WEBHOOK_URL", "")
    if not cfg.anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY is required (set it in .env)")
    # re-run live checks now that env vars are in
    Config.model_validate(cfg.model_dump())
    return cfg
