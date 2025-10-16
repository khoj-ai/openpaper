import logging
import uuid
from typing import Annotated, Optional

from app.database.crud.subscription_crud import subscription_crud
from app.database.crud.user_crud import user as user_crud
from app.database.database import get_db
from app.schemas.user import CurrentUser
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Session cookie name
SESSION_COOKIE_NAME = "session_token"

# Setup header auth
api_key_header = APIKeyHeader(name="Authorization", auto_error=False)


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    authorization: str = Depends(api_key_header),
) -> Optional[CurrentUser]:
    """
    Get the current user from session token in cookie or Authorization header.

    This is a FastAPI dependency that can be used in route functions.
    """
    token = None

    # First try from Authorization header
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "")

    # Then try from cookie
    if not token:
        token = request.cookies.get(SESSION_COOKIE_NAME)

    if not token:
        return None

    # Get session from database
    db_session = user_crud.get_by_token(db=db, token=token)
    if not db_session:
        return None

    # Get user from session
    db_user = user_crud.get(db=db, id=db_session.user_id)
    if not db_user or not db_user.is_active:
        return None

    if not db_user.id:
        logger.error("User ID is missing in the database record.")
        return None

    id_as_uuid = uuid.UUID(str(db_user.id))

    is_user_active = subscription_crud.is_user_active(db, db_user)

    # Return CurrentUser model
    return CurrentUser(
        id=id_as_uuid,
        email=str(db_user.email),
        name=str(db_user.name),
        is_admin=bool(db_user.is_admin),
        picture=str(db_user.picture),
        is_email_verified=bool(db_user.is_email_verified),
        is_active=is_user_active,
    )


async def get_required_user(
    current_user: Annotated[Optional[CurrentUser], Depends(get_current_user)]
) -> CurrentUser:
    """
    Require a logged-in user for protected routes.
    Raises 401 Unauthorized if no user is found.
    """
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user


async def get_admin_user(
    current_user: Annotated[CurrentUser, Depends(get_required_user)]
) -> CurrentUser:
    """
    Require an admin user for admin-only routes.
    Raises 403 Forbidden if user is not admin.
    """
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    return current_user
