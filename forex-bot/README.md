# FXBot — Autonomous Forex Trading Bot

An autonomous forex trading bot that runs 24/5 on a Linux server (built for an
OVH VPS), uses **Claude Sonnet** as its decision engine, and trades a
**trading.com MetaTrader 5 account** through the MetaApi cloud bridge.

Two decision-engine backends (`llm.backend` in `config.yaml`):

- **`claude_cli`** (default) — drives the logged-in **Claude Code CLI** on the
  server (`claude -p --json-schema ...`), so a Claude subscription covers the
  model calls with **no API credits needed**. Known CLI flakes (silent
  crashes, timeouts) are retried automatically.
- **`api`** — the Anthropic API (`claude-sonnet-5`) with structured outputs,
  effort control, and a hard daily spend cap. Needs `ANTHROPIC_API_KEY`.

Every 15 minutes (configurable) it assembles a full market dossier —
multi-timeframe technicals, live spreads, the complete round-trip cost of each
trade, cross-market context (DXY, gold, oil, S&P futures, US 10Y yield, VIX,
BTC), fresh news headlines, the economic calendar, and social-media sentiment —
hands it to Sonnet, and executes only the decisions that survive a hard chain
of cost and risk gates.

## ⚠️ Read this first

- **No trading bot can guarantee profits.** LLM-driven trading is experimental.
  Most retail forex traders lose money; costs and leverage make it worse. Run
  it in paper mode, then on a **demo** account, for weeks before considering
  real funds — and only ever fund it with money you can afford to lose.
- **Paper mode is the default.** Live trading requires *both* MetaApi
  credentials *and* an explicit `confirm_live: true` in the config.
- trading.com has no public trading API — it is an MT5 broker. The supported
  path from Linux is [MetaApi](https://metaapi.cloud), which hosts the MT5
  connection and exposes it to this bot. MetaApi has a free tier for one
  account; check their current pricing.

## How a trade happens

```
Yahoo candles ─┐
News RSS ──────┤
Econ calendar ─┼─► JSON dossier ─► claude-sonnet-5 ─► proposed decisions
Reddit ────────┤       (with full cost breakdown            │
Cross-markets ─┤        per symbol per direction)           ▼
Live spreads ──┘                                   ┌─ gate chain ─────────────┐
                                                   │ 1. confidence ≥ 0.62     │
                                                   │ 2. news blackout window  │
                                                   │ 3. risk limits/killswitch│
                                                   │ 4. stop ≥ 1×ATR sanity   │
                                                   │ 5. edge ≥ 2× ALL costs   │
                                                   └──────────┬───────────────┘
                                                              ▼
                                              position sizing (0.5% equity risk)
                                                              ▼
                                              broker order (paper or MetaApi/MT5)
                                                              ▼
                                                  SQLite journal + webhook alert
```

**Costs are first-class.** For every candidate trade the bot computes
`spread + 2×slippage + commission (converted to pips) + expected overnight
swap for the planned holding period (incl. triple-swap Wednesday)`, and the
model's expected move must exceed `min_edge_multiple` (default 2×) of that
total or the trade is refused — regardless of how confident the model is.

**Safety rails** (all configurable in `config.yaml`):

| Rail | Default |
|---|---|
| Risk per trade | 0.5% of equity, ATR-anchored stop |
| Max concurrent positions | 3 (1 per symbol) |
| Daily loss limit | 2% → no new trades until tomorrow |
| Max drawdown kill switch | 10% → flatten everything, halt until manual reset |
| News blackout | ±30 min around high-impact calendar events |
| Weekend | flatten Friday evening, no weekend trades |
| LLM budget | $5/day hard cap on API spend |

The kill switch and equity peaks persist in SQLite — restarting the process
does **not** reset them. To un-halt after reviewing what happened:
`sqlite3 fxbot.sqlite3 "DELETE FROM meta WHERE key='halted';"`

## Setup on the OVH server

```bash
cd /home/ubuntu/fxbot          # or wherever you place this directory
bash deploy/deploy.sh          # venv, deps, systemd unit
nano .env                      # only needed for api backend / MetaApi creds for live
nano config.yaml               # symbols, risk, costs
.venv/bin/python run.py --once # smoke test: one full cycle in paper mode
sudo systemctl start fxbot
journalctl -u fxbot -f         # watch it work
```

## Going live (only after successful paper + demo runs)

1. Open an MT5 **demo** account at trading.com.
2. Create a [MetaApi](https://metaapi.cloud) account, add the MT5 account
   (server name, login, password), copy the token + account id into `.env`.
3. Set `mode: live` **and** `confirm_live: true` in `config.yaml`, restart.
4. Update `costs:` in the config with your actual account's commission and
   swap rates (shown in MT5 symbol specifications) — the defaults are
   estimates and the cost gate is only as good as these numbers.
5. Repeat with a real account only when the demo track record satisfies you.

## Monitoring

- `journalctl -u fxbot -f` — live log with every decision and gate result.
- `fxbot.sqlite3` — full audit trail: `decisions`, `trades`, `equity`,
  `outlooks` tables.
- Set `NOTIFY_WEBHOOK_URL` (Discord/Slack webhook) in `.env` to get pushed
  trade opens/closes and kill-switch alerts.

## Tests

```bash
.venv/bin/python -m pytest tests/ -q
```

## Layout

```
run.py                    entrypoint (--once for a single smoke-test cycle)
fxbot/engine.py           orchestrator + gate chain
fxbot/llm.py              claude-sonnet-5 decision engine (structured output)
fxbot/costs.py            spread/commission/slippage/swap model + edge gate
fxbot/risk.py             sizing, limits, kill switch
fxbot/broker/paper.py     simulated broker (default)
fxbot/broker/metaapi_broker.py   trading.com MT5 via MetaApi
fxbot/data/market.py      candles, indicators, cross-market context
fxbot/data/news.py        RSS headlines + economic calendar (blackout source)
fxbot/data/sentiment.py   reddit sentiment feed
fxbot/journal.py          SQLite audit trail + persisted safety state
deploy/                   systemd unit + install script
```
