import asyncio
import functools
import json
import logging
import random
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)


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
                except (ValueError, json.JSONDecodeError) as e:
                    last_exception = e
                    if attempt < max_retries:
                        # Calculate exponential backoff with jitter
                        backoff_time = (
                            delay * (2**attempt) * (0.5 + 0.5 * random.random())
                        )
                        logger.debug(
                            f"Retry {attempt+1}/{max_retries} for {func.__name__}: {str(e)}. Retrying in {backoff_time:.2f}s"
                        )
                        time.sleep(backoff_time)
                    else:
                        logger.debug(
                            f"All {max_retries} retries failed for {func.__name__}"
                        )

            # If we reach here, all retries failed
            if last_exception is not None:
                logger.error(
                    f"Final failure after {max_retries} retries for {func.__name__}: {str(last_exception)}"
                )
                raise last_exception

        # Create async version for async functions
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            last_exception: BaseException | None = None

            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except (ValueError, json.JSONDecodeError) as e:
                    last_exception = e
                    if attempt < max_retries:
                        # Calculate exponential backoff with jitter
                        backoff_time = (
                            delay * (2**attempt) * (0.5 + 0.5 * random.random())
                        )
                        logger.debug(
                            f"Retry {attempt+1}/{max_retries} for {func.__name__}: {str(e)}. Retrying in {backoff_time:.2f}s"
                        )
                        await asyncio.sleep(backoff_time)
                    else:
                        logger.debug(
                            f"All {max_retries} retries failed for {func.__name__}"
                        )

            # If we reach here, all retries failed
            if last_exception is not None:
                logger.error(
                    f"Final failure after {max_retries} retries for {func.__name__}: {str(last_exception)}"
                )
                raise last_exception

        # Return appropriate wrapper based on if the function is async or not
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return wrapper

    return decorator
