"""Org members get their organization's plan, against a real database.

The resolution is a join across memberships and org billing state, so mocking
the session would assert nothing. These run against the configured Postgres and
skip when it isn't reachable.
"""

import secrets
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

try:
    from app.database.crud.organization_crud import (
        OrganizationCreate,
        organization_crud,
    )
    from app.database.crud.subscription_crud import subscription_crud
    from app.database.database import SessionLocal, engine
    from app.database.models import (
        Organization,
        OrganizationMembership,
        Subscription,
        SubscriptionPlan,
        SubscriptionStatus,
        User,
    )
    from app.helpers.subscription_limits import get_user_subscription_plan

    with engine.connect() as probe:
        probe.execute(text("SELECT 1 FROM organizations LIMIT 1"))
    DB_AVAILABLE = True
except Exception:  # pragma: no cover - depends on the developer's environment
    DB_AVAILABLE = False


@unittest.skipUnless(DB_AVAILABLE, "requires a migrated Postgres")
class TestOrganizationPlanResolution(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()
        self.created_users: list = []
        self.created_orgs: list = []
        self.addCleanup(self._cleanup)

    def _cleanup(self) -> None:
        for org_id in self.created_orgs:
            self.db.query(Organization).filter(Organization.id == org_id).delete()
        for user_id in self.created_users:
            self.db.query(User).filter(User.id == user_id).delete()
        self.db.commit()
        self.db.close()

    def _user(self) -> User:
        token = secrets.token_hex(8)
        user = User(
            email=f"org-test-{token}@example.com",
            auth_provider="email",
            provider_user_id=token,
        )
        self.db.add(user)
        self.db.commit()
        self.created_users.append(user.id)
        return user

    def _org(self, admin: User, *, status: str, period_end: datetime) -> Organization:
        org = organization_crud.create_with_admin(
            self.db, obj_in=OrganizationCreate(name="Lab"), admin_user_id=admin.id
        )
        org.status = status
        org.current_period_end = period_end
        self.db.commit()
        self.created_orgs.append(org.id)
        return org

    def _join(self, org: Organization, user: User) -> None:
        self.db.add(OrganizationMembership(organization_id=org.id, user_id=user.id))
        self.db.commit()

    def _plan(self, user: User) -> SubscriptionPlan:
        return get_user_subscription_plan(self.db, SimpleNamespace(id=user.id))

    def _future(self) -> datetime:
        return datetime.now(timezone.utc) + timedelta(days=30)

    def test_no_subscription_or_org_is_basic(self) -> None:
        self.assertEqual(self._plan(self._user()), SubscriptionPlan.BASIC)

    def test_member_of_paid_org_gets_team(self) -> None:
        admin, member = self._user(), self._user()
        org = self._org(
            admin, status=SubscriptionStatus.ACTIVE.value, period_end=self._future()
        )
        self._join(org, member)

        self.assertEqual(self._plan(member), SubscriptionPlan.TEAM)
        self.assertEqual(self._plan(admin), SubscriptionPlan.TEAM)

    def test_member_of_paid_org_counts_as_active(self) -> None:
        admin, member = self._user(), self._user()
        org = self._org(
            admin, status=SubscriptionStatus.ACTIVE.value, period_end=self._future()
        )
        self._join(org, member)

        self.assertTrue(subscription_crud.is_user_active(self.db, member))
        self.assertFalse(subscription_crud.is_user_active(self.db, self._user()))

    def test_org_that_never_finished_checkout_grants_nothing(self) -> None:
        admin = self._user()
        organization_crud.create_with_admin(
            self.db, obj_in=OrganizationCreate(name="Lab"), admin_user_id=admin.id
        )
        self.created_orgs += [
            o.id for o in organization_crud.get_for_user(self.db, admin.id)
        ]

        self.assertEqual(self._plan(admin), SubscriptionPlan.BASIC)

    def test_lapsed_org_grants_nothing(self) -> None:
        member = self._user()
        past = datetime.now(timezone.utc) - timedelta(days=1)
        org = self._org(
            self._user(), status=SubscriptionStatus.ACTIVE.value, period_end=past
        )
        self._join(org, member)

        self.assertEqual(self._plan(member), SubscriptionPlan.BASIC)

    def test_past_due_org_grants_nothing(self) -> None:
        member = self._user()
        org = self._org(
            self._user(),
            status=SubscriptionStatus.PAST_DUE.value,
            period_end=self._future(),
        )
        self._join(org, member)

        self.assertEqual(self._plan(member), SubscriptionPlan.BASIC)

    def test_personal_plan_survives_lapsed_org(self) -> None:
        member = self._user()
        self.db.add(
            Subscription(
                user_id=member.id,
                plan=SubscriptionPlan.RESEARCHER.value,
                status=SubscriptionStatus.ACTIVE.value,
                current_period_end=self._future(),
            )
        )
        self.db.commit()
        past = datetime.now(timezone.utc) - timedelta(days=1)
        org = self._org(
            self._user(), status=SubscriptionStatus.ACTIVE.value, period_end=past
        )
        self._join(org, member)

        self.assertEqual(self._plan(member), SubscriptionPlan.RESEARCHER)


@unittest.skipUnless(DB_AVAILABLE, "requires a migrated Postgres")
class TestPlanColumnsOnlyHoldValidTiers(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()
        self.addCleanup(self.db.close)

    def test_personal_subscription_cannot_be_team(self) -> None:
        token = secrets.token_hex(8)
        user = User(
            email=f"org-test-{token}@example.com",
            auth_provider="email",
            provider_user_id=token,
        )
        self.db.add(user)
        self.db.commit()
        self.addCleanup(self._delete_user, user.id)

        self.db.add(Subscription(user_id=user.id, plan=SubscriptionPlan.TEAM.value))
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def test_organization_cannot_be_researcher(self) -> None:
        self.db.add(Organization(name="Lab", plan=SubscriptionPlan.RESEARCHER.value))
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def _delete_user(self, user_id) -> None:
        self.db.query(User).filter(User.id == user_id).delete()
        self.db.commit()


if __name__ == "__main__":
    unittest.main()
