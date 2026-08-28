import asyncio
import difflib
import functools
import json
import logging
import random
import time
from typing import Any, AsyncIterator, Callable, Tuple

import anthropic
import httpx
import openai

logger = logging.getLogger(__name__)


class LLMBlockedError(Exception):
    """The model declined to produce output for a reason that retrying won't fix
    (safety filter, recitation, prompt-level block, malformed function call).

    `reason` is the provider's finish reason as a bare name (e.g. "RECITATION"),
    so callers can tell the terminal blocks apart from the one that isn't:
    recitation depends on the sampled continuation, not on anything stable about
    the request.
    """

    def __init__(self, message: str, reason: str | None = None):
        super().__init__(message)
        self.reason = reason

    @property
    def is_recitation(self) -> bool:
        return self.reason == "RECITATION"


# Exceptions that should trigger a retry with backoff. LLMBlockedError is
# deliberately excluded — retrying a safety block just burns time and tokens.
RETRYABLE_EXCEPTIONS = (
    ValueError,
    json.JSONDecodeError,
    openai.InternalServerError,  # 500, 503
    openai.RateLimitError,  # 429
    openai.APIConnectionError,  # Network issues
    openai.APITimeoutError,  # Timeouts
)


def retry_llm_operation(max_retries: int = 3, delay: float = 1.0):
    """
    Decorator to retry LLM operations that may fail due to API errors or validation issues.

    Args:
        max_retries: Maximum number of retry attempts (default: 3)
        delay: Base delay between retries in seconds (default: 1.0)
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception: BaseException | None = None

            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except RETRYABLE_EXCEPTIONS as e:
                    last_exception = e
                    if attempt < max_retries:
                        # Calculate exponential backoff with jitter
                        backoff_time = (
                            delay * (2**attempt) * (0.5 + 0.5 * random.random())
                        )
                        logger.warning(
                            f"Retry {attempt+1}/{max_retries} for {func.__name__}: {type(e).__name__}: {str(e)[:100]}. Retrying in {backoff_time:.2f}s"
                        )
                        time.sleep(backoff_time)
                    else:
                        logger.warning(
                            f"All {max_retries} retries failed for {func.__name__}"
                        )

            # If we reach here, all retries failed
            if last_exception is not None:
                logger.error(
                    f"Final failure after {max_retries} retries for {func.__name__}: {str(last_exception)}",
                    exc_info=last_exception,
                )
                raise last_exception

        # Create async version for async functions
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            last_exception: BaseException | None = None

            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except RETRYABLE_EXCEPTIONS as e:
                    last_exception = e
                    if attempt < max_retries:
                        # Calculate exponential backoff with jitter
                        backoff_time = (
                            delay * (2**attempt) * (0.5 + 0.5 * random.random())
                        )
                        logger.warning(
                            f"Retry {attempt+1}/{max_retries} for {func.__name__}: {type(e).__name__}: {str(e)[:100]}. Retrying in {backoff_time:.2f}s"
                        )
                        await asyncio.sleep(backoff_time)
                    else:
                        logger.warning(
                            f"All {max_retries} retries failed for {func.__name__}"
                        )

            # If we reach here, all retries failed
            if last_exception is not None:
                logger.error(
                    f"Final failure after {max_retries} retries for {func.__name__}: {str(last_exception)}",
                    exc_info=last_exception,
                )
                raise last_exception

        # Return appropriate wrapper based on if the function is async or not
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return wrapper

    return decorator


# Transport-level failures that kill a response mid-body. These are not model
# errors: the connection died with bytes still owed, so the same request sent
# again will usually succeed. httpx exceptions arrive raw from the Gemini SDK;
# the OpenAI and Anthropic SDKs wrap theirs in APIConnectionError.
RETRYABLE_STREAM_EXCEPTIONS = (
    httpx.RemoteProtocolError,
    httpx.ReadError,
    httpx.ReadTimeout,
    httpx.WriteError,
    httpx.ConnectError,
    httpx.ConnectTimeout,
    openai.APIConnectionError,
    anthropic.APIConnectionError,
)


class _StreamRestart:
    """Marker yielded when a dropped stream is being retried from scratch."""

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "STREAM_RESTART"


STREAM_RESTART = _StreamRestart()


async def stream_with_retry(
    open_stream: Callable[[], Any],
    *,
    max_retries: int = 2,
    delay: float = 1.0,
    description: str = "stream",
) -> AsyncIterator[Any]:
    """Iterate an upstream LLM stream, re-issuing the whole request if the
    connection drops mid-body.

    `open_stream` is an awaitable factory returning a fresh async iterator, so
    each attempt is a brand new HTTP request. Chunks are passed through
    untouched.

    A partially-streamed answer cannot be resumed — the retry produces different
    text, not a continuation — so when chunks were already emitted before the
    drop, STREAM_RESTART is yielded first. Callers must treat it as "discard
    everything received so far"; what follows is a complete replacement answer.
    """
    for attempt in range(max_retries + 1):
        emitted = False
        try:
            stream = await open_stream()
            async for chunk in stream:
                emitted = True
                yield chunk
            return
        except RETRYABLE_STREAM_EXCEPTIONS as e:
            if attempt >= max_retries:
                logger.error(
                    f"{description}: stream dropped after {max_retries} retries: "
                    f"{type(e).__name__}: {e}",
                    exc_info=e,
                )
                raise

            backoff_time = delay * (2**attempt) * (0.5 + 0.5 * random.random())
            logger.warning(
                f"{description}: stream dropped ({type(e).__name__}: {str(e)[:120]}) "
                f"after emitting={emitted}. Retry {attempt+1}/{max_retries} "
                f"in {backoff_time:.2f}s"
            )
            await asyncio.sleep(backoff_time)

            # Only signal a restart if the caller already saw part of the
            # answer. Dropping before the first chunk is invisible downstream.
            if emitted:
                yield STREAM_RESTART


def find_offsets(target: str, full_text: str) -> Tuple[int, int]:
    """
    Find the start and end offsets of a target string within a full text.
    Returns a tuple of (start_offset, end_offset).
    """
    start_offset = full_text.find(target)
    if start_offset == -1:
        # Run a fuzzy search if exact match not found
        matcher = difflib.SequenceMatcher(None, full_text, target)
        match = matcher.find_longest_match(0, len(full_text), 0, len(target))
        if match.size == 0:
            return -1, -1  # No match found

        start_offset = match.a  # Start index of the match in full_text
        end_offset = start_offset + match.size

    if start_offset == -1:
        return -1, -1

    end_offset = start_offset + len(target)
    return start_offset, end_offset
