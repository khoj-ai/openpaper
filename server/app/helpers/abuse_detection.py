import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.database.models import User
from app.helpers.email import send_email
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

ADMIN_EMAIL = os.getenv("ROOT_EMAIL", "saba@khoj.dev")
ABUSE_LOOKBACK_DAYS = 30


def normalize_email(email: str) -> str:
    """
    Normalize an email address to detect duplicate accounts.

    For Gmail/Googlemail: remove dots and +aliases from the local part.
    For all addresses: lowercase everything.
    """
    email = email.lower().strip()
    local, _, domain = email.partition("@")
    if not domain:
        return email

    if domain in ("gmail.com", "googlemail.com"):
        local = local.split("+")[0]
        local = local.replace(".", "")
        domain = "gmail.com"

    return f"{local}@{domain}"


def normalize_name(name: Optional[str]) -> str:
    """Normalize a name for comparison: lowercase, strip, collapse whitespace."""
    if not name:
        return ""
    return " ".join(name.lower().split())


def _email_local_part(email: str) -> str:
    """Extract and lowercase the local part of an email."""
    return email.lower().split("@")[0]


def _simple_similarity(a: str, b: str) -> float:
    """
    Simple character-level similarity ratio between two strings.
    Returns 0.0 to 1.0. Uses sorted character frequency overlap
    so we don't need external deps like python-Levenshtein.
    """
    if not a or not b:
        return 0.0
    a, b = a.lower(), b.lower()
    if a == b:
        return 1.0

    # Bigram similarity (Dice coefficient)
    def bigrams(s: str) -> list[str]:
        return [s[i : i + 2] for i in range(len(s) - 1)]

    a_bigrams = bigrams(a)
    b_bigrams = bigrams(b)
    if not a_bigrams or not b_bigrams:
        return 0.0

    b_set = list(b_bigrams)
    overlap = 0
    for bg in a_bigrams:
        if bg in b_set:
            overlap += 1
            b_set.remove(bg)

    return (2.0 * overlap) / (len(a_bigrams) + len(b_bigrams))


def check_signup_abuse(
    db: Session,
    new_user: User,
) -> list[dict]:
    """
    Check if a newly created user matches patterns of suspected abuse.

    Returns a list of match dicts, each describing a suspicious existing account
    and the reason(s) it was flagged.
    """
    new_email = str(new_user.email).lower()
    new_name = normalize_name(str(new_user.name) if new_user.name else None)
    new_normalized_email = normalize_email(new_email)
    new_local = _email_local_part(new_email)

    cutoff = datetime.now(timezone.utc) - timedelta(days=ABUSE_LOOKBACK_DAYS)

    recent_users = (
        db.query(User)
        .filter(
            User.id != new_user.id,
            User.created_at >= cutoff,
        )
        .all()
    )

    matches: list[dict] = []

    for existing in recent_users:
        reasons: list[str] = []
        existing_email = str(existing.email).lower()
        existing_name = normalize_name(str(existing.name) if existing.name else None)

        # Check 1: Exact normalized email match (Gmail dot/alias tricks)
        if normalize_email(existing_email) == new_normalized_email:
            reasons.append(
                f"Normalized email match: both resolve to {new_normalized_email}"
            )

        # Check 2: Exact name match (case-insensitive)
        if new_name and existing_name and new_name == existing_name:
            reasons.append(f"Exact name match: '{new_name}'")

        # Check 3: High email local-part similarity
        existing_local = _email_local_part(existing_email)
        similarity = _simple_similarity(new_local, existing_local)
        if similarity >= 0.75 and new_local != existing_local:
            reasons.append(
                f"Similar email local part: '{new_local}' vs '{existing_local}' "
                f"(similarity: {similarity:.0%})"
            )

        if reasons:
            matches.append(
                {
                    "existing_user_id": str(existing.id),
                    "existing_email": existing_email,
                    "existing_name": existing_name,
                    "created_at": str(existing.created_at),
                    "reasons": reasons,
                }
            )

    return matches


def send_abuse_alert(new_user: User, matches: list[dict]) -> None:
    """Send an email to the admin alerting them of suspected signup abuse."""
    new_email = str(new_user.email)
    new_name = str(new_user.name) if new_user.name else "N/A"

    match_rows = ""
    for m in matches:
        reasons_html = "<br>".join(f"&bull; {r}" for r in m["reasons"])
        match_rows += f"""
        <tr>
            <td style="padding:8px;border:1px solid #ddd;">{m['existing_email']}</td>
            <td style="padding:8px;border:1px solid #ddd;">{m['existing_name']}</td>
            <td style="padding:8px;border:1px solid #ddd;">{m['created_at']}</td>
            <td style="padding:8px;border:1px solid #ddd;">{reasons_html}</td>
        </tr>
        """

    html = f"""
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;">
        <h2 style="color:#e74c3c;">Suspected Signup Abuse Detected</h2>
        <p>A new account was created that matches existing accounts:</p>

        <h3>New Account</h3>
        <table style="border-collapse:collapse;width:100%;">
            <tr>
                <td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Email</td>
                <td style="padding:8px;border:1px solid #ddd;">{new_email}</td>
            </tr>
            <tr>
                <td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Name</td>
                <td style="padding:8px;border:1px solid #ddd;">{new_name}</td>
            </tr>
            <tr>
                <td style="padding:8px;border:1px solid #ddd;font-weight:bold;">User ID</td>
                <td style="padding:8px;border:1px solid #ddd;">{new_user.id}</td>
            </tr>
        </table>

        <h3>Matching Accounts</h3>
        <table style="border-collapse:collapse;width:100%;">
            <tr style="background:#f5f5f5;">
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Email</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Name</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Created</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Reasons</th>
            </tr>
            {match_rows}
        </table>

        <p style="margin-top:16px;color:#666;">
            You can block this user from the
            <a href="https://openpaper.ai/admin">admin panel</a>.
        </p>
    </div>
    """

    try:
        send_email(
            to_email=ADMIN_EMAIL,
            subject=f"[Abuse Alert] Suspicious signup: {new_email}",
            html_content=html,
            from_name="Open Paper Alerts",
            from_address="noreply@updates.openpaper.ai",
        )
        logger.info(f"Abuse alert sent for new user {new_email}")
    except Exception as e:
        logger.error(f"Failed to send abuse alert email: {e}", exc_info=True)
