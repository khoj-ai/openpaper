"""Team invitations, seats, membership rules, Stripe sync, and API permissions,
against a real database.

These are all conditional writes and joins whose correctness only exists at the
database, so mocking the session would assert nothing. They run against the
configured Postgres and skip when it isn't reachable.
"""

import secrets
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import text

try:
    from app.api.organization import stripe_events
    from app.api.subscription import config as subscription_config
    from app.auth.dependencies import get_required_user
    from app.database.crud.organization_crud import (
        OrganizationCreate,
        OrganizationError,
        organization_crud,
        organization_invitation_crud,
    )
    from app.database.database import SessionLocal, engine
    from app.database.models import (
        Organization,
        OrganizationRoles,
        SubscriptionPlan,
        SubscriptionStatus,
        User,
    )
    from app.helpers.subscription_limits import get_user_subscription_plan
    from app.main import app
    from app.schemas.user import CurrentUser
    from fastapi.testclient import TestClient

    with engine.connect() as probe:
        probe.execute(text("SELECT 1 FROM organizations LIMIT 1"))
    DB_AVAILABLE = True
except Exception:  # pragma: no cover - depends on the developer's environment
    DB_AVAILABLE = False

TEAM_PRICE = "price_test_team_monthly"
PERSONAL_PRICE = "price_test_personal_monthly"


class TeamTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()
        self.created_users: list = []
        self.created_orgs: list = []
        self.addCleanup(self._cleanup)

    def _cleanup(self) -> None:
        self.db.rollback()
        for org_id in self.created_orgs:
            self.db.query(Organization).filter(Organization.id == org_id).delete()
        for user_id in self.created_users:
            self.db.query(User).filter(User.id == user_id).delete()
        self.db.commit()
        self.db.close()

    def _user(self) -> User:
        token = secrets.token_hex(8)
        user = User(
            email=f"team-test-{token}@example.com",
            name=f"Tester {token[:4]}",
            auth_provider="email",
            provider_user_id=token,
        )
        self.db.add(user)
        self.db.commit()
        self.created_users.append(user.id)
        return user

    def _team(self, admin: User, *, seats: int = 3, paid: bool = True) -> Organization:
        org = organization_crud.create_with_admin(
            self.db, obj_in=OrganizationCreate(name="Lab"), admin_user_id=admin.id
        )
        self.created_orgs.append(org.id)
        org.seats = seats
        if paid:
            org.status = SubscriptionStatus.ACTIVE.value
            org.current_period_end = datetime.now(timezone.utc) + timedelta(days=30)
        self.db.commit()
        return org

    def _invite(self, org: Organization, email: str, by: User):
        return organization_invitation_crud.invite(
            self.db, organization=org, email=email, invited_by=by.id
        )


@unittest.skipUnless(DB_AVAILABLE, "requires a migrated Postgres")
class TestInvitationsAndSeats(TeamTestCase):
    def test_pending_invitations_hold_seats(self) -> None:
        admin = self._user()
        org = self._team(admin, seats=3)  # admin takes one seat

        self._invite(org, "a@example.com", admin)
        self._invite(org, "b@example.com", admin)
        with self.assertRaises(OrganizationError):
            self._invite(org, "c@example.com", admin)

        self.assertEqual(organization_crud.seats_taken(self.db, org.id), 3)

    def test_reinviting_returns_the_same_invitation_without_another_seat(self) -> None:
        admin = self._user()
        org = self._team(admin, seats=2)

        first = self._invite(org, "Student@Example.com", admin)
        second = self._invite(org, "student@example.com ", admin)

        self.assertEqual(first.id, second.id)
        self.assertEqual(organization_crud.seats_taken(self.db, org.id), 2)

    def test_cannot_invite_an_existing_member(self) -> None:
        admin = self._user()
        org = self._team(admin)
        with self.assertRaises(OrganizationError):
            self._invite(org, str(admin.email).upper(), admin)

    def test_only_the_invited_address_can_accept(self) -> None:
        admin, invitee, other = self._user(), self._user(), self._user()
        org = self._team(admin)
        invitation = self._invite(org, str(invitee.email), admin)

        with self.assertRaises(OrganizationError):
            organization_invitation_crud.accept(
                self.db,
                invitation_id=invitation.id,
                user_id=other.id,
                user_email=str(other.email),
            )

        organization_invitation_crud.accept(
            self.db,
            invitation_id=invitation.id,
            user_id=invitee.id,
            user_email=str(invitee.email).upper(),
        )
        self.assertIsNotNone(
            organization_crud.get_membership(
                self.db, organization_id=org.id, user_id=invitee.id
            )
        )
        # The accepted invitation became a member; the seat count doesn't change.
        self.assertEqual(organization_crud.seats_taken(self.db, org.id), 2)
        self.assertEqual(
            get_user_subscription_plan(self.db, invitee), SubscriptionPlan.TEAM
        )

    def test_accepted_invitation_cannot_be_accepted_twice(self) -> None:
        admin, invitee = self._user(), self._user()
        org = self._team(admin)
        invitation = self._invite(org, str(invitee.email), admin)
        kwargs = dict(
            invitation_id=invitation.id,
            user_id=invitee.id,
            user_email=str(invitee.email),
        )
        organization_invitation_crud.accept(self.db, **kwargs)
        with self.assertRaises(OrganizationError):
            organization_invitation_crud.accept(self.db, **kwargs)

    def test_rejecting_frees_the_seat(self) -> None:
        admin, invitee = self._user(), self._user()
        org = self._team(admin, seats=2)
        invitation = self._invite(org, str(invitee.email), admin)

        organization_invitation_crud.reject(
            self.db, invitation_id=invitation.id, user_email=str(invitee.email)
        )
        self.assertEqual(organization_crud.seats_taken(self.db, org.id), 1)


@unittest.skipUnless(DB_AVAILABLE, "requires a migrated Postgres")
class TestAdminRules(TeamTestCase):
    def test_last_admin_cannot_leave_or_be_demoted(self) -> None:
        admin = self._user()
        org = self._team(admin)

        with self.assertRaises(OrganizationError):
            organization_crud.remove_member(
                self.db, organization_id=org.id, user_id=admin.id
            )
        with self.assertRaises(OrganizationError):
            organization_crud.set_role(
                self.db,
                organization_id=org.id,
                user_id=admin.id,
                role=OrganizationRoles.MEMBER,
            )

    def test_admin_can_leave_after_promoting_someone(self) -> None:
        admin, member = self._user(), self._user()
        org = self._team(admin)
        invitation = self._invite(org, str(member.email), admin)
        organization_invitation_crud.accept(
            self.db,
            invitation_id=invitation.id,
            user_id=member.id,
            user_email=str(member.email),
        )

        organization_crud.set_role(
            self.db,
            organization_id=org.id,
            user_id=member.id,
            role=OrganizationRoles.ADMIN,
        )
        organization_crud.remove_member(
            self.db, organization_id=org.id, user_id=admin.id
        )

        self.assertTrue(
            organization_crud.is_admin(
                self.db, organization_id=org.id, user_id=member.id
            )
        )


class _StripeMetadata:
    """Like stripe's StripeObject: indexing and `in` work, dict methods don't."""

    def __init__(self, data):
        self._data = data

    def __contains__(self, key):
        return key in self._data

    def __getitem__(self, key):
        return self._data[key]

    def __bool__(self):
        return bool(self._data)


def _stripe_subscription(org_id, *, sub_id, price=TEAM_PRICE, quantity=5, **extra):
    now = int(datetime.now(timezone.utc).timestamp())
    item = SimpleNamespace(
        price=SimpleNamespace(id=price),
        quantity=quantity,
        current_period_start=now,
        current_period_end=now + 30 * 24 * 3600,
    )

    class Sub(SimpleNamespace):
        def __getitem__(self, key):
            return getattr(self, key)

    return Sub(
        id=sub_id,
        customer="cus_test",
        status=extra.pop("status", "active"),
        items={"data": [item]},
        metadata=_StripeMetadata({"organization_id": str(org_id)}),
        cancel_at_period_end=False,
        cancel_at=None,
        canceled_at=None,
        **extra,
    )


def _event(event_type, obj):
    return {"type": event_type, "data": {"object": obj}}


@unittest.skipUnless(DB_AVAILABLE, "requires a migrated Postgres")
class TestTeamStripeEvents(TeamTestCase):
    def setUp(self) -> None:
        super().setUp()
        for name, value in [
            ("TEAM_MONTHLY_PRICE_ID", TEAM_PRICE),
            ("TEAM_YEARLY_PRICE_ID", "price_test_team_yearly"),
        ]:
            patcher = patch.object(subscription_config, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _handle(self, event_type, obj) -> bool:
        return stripe_events.handle_team_stripe_event(self.db, _event(event_type, obj))

    def test_created_links_the_team_and_pays_its_seats(self) -> None:
        admin = self._user()
        org = self._team(admin, paid=False)
        sub_id = f"sub_{secrets.token_hex(6)}"

        handled = self._handle(
            "customer.subscription.created",
            _stripe_subscription(org.id, sub_id=sub_id, quantity=5),
        )

        self.db.refresh(org)
        self.assertTrue(handled)
        self.assertEqual(org.stripe_subscription_id, sub_id)
        self.assertEqual(org.status, "active")
        self.assertEqual(org.seats, 5)
        self.assertEqual(org.plan, SubscriptionPlan.TEAM.value)
        self.assertEqual(
            get_user_subscription_plan(self.db, admin), SubscriptionPlan.TEAM
        )

    def test_quantity_change_updates_seats_and_deletion_ends_coverage(self) -> None:
        admin = self._user()
        org = self._team(admin, paid=False)
        sub_id = f"sub_{secrets.token_hex(6)}"
        self._handle(
            "customer.subscription.created",
            _stripe_subscription(org.id, sub_id=sub_id, quantity=5),
        )

        self._handle(
            "customer.subscription.updated",
            _stripe_subscription(org.id, sub_id=sub_id, quantity=8),
        )
        self.db.refresh(org)
        self.assertEqual(org.seats, 8)

        self._handle(
            "customer.subscription.deleted",
            _stripe_subscription(org.id, sub_id=sub_id, quantity=8),
        )
        self.db.refresh(org)
        self.assertEqual(org.status, SubscriptionStatus.CANCELED.value)
        self.assertEqual(
            get_user_subscription_plan(self.db, admin), SubscriptionPlan.BASIC
        )

    def test_personal_prices_fall_through(self) -> None:
        org = self._team(self._user(), paid=False)
        handled = self._handle(
            "customer.subscription.created",
            _stripe_subscription(
                org.id, sub_id=f"sub_{secrets.token_hex(6)}", price=PERSONAL_PRICE
            ),
        )
        self.assertFalse(handled)

    def test_failed_payment_marks_past_due_and_tells_admins(self) -> None:
        admin = self._user()
        org = self._team(admin, paid=False)
        sub_id = f"sub_{secrets.token_hex(6)}"
        self._handle(
            "customer.subscription.created",
            _stripe_subscription(org.id, sub_id=sub_id),
        )

        invoice = SimpleNamespace(id="in_test", subscription=sub_id)
        with patch.object(stripe_events, "notify_billing_issue") as notify:
            handled = self._handle("invoice.payment_failed", invoice)

        self.db.refresh(org)
        self.assertTrue(handled)
        self.assertEqual(org.status, SubscriptionStatus.PAST_DUE.value)
        self.assertEqual(notify.call_args.args[0], admin.email)
        self.assertEqual(
            get_user_subscription_plan(self.db, admin), SubscriptionPlan.BASIC
        )

    def test_invoices_for_other_subscriptions_fall_through(self) -> None:
        invoice = SimpleNamespace(id="in_test", subscription="sub_not_a_team")
        self.assertFalse(self._handle("invoice.payment_succeeded", invoice))


@unittest.skipUnless(DB_AVAILABLE, "requires a migrated Postgres")
class TestTeamApiPermissions(TeamTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.client = TestClient(app)
        self.addCleanup(app.dependency_overrides.clear)

    def _as(self, user: User) -> None:
        app.dependency_overrides[get_required_user] = lambda: CurrentUser(
            id=uuid.UUID(str(user.id)), email=str(user.email), name=user.name
        )

    def test_non_members_get_404(self) -> None:
        org = self._team(self._user())
        self._as(self._user())
        self.assertEqual(
            self.client.get(f"/api/organization/{org.id}").status_code, 404
        )

    def test_members_cannot_do_admin_things(self) -> None:
        admin, member = self._user(), self._user()
        org = self._team(admin)
        invitation = self._invite(org, str(member.email), admin)
        organization_invitation_crud.accept(
            self.db,
            invitation_id=invitation.id,
            user_id=member.id,
            user_email=str(member.email),
        )

        self._as(member)
        detail = self.client.get(f"/api/organization/{org.id}").json()
        self.assertNotIn("invitations", detail)
        for method, path, body in [
            (
                "post",
                f"/api/organization/{org.id}/invitations",
                {"emails": ["x@example.com"]},
            ),
            ("get", f"/api/organization/{org.id}/usage", None),
            ("put", f"/api/organization/{org.id}/seats", {"seats": 10}),
            ("delete", f"/api/organization/{org.id}/members/{admin.id}", None),
        ]:
            response = self.client.request(method, path, json=body)
            self.assertEqual(response.status_code, 403, path)

    def test_member_can_leave(self) -> None:
        admin, member = self._user(), self._user()
        org = self._team(admin)
        invitation = self._invite(org, str(member.email), admin)
        organization_invitation_crud.accept(
            self.db,
            invitation_id=invitation.id,
            user_id=member.id,
            user_email=str(member.email),
        )

        self._as(member)
        response = self.client.delete(f"/api/organization/{org.id}/members/{member.id}")
        self.assertEqual(response.status_code, 200)

    def test_admin_invites_and_sees_usage_per_seat(self) -> None:
        admin = self._user()
        org = self._team(admin, seats=2)
        self._as(admin)

        with patch(
            "app.api.organization.organizations_api.send_organization_invite_email"
        ) as send:
            response = self.client.post(
                f"/api/organization/{org.id}/invitations",
                json={"emails": ["one@example.com", "two@example.com"]},
            ).json()

        self.assertEqual([i["email"] for i in response["invited"]], ["one@example.com"])
        self.assertEqual(response["failed"][0]["email"], "two@example.com")
        send.assert_called_once()

        usage = self.client.get(f"/api/organization/{org.id}/usage").json()
        self.assertEqual(len(usage["members"]), 1)
        self.assertEqual(usage["members"][0]["plan"], SubscriptionPlan.TEAM.value)

    def test_unpaid_team_cannot_invite(self) -> None:
        admin = self._user()
        org = self._team(admin, paid=False)
        self._as(admin)
        response = self.client.post(
            f"/api/organization/{org.id}/invitations",
            json={"emails": ["one@example.com"]},
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
