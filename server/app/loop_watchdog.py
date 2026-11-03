"""Log what a worker's event loop is stuck on while it is stuck.

Every request a worker serves runs on its one event loop, so a blocking call
on it stalls them all, and gunicorn kills the worker once its heartbeat has
been quiet for the timeout. The kill leaves no trace of what the loop was
doing, so a thread watches a heartbeat task on the loop and, when the beats
stop, logs the loop thread's current stack.
"""

import asyncio
import faulthandler
import logging
import os
import sys
import threading
import time
import traceback
from typing import Optional

logger = logging.getLogger(__name__)

# Far below the worker timeout, so a stall is on record well before the kill.
STALL_THRESHOLD_SECONDS = 10.0
HEARTBEAT_SECONDS = 1.0


class LoopWatchdog:
    """Report event loop stalls with the stack the loop is blocked in.

    A stall is reported once it reaches the threshold, again each time its
    length doubles, so a long one shows where it moves to, and once more when
    the loop runs again.
    """

    def __init__(
        self,
        threshold: float = STALL_THRESHOLD_SECONDS,
        interval: float = HEARTBEAT_SECONDS,
    ) -> None:
        self.threshold = threshold
        self.interval = interval
        self._last_beat = time.monotonic()
        self._loop_thread_id: Optional[int] = None
        self._beat_task: Optional[asyncio.Task[None]] = None
        self._stopped = threading.Event()

    def start(self) -> None:
        """Start watching the running loop. Call from a coroutine on it."""
        self._loop_thread_id = threading.get_ident()
        self._last_beat = time.monotonic()
        self._beat_task = asyncio.get_running_loop().create_task(self._beat())
        threading.Thread(target=self._watch, name="loop-watchdog", daemon=True).start()
        # A stall that holds the GIL keeps the watchdog thread from running.
        # The uvicorn worker resets SIGABRT, which gunicorn sends a worker it
        # kills for a timeout, to its default; faulthandler's handler dumps
        # every thread's stack to stderr first, without needing the GIL.
        faulthandler.enable()

    def stop(self) -> None:
        self._stopped.set()
        if self._beat_task:
            self._beat_task.cancel()

    async def _beat(self) -> None:
        while True:
            self._last_beat = time.monotonic()
            await asyncio.sleep(self.interval)

    def _watch(self) -> None:
        stalled_since: Optional[float] = None
        next_report = self.threshold
        while not self._stopped.wait(self.interval):
            last_beat = self._last_beat
            if stalled_since is not None and last_beat != stalled_since:
                logger.warning(
                    f"Event loop in worker {os.getpid()} ran again after being "
                    f"blocked for {last_beat - stalled_since:.0f}s"
                )
                stalled_since = None
                next_report = self.threshold

            stalled_for = time.monotonic() - last_beat
            if stalled_for >= next_report:
                stalled_since = last_beat
                next_report *= 2
                logger.warning(
                    f"Event loop in worker {os.getpid()} blocked for "
                    f"{stalled_for:.0f}s, in:\n{self._loop_stack()}"
                )

    def _loop_stack(self) -> str:
        frame = sys._current_frames().get(self._loop_thread_id or 0)
        if frame is None:
            return "(the event loop thread has exited)"
        return "".join(traceback.format_stack(frame))
