"""Langfuse setup for the short-lived and worker PDF-processing processes."""

import os
import re
from typing import Any, Optional

from langfuse import Langfuse
from langfuse.types import MaskOtelSpansParams, MaskOtelSpansResult, OtelSpanPatch


_EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
_PHONE = re.compile(r"(?<!\w)(?:\+?\d[\d .()-]{7,}\d)\b")

# A run of base64 characters (standard or URL-safe alphabet) far longer than
# any legitimate prose token: in practice, an inlined PDF/image payload.
_BASE64_BLOB = re.compile(r"[A-Za-z0-9+/_-]{4096,}={0,2}")


def _mask_pii(data: Any, **_: Any) -> Any:
    value = data
    if isinstance(value, str):
        # Base64 data URIs hold encoded binary — no PII for the regexes to
        # find, and rewriting digit runs corrupts the encoding.
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
    the PDF bytes this worker sends for metadata extraction, which google-genai
    serializes as URL-safe base64. Langfuse's media parser only understands the
    standard alphabet, so it errors on these, and either way we have no reason
    to ship hundreds of KB of encoded binary per generation. Replace the blobs
    with a marker and keep the surrounding prompt text intact.
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
    # See _strip_base64_blobs: Langfuse's media parser errors on the URL-safe
    # base64 google-genai emits for PDF inline_data, and the blobs are stripped
    # at export anyway, so skip media detection entirely. Deployments can
    # re-enable by setting the variable explicitly before startup.
    os.environ.setdefault("LANGFUSE_MEDIA_UPLOAD_ENABLED", "false")
    return Langfuse(mask=_mask_pii, mask_otel_spans=_strip_base64_blobs)
