from typing import Any


def sanitize_for_postgres(value: Any) -> Any:
    """Recursively remove null characters that PostgreSQL cannot store."""
    if isinstance(value, str):
        return value.replace("\x00", "").replace("\u0000", "")
    if isinstance(value, dict):
        return {key: sanitize_for_postgres(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_for_postgres(item) for item in value]
    if isinstance(value, tuple):
        return tuple(sanitize_for_postgres(item) for item in value)
    return value
