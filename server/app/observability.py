"""Langfuse setup shared by the API and all LLM providers.

This module intentionally contains no application data.  Import it only after
environment variables have been loaded so the Langfuse client is configured
with the deployment's credentials.
"""

import os
import re
from typing import Any, Optional

from langfuse import Langfuse
from langfuse.types import MaskOtelSpansParams, MaskOtelSpansResult, OtelSpanPatch
from openinference.instrumentation.anthropic import AnthropicInstrumentor
from openinference.instrumentation.google_genai import GoogleGenAIInstrumentor

_EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
_PHONE = re.compile(r"(?<!\w)(?:\+?\d[\d .()-]{7,}\d)\b")

# A run of base64 characters (standard or URL-safe alphabet) far longer than
# any legitimate prose token: in practice, an inlined PDF/image payload.
_BASE64_BLOB = re.compile(r"[A-Za-z0-9+/_-]{4096,}={0,2}")


def _mask_pii(data: Any, **_: Any) -> Any:
    """Redact common PII before a trace leaves this process."""
    value = data
    if isinstance(value, str):
        # Base64 data URIs (PDF/image payloads) hold encoded binary, so the
        # regexes can't find real PII in them — but "redacting" incidental
        # digit runs corrupts the encoding and Langfuse then fails to parse
        # the media. Pass them through untouched.
        if value.startswith("data:") and ";base64," in value[:100]:
            return value
        return _PHONE.sub("[PHONE_REDACTED]", _EMAIL.sub("[EMAIL_REDACTED]", value))
    if isinstance(value, dict):
        return {key: _mask_pii(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_mask_pii(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_mask_pii(item) for item in value)
    return value


def _strip_base64_blobs(
    *, params: MaskOtelSpansParams
) -> Optional[MaskOtelSpansResult]:
    """Drop inlined binary payloads from spans before they are exported.

    The GoogleGenAI instrumentor records the whole model request — including
    PDF bytes sent as inline_data, which google-genai serializes as URL-safe
    base64. Langfuse's media parser only understands the standard alphabet, so
    it errors on these, and either way we have no reason to ship hundreds of
    KB of encoded binary per generation. Replace the blobs with a marker and
    keep the surrounding prompt text intact.
    """
    try:
        patches = {}
        for identifier, span in params.spans.items():
            replaced = {}
            for key, value in (span.attributes or {}).items():
                if (
                    isinstance(value, str)
                    and len(value) >= 4096
                    and _BASE64_BLOB.search(value)
                ):
                    replaced[key] = _BASE64_BLOB.sub("[BASE64_PAYLOAD_OMITTED]", value)
            if replaced:
                patches[identifier] = OtelSpanPatch(set_attributes=replaced)
        return MaskOtelSpansResult(span_patches=patches) if patches else None
    except Exception:
        # Raising here would make Langfuse drop the whole export batch;
        # prefer exporting unstripped spans over losing them.
        return None


def configure_langfuse() -> Langfuse:
    """Initialize the process-wide client with export-stage PII masking."""
    # Langfuse's media pipeline can't parse the URL-safe base64 that
    # google-genai emits for PDF inline_data (it b64decodes with the standard
    # alphabet), so every Gemini PDF call logs a parse error. Disable media
    # detection outright — _strip_base64_blobs removes the payloads at export
    # anyway, so there is nothing left to upload. Deployments can re-enable by
    # setting the variable explicitly before startup.
    os.environ.setdefault("LANGFUSE_MEDIA_UPLOAD_ENABLED", "false")
    client = Langfuse(mask=_mask_pii, mask_otel_spans=_strip_base64_blobs)
    # Gemini has no Langfuse drop-in SDK; its OpenTelemetry instrumentor emits
    # generation spans with model, usage, latency, and errors automatically.
    AnthropicInstrumentor().instrument()
    GoogleGenAIInstrumentor().instrument()
    return client
