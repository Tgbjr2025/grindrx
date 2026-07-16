"""Claude Code CLI decision engine ("CLI bridge" backend).

Instead of the Anthropic API (which bills per token), this backend drives the
locally installed `claude` CLI under a Claude subscription - the same pattern
as the ClaudeCLIWrapper bridge in phoenix/apex_dominus:

    claude -p --output-format json --tools "" --max-turns 2 \
           --json-schema <DECISION_SCHEMA> --model <model>   (prompt on stdin)

The CLI returns an envelope whose `structured_output` field carries the
schema-validated decision JSON (falling back to parsing `result`). The CLI is
known to crash silently (exit != 0, empty stderr) a noticeable fraction of the
time, so those - and timeouts - are retried with backoff; real model errors
(non-empty stderr) are not.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from .config import LLMCfg
from .llm import DECISION_SCHEMA, LLMDecision, LLMResult, SYSTEM_PROMPT

log = logging.getLogger("fxbot.llm_cli")

_SILENT_CRASH_RETRIES = 2
_BACKOFF_SECONDS = (3.0, 8.0)


def find_claude_binary(explicit: str = "") -> str:
    if explicit and Path(explicit).exists():
        return explicit
    env_path = os.environ.get("CLAUDE_CLI_PATH", "")
    if env_path and Path(env_path).exists():
        return env_path
    found = shutil.which("claude")
    if found:
        return found
    for candidate in (
        Path.home() / ".local" / "bin" / "claude",
        Path("/home/ubuntu/.local/bin/claude"),
        Path("/usr/local/bin/claude"),
    ):
        if candidate.exists():
            return str(candidate)
    raise FileNotFoundError(
        "claude CLI not found - install Claude Code or set llm.cli_path / CLAUDE_CLI_PATH"
    )


def parse_cli_envelope(output: str) -> dict[str, Any]:
    """Extract the decision dict from a `claude -p --output-format json` envelope."""
    try:
        raw = json.loads(output)
    except json.JSONDecodeError:
        raw = {"result": output}
    if isinstance(raw, list):  # older CLIs may emit a content-block list
        raw = {"result": " ".join(
            str(b.get("text", b)) if isinstance(b, dict) else str(b) for b in raw
        )}
    structured = raw.get("structured_output") if isinstance(raw, dict) else None
    if not isinstance(structured, dict):
        result_text = raw.get("result", "") if isinstance(raw, dict) else str(raw)
        try:
            parsed = json.loads(result_text)
            structured = parsed if isinstance(parsed, dict) else {}
        except (json.JSONDecodeError, TypeError):
            structured = {}
    structured.setdefault("market_outlook", "")
    structured.setdefault("decisions", [])
    return structured


class CLIDecisionEngine:
    """Drop-in alternative to llm.DecisionEngine that uses the Claude Code CLI."""

    def __init__(self, cfg: LLMCfg):
        self.cfg = cfg
        self.binary = find_claude_binary(cfg.cli_path)
        log.info("CLI bridge backend: %s (model=%s)", self.binary, cfg.model)

    # Subscription usage has no per-token bill; the API-budget gate never trips.
    @property
    def spend_today(self) -> float:
        return 0.0

    def budget_exhausted(self) -> bool:
        return False

    async def _call_cli(self, prompt: str) -> str:
        cmd = [
            self.binary, "-p",
            "--output-format", "json",
            "--tools", "",
            "--max-turns", "2",
            "--json-schema", json.dumps(DECISION_SCHEMA),
            "--model", self.cfg.model,
        ]
        last_error: Exception | None = None
        for attempt in range(_SILENT_CRASH_RETRIES + 1):
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(input=prompt.encode()),
                    timeout=self.cfg.cli_timeout_seconds,
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                last_error = TimeoutError(
                    f"claude CLI timeout after {self.cfg.cli_timeout_seconds}s")
                log.warning("%s (attempt %d/%d)", last_error, attempt + 1,
                            _SILENT_CRASH_RETRIES + 1)
                await asyncio.sleep(_BACKOFF_SECONDS[min(attempt, 1)])
                continue

            out = stdout.decode(errors="replace").strip()
            err = stderr.decode(errors="replace").strip()
            if proc.returncode != 0:
                if not err and not out and attempt < _SILENT_CRASH_RETRIES:
                    log.warning("claude CLI silent crash exit=%s (attempt %d/%d); retrying",
                                proc.returncode, attempt + 1, _SILENT_CRASH_RETRIES + 1)
                    last_error = RuntimeError("claude CLI silent crash")
                    await asyncio.sleep(_BACKOFF_SECONDS[min(attempt, 1)])
                    continue
                raise RuntimeError(f"claude CLI error (exit {proc.returncode}): {err[:400]}")
            return out
        raise last_error or RuntimeError("claude CLI: exhausted retries")

    async def decide(self, dossier: dict[str, Any]) -> LLMResult | None:
        prompt = (
            SYSTEM_PROMPT
            + "\n\nMarket dossier:\n" + json.dumps(dossier, default=str)
            + "\n\nReturn your trading decisions as JSON matching the schema."
        )
        try:
            output = await self._call_cli(prompt)
        except Exception as e:  # noqa: BLE001 - a failed cycle must not kill the loop
            log.error("CLI bridge call failed, skipping cycle: %s", e)
            return LLMResult(outlook=f"(cli error: {e})", decisions=[], cost_usd=0.0)

        data = parse_cli_envelope(output)
        decisions = []
        for d in data.get("decisions", []):
            try:
                decisions.append(LLMDecision(**d))
            except TypeError as e:
                log.warning("malformed decision skipped: %s (%s)", d, e)
        return LLMResult(outlook=data.get("market_outlook", ""), decisions=decisions,
                         cost_usd=0.0)
