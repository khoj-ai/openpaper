import json
import logging
import os
import random
import secrets
from datetime import datetime, timezone
from typing import Optional

from app.auth.dependencies import get_current_user, get_required_user
from app.auth.email import email_auth_client
from app.auth.google import google_auth_client
from app.auth.utils import (
    clear_session_cookie,
    is_verification_code_valid,
    set_session_cookie,
)
from app.database.crud.annotation_crud import annotation_crud
from app.database.crud.highlight_crud import highlight_crud
from app.database.crud.message_crud import message_crud
from app.database.crud.paper_crud import paper_crud
from app.database.crud.user_crud import user as user_crud
from app.database.database import get_db
from app.database.models import PaperStatus
from app.database.telemetry import track_event
from app.helpers.email import add_to_default_audience, send_onboarding_email
from app.schemas.user import CurrentUser, UserCreateWithProvider, UserUpdate
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

auth_router = APIRouter()

client_domain = os.getenv("CLIENT_DOMAIN", "http://localhost:3000")
api_domain = os.getenv("API_DOMAIN", "http://localhost:8000")


class AuthResponse(BaseModel):
    """Response model for auth routes."""

    success: bool
    message: str
    user: Optional[CurrentUser] = None
    newly_created: bool = False


@auth_router.get("/me", response_model=AuthResponse)
async def get_me(current_user: Optional[CurrentUser] = Depends(get_current_user)):
    """Get the current user."""
    if not current_user:
        return AuthResponse(success=False, message="Not authenticated")

    # Track the event of fetching user details
    track_event("user_details_fetched", user_id=str(current_user.id))
    return AuthResponse(success=True, message="User found", user=current_user)


@auth_router.get("/onboarding")
async def get_onboarding_status(
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    # Check if the user has any documents, highlights, annotations, or messages
    has_highlights = highlight_crud.has_any(db, user=current_user)
    has_annotations = annotation_crud.has_any(db, user=current_user)
    has_messages = message_crud.has_any(db, user=current_user)
    has_papers = paper_crud.has_any(db, user=current_user)
    has_completed_paper = bool(
        paper_crud.get_by(db, user=current_user, status=PaperStatus.completed)
    )

    onboarding_completed = all(
        [
            has_highlights,
            has_annotations,
            has_messages,
            has_papers,
            has_completed_paper,
        ]
    )

    onboarding_status = {
        "onboarding_completed": onboarding_completed,
        "has_highlights": has_highlights,
        "has_annotations": has_annotations,
        "has_messages": has_messages,
        "has_papers": has_papers,
        "has_completed_paper": has_completed_paper,
    }

    return Response(
        content=json.dumps(onboarding_status),
        status_code=200,
        media_type="application/json",
    )


@auth_router.get("/topics")
async def get_topics(
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """
    Get the list of topics for the current user.
    This can be used to fetch user-specific topics or general topics.
    """
    topics = paper_crud.get_topics(db, user=current_user)
    # randomly shuffle the topics
    random.shuffle(topics)

    return Response(
        content=json.dumps(topics),
        status_code=200,
        media_type="application/json",
    )


@auth_router.get("/logout")
async def logout(
    response: Response,
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
    all_devices: bool = Query(False),
):
    """Logout the current user."""
    if all_devices and current_user:
        # Revoke all user sessions
        user_crud.revoke_all_sessions(db=db, user_id=current_user.id)
    else:
        # Get token from cookie (handled in auth dependency)
        token = response.headers.get("Set-Cookie")
        if token:
            # Revoke this specific session
            user_crud.revoke_session(db=db, token=token)

    # Clear the session cookie
    clear_session_cookie(response)

    return AuthResponse(success=True, message="Logged out successfully")


@auth_router.get("/google/login")
async def google_login():
    """Start Google OAuth flow."""
    # Generate a random state for security
    state = secrets.token_urlsafe(32)

    # Get the authorization URL
    auth_url = google_auth_client.get_auth_url(state=state)

    return {"auth_url": auth_url}


@auth_router.get("/google/callback", response_class=RedirectResponse)
async def google_callback(
    request: Request,
    code: str = Query(...),
    db: Session = Depends(get_db),
):
    """Handle Google OAuth callback."""
    try:
        # Exchange the code for a token
        token_data = google_auth_client.get_token(code)
        if not token_data or "access_token" not in token_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to get access token",
            )

        # Get user info from Google
        user_info = google_auth_client.get_user_info(token_data["access_token"])
        if not user_info:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to get user info",
            )

        # Check if user exists with a different provider
        existing_user = user_crud.get_by_email_and_provider(
            db, email=user_info.email, provider="google"
        )
        user_with_different_provider = user_crud.get_by_email(db, email=user_info.email)

        if user_with_different_provider and not existing_user:
            # User exists but with a different provider
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User logged in with different method",
            )

        # Create or update user
        user_data = UserCreateWithProvider(
            email=user_info.email,
            name=user_info.name,
            picture=user_info.picture,
            locale=user_info.locale,
            auth_provider="google",
            provider_user_id=user_info.id,
        )

        db_user, newly_created = user_crud.upsert_with_provider(db=db, obj_in=user_data)

        # Track user signup event
        if newly_created:
            add_to_default_audience(
                email=str(db_user.email), name=str(db_user.name) or None
            )
            send_onboarding_email(
                email=str(db_user.email), name=str(db_user.name) or None
            )
            track_event(
                "user_signup",
                properties={"auth_provider": "google"},
                user_id=str(db_user.id),
            )

        # Create a new session
        user_agent = request.headers.get("user-agent")
        client_host = request.client.host if request.client else None

        if not db_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found after creation",
            )

        session = user_crud.create_session(
            db=db,
            user_id=db_user.id,  # type: ignore
            user_agent=user_agent,
            ip_address=client_host,
        )

        # Create redirect response
        redirect_url = f"{client_domain}/auth/callback?success=true"

        if newly_created:
            redirect_url += "&welcome=true"

        redirect_response = RedirectResponse(
            url=redirect_url, status_code=status.HTTP_302_FOUND
        )

        # Set the session cookie on the redirect response
        set_session_cookie(
            redirect_response, token=session.token, expires_at=session.expires_at  # type: ignore
        )

        # Set a header that the frontend can use to detect successful auth
        redirect_response.headers["X-Auth-Success"] = "true"

        return redirect_response
    except Exception as e:
        logger.error(f"Error during Google OAuth callback: {e}")
        # Redirect to frontend with failure status
        redirect_url = f"{client_domain}/auth/callback?success=false"
        redirect_response = RedirectResponse(
            url=redirect_url, status_code=status.HTTP_302_FOUND
        )
        return redirect_response


# Email Authentication Models
class EmailSignInRequest(BaseModel):
    """Request model for email sign-in."""

    email: str


class EmailSetNameRequest(BaseModel):
    """Request model for setting name."""

    email: str
    name: str


class EmailVerifyRequest(BaseModel):
    """Request model for email verification."""

    email: str
    code: str


@auth_router.post("/email/signin", response_model=AuthResponse)
async def email_signin(
    request: EmailSignInRequest,
    db: Session = Depends(get_db),
):
    """
    Initiate email sign-in by sending a 6-digit verification code.
    Creates user if they don't exist.
    """
    try:
        email = request.email.lower().strip()

        # Check if user exists with email auth provider
        db_user = user_crud.get_by_email_and_provider(db, email=email, provider="email")

        newly_created = False

        # If user doesn't exist, create them
        if not db_user:
            db_user = user_crud.create_email_user(db, email=email)
            logger.info(f"Created new email user: {email}")
            newly_created = True

        # Generate verification code
        code, expires_at = email_auth_client.generate_verification_data()

        # Update user with verification code
        user_crud.update_verification_code(
            db, user=db_user, code=code, expires_at=expires_at
        )

        # Send verification email
        success = email_auth_client.send_verification_code(email, code)

        if success:
            track_event("email_signin_initiated", user_id=str(db_user.id))
            return AuthResponse(
                success=True,
                message="Verification code sent to your email",
                newly_created=newly_created,
            )
        else:
            return AuthResponse(
                success=False,
                message="Failed to send verification code. Please try again.",
            )

    except Exception as e:
        logger.error(f"Error during email sign-in: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during sign-in",
        )


@auth_router.post("/email/fullname", response_model=AuthResponse)
async def email_set_name(
    request: EmailSetNameRequest,
    db: Session = Depends(get_db),
):
    """
    Set name for email user if they don't have one.
    """
    try:
        email = request.email.lower().strip()

        # Check if user exists with email auth provider
        db_user = user_crud.get_by_email_and_provider(db, email=email, provider="email")

        if not db_user:
            return AuthResponse(success=False, message="User not found")

        if db_user.name:
            return AuthResponse(success=True, message="Name already set", user=db_user)

        # Update user with name
        user_crud.update(
            db, db_obj=db_user, obj_in=UserUpdate(name=request.name), user=db_user
        )

        return AuthResponse(success=True, message="Name set successfully")

    except Exception as e:
        logger.error(f"Error during setting name: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during setting name",
        )


@auth_router.post("/email/verify", response_model=AuthResponse)
async def email_verify(
    request: EmailVerifyRequest,
    http_request: Request,
    db: Session = Depends(get_db),
):
    """
    Verify email with 6-digit code and create session.
    """
    try:

        email = request.email.lower().strip()
        code = request.code.strip()

        # Find user with email auth provider
        db_user = user_crud.get_by_email_and_provider(db, email=email, provider="email")

        if not db_user:
            return AuthResponse(success=False, message="User not found")

        new_user = db_user.is_email_verified == False

        # Check if verification code matches and is not expired
        verification_token = str(db_user.email_verification_token)
        verification_expires = datetime.fromisoformat(
            str(db_user.email_verification_expires_at)
        )

        if (
            not verification_token
            or not verification_expires
            or not is_verification_code_valid(
                verification_expires, code, verification_token
            )
        ):

            return AuthResponse(
                success=False, message="Invalid or expired verification code"
            )

        # Mark email as verified and clear verification code
        user_crud.verify_email(db, user=db_user)

        # Create a new session
        user_agent = http_request.headers.get("user-agent")
        client_host = http_request.client.host if http_request.client else None

        session = user_crud.create_session(
            db=db,
            user_id=getattr(db_user, "id"),
            user_agent=user_agent,
            ip_address=client_host,
        )

        # Create redirect URL
        redirect_url = f"{client_domain}/auth/callback?success=true"

        if new_user:
            redirect_url += "&welcome=true"
            add_to_default_audience(email=email, name=None)

        # Create JSON response with redirect info
        response_data = {
            "success": True,
            "message": "Email verified successfully",
            "redirectUrl": redirect_url,
        }

        # Create response and set the session cookie
        response = Response(
            content=json.dumps(response_data),
            status_code=200,
            media_type="application/json",
        )

        # Set the session cookie on the response
        set_session_cookie(
            response, token=session.token, expires_at=session.expires_at  # type: ignore
        )

        track_event("email_signin_completed", user_id=str(db_user.id))

        return response

    except Exception as e:
        logger.error(f"Error during email verification: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during verification",
        )
