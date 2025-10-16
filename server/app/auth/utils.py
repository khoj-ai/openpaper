import os
import random
import string
from datetime import datetime, timedelta, timezone
from typing import Literal

from app.auth.dependencies import SESSION_COOKIE_NAME
from dotenv import load_dotenv
from fastapi import Request, Response

load_dotenv()

# Environment variables
SESSION_COOKIE_DOMAIN = os.getenv("SESSION_COOKIE_DOMAIN", None)
SECURE_COOKIES = os.getenv("SECURE_COOKIES", "false").lower() == "true"


def set_session_cookie(
    response: Response,
    token: str,
    expires_at: datetime,
    http_only: bool = True,
    same_site: Literal["lax", "strict", "none"] = "lax",
) -> None:
    """
    Set a session cookie in the response.

    Args:
        response: FastAPI Response object
        token: Session token
        expires_at: When the session expires
        http_only: Whether the cookie is HTTP only
        same_site: SameSite cookie setting (lax, strict, none)
    """
    # Calculate max_age in seconds
    now = datetime.now(timezone.utc)
    max_age = int((expires_at - now).total_seconds())

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=max_age,  # seconds until expiration
        expires=expires_at.strftime("%a, %d %b %Y %H:%M:%S GMT"),  # RFC format
        domain=SESSION_COOKIE_DOMAIN,
        path="/",
        secure=SECURE_COOKIES,  # Only send over HTTPS
        httponly=http_only,  # Not accessible via JavaScript
        samesite=same_site,  # Controls cross-site sending
    )


def clear_session_cookie(response: Response) -> None:
    """
    Clear the session cookie from the response.

    Args:
        response: FastAPI Response object
    """
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        domain=SESSION_COOKIE_DOMAIN,
        path="/",
    )


def generate_verification_code() -> str:
    """
    Generate a 6-digit verification code.

    Returns:
        str: A 6-digit numeric verification code
    """
    return "".join(random.choices(string.digits, k=6))


def is_verification_code_valid(
    expires_at: datetime, provided: str, actual: str
) -> bool:
    """
    Check if a verification code is still valid (not expired).

    Args:
        expires_at: The expiration datetime of the verification code
        provided: The verification code provided by the user
        actual: The actual verification code to compare against

    Returns:
        bool: True if the code is still valid, False otherwise
    """
    if not expires_at:
        return False

    if provided != actual:
        return False

    return datetime.now(timezone.utc) < expires_at


def get_verification_code_expiry() -> datetime:
    """
    Get the expiry time for a new verification code (10 minutes from now).

    Returns:
        datetime: The expiry time for the verification code
    """
    return datetime.now(timezone.utc) + timedelta(minutes=10)
