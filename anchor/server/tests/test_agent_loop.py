"""Agent loop with a scripted fake Anthropic client — no network."""

import json
from datetime import timedelta
from types import SimpleNamespace

from anchor_server import db, ingest, timeutil
from anchor_server.agent import brain


class Block(SimpleNamespace):
    def model_dump(self):
        return dict(vars(self))


class FakeClient:
    """Yields scripted responses; records the requests it receives."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.requests = []
        self.messages = self  # so client.messages.create resolves here

    def create(self, **kwargs):
        import copy

        # Snapshot: brain mutates the messages list after the call.
        self.requests.append(copy.deepcopy(kwargs))
        return self._responses.pop(0)


def _response(blocks, stop_reason):
    return SimpleNamespace(content=blocks, stop_reason=stop_reason)


def test_artifact_turn_dispatches_tools_and_stores_summary(tmp_path, monkeypatch):
    f = tmp_path / "Call recording PT Office_260812_100000.m4a"
    f.write_bytes(b"pt-office-call")
    art = ingest.ingest_file(f, f.name, "call")["artifact_id"]
    db.execute(
        "UPDATE artifacts SET transcript='we have you down for Thursday at ten', status='transcribed' WHERE id=?",
        (art,),
    )

    start = timeutil.iso(timeutil.now_local() + timedelta(days=2))
    fake = FakeClient(
        [
            _response(
                [
                    Block(type="tool_use", id="tu_1", name="calendar_write",
                          input={
                              "action": "create",
                              "title": "Physical therapy",
                              "start": start,
                              "source_artifact_id": art,
                              "source_quote": "we have you down for Thursday at ten",
                          })
                ],
                "tool_use",
            ),
            _response([Block(type="text", text="Booked PT and notified you.")], "end_turn"),
        ]
    )
    monkeypatch.setattr(brain, "_get_client", lambda: fake)

    summary = brain.run_artifact_turn(art)
    assert summary == "Booked PT and notified you."
    # The tool actually ran: event exists with provenance.
    event = db.q1("SELECT * FROM events WHERE source_artifact_id=?", (art,))
    assert event is not None and event["title"] == "Physical therapy"
    # Artifact finalized.
    a = db.q1("SELECT * FROM artifacts WHERE id=?", (art,))
    assert a["status"] == "processed"
    assert a["agent_summary"] == "Booked PT and notified you."
    # Full message log kept for audit.
    run = db.q1("SELECT * FROM agent_runs WHERE artifact_id=?", (art,))
    transcript = json.loads(run["transcript"])
    assert any(m["role"] == "assistant" for m in transcript)
    # Tool result fed back to the model on the second request.
    second_request = fake.requests[1]
    tool_results = second_request["messages"][-1]["content"]
    assert tool_results[0]["type"] == "tool_result"
    assert not tool_results[0].get("is_error")


def test_tool_error_is_reported_to_model_not_raised(tmp_path, monkeypatch):
    f = tmp_path / "note2.txt"
    f.write_bytes(b"hello")
    art = ingest.ingest_file(f, f.name, "note", text_body="hello")["artifact_id"]

    fake = FakeClient(
        [
            _response(
                [Block(type="tool_use", id="tu_1", name="task_close",
                       input={"task_id": 424242, "reason": "done"})],
                "tool_use",
            ),
            _response([Block(type="text", text="That task does not exist.")], "end_turn"),
        ]
    )
    monkeypatch.setattr(brain, "_get_client", lambda: fake)
    summary = brain.run_artifact_turn(art)
    assert "does not exist" in summary
    tool_results = fake.requests[1]["messages"][-1]["content"]
    assert tool_results[0]["is_error"] is True


def test_iteration_cap_is_loud(tmp_path, monkeypatch):
    f = tmp_path / "note3.txt"
    f.write_bytes(b"loop")
    art = ingest.ingest_file(f, f.name, "note", text_body="loop")["artifact_id"]

    looping = [
        _response(
            [Block(type="tool_use", id=f"tu_{i}", name="contact_lookup", input={"name": "x"})],
            "tool_use",
        )
        for i in range(100)
    ]
    fake = FakeClient(looping)
    monkeypatch.setattr(brain, "_get_client", lambda: fake)
    monkeypatch.setattr(brain.config, "AGENT_MAX_ITERATIONS", 3)
    summary = brain.run_artifact_turn(art)
    assert "iteration cap" in summary
    assert db.q1("SELECT * FROM audit_log WHERE action='run.iteration_cap'") is not None
