from app.api.referral.routes import router as routes_router
from fastapi import APIRouter

referral_router = APIRouter()
referral_router.include_router(routes_router)
