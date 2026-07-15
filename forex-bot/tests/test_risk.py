from fxbot.config import Config
from fxbot.risk import (
    AccountState,
    can_open,
    daily_loss_pct,
    drawdown_pct,
    kill_switch_tripped,
    position_size_lots,
)


def cfg() -> Config:
    c = Config()
    c.anthropic_api_key = "test"
    return c


def state(equity=10_000, peak=10_000, day_start=10_000, positions=None) -> AccountState:
    return AccountState(
        equity=equity, balance=equity, peak_equity=peak,
        day_start_equity=day_start, open_positions=positions or [],
    )


def test_position_sizing():
    # 0.5% of 10k = $50 risk; 25 pip stop on EURUSD ($10/pip/lot) -> 0.2 lots
    lots = position_size_lots(cfg(), 10_000, "EURUSD", 1.09, stop_pips=25)
    assert lots == 0.2


def test_position_sizing_capped():
    c = cfg()
    c.risk.max_lot_size = 0.5
    lots = position_size_lots(c, 1_000_000, "EURUSD", 1.09, stop_pips=10)
    assert lots == 0.5


def test_kill_switch():
    assert kill_switch_tripped(cfg(), state(equity=8_900, peak=10_000))  # 11% dd
    assert not kill_switch_tripped(cfg(), state(equity=9_500, peak=10_000))


def test_daily_loss_blocks_new_trades():
    s = state(equity=9_700, day_start=10_000)  # -3% on the day (limit 2%)
    assert daily_loss_pct(s) == 3.0
    v = can_open(cfg(), s, "EURUSD")
    assert not v.allowed


def test_drawdown_pct():
    assert drawdown_pct(state(equity=9_000, peak=10_000)) == 10.0
