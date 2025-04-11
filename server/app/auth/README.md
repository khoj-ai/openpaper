# Auth System Setup

This directory contains the authentication system for the application.

## Setup

1. Create a Google OAuth Client ID:

   a. Go to the [Google Cloud Console](https://console.cloud.google.com/)
   b. Create a new project (or use an existing one)
   c. Navigate to "APIs & Services" > "Credentials"
   d. Click "Create Credentials" > "OAuth client ID"
   e. Select "Web application" as the application type
   f. Add the following Authorized redirect URIs:
      - `http://localhost:8000/api/auth/google/callback` (for development)
      - `https://yourdomain.com/api/auth/google/callback` (for production)
   g. Click "Create" and note your Client ID and Client Secret

2. Add the following environment variables to your `.env` file:

```
# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback

# Session settings
SESSION_COOKIE_DOMAIN=localhost  # Optional, only needed for production
SECURE_COOKIES=false  # Set to true in production
```

3. Run migrations to create the auth tables:

```bash
python -m app.scripts.run_migrations
```

## How it Works

1. The auth system uses cookies and Bearer tokens for authentication
2. Google OAuth is implemented for authentication
3. User sessions are stored in the database for security
4. The system is designed to be extensible for additional OAuth providers

## Protecting Routes

Use the dependencies from `app.auth.dependencies` to protect your routes:

```python
from fastapi import Depends
from app.auth.dependencies import get_required_user, get_admin_user
from app.schemas.user import CurrentUser

@router.get("/protected-route")
async def protected_route(current_user: CurrentUser = Depends(get_required_user)):
    # Only authenticated users can access this
    return {"user": current_user}

@router.get("/admin-route")
async def admin_route(current_user: CurrentUser = Depends(get_admin_user)):
    # Only admin users can access this
    return {"admin": current_user}
```

## Frontend Integration

1. On the frontend, redirect users to `/api/auth/google/login` to begin authentication
2. Google will redirect to our callback URL which will set the session cookie
3. After successful authentication, the user will be redirected to `/auth/callback` on the frontend
4. Use `/api/me` endpoint to retrieve current user information

## Logging Out

Use the `/api/logout` endpoint to log out users. Set `all_devices=true` query parameter to log out from all devices.
