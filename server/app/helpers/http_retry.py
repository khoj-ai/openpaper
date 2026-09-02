"""Shared retry classification for outbound HTTP calls.

Every third-party client we retry against wants the same rule — retry transport
failures and transient server responses, give up immediately on a 4xx that will
never succeed — but each surfaces failures through a different exception type.
The status set and the rule live here; the per-library predicates that map an
exception onto it live next to their client.
"""

import re
from typing import Optional

# 429 is included because it is transient by definition: the caller is expected
# to wait and try again. Every other 4xx describes a request that is wrong on its
# own terms (bad params, missing resource, bad credentials) and retrying it only
# multiplies the latency and the log noise.
RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})

# Clients that only expose the status inside an exception message, e.g. exa_py's
# ValueError("Request failed with status code 502: ...").
_STATUS_IN_MESSAGE = re.compile(r"status code (\d{3})")


def is_retryable_status(status_code: Optional[int]) -> bool:
    """True if an HTTP status is worth retrying.

    An unknown status (None) is treated as retryable: it means we never got a
    response, which is the transport-failure case.
    """
    if status_code is None:
        return True
    return status_code in RETRYABLE_STATUS_CODES


def retryable_status_in_message(message: str) -> Optional[bool]:
    """Classify a failure whose status is only present in its message text.

    Returns None when no status could be found, so callers can fall back to
    their own heuristics rather than treating "unparseable" as "not retryable".
    """
    match = _STATUS_IN_MESSAGE.search(message)
    if not match:
        return None
    return is_retryable_status(int(match.group(1)))
