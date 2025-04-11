import logging
import os
from typing import Dict, Optional

import requests
from app.schemas.user import OAuthUserInfo
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Load from environment variables
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI")


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

        # Build the URL with parameters
        auth_url = (
            f"{self.auth_base_url}?{'&'.join(f'{k}={v}' for k, v in params.items())}"
        )
        return auth_url

    def get_token(self, code: str) -> Optional[Dict]:
        """
        Exchange the authorization code for tokens.

        Args:
            code: The authorization code from the callback

        Returns:
            Optional[Dict]: The token response containing access_token, refresh_token, etc.
        """
        payload = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "redirect_uri": self.redirect_uri,
            "grant_type": "authorization_code",
        }

        try:
            response = requests.post(self.token_url, data=payload)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Error getting token from Google: {e}")
            return None

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
            response = requests.get(self.user_info_url, headers=headers)
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
            logger.error(f"Error getting user info from Google: {e}")
            return None
        except KeyError as e:
            logger.error(f"Missing field in Google user info response: {e}")
            return None


# Create a singleton instance
google_auth_client = GoogleAuthClient()
