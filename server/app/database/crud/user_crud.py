import datetime
import logging
import secrets
import uuid
from typing import Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import Session as DBSession
from app.database.models import User
from app.schemas.user import UserCreate, UserCreateWithProvider, UserUpdate
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class CRUDUser(CRUDBase[User, UserCreate, UserUpdate]):
    def get_by_email(self, db: Session, *, email: str) -> Optional[User]:
        """Get a user by email."""
        return db.query(User).filter(User.email == email).first()

    def get_by_provider_id(
        self, db: Session, *, provider: str, provider_user_id: str
    ) -> Optional[User]:
        """Get a user by provider and provider's user ID."""
        return (
            db.query(User)
            .filter(
                User.auth_provider == provider,
                User.provider_user_id == provider_user_id,
            )
            .first()
        )

    def create_with_provider(
        self, db: Session, *, obj_in: UserCreateWithProvider
    ) -> User:
        """Create a new user from OAuth provider data."""
        db_obj = User(
            email=obj_in.email,
            name=obj_in.name,
            picture=obj_in.picture,
            auth_provider=obj_in.auth_provider,
            provider_user_id=obj_in.provider_user_id,
            locale=obj_in.locale,
            is_active=True,
            is_admin=False,
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def upsert_with_provider(
        self, db: Session, *, obj_in: UserCreateWithProvider
    ) -> User:
        """
        Create or update a user from OAuth provider data.
        If user exists (by provider ID), update their info.
        If not, create new user.
        """
        # First try to find by provider ID
        db_user = self.get_by_provider_id(
            db, provider=obj_in.auth_provider, provider_user_id=obj_in.provider_user_id
        )

        # If exists, update info
        if db_user:
            update_data = obj_in.model_dump(
                exclude={"auth_provider", "provider_user_id"}
            )
            for field, value in update_data.items():
                setattr(db_user, field, value)
            db.add(db_user)
            db.commit()
            db.refresh(db_user)
            return db_user

        # If not found by provider ID, check email (might have registered with another provider)
        db_user = self.get_by_email(db, email=obj_in.email)
        if db_user:
            # User exists with this email but different provider
            # Here you could implement a linking strategy for multiple providers
            # For now, we'll just log and use the existing account
            logger.info(
                f"User with email {obj_in.email} already exists with provider {db_user.auth_provider}, "
                f"but is now authenticating with {obj_in.auth_provider}"
            )
            # Update user with new provider info
            db_user.auth_provider = obj_in.auth_provider
            db_user.provider_user_id = obj_in.provider_user_id
            db_user.name = obj_in.name or db_user.name
            db_user.picture = obj_in.picture or db_user.picture
            db_user.locale = obj_in.locale or db_user.locale
            db.add(db_user)
            db.commit()
            db.refresh(db_user)
            return db_user

        # Create new user if not found
        return self.create_with_provider(db, obj_in=obj_in)

    def create_session(
        self,
        db: Session,
        *,
        user_id: UUID,
        user_agent: Optional[str] = None,
        ip_address: Optional[str] = None,
        expires_in_days: int = 30,
    ) -> DBSession:
        """Create a new session for a user."""
        token = secrets.token_hex(32)  # 64 characters
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            days=expires_in_days
        )

        session = DBSession(
            id=uuid.uuid4(),
            user_id=user_id,
            token=token,
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
        )

        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    def get_by_token(self, db: Session, *, token: str) -> Optional[DBSession]:
        """Get session by token."""
        now = datetime.datetime.now(datetime.timezone.utc)
        session = (
            db.query(DBSession)
            .filter(DBSession.token == token, DBSession.expires_at > now)
            .first()
        )
        return session

    def revoke_session(self, db: Session, *, token: str) -> bool:
        """Revoke (delete) a session."""
        session = db.query(DBSession).filter(DBSession.token == token).first()
        if session:
            db.delete(session)
            db.commit()
            return True
        return False

    def revoke_all_sessions(self, db: Session, *, user_id: UUID) -> int:
        """Revoke all sessions for a user."""
        result = db.query(DBSession).filter(DBSession.user_id == user_id).delete()
        db.commit()
        return result


user = CRUDUser(User)
