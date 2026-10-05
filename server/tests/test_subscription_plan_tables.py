import unittest

from app.database.models import SubscriptionPlan
from app.helpers.subscription_limits import PLAN_RANK, SUBSCRIPTION_LIMITS


class TestEveryPlanIsConfigured(unittest.TestCase):
    """A plan missing from either table fails at runtime: a KeyError when ranking
    plans, or a silent fallback to BASIC limits."""

    def test_every_plan_has_a_rank(self) -> None:
        self.assertEqual(set(PLAN_RANK), set(SubscriptionPlan))

    def test_every_plan_has_limits(self) -> None:
        self.assertEqual(set(SUBSCRIPTION_LIMITS), set(SubscriptionPlan))

    def test_limits_never_shrink_as_rank_grows(self) -> None:
        plans = sorted(SubscriptionPlan, key=PLAN_RANK.__getitem__)
        for lower, higher in zip(plans, plans[1:]):
            for key, value in SUBSCRIPTION_LIMITS[lower].items():
                self.assertGreaterEqual(
                    SUBSCRIPTION_LIMITS[higher][key], value, f"{higher} {key}"
                )


if __name__ == "__main__":
    unittest.main()
