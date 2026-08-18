"""Configuration. Single .env file for secrets; everything has a sane default.

Fail-loud philosophy: missing config that a component actually needs raises
ConfigError at the moment of use with a message naming the exact variable —
never a silent no-op.
"""

from __future__ import annotations

import os
from pathlib import Path
from zoneinfo import ZoneInfo


class ConfigError(RuntimeError):
    """A required setting is missing or invalid."""


def _load_dotenv() -> None:
    """Load .env without requiring python-dotenv (but use it if present)."""
    env_path = os.environ.get("ANCHOR_ENV_FILE", "")
    candidates = [Path(env_path)] if env_path else [
        Path("/etc/anchor/anchor.env"),
        Path.cwd() / ".env",
    ]
    for path in candidates:
        if path.is_file():
            try:
                from dotenv import load_dotenv

                load_dotenv(path, override=False)
            except ImportError:
                for line in path.read_text().splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip().strip('"'))
            break


_load_dotenv()


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, default)
    return value if value not in ("", None) else default


def require(name: str) -> str:
    value = _env(name)
    if value is None:
        raise ConfigError(
            f"Required setting {name} is not set. Add it to /etc/anchor/anchor.env "
            f"(or the .env file) and restart."
        )
    return value


# --- Paths ------------------------------------------------------------------
DATA_DIR = Path(_env("ANCHOR_DATA_DIR", "/var/lib/anchor"))
VAULT_DIR = Path(_env("ANCHOR_VAULT_DIR", str(DATA_DIR / "vault")))
DB_PATH = Path(_env("ANCHOR_DB_PATH", str(DATA_DIR / "anchor.db")))

# --- Identity / time --------------------------------------------------------
TIMEZONE_NAME = _env("ANCHOR_TIMEZONE", "America/Detroit")
TZ = ZoneInfo(TIMEZONE_NAME)

# --- API server -------------------------------------------------------------
API_HOST = _env("ANCHOR_API_HOST", "127.0.0.1")
API_PORT = int(_env("ANCHOR_API_PORT", "8300"))
# Single bearer token shared by phone clients and the GUI.
API_TOKEN_VAR = "ANCHOR_API_TOKEN"

# --- Agent ------------------------------------------------------------------
AGENT_MODEL = _env("ANCHOR_AGENT_MODEL", "claude-sonnet-4-6")
AGENT_MAX_TOKENS = int(_env("ANCHOR_AGENT_MAX_TOKENS", "8000"))
AGENT_MAX_ITERATIONS = int(_env("ANCHOR_AGENT_MAX_ITERATIONS", "30"))

# Backend for agent turns:
#   claude_cli — shell out to the local `claude` CLI (subscription auth, no
#                API key; the Phoenix-style tool_call bridge). Default.
#   api        — Anthropic SDK with ANTHROPIC_API_KEY.
LLM_BACKEND = _env("ANCHOR_LLM_BACKEND", "claude_cli")
CLAUDE_CLI_BIN = _env("ANCHOR_CLAUDE_CLI_BIN", "claude")
CLAUDE_CLI_TIMEOUT = int(_env("ANCHOR_CLAUDE_CLI_TIMEOUT", "600"))
CLAUDE_CLI_EXTRA_ARGS = (_env("ANCHOR_CLAUDE_CLI_EXTRA_ARGS", "") or "").split() or []

# --- Transcription ----------------------------------------------------------
WHISPER_MODEL = _env("ANCHOR_WHISPER_MODEL", "small")
WHISPER_DEVICE = _env("ANCHOR_WHISPER_DEVICE", "auto")
WHISPER_COMPUTE = _env("ANCHOR_WHISPER_COMPUTE", "auto")

# --- ntfy push --------------------------------------------------------------
NTFY_URL = _env("ANCHOR_NTFY_URL", "https://ntfy.sh")
NTFY_TOPIC_VAR = "ANCHOR_NTFY_TOPIC"
NTFY_TOKEN = _env("ANCHOR_NTFY_TOKEN")  # optional (self-hosted ntfy auth)

# --- Google -----------------------------------------------------------------
GOOGLE_CLIENT_SECRETS = _env(
    "ANCHOR_GOOGLE_CLIENT_SECRETS", str(DATA_DIR / "google_client_secret.json")
)
GOOGLE_TOKEN_PATH = _env("ANCHOR_GOOGLE_TOKEN", str(DATA_DIR / "google_token.json"))
GOOGLE_CALENDAR_ID = _env("ANCHOR_GOOGLE_CALENDAR_ID", "primary")

# --- Semantic search (Phase 3) ----------------------------------------------
EMBED_ENABLED = _env("ANCHOR_EMBED", "1") == "1"
EMBED_MODEL = _env("ANCHOR_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
EMBED_BATCH = int(_env("ANCHOR_EMBED_BATCH", "32"))

# --- Gmail ingestion (Phase 3, opt-in; read-only, label-filtered) ------------
GMAIL_ENABLED = _env("ANCHOR_GMAIL_ENABLED", "0") == "1"
GMAIL_LABEL = _env("ANCHOR_GMAIL_LABEL", "Anchor")
GMAIL_POLL_SECONDS = int(_env("ANCHOR_GMAIL_POLL_SECONDS", "900"))

# --- Behavior knobs ---------------------------------------------------------
# Dry run: calendar/people/ntfy calls are recorded in the outbox table instead
# of hitting the network. Used by tests and for first-boot smoke checks.
DRY_RUN = _env("ANCHOR_DRY_RUN", "0") == "1"

# Reminders forced onto every created event, minutes before start.
EVENT_REMINDER_MINUTES = (120, 45)

# Phone sync considered stale after this many seconds without a heartbeat
# (checked only during waking hours).
PHONE_STALE_SECONDS = int(_env("ANCHOR_PHONE_STALE_SECONDS", str(2 * 3600)))
WAKING_HOURS = (8, 23)  # local hours during which stale-sync alerts fire

# Job retry backoff schedule (seconds); after the last entry the job is FAILED
# and rule 8 (fail loud) kicks in.
JOB_BACKOFF = (60, 300, 1800)

# Escalating reminder schedule for open callback tasks (seconds since created).
TASK_ESCALATION_SECONDS = (4 * 3600, 24 * 3600, 48 * 3600)


def api_token() -> str:
    return require(API_TOKEN_VAR)


def ntfy_topic() -> str:
    return require(NTFY_TOPIC_VAR)


def anthropic_api_key() -> str:
    return require("ANTHROPIC_API_KEY")


def ensure_dirs() -> None:
    for d in (DATA_DIR, VAULT_DIR, DB_PATH.parent):
        d.mkdir(parents=True, exist_ok=True)
