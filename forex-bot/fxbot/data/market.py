"""Market data: OHLC candles, technical indicators, and cross-market context.

Candles come from Yahoo Finance's public chart API (no key required). Analysis
data does not need broker-grade precision; execution prices always come from
the broker adapter at order time.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx
import numpy as np
import pandas as pd

log = logging.getLogger("fxbot.market")

YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}

# timeframe -> (yahoo interval, yahoo range, resample rule or None)
TF_MAP: dict[str, tuple[str, str, str | None]] = {
    "5m": ("5m", "5d", None),
    "15m": ("15m", "5d", None),
    "1h": ("1h", "1mo", None),
    "4h": ("1h", "3mo", "4h"),
    "1d": ("1d", "1y", None),
}


def yahoo_fx_symbol(symbol: str) -> str:
    """EURUSD -> EURUSD=X"""
    return f"{symbol}=X"


def pip_size(symbol: str) -> float:
    return 0.01 if symbol.upper().endswith("JPY") else 0.0001


@dataclass
class SymbolSnapshot:
    symbol: str
    price: float
    atr_pips: dict[str, float] = field(default_factory=dict)  # per timeframe
    summary: dict[str, Any] = field(default_factory=dict)     # compact JSON for the LLM


async def _fetch_chart(client: httpx.AsyncClient, symbol: str, interval: str, rng: str) -> pd.DataFrame:
    r = await client.get(
        YAHOO_CHART.format(symbol=symbol),
        params={"interval": interval, "range": rng},
        headers=UA,
        timeout=20,
    )
    r.raise_for_status()
    result = r.json()["chart"]["result"][0]
    ts = result.get("timestamp") or []
    quote = result["indicators"]["quote"][0]
    df = pd.DataFrame(
        {
            "open": quote["open"],
            "high": quote["high"],
            "low": quote["low"],
            "close": quote["close"],
        },
        index=pd.to_datetime(ts, unit="s", utc=True),
    ).dropna()
    return df


def _resample(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    return (
        df.resample(rule)
        .agg({"open": "first", "high": "max", "low": "min", "close": "last"})
        .dropna()
    )


def _indicators(df: pd.DataFrame, symbol: str) -> dict[str, Any]:
    close = df["close"]
    ema20 = close.ewm(span=20, adjust=False).mean()
    ema50 = close.ewm(span=50, adjust=False).mean()
    ema200 = close.ewm(span=200, adjust=False).mean()

    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - 100 / (1 + rs)

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    macd_sig = macd.ewm(span=9, adjust=False).mean()

    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - close.shift()).abs(),
            (df["low"] - close.shift()).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = tr.ewm(alpha=1 / 14, adjust=False).mean()

    ps = pip_size(symbol)
    last = float(close.iloc[-1])
    return {
        "last_close": round(last, 5),
        "ema20": round(float(ema20.iloc[-1]), 5),
        "ema50": round(float(ema50.iloc[-1]), 5),
        "ema200": round(float(ema200.iloc[-1]), 5),
        "rsi14": round(float(rsi.iloc[-1]), 1),
        "macd_hist": round(float((macd - macd_sig).iloc[-1]), 6),
        "atr_pips": round(float(atr.iloc[-1]) / ps, 1),
        "change_pct_last_10_bars": round((last / float(close.iloc[-11]) - 1) * 100, 3)
        if len(close) > 11
        else None,
        "high_20": round(float(df["high"].tail(20).max()), 5),
        "low_20": round(float(df["low"].tail(20).min()), 5),
        "recent_closes": [round(float(c), 5) for c in close.tail(20)],
    }


async def get_symbol_snapshot(
    client: httpx.AsyncClient, symbol: str, timeframes: list[str], candles: int
) -> SymbolSnapshot:
    ysym = yahoo_fx_symbol(symbol)
    summary: dict[str, Any] = {}
    atr_pips: dict[str, float] = {}
    price = 0.0
    for tf in timeframes:
        interval, rng, rule = TF_MAP.get(tf, ("1h", "1mo", None))
        try:
            df = await _fetch_chart(client, ysym, interval, rng)
            if rule:
                df = _resample(df, rule)
            df = df.tail(max(candles, 60))
            ind = _indicators(df, symbol)
            summary[tf] = ind
            atr_pips[tf] = ind["atr_pips"]
            price = ind["last_close"]
        except Exception as e:  # noqa: BLE001 - one bad timeframe must not kill the cycle
            log.warning("candles failed for %s %s: %s", symbol, tf, e)
    return SymbolSnapshot(symbol=symbol, price=price, atr_pips=atr_pips, summary=summary)


async def get_cross_markets(client: httpx.AsyncClient, mapping: dict[str, str]) -> dict[str, Any]:
    """Last price + 1-day and 5-day % change for correlated markets."""

    async def one(name: str, ysym: str) -> tuple[str, Any]:
        try:
            df = await _fetch_chart(client, ysym, "1d", "1mo")
            close = df["close"]
            last = float(close.iloc[-1])
            return name, {
                "last": round(last, 4),
                "chg_1d_pct": round((last / float(close.iloc[-2]) - 1) * 100, 2) if len(close) > 1 else None,
                "chg_5d_pct": round((last / float(close.iloc[-6]) - 1) * 100, 2) if len(close) > 5 else None,
            }
        except Exception as e:  # noqa: BLE001
            log.warning("cross-market fetch failed for %s: %s", name, e)
            return name, None

    results = await asyncio.gather(*(one(n, s) for n, s in mapping.items()))
    return {name: data for name, data in results if data}
