"""Cover email sign-in's handling of addresses that are not addresses.

The bug these guard against: sign-in created the account and asked the mail
provider to deliver the code before anything checked the address was one. A
sign-in as a bare username like "admin" therefore logged a send failure and
left a junk user row behind on every attempt.
"""

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from app.api.auth_api import auth_router
from app.database.database import get_db
from fastapi import FastAPI
from fastapi.testclient import TestClient


class TestEmailSignInValidation(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(auth_router, prefix="/api/auth")
        app.dependency_overrides[get_db] = lambda: MagicMock()
        self.client = TestClient(app)

        self.user_crud = MagicMock()
        # Nobody signed up yet, so sign-in takes the create-the-account path.
        self.user_crud.get_by_email_and_provider.return_value = None
        self.user_crud.get_by_email.return_value = None

        self.email_client = MagicMock()
        self.email_client.generate_verification_data.return_value = (
            "123456",
            datetime.now(timezone.utc) + timedelta(minutes=10),
        )
        self.email_client.send_verification_code.return_value = True

        for target, replacement in (
            ("user_crud", self.user_crud),
            ("email_auth_client", self.email_client),
            ("track_event", MagicMock()),
            ("check_signup_abuse", MagicMock(return_value=[])),
        ):
            patcher = patch(f"app.api.auth_api.{target}", replacement)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _signin(self, email: str):
        return self.client.post("/api/auth/email/signin", json={"email": email})

    def test_malformed_addresses_are_rejected_before_any_side_effect(self) -> None:
        # Bare usernames, plus the near-misses a typo produces that the
        # browser's type="email" check lets through.
        for email in ("admin", "user", "root", "", "   ", "me@gmail", "a@b@c.com"):
            with self.subTest(email=email):
                response = self._signin(email)

                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json()["success"])
                self.assertIn("valid email", response.json()["message"])

        self.user_crud.create_email_user.assert_not_called()
        self.email_client.send_verification_code.assert_not_called()

    def test_valid_address_is_normalized_before_use(self) -> None:
        response = self._signin("  New.User@Example.COM ")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])
        self.assertTrue(response.json()["newly_created"])

        # Lookup, creation and delivery all have to agree on one spelling, or
        # a second sign-in with different casing makes a duplicate account.
        self.assertEqual(
            self.user_crud.create_email_user.call_args.kwargs["email"],
            "new.user@example.com",
        )
        self.assertEqual(
            self.email_client.send_verification_code.call_args[0][0],
            "new.user@example.com",
        )


if __name__ == "__main__":
    unittest.main()
