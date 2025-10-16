import logging
import os
from datetime import datetime
from typing import Optional

from app.auth.utils import generate_verification_code, get_verification_code_expiry
from app.helpers.email import load_email_template, send_email
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class EmailAuthClient:
    """Email-based authentication client using 6-digit passcodes."""

    def send_verification_code(self, email: str, verification_code: str) -> bool:
        """
        Send a 6-digit verification code to the user's email.

        Args:
            email: The recipient's email address
            verification_code: The 6-digit verification code to send

        Returns:
            bool: True if email was sent successfully, False otherwise
        """
        try:
            subject = "Your Open Paper verification code"

            html_template = load_email_template("verification_code.html")
            html_content = html_template.replace(
                "{{verification_code}}", verification_code
            )

            text_template = load_email_template("verification_code.txt")
            text_content = text_template.replace(
                "{{verification_code}}", verification_code
            )

            # Send the email using the existing email helper
            success = send_email(
                to_email=email,
                subject=subject,
                html_content=html_content,
                text_content=text_content,
            )

            if success:
                logger.info(f"Verification code sent successfully to {email}")
                return True
            else:
                logger.error(f"Failed to send verification code to {email}")
                return False

        except Exception as e:
            logger.error(f"Error sending verification code to {email}: {str(e)}")
            return False

    def generate_verification_data(self) -> tuple[str, datetime]:
        """
        Generate verification code and expiry datetime.

        Returns:
            tuple: (verification_code, expires_at_datetime)
        """
        code = generate_verification_code()
        expires_at = get_verification_code_expiry()
        return code, expires_at


# Global instance
email_auth_client = EmailAuthClient()
