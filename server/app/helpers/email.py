import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Union

import resend

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY")


def load_email_template(template_name: str) -> str:
    """Load HTML email template from templates directory"""
    # Get the directory of the current file
    current_dir = Path(__file__).parent
    template_path = current_dir / "templates" / template_name

    try:
        with open(template_path, "r", encoding="utf-8") as file:
            return file.read()
    except FileNotFoundError:
        raise FileNotFoundError(
            f"Template {template_name} not found at {template_path}"
        )


def send_onboarding_email(email: str, name: Union[str, None] = None) -> None:
    """
    Send an onboarding email to a new user.

    Args:
        email (str): The email address of the user.
        name (str): The name of the user.
    """
    if not RESEND_API_KEY:
        raise ValueError("RESEND_API_KEY environment variable is not set.")

    resend.api_key = RESEND_API_KEY

    try:
        one_minute_from_now = (
            datetime.now(timezone.utc) + timedelta(minutes=2)
        ).isoformat()
        formatted_name = f", {name}" if name else ""
        payload = resend.Emails.SendParams = {  # type: ignore
            "from": "Open Paper <onboarding@openpaper.ai>",
            "to": [email],
            "subject": "Welcome to Open Paper!",
            "html": load_email_template("onboarding.html").replace(
                "{{user_name}}", formatted_name
            ),
            "scheduled_at": one_minute_from_now,
            "reply_to": "saba@openpaper.ai",
        }

        email = resend.Emails.send(payload)  # type: ignore

    except Exception as e:
        logger.error(f"Failed to send onboarding email: {e}", exc_info=True)
