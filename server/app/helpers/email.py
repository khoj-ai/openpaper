import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Union

import resend

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY")
RESEND_MAIN_AUDIENCE_ID = os.getenv("RESEND_MAIN_AUDIENCE_ID")

resend.api_key = RESEND_API_KEY

YOUR_DOMAIN = os.getenv("FRONTEND_URL", "http://localhost:3000")

REPLY_TO_DEFAULT_EMAIL = "saba@openpaper.ai"


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


def add_to_default_audience(email: str, name: Union[str, None] = None) -> None:
    """
    Add a user to the default audience in Resend.

    Args:
        email (str): The email address of the user.
        name (str): The name of the user.
    """
    try:
        split_name = name.split() if name else []
        fname = split_name[0] if split_name else ""
        lname = " ".join(split_name[1:]) if len(split_name) > 1 else ""
        payload = resend.Contacts.CreateParams = {  # type: ignore
            "email": email,
            "first_name": fname,
            "last_name": lname,
            "unsubscribed": False,
            "audience_id": RESEND_MAIN_AUDIENCE_ID,
        }
        resend.Contacts.create(payload)  # type: ignore

    except Exception as e:
        logger.error(f"Failed to add user to audience: {e}", exc_info=True)


def send_onboarding_email(email: str, name: Union[str, None] = None) -> None:
    """
    Send an onboarding email to a new user.

    Args:
        email (str): The email address of the user.
        name (str): The name of the user.
    """

    try:
        one_minute_from_now = (
            datetime.now(timezone.utc) + timedelta(minutes=2)
        ).isoformat()
        split_name = name.split() if name else []
        fname = split_name[0] if split_name else ""
        formatted_name = f", {fname}" if fname else ""
        payload = resend.Emails.SendParams = {  # type: ignore
            "from": "Open Paper <onboarding@openpaper.ai>",
            "to": [email],
            "subject": "Welcome to Open Paper!",
            "html": load_email_template("onboarding.html").replace(
                "{{user_name}}", formatted_name
            ),
            "scheduled_at": one_minute_from_now,
            "reply_to": REPLY_TO_DEFAULT_EMAIL,
        }

        first_email = resend.Emails.send(payload)  # type: ignore

        two_days_from_now = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()

        payload = resend.Emails.SendParams = {  # type: ignore
            "from": "Open Paper <onboarding@openpaper.ai>",
            "to": [email],
            "subject": "How Researchers are Using AI to Read Papers",
            "html": load_email_template("some_tips.html"),
            "scheduled_at": two_days_from_now,
            "reply_to": "saba@openpaper.ai",
        }

        second_email = resend.Emails.send(payload)  # type: ignore

        four_days_from_now = (
            datetime.now(timezone.utc) + timedelta(days=4)
        ).isoformat()

        formatted_name = f" {fname}" if fname else ""

        payload = resend.Emails.SendParams = {  # type: ignore
            "from": "Open Paper <onboarding@openpaper.ai>",
            "to": [email],
            "subject": "Design Principles by Open Paper",
            "html": load_email_template("design_principles.html").replace(
                "{{user_name}}", formatted_name
            ),
            "scheduled_at": four_days_from_now,
            "reply_to": REPLY_TO_DEFAULT_EMAIL,
        }

        third_email = resend.Emails.send(payload)  # type: ignore

        logger.info(
            f"Onboarding emails sent successfully: {first_email['id'] if first_email else ''}, {second_email['id'] if second_email else ''}, {third_email['id'] if third_email else ''}"
        )

    except Exception as e:
        logger.error(f"Failed to send onboarding email: {e}", exc_info=True)


def notify_converted_billing_interval(
    email: str,
    new_interval: str,
    name: Union[str, None] = None,
) -> None:
    """
    Notify user about their billing interval change.

    Args:
        email (str): The email address of the user.
        name (str): The name of the user.
        new_interval (str): The new billing interval (e.g., "yearly").
    """
    try:
        subject = f"{new_interval.zfill(1).capitalize()} Cycle Activated - Open Paper"
        payload = resend.Emails.SendParams = {  # type: ignore
            "from": "Open Paper <support@updates.openpaper.ai>",
            "reply_to": REPLY_TO_DEFAULT_EMAIL,
            "to": [email],
            "subject": subject,
            "text": f"Hello {name},\n\nYour cycle has been successfully changed to {new_interval}. Thank you for your continued support for open research!\n\nOpen Paper Team",
        }

        resend.Emails.send(payload)  # type: ignore

    except Exception as e:
        logger.error(f"Failed to notify billing interval change: {e}", exc_info=True)


def notify_billing_issue(email: str, issue: str, name: Union[str, None] = None) -> None:
    """
    Notify user about a billing issue.

    Args:
        email (str): The email address of the user.
        name (str): The name of the user.
        issue (str): The type of billing issue (e.g., "payment").
    """
    try:
        manage_url = f"{YOUR_DOMAIN}/pricing"
        payload = resend.Emails.SendParams = {  # type: ignore
            "from": "Open Paper <support@updates.openpaper.ai>",
            "reply_to": REPLY_TO_DEFAULT_EMAIL,
            "to": [email],
            "subject": "Fulfillment Issue Detected",
            "text": f"Hello {name},\n\nWe have detected an issue with your account. {issue}.\n\nVisit {manage_url} for assistance.\n\nOpen Paper Team",
        }

        resend.Emails.send(payload)  # type: ignore

    except Exception as e:
        logger.error(f"Failed to notify billing issue: {e}", exc_info=True)


def send_subscription_welcome_email(
    email: str,
) -> None:
    """
    Send a welcome email to a new subscriber.

    Args:
        email (str): The email address of the user.
        name (str): The name of the user.
    """
    try:
        payload = resend.Emails.SendParams = {  # type: ignore
            "from": f"Saba <{REPLY_TO_DEFAULT_EMAIL}>",
            "to": [email],
            "subject": "What will you discover today? - Open Paper",
            "html": load_email_template("subscription_welcome.html"),
        }

        resend.Emails.send(payload)  # type: ignore

    except Exception as e:
        logger.error(f"Failed to send subscription welcome email: {e}", exc_info=True)
