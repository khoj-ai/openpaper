from app.api.subscription.checkout import router as checkout_router
from app.api.subscription.interval import router as interval_router
from app.api.subscription.portal import router as portal_router
from app.api.subscription.status import router as status_router
from app.api.subscription.webhook import router as webhook_router
from fastapi import APIRouter

subscription_router = APIRouter()
subscription_router.include_router(checkout_router)
subscription_router.include_router(status_router)
subscription_router.include_router(portal_router)
subscription_router.include_router(interval_router)
subscription_router.include_router(webhook_router)
