"""Claude CLI bridge — run agent turns through the local `claude` CLI
(subscription auth) instead of the Anthropic API key.

Ported from the Phoenix agent's bridge design (apex_dominus/llm/tool_shim.py):
tool schemas are injected into the prompt and the model emits ```tool_call
JSON blocks, which we parse back into tool_use blocks. The class exposes the
same `client.messages.create(...)` surface and response shape as the
Anthropic SDK, so brain.py works identically on either backend.

Each create() call is stateless: the full conversation (system, tools, every
turn including tool results) is rendered into one `claude -p` invocation.
That costs repeated context but keeps the durable-queue semantics — a crashed
turn re-runs cleanly with no CLI session state to lose.
"""

from __future__ import annotations

import json
import re
import subprocess
import uuid
from types import SimpleNamespace
from typing import Any

from .. import config


class ClaudeCLIError(RuntimeError):
    """CLI invocation failed. Bubbles into the job queue's retry/fail-loud path."""


class _Block(SimpleNamespace):
    def model_dump(self) -> dict[str, Any]:
        return dict(vars(self))


_TOOL_CALL_RE = re.compile(r"```tool_call\s*(\{.*?\})\s*```", re.DOTALL)


def build_tool_prompt(tools: list[dict[str, Any]]) -> str:
    """Render Anthropic tool schemas into the Phoenix tool_call protocol."""
    lines = [
        "[AVAILABLE TOOLS]",
        "You have access to the following tools. To call a tool, output a JSON block like this:",
        "",
        "```tool_call",
        '{"name": "tool_name", "arguments": {"param1": "value1"}}',
        "```",
        "",
        "You can call multiple tools by outputting multiple ```tool_call blocks.",
        "After outputting tool calls, STOP and wait for results.",
        "When you're done and have no more tools to call, just respond normally"
        " (no tool_call blocks).",
        "",
        "Tools:",
    ]
    for tool in tools:
        lines.append(f"- {tool['name']}: {tool.get('description', '')}")
        schema = tool.get("input_schema", {})
        props = schema.get("properties", {})
        required = set(schema.get("required", []))
        for pname, pdef in props.items():
            req = " (required)" if pname in required else ""
            desc = pdef.get("description", "")
            enum = f" one of {pdef['enum']}" if "enum" in pdef else ""
            lines.append(f"    - {pname}{req}: {pdef.get('type', 'any')}{enum} {desc}".rstrip())
    return "\n".join(lines)


def _render_conversation(messages: list[dict[str, Any]]) -> str:
    """Flatten the API-shaped message list into a plain transcript."""
    out: list[str] = []
    for msg in messages:
        content = msg["content"]
        if isinstance(content, str):
            out.append(f"[{msg['role'].upper()}]\n{content}")
            continue
        for block in content:
            b = block if isinstance(block, dict) else vars(block)
            btype = b.get("type")
            if btype == "text":
                out.append(f"[{msg['role'].upper()}]\n{b['text']}")
            elif btype == "tool_use":
                out.append(
                    "[ASSISTANT tool_call "
                    + b.get("id", "")
                    + "]\n```tool_call\n"
                    + json.dumps({"name": b["name"], "arguments": b["input"]})
                    + "\n```"
                )
            elif btype == "tool_result":
                flag = " (ERROR)" if b.get("is_error") else ""
                out.append(f"[TOOL RESULT for {b['tool_use_id']}{flag}]\n{b['content']}")
    return "\n\n".join(out)


def parse_tool_calls(text: str) -> tuple[str, list[dict[str, Any]]]:
    """Extract ```tool_call blocks; returns (remaining_text, calls)."""
    calls: list[dict[str, Any]] = []
    for m in _TOOL_CALL_RE.finditer(text):
        try:
            payload = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue  # malformed block stays in the text so the loop can see it
        if isinstance(payload, dict) and "name" in payload:
            calls.append(
                {
                    "id": f"toolu_cli_{uuid.uuid4().hex[:12]}",
                    "name": payload["name"],
                    "input": payload.get("arguments") or payload.get("input") or {},
                }
            )
    remaining = _TOOL_CALL_RE.sub("", text).strip() if calls else text.strip()
    return remaining, calls


def run_cli(prompt: str, system: str, model: str) -> str:
    """One `claude -p` invocation; returns the result text."""
    cmd = [
        config.CLAUDE_CLI_BIN,
        "-p",
        "--output-format", "json",
        "--model", model,
        "--append-system-prompt", system,
        # The CLI's own tools stay off: Anchor's tool layer is the only
        # actuator (provenance + audit live there).
        "--disallowedTools", "*",
    ]
    if config.CLAUDE_CLI_EXTRA_ARGS:
        cmd += config.CLAUDE_CLI_EXTRA_ARGS
    try:
        proc = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=config.CLAUDE_CLI_TIMEOUT,
        )
    except FileNotFoundError as exc:
        raise ClaudeCLIError(
            f"Claude CLI not found at {config.CLAUDE_CLI_BIN!r}. Install it and "
            "log in as the service user (see README), or set ANCHOR_LLM_BACKEND=api."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ClaudeCLIError(
            f"Claude CLI timed out after {config.CLAUDE_CLI_TIMEOUT}s"
        ) from exc
    if proc.returncode != 0:
        raise ClaudeCLIError(
            f"Claude CLI exited {proc.returncode}: {proc.stderr.strip()[:2000]}"
        )
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise ClaudeCLIError(
            f"Claude CLI returned non-JSON output: {proc.stdout[:500]!r}"
        ) from exc
    if payload.get("is_error"):
        raise ClaudeCLIError(f"Claude CLI reported an error: {str(payload)[:2000]}")
    result = payload.get("result")
    if not isinstance(result, str):
        raise ClaudeCLIError(f"Claude CLI JSON missing 'result': {str(payload)[:500]}")
    return result


class ClaudeCLIClient:
    """Drop-in stand-in for anthropic.Anthropic() limited to what brain.py uses."""

    def __init__(self) -> None:
        self.messages = self

    def create(
        self,
        *,
        model: str,
        max_tokens: int,  # noqa: ARG002 — the CLI manages its own output budget
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
    ) -> SimpleNamespace:
        full_system = system + "\n\n" + build_tool_prompt(tools)
        prompt = (
            _render_conversation(messages)
            + "\n\n[Continue as the assistant. Use tool_call blocks or answer.]"
        )
        text = run_cli(prompt, full_system, model)
        remaining, calls = parse_tool_calls(text)
        content: list[_Block] = []
        if remaining:
            content.append(_Block(type="text", text=remaining))
        for call in calls:
            content.append(
                _Block(type="tool_use", id=call["id"], name=call["name"], input=call["input"])
            )
        return SimpleNamespace(
            content=content,
            stop_reason="tool_use" if calls else "end_turn",
        )
