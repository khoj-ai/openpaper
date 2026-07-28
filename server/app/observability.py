"""Langfuse setup shared by the API and all LLM providers.

This module intentionally contains no application data.  Import it only after
environment variables have been loaded so the Langfuse client is configured
with the deployment's credentials.
"""

import re
from typing import Any

from langfuse import Langfuse
from openinference.instrumentation.anthropic import AnthropicInstrumentor
from openinference.instrumentation.google_genai import GoogleGenAIInstrumentor

_EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
_PHONE = re.compile(r"(?<!\w)(?:\+?\d[\d .()-]{7,}\d)\b")


def _mask_pii(data: Any, **_: Any) -> Any:
    """Redact common PII before a trace leaves this process."""
    value = data
    if isinstance(value, str):
        return _PHONE.sub("[PHONE_REDACTED]", _EMAIL.sub("[EMAIL_REDACTED]", value))
    if isinstance(value, dict):
        return {key: _mask_pii(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_mask_pii(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_mask_pii(item) for item in value)
    return value


def configure_langfuse() -> Langfuse:
    """Initialize the process-wide client with export-stage PII masking."""
    client = Langfuse(mask=_mask_pii)
    # Gemini has no Langfuse drop-in SDK; its OpenTelemetry instrumentor emits
    # generation spans with model, usage, latency, and errors automatically.
    AnthropicInstrumentor().instrument()
    GoogleGenAIInstrumentor().instrument()
    return client
