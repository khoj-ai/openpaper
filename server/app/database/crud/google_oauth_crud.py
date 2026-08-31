"""State tracking for the Google sign-in flow.

See `GoogleOAuthState` for why the flow needs server-side state at all: CSRF,
and making a single-use authorization code survive a callback URL that gets
fetched more than once.
"""

import datetime
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Optional
from uuid import UUID

from app.database.models import GoogleOAuthState
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Google's authorization codes last about 10 minutes. Outliving them buys
# nothing: past that point the exchange fails no matter what we remember.
STATE_TTL_MINUTES = 15

# Consumed rows are kept past their TTL so a late replay is still recognised as
# one rather than looking like a forged state.
RETENTION_MINUTES = 60


class ClaimOutcome(str, Enum):
    CLAIMED = "claimed"  # This request won; it should do the token exchange.
    REPLAY = "replay"  # Another request already exchanged this code.
    EXPIRED = "expired"  # Issued by us, but too long ago.
    UNKNOWN = "unknown"  # Never issued by us, or aged out of retention.


@dataclass
class ClaimResult:
    outcome: ClaimOutcome
    record: Optional[GoogleOAuthState] = None


class CRUDGoogleOAuthState:
    def create(self, db: Session, *, state: str) -> GoogleOAuthState:
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            minutes=STATE_TTL_MINUTES
        )
        db_obj = GoogleOAuthState(state=state, expires_at=expires_at)
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def claim(self, db: Session, *, state: str) -> ClaimResult:
        """Try to take ownership of a state, atomically.

        The conditional UPDATE is the whole point: a scanner and the user's
        browser can hit the callback concurrently with the same code, and only
        the request whose UPDATE matches a row may talk to Google. Everyone
        else is told it's a replay.
        """
        now = datetime.datetime.now(datetime.timezone.utc)
        claimed = (
            db.query(GoogleOAuthState)
            .filter(
                GoogleOAuthState.state == state,
                GoogleOAuthState.consumed_at.is_(None),
                GoogleOAuthState.expires_at > now,
            )
            .update({"consumed_at": now}, synchronize_session=False)
        )
        db.commit()

        record = (
            db.query(GoogleOAuthState)
            .filter(GoogleOAuthState.state == state)
            .one_or_none()
        )

        if claimed:
            return ClaimResult(ClaimOutcome.CLAIMED, record)
        if record is None:
            return ClaimResult(ClaimOutcome.UNKNOWN)
        if record.consumed_at is not None:
            return ClaimResult(ClaimOutcome.REPLAY, record)
        return ClaimResult(ClaimOutcome.EXPIRED, record)

    def attach_session(
        self,
        db: Session,
        *,
        record: GoogleOAuthState,
        session_id: UUID,
        was_new_user: bool,
    ) -> None:
        """Record the session a successful exchange produced.

        Without this a replay would be recognised but still land the user on a
        signed-out page, because the request that won the claim may have been
        the scanner rather than the browser.
        """
        record.session_id = session_id  # type: ignore[assignment]
        record.was_new_user = was_new_user  # type: ignore[assignment]
        db.commit()

    def release(self, db: Session, *, record: GoogleOAuthState) -> None:
        """Hand a claim back after an exchange that failed on our side.

        A network blip or a 5xx from Google leaves the code unspent, so the
        user retrying the same callback URL should be allowed to proceed rather
        than being told it's a replay.
        """
        record.consumed_at = None  # type: ignore[assignment]
        db.commit()

    def delete_stale(self, db: Session) -> int:
        """Drop rows no callback can still refer to.

        Called opportunistically from /google/login, which is unauthenticated
        and so is the one place rows accumulate.
        """
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
            minutes=RETENTION_MINUTES
        )
        deleted = (
            db.query(GoogleOAuthState)
            .filter(GoogleOAuthState.expires_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        return deleted


google_oauth_state_crud = CRUDGoogleOAuthState()
