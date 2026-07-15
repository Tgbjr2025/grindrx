from fxbot.config import CostsCfg
from fxbot.costs import edge_clears_costs, estimate_costs, pip_value_usd


def cfg() -> CostsCfg:
    return CostsCfg(
        commission_per_lot_usd=7.0,
        slippage_pips=0.3,
        min_edge_multiple=2.0,
        swap_long_pips_per_day={"EURUSD": -0.55},
        swap_short_pips_per_day={"EURUSD": 0.15},
    )


def test_pip_value_usd_quote():
    assert pip_value_usd("EURUSD", 1.09) == 10.0


def test_pip_value_usd_base():
    v = pip_value_usd("USDJPY", 150.0)
    assert 6.0 < v < 7.5  # 0.01*100000/150 = 6.67


def test_costs_include_all_components():
    cb = estimate_costs(cfg(), "EURUSD", "long", 1.09, spread_pips=0.9, holding_days=1)
    assert cb.spread_pips == 0.9
    assert cb.slippage_pips == 0.6
    assert round(cb.commission_pips, 2) == 0.7
    assert cb.swap_pips > 0  # long EURUSD pays swap
    assert cb.total_pips >= 0.9 + 0.6 + 0.7


def test_edge_gate_blocks_thin_edges():
    cb = estimate_costs(cfg(), "EURUSD", "long", 1.09, spread_pips=0.9, holding_days=1)
    assert not edge_clears_costs(cfg(), expected_move_pips=cb.total_pips * 1.5, costs=cb)
    assert edge_clears_costs(cfg(), expected_move_pips=cb.total_pips * 2.5, costs=cb)


def test_negative_swap_credit_not_counted_as_cost():
    cb = estimate_costs(cfg(), "EURUSD", "short", 1.09, spread_pips=0.9, holding_days=1)
    # short EURUSD earns swap credit; total must not go below hard costs
    assert cb.total_pips >= cb.spread_pips + cb.slippage_pips + cb.commission_pips
