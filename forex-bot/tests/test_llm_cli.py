import json

from fxbot.llm_cli import parse_cli_envelope

DECISION = {
    "market_outlook": "risk-on",
    "decisions": [
        {
            "symbol": "EURUSD", "action": "hold", "confidence": 0.5,
            "expected_move_pips": 0, "stop_loss_pips": 0, "take_profit_pips": 0,
            "holding_days": 0, "reasoning": "no edge",
        }
    ],
}


def test_structured_output_field():
    envelope = json.dumps({"result": "done", "structured_output": DECISION, "usage": {}})
    out = parse_cli_envelope(envelope)
    assert out["market_outlook"] == "risk-on"
    assert out["decisions"][0]["symbol"] == "EURUSD"


def test_result_json_fallback():
    envelope = json.dumps({"result": json.dumps(DECISION)})
    out = parse_cli_envelope(envelope)
    assert out["decisions"][0]["action"] == "hold"


def test_garbage_degrades_to_empty():
    out = parse_cli_envelope("not json at all")
    assert out["decisions"] == []
    assert "market_outlook" in out


def test_content_block_list():
    envelope = json.dumps([{"text": json.dumps(DECISION)}])
    out = parse_cli_envelope(envelope)
    assert out["decisions"][0]["symbol"] == "EURUSD"
