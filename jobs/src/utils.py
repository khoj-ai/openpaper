import asyncio
import functools
import json
import logging
import random
import time
from contextlib import asynccontextmanager
from typing import Any, Callable, AsyncGenerator, Optional, Dict

from src.telemetry import track_event

logger = logging.getLogger(__name__)


@asynccontextmanager
async def time_it(
    description: str,
    job_id: Optional[str] = None,
    event_properties: Optional[Dict[str, Any]] = None,
) -> AsyncGenerator[None, None]:
    """
    An async context manager to measure and log the execution time of a code block.

    Args:
        description: A description of the code block being timed.
        job_id: The job ID for tracking.
        event_properties: Additional properties for the tracking event.
    """
    start_time = time.monotonic()
    logger.info(f"Starting: {description}...")
    yield
    end_time = time.monotonic()
    duration = end_time - start_time
    logger.info(f"Finished: {description}. Duration: {duration:.2f} seconds")

    if job_id:
        event_name = f"timer:{description.lower().replace(' ', '_')}"
        properties = {"duration": duration}
        if event_properties:
            properties.update(event_properties)
        track_event(event_name, distinct_id=job_id, properties=properties)



def retry_llm_operation(max_retries: int = 3, delay: float = 1.0):
    """
    Decorator to retry async LLM operations that may fail due to API errors or validation issues.

    Args:
        max_retries: Maximum number of retry attempts (default: 3)
        delay: Base delay between retries in seconds (default: 1.0)
    """
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            last_exception: BaseException | None = None

            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except (ValueError, json.JSONDecodeError, RuntimeError) as e:
                    last_exception = e
                    if attempt < max_retries:
                        # Calculate exponential backoff with jitter
                        backoff_time = delay * (2**attempt) * (0.5 + 0.5 * random.random())
                        logger.debug(
                            f"Retry {attempt+1}/{max_retries} for {func.__name__}: {str(e)}. "
                            f"Retrying in {backoff_time:.2f}s"
                        )
                        await asyncio.sleep(backoff_time)
                    else:
                        logger.debug(f"All {max_retries} retries failed for {func.__name__}")

            # If we reach here, all retries failed
            if last_exception is not None:
                logger.error(
                    f"Final failure after {max_retries} retries for {func.__name__}: "
                    f"{str(last_exception)}"
                )
                raise last_exception

            # This should never be reached, but just in case
            raise RuntimeError(f"Unexpected state in retry decorator for {func.__name__}")

        return async_wrapper

    return decorator
