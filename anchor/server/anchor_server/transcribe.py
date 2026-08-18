"""faster-whisper transcription. Model loaded once per worker process."""

from __future__ import annotations

import json
from typing import Any

from . import config

_model = None


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            config.WHISPER_MODEL,
            device=config.WHISPER_DEVICE,
            compute_type=config.WHISPER_COMPUTE,
        )
    return _model


def transcribe_file(path: str) -> dict[str, Any]:
    """Returns {text, segments: [{start, end, text}], duration}."""
    segments_iter, info = _get_model().transcribe(path, vad_filter=True)
    segments = [
        {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
        for s in segments_iter
    ]
    return {
        "text": " ".join(s["text"] for s in segments).strip(),
        "segments": segments,
        "duration": round(info.duration, 2),
        "language": info.language,
    }


def segments_json(result: dict[str, Any]) -> str:
    return json.dumps(result["segments"])
