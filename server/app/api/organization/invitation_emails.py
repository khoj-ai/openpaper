import logging

from app.database.crud.organization_crud import is_paid, organization_invitation_crud
from app.database.models import Organization
from app.helpers.email import send_organization_invite_email
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def send_held_invitations(db: Session, organization: Organization) -> int:
    """Email every invitation that hasn't been sent yet, if the team is paid.
    Invitations added during setup wait here until checkout goes through.
    Returns how many were sent."""
    if not is_paid(organization):
        return 0

    invitations = organization_invitation_crud.claim_unsent(db, organization.id)  # type: ignore[arg-type]
    for invitation in invitations:
        inviter = invitation.inviter
        send_organization_invite_email(
            to_email=str(invitation.email),
            from_name=(
                str(inviter.name or inviter.email) if inviter else "Your team admin"
            ),
            organization_name=str(organization.name),
        )
    if invitations:
        logger.info(f"Sent {len(invitations)} invitation(s) for team {organization.id}")
    return len(invitations)
