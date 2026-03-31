import logging
import os
from enum import Enum

import stripe

STRIPE_API_KEY = os.getenv("STRIPE_API_KEY")
if not STRIPE_API_KEY:
    raise ValueError("STRIPE_API_KEY environment variable is not set")

STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")

MONTHLY_PRICE_ID = os.getenv("STRIPE_MONTHLY_PRICE_ID")
YEARLY_PRICE_ID = os.getenv("STRIPE_YEARLY_PRICE_ID")
YOUR_DOMAIN = os.getenv("CLIENT_DOMAIN", "http://localhost:3000")

stripe.api_key = STRIPE_API_KEY

logger = logging.getLogger(__name__)


class SubscriptionInterval(str, Enum):
    MONTHLY = "month"
    YEARLY = "year"


def is_valid_price_id(price_id: str) -> bool:
    """Check if the price ID is one of our configured prices."""
    return price_id in [MONTHLY_PRICE_ID, YEARLY_PRICE_ID]
