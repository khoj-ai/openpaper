import logging
import os
from typing import Dict, Optional
from urllib.parse import urlencode

import requests
from app.schemas.user import OAuthUserInfo
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Load from environment variables
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI")

# Google's own machine-readable codes for "the caller sent us something bad",
# as opposed to "our client registration is wrong". Only the latter is a fault
# on our side worth waking someone up for; see GoogleTokenError.is_client_fault.
_CALLER_ERRORS = frozenset({"invalid_grant", "invalid_request", "access_denied"})


class GoogleTokenError(Exception):
    """A token exchange that Google refused, with its answer kept intact.

    Google returns a JSON body naming exactly which of several unrelated
    conditions it hit — a spent code, an expired code, a redirect_uri that
    doesn't match, a bad client secret. Collapsing that into "Failed to get
    access token" is what made these indistinguishable in the logs, so the
    parsed code and the raw body both travel with the exception and get logged
    as structured fields by whoever catches it.
    """

    def __init__(
        self,
        error: str,
        description: Optional[str] = None,
        status_code: Optional[int] = None,
        body: Optional[str] = None,
    ) -> None:
        super().__init__(f"Google token exchange failed: {error}")
        self.error = error
        self.description = description
        self.status_code = status_code
        self.body = body

    @property
    def is_caller_fault(self) -> bool:
        """True when the request was bad, not our client registration."""
        return self.error in _CALLER_ERRORS

    def log_fields(self) -> Dict[str, Optional[str | int]]:
        """Structured fields for `extra=`, raw body included."""
        return {
            "google_error": self.error,
            "google_error_description": self.description,
            "google_status_code": self.status_code,
            "google_response_body": self.body,
        }


def _parse_error(response: Optional[requests.Response]) -> tuple[str, Optional[str]]:
    """Pull Google's `error` / `error_description` out of a failed response."""
    if response is None:
        return "network_error", None
    try:
        payload = response.json()
    except ValueError:
        return "unparseable_response", None
    if not isinstance(payload, dict):
        return "unparseable_response", None
    return payload.get("error", "unknown_error"), payload.get("error_description")


class GoogleAuthClient:
    """Google OAuth2 client."""

    def __init__(self):
        self.client_id = GOOGLE_CLIENT_ID
        self.client_secret = GOOGLE_CLIENT_SECRET
        self.redirect_uri = GOOGLE_REDIRECT_URI
        self.auth_base_url = "https://accounts.google.com/o/oauth2/v2/auth"
        self.token_url = "https://oauth2.googleapis.com/token"
        self.user_info_url = "https://www.googleapis.com/oauth2/v2/userinfo"

    def get_auth_url(self, state: str = "") -> str:
        """
        Generate the authorization URL for Google OAuth.

        Args:
            state: Optional state parameter for security

        Returns:
            str: The authorization URL
        """
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent",
        }

        if state:
            params["state"] = state

        # urlencode rather than joining by hand: `scope` is space-separated and
        # `redirect_uri` carries a scheme, neither of which survives a raw
        # f-string as valid query syntax.
        return f"{self.auth_base_url}?{urlencode(params)}"

    def get_token(self, code: str) -> Dict:
        """
        Exchange the authorization code for tokens.

        Args:
            code: The authorization code from the callback

        Returns:
            Dict: The token response containing access_token, refresh_token, etc.

        Raises:
            GoogleTokenError: If Google refuses the exchange or is unreachable.
        """
        payload = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "redirect_uri": self.redirect_uri,
            "grant_type": "authorization_code",
        }

        try:
            response = requests.post(self.token_url, data=payload, timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            error, description = _parse_error(e.response)
            raise GoogleTokenError(
                error=error,
                description=description or str(e),
                status_code=e.response.status_code if e.response is not None else None,
                body=e.response.text if e.response is not None else None,
            ) from e

        token_data = response.json()
        if "access_token" not in token_data:
            raise GoogleTokenError(
                error="missing_access_token",
                description="Google returned 200 with no access_token",
                status_code=response.status_code,
                body=response.text,
            )
        return token_data

    def get_user_info(self, access_token: str) -> Optional[OAuthUserInfo]:
        """
        Get user information using the access token.

        Args:
            access_token: The OAuth access token

        Returns:
            Optional[OAuthUserInfo]: The user information
        """
        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            response = requests.get(self.user_info_url, headers=headers, timeout=10)
            response.raise_for_status()
            user_data = response.json()

            # Convert to our schema
            return OAuthUserInfo(
                id=user_data["id"],
                email=user_data["email"],
                name=user_data.get("name"),
                picture=user_data.get("picture"),
                locale=user_data.get("locale"),
            )
        except requests.exceptions.RequestException as e:
            error, description = _parse_error(e.response)
            logger.error(
                f"Google refused the userinfo request: {error}",
                extra={
                    "google_error": error,
                    "google_error_description": description,
                    "google_status_code": (
                        e.response.status_code if e.response is not None else None
                    ),
                    "google_response_body": (
                        e.response.text if e.response is not None else None
                    ),
                },
            )
            return None
        except KeyError as e:
            logger.error(f"Missing field in Google user info response: {e}")
            return None


# Create a singleton instance
google_auth_client = GoogleAuthClient()
