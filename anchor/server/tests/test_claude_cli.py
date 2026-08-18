"""Claude CLI bridge: tool_call protocol, CLI invocation, full loop round-trip."""

import json
from datetime import timedelta

import pytest

from anchor_server import config, db, ingest, timeutil
from anchor_server.agent import brain, claude_cli, tools
from anchor_server.agent.claude_cli import (
    ClaudeCLIClient,
    ClaudeCLIError,
    build_tool_prompt,
    parse_tool_calls,
)


def test_tool_prompt_lists_all_anchor_tools():
    prompt = build_tool_prompt(tools.TOOL_DEFINITIONS)
    for t in tools.TOOL_DEFINITIONS:
        assert f"- {t['name']}:" in prompt
    assert "```tool_call" in prompt
    assert "source_artifact_id (required)" in prompt  # required params marked


def test_parse_single_tool_call():
    text = (
        "I'll check the calendar first.\n"
        "```tool_call\n"
        '{"name": "calendar_read", "arguments": {"start": "2026-08-18T00:00:00", "end": "2026-08-19T00:00:00"}}\n'
        "```"
    )
    remaining, calls = parse_tool_calls(text)
    assert remaining == "I'll check the calendar first."
    assert len(calls) == 1
    assert calls[0]["name"] == "calendar_read"
    assert calls[0]["input"]["start"] == "2026-08-18T00:00:00"
    assert calls[0]["id"].startswith("toolu_cli_")


def test_parse_multiple_and_malformed():
    text = (
        "```tool_call\n{\"name\": \"contact_lookup\", \"arguments\": {\"name\": \"Sarah\"}}\n```\n"
        "```tool_call\nnot json at all\n```\n"
        "```tool_call\n{\"name\": \"notify\", \"arguments\": {\"title\": \"t\", \"message\": \"m\"}}\n```"
    )
    _, calls = parse_tool_calls(text)
    assert [c["name"] for c in calls] == ["contact_lookup", "notify"]


def test_parse_plain_text_is_end_turn():
    remaining, calls = parse_tool_calls("All done. Nothing to schedule.")
    assert calls == []
    assert remaining == "All done. Nothing to schedule."


def test_run_cli_success(monkeypatch):
    captured = {}

    class FakeProc:
        returncode = 0
        stdout = json.dumps({"result": "hello from cli", "is_error": False})
        stderr = ""

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["input"] = kwargs.get("input")
        return FakeProc()

    monkeypatch.setattr(claude_cli.subprocess, "run", fake_run)
    out = claude_cli.run_cli("the prompt", "the system", "claude-sonnet-4-6")
    assert out == "hello from cli"
    assert captured["cmd"][0] == config.CLAUDE_CLI_BIN
    assert "-p" in captured["cmd"]
    assert "--append-system-prompt" in captured["cmd"]
    assert captured["input"] == "the prompt"
    # Anchor's tool layer is the only actuator: CLI tools disabled.
    i = captured["cmd"].index("--disallowedTools")
    assert captured["cmd"][i + 1] == "*"


def test_run_cli_failures(monkeypatch):
    class BadProc:
        returncode = 1
        stdout = ""
        stderr = "boom"

    monkeypatch.setattr(claude_cli.subprocess, "run", lambda *a, **k: BadProc())
    with pytest.raises(ClaudeCLIError, match="exited 1"):
        claude_cli.run_cli("p", "s", "m")

    class ErrProc:
        returncode = 0
        stdout = json.dumps({"is_error": True, "result": "credit exhausted"})
        stderr = ""

    monkeypatch.setattr(claude_cli.subprocess, "run", lambda *a, **k: ErrProc())
    with pytest.raises(ClaudeCLIError, match="reported an error"):
        claude_cli.run_cli("p", "s", "m")

    def missing(*a, **k):
        raise FileNotFoundError("claude")

    monkeypatch.setattr(claude_cli.subprocess, "run", missing)
    with pytest.raises(ClaudeCLIError, match="not found"):
        claude_cli.run_cli("p", "s", "m")


def test_default_backend_is_claude_cli(monkeypatch):
    monkeypatch.setattr(brain, "_client", None)
    assert config.LLM_BACKEND == "claude_cli"
    client = brain._get_client()
    assert isinstance(client, ClaudeCLIClient)
    monkeypatch.setattr(brain, "_client", None)  # don't leak into other tests


def test_full_artifact_turn_through_cli_bridge(tmp_path, monkeypatch):
    """End-to-end: brain loop → CLI client → tool_call parse → real tool →
    tool result rendered back into the next CLI prompt."""
    f = tmp_path / "Call recording PT Office_260812_100000.m4a"
    f.write_bytes(b"cli-bridge-call")
    art = ingest.ingest_file(f, f.name, "call")["artifact_id"]
    db.execute(
        "UPDATE artifacts SET transcript='see you Thursday at ten', status='transcribed' WHERE id=?",
        (art,),
    )
    start = timeutil.iso(timeutil.now_local() + timedelta(days=3))

    responses = [
        # Turn 1: the model calls calendar_write via the tool_call protocol.
        "Booking it now.\n```tool_call\n"
        + json.dumps({
            "name": "calendar_write",
            "arguments": {
                "action": "create",
                "title": "Physical therapy",
                "start": start,
                "source_artifact_id": art,
                "source_quote": "see you Thursday at ten",
            },
        })
        + "\n```",
        # Turn 2: plain text → end_turn.
        "Booked PT for Thursday and notified you.",
    ]
    prompts = []

    def fake_run_cli(prompt, system, model):
        prompts.append((prompt, system, model))
        return responses.pop(0)

    monkeypatch.setattr(claude_cli, "run_cli", fake_run_cli)
    monkeypatch.setattr(brain, "_client", None)
    try:
        summary = brain.run_artifact_turn(art)
    finally:
        monkeypatch.setattr(brain, "_client", None)

    assert summary == "Booked PT for Thursday and notified you."
    event = db.q1("SELECT * FROM events WHERE source_artifact_id=?", (art,))
    assert event is not None and event["title"] == "Physical therapy"
    # Second CLI call saw the tool result of the first.
    second_prompt = prompts[1][0]
    assert "[TOOL RESULT for toolu_cli_" in second_prompt
    assert '"result": "created"' in second_prompt
    # System prompt carried the tool schemas both times.
    assert "[AVAILABLE TOOLS]" in prompts[0][1]
    assert prompts[0][2] == config.AGENT_MODEL


def test_run_cli_retries_transient_then_succeeds(monkeypatch):
    attempts = []

    def flaky(prompt, system, model):
        attempts.append(1)
        if len(attempts) == 1:
            raise ClaudeCLIError("Claude CLI exited 1: transient")
        return "recovered"

    monkeypatch.setattr(claude_cli, "_run_cli_once", flaky)
    assert claude_cli.run_cli("p", "s", "m") == "recovered"
    assert len(attempts) == 2


def test_run_cli_no_retry_on_missing_binary(monkeypatch):
    attempts = []

    def missing(prompt, system, model):
        attempts.append(1)
        raise ClaudeCLIError("Claude CLI not found at 'claude'.")

    monkeypatch.setattr(claude_cli, "_run_cli_once", missing)
    with pytest.raises(ClaudeCLIError, match="not found"):
        claude_cli.run_cli("p", "s", "m")
    assert len(attempts) == 1


def test_worker_startup_alerts_on_missing_cli(monkeypatch):
    import shutil as _shutil

    from anchor_server import worker

    monkeypatch.setattr(_shutil, "which", lambda _: None)
    worker.check_llm_backend()
    pushes = db.q("SELECT * FROM outbox WHERE channel='ntfy'")
    assert any("backend unavailable" in p["payload"] for p in pushes)
