"""Session-level Postgres advisory lock helpers.

Advisory locks let us serialize work across concurrent requests/processes
without a dedicated lock table or row locks.

We use *session-level* locks (``pg_try_advisory_lock``, not the ``_xact_``
variant) because a single request handler may issue many intermediate commits,
and a transaction-level lock would be released by the first of those.

Crucially, the lock is held on its own **dedicated connection** rather than on
the request's ORM ``Session``. SQLAlchemy returns a Session's connection to the
pool on every ``commit()`` and checks out a fresh one for the next statement,
so a lock taken through the Session would not reliably survive the handler's
commits. By owning a connection for the lifetime of the lock we guarantee the
lock spans the whole critical section, and it auto-releases if the process dies
(the backend connection closes).

Keys use the two-int ``(namespace, hashtext(key))`` form so different callers
can carve out non-colliding namespaces.
"""

import logging
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

logger = logging.getLogger(__name__)


class AdvisoryLockNamespace:
    """Stable int4 namespaces for advisory locks. Keep values unique."""

    PAPER_PROCESSING_WEBHOOK = 1885434469  # arbitrary int4 constant ("pape")


class AdvisoryLock:
    """A non-blocking, session-level Postgres advisory lock on its own connection.

    Acquire with :meth:`acquire` (returns whether the lock was taken) and always
    pair a successful acquire with :meth:`release`, ideally in a ``finally``.
    Prefer the :func:`advisory_lock` context manager where the control flow
    allows it.
    """

    def __init__(self, engine: Engine, *, namespace: int, key: str) -> None:
        self._engine = engine
        self._namespace = namespace
        self._key = key
        self._conn: Optional[Connection] = None

    def acquire(self) -> bool:
        """Try to take the lock. Returns True if acquired, False if held elsewhere.

        On success the underlying connection is kept open to hold the lock; on
        failure (or error) the connection is returned to the pool immediately.
        """
        conn = self._engine.connect()
        try:
            acquired = bool(
                conn.execute(
                    text("SELECT pg_try_advisory_lock(:ns, hashtext(:key))"),
                    {"ns": self._namespace, "key": self._key},
                ).scalar()
            )
        except Exception:
            conn.close()
            raise

        if acquired:
            self._conn = conn
            return True

        conn.close()
        return False

    def release(self) -> None:
        """Release the lock and return its connection to the pool. Never raises."""
        if self._conn is None:
            return
        try:
            self._conn.execute(
                text("SELECT pg_advisory_unlock(:ns, hashtext(:key))"),
                {"ns": self._namespace, "key": self._key},
            )
        except Exception as e:
            logger.error(
                f"Failed to release advisory lock (ns={self._namespace}, "
                f"key={self._key}): {str(e)}"
            )
        finally:
            self._conn.close()
            self._conn = None


@contextmanager
def advisory_lock(engine: Engine, *, namespace: int, key: str) -> Iterator[bool]:
    """Context manager around :class:`AdvisoryLock`.

    Yields whether the lock was acquired; releases it on exit iff it was taken
    here.

        with advisory_lock(engine, namespace=NS, key=job_id) as locked:
            if not locked:
                return  # someone else is already working on this key
            ...  # critical section
    """
    lock = AdvisoryLock(engine, namespace=namespace, key=key)
    acquired = lock.acquire()
    try:
        yield acquired
    finally:
        if acquired:
            lock.release()
