"""Logging setup shared by the API, migrations, scripts and evals.

Records go out as one JSON object each, so log searches can filter on the
`level` field instead of grepping for the word ERROR — which also turns up in
request paths, traceback bodies and model output. `DEBUG` swaps in the
human-readable text format, which reads better in a local terminal.

Mirrored in jobs/src/logging_config.py; the two services deploy independently
and so cannot share a module.
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

TEXT_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
DEFAULT_SERVICE = "server"

# Attributes on every LogRecord, plus uvicorn's ANSI-coloured copy of the
# message; anything else a caller adds through `extra=` is kept.
_RESERVED_RECORD_FIELDS = frozenset(
    {
        "args",
        "asctime",
        "color_message",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)

# Emptying these makes their records propagate to the root handler instead of
# going out through the handlers and formats the servers install themselves.
_FRAMEWORK_LOGGERS = (
    "uvicorn",
    "uvicorn.access",
    "uvicorn.error",
    "gunicorn.access",
    "gunicorn.error",
)

# The load balancer probes every task several times a second, which is the bulk
# of everything we log. A probe that fails shows up as an unhealthy target, so
# the access records carry no signal of their own.
_ACCESS_LOGGERS = ("uvicorn.access", "gunicorn.access")
_HEALTH_PATHS = frozenset({"/health", "/api/health"})


class HealthCheckFilter(logging.Filter):
    """Drop access-log records for health probes."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Access records are logged as
        # (client_addr, method, full_path, http_version, status_code); anything
        # else is some other record on this logger and is kept.
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3:
            return str(args[2]).split("?", 1)[0] not in _HEALTH_PATHS
        return True


class JsonFormatter(logging.Formatter):
    """Render a record as one JSON line, traceback included."""

    def __init__(self, service: str) -> None:
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(
                timespec="milliseconds"
            ),
            "level": record.levelname,
            "service": self.service,
            "logger": record.name,
            "process": record.processName,
            "message": record.getMessage(),
        }
        if record.exc_info:
            # Inlined so the traceback stays one event, not a run of level-less
            # lines that no error search can attribute back to this record.
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)
        extra = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _RESERVED_RECORD_FIELDS
        }
        if extra:
            payload["extra"] = extra
        return json.dumps(payload, default=str)


def build_formatter() -> logging.Formatter:
    """JSON everywhere; the readable text format under DEBUG."""
    if os.getenv("DEBUG", "False").lower() in ("true", "1", "t"):
        return logging.Formatter(TEXT_FORMAT, DATE_FORMAT)
    return JsonFormatter(os.getenv("SERVICE_NAME", DEFAULT_SERVICE))


def configure_logging(level: int | str | None = None) -> None:
    """Route every logger through one root handler in the shared format.

    `force` is what makes this reliable: imported modules and the ASGI servers
    configure the root logger themselves, and basicConfig is silently a no-op
    once the root logger has a handler.
    """
    handler = logging.StreamHandler()
    handler.setFormatter(build_formatter())
    logging.basicConfig(
        level=level or os.getenv("LOG_LEVEL", "INFO"),
        handlers=[handler],
        force=True,
    )
    for name in _FRAMEWORK_LOGGERS:
        framework_logger = logging.getLogger(name)
        framework_logger.handlers.clear()
        framework_logger.propagate = True

    # Cleared first so repeated calls don't stack duplicate filters. A filter on
    # the logger applies before propagation, so it still drops the record even
    # though the handler now lives on the root logger.
    for name in _ACCESS_LOGGERS:
        access_logger = logging.getLogger(name)
        access_logger.filters.clear()
        access_logger.addFilter(HealthCheckFilter())
