"""Langfuse setup for the short-lived and worker PDF-processing processes."""

import re
from typing import Any

from langfuse import Langfuse


_EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
_PHONE = re.compile(r"(?<!\w)(?:\+?\d[\d .()-]{7,}\d)\b")


def _mask_pii(data: Any, **_: Any) -> Any:
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
    return Langfuse(mask=_mask_pii)
