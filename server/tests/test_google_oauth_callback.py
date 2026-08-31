"""Cover the Google sign-in flow's failure paths.

The bug these guard against: the callback is a GET performing a single-use
operation, so link scanners and prefetchers hit it a second time with a spent
authorization code. That used to burn the code against Google and log the
resulting invalid_grant as an ERROR.
"""

import datetime
import unittest
import uuid
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import requests
from app.auth.google import GoogleAuthClient, GoogleTokenError, _parse_error


def _response(status_code: int, body: str) -> requests.Response:
    response = requests.Response()
    response.status_code = status_code
    response._content = body.encode()
    response.url = "https://oauth2.googleapis.com/token"
    return response


class TestAuthUrlEncoding(unittest.TestCase):
    def setUp(self) -> None:
        self.client = GoogleAuthClient()
        self.client.client_id = "cid"
        self.client.redirect_uri = "https://openpaper.ai/api/auth/google/callback"

    def test_params_are_percent_encoded(self) -> None:
        url = self.client.get_auth_url(state="abc123")
        query = parse_qs(urlparse(url).query)

        # The two values a raw f-string mangled: spaces in scope, and the
        # scheme separator in redirect_uri.
        self.assertEqual(query["scope"], ["openid email profile"])
        self.assertEqual(
            query["redirect_uri"],
            ["https://openpaper.ai/api/auth/google/callback"],
        )
        self.assertEqual(query["state"], ["abc123"])
        self.assertNotIn(" ", urlparse(url).query)

    def test_state_is_omitted_when_empty(self) -> None:
        query = parse_qs(urlparse(self.client.get_auth_url()).query)
        self.assertNotIn("state", query)


class TestErrorParsing(unittest.TestCase):
    def test_parses_google_error_body(self) -> None:
        error, description = _parse_error(
            _response(
                400, '{"error": "invalid_grant", "error_description": "Bad Request"}'
            )
        )
        self.assertEqual(error, "invalid_grant")
        self.assertEqual(description, "Bad Request")

    def test_non_json_body(self) -> None:
        error, _ = _parse_error(_response(502, "<html>gateway</html>"))
        self.assertEqual(error, "unparseable_response")

    def test_no_response_at_all(self) -> None:
        error, _ = _parse_error(None)
        self.assertEqual(error, "network_error")

    def test_caller_faults_are_separated_from_ours(self) -> None:
        # invalid_grant is a spent or expired code — nothing is broken here, so
        # it must not be classified as our fault and logged at ERROR.
        self.assertTrue(GoogleTokenError("invalid_grant").is_caller_fault)
        self.assertFalse(GoogleTokenError("invalid_client").is_caller_fault)
        self.assertFalse(GoogleTokenError("network_error").is_caller_fault)

    def test_log_fields_keep_the_raw_body(self) -> None:
        body = '{"error": "invalid_grant", "error_description": "Bad Request"}'
        fields = GoogleTokenError(
            "invalid_grant", "Bad Request", 400, body
        ).log_fields()
        self.assertEqual(fields["google_error"], "invalid_grant")
        self.assertEqual(fields["google_status_code"], 400)
        self.assertEqual(fields["google_response_body"], body)


class TestGetToken(unittest.TestCase):
    def setUp(self) -> None:
        self.client = GoogleAuthClient()

    def test_raises_with_googles_own_error_code(self) -> None:
        failed = _response(
            400, '{"error": "invalid_grant", "error_description": "Bad Request"}'
        )
        with patch("app.auth.google.requests.post", return_value=failed):
            with self.assertRaises(GoogleTokenError) as ctx:
                self.client.get_token("spent-code")

        self.assertEqual(ctx.exception.error, "invalid_grant")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("invalid_grant", ctx.exception.body or "")

    def test_200_without_access_token_is_still_an_error(self) -> None:
        with patch("app.auth.google.requests.post", return_value=_response(200, "{}")):
            with self.assertRaises(GoogleTokenError) as ctx:
                self.client.get_token("odd-code")
        self.assertEqual(ctx.exception.error, "missing_access_token")

    def test_success_returns_the_payload(self) -> None:
        with patch(
            "app.auth.google.requests.post",
            return_value=_response(200, '{"access_token": "tok"}'),
        ):
            self.assertEqual(self.client.get_token("good")["access_token"], "tok")


class TestCallbackRouting(unittest.IsolatedAsyncioTestCase):
    """The callback's decisions, with the CRUD layer stubbed out."""

    def setUp(self) -> None:
        from app.database.crud.google_oauth_crud import ClaimOutcome, ClaimResult

        self.ClaimOutcome = ClaimOutcome
        self.ClaimResult = ClaimResult
        self.request = MagicMock()
        self.request.headers = {}
        self.request.client = None

    async def _call(self, **kwargs):
        from app.api import auth_api

        params = {
            "request": self.request,
            "code": None,
            "state": None,
            "error": None,
            "db": MagicMock(),
        }
        params.update(kwargs)
        return await auth_api.google_callback(**params)

    async def test_user_declining_consent_redirects_to_login(self) -> None:
        response = await self._call(error="access_denied", state="s")
        self.assertEqual(response.status_code, 302)
        self.assertIn("error=login_cancelled", response.headers["location"])

    async def test_missing_code_does_not_422(self) -> None:
        # Previously `code: str = Query(...)` made this a raw 422 body.
        response = await self._call(state="s")
        self.assertEqual(response.status_code, 302)
        self.assertIn("error=missing_code", response.headers["location"])

    async def test_unissued_state_is_rejected(self) -> None:
        from app.api import auth_api

        with patch.object(
            auth_api.google_oauth_state_crud,
            "claim",
            return_value=self.ClaimResult(self.ClaimOutcome.UNKNOWN),
        ):
            response = await self._call(code="c", state="forged")
        self.assertIn("error=callback_failed", response.headers["location"])

    async def test_expired_state_gets_its_own_message(self) -> None:
        from app.api import auth_api

        with patch.object(
            auth_api.google_oauth_state_crud,
            "claim",
            return_value=self.ClaimResult(self.ClaimOutcome.EXPIRED, MagicMock()),
        ):
            response = await self._call(code="c", state="old")
        self.assertIn("error=login_expired", response.headers["location"])

    async def test_replay_is_signed_in_without_calling_google(self) -> None:
        """The whole point: a second hit must not re-exchange the code."""
        from app.api import auth_api

        record = MagicMock()
        record.session_id = uuid.uuid4()
        record.was_new_user = False

        session = MagicMock()
        session.token = "session-token"
        session.expires_at = datetime.datetime.now(
            datetime.timezone.utc
        ) + datetime.timedelta(days=30)

        with patch.object(
            auth_api.google_oauth_state_crud,
            "claim",
            return_value=self.ClaimResult(self.ClaimOutcome.REPLAY, record),
        ), patch.object(
            auth_api.user_crud, "get_session_by_id", return_value=session
        ), patch.object(
            auth_api.google_auth_client, "get_token"
        ) as get_token:
            response = await self._call(code="spent", state="s")

        get_token.assert_not_called()
        self.assertIn("success=true", response.headers["location"])
        self.assertIn("session-token", response.headers["set-cookie"])

    async def test_replay_without_a_session_falls_back_to_login(self) -> None:
        from app.api import auth_api

        record = MagicMock()
        record.session_id = None

        with patch.object(
            auth_api.google_oauth_state_crud,
            "claim",
            return_value=self.ClaimResult(self.ClaimOutcome.REPLAY, record),
        ):
            response = await self._call(code="spent", state="s")
        self.assertIn("error=callback_failed", response.headers["location"])

    async def test_invalid_grant_keeps_the_claim_and_warns(self) -> None:
        from app.api import auth_api

        record = MagicMock()
        with patch.object(
            auth_api.google_oauth_state_crud,
            "claim",
            return_value=self.ClaimResult(self.ClaimOutcome.CLAIMED, record),
        ), patch.object(
            auth_api.google_auth_client,
            "get_token",
            side_effect=GoogleTokenError("invalid_grant", "Bad Request", 400, "{}"),
        ), patch.object(
            auth_api.google_oauth_state_crud, "release"
        ) as release, self.assertLogs(
            "app.api.auth_api", level="WARNING"
        ) as logs:
            response = await self._call(code="spent", state="s")

        # A spent code is not a server fault: WARNING, not ERROR, and the claim
        # stays consumed so retries keep taking the replay path.
        self.assertEqual(logs.records[0].levelname, "WARNING")
        self.assertEqual(logs.records[0].google_error, "invalid_grant")  # type: ignore[attr-defined]
        self.assertEqual(logs.records[0].google_response_body, "{}")  # type: ignore[attr-defined]
        release.assert_not_called()
        self.assertIn("error=authentication_error", response.headers["location"])

    async def test_our_own_fault_releases_the_claim_and_errors(self) -> None:
        from app.api import auth_api

        record = MagicMock()
        with patch.object(
            auth_api.google_oauth_state_crud,
            "claim",
            return_value=self.ClaimResult(self.ClaimOutcome.CLAIMED, record),
        ), patch.object(
            auth_api.google_auth_client,
            "get_token",
            side_effect=GoogleTokenError("invalid_client", None, 401, "{}"),
        ), patch.object(
            auth_api.google_oauth_state_crud, "release"
        ) as release, self.assertLogs(
            "app.api.auth_api", level="ERROR"
        ) as logs:
            await self._call(code="c", state="s")

        # The code was never spent, so a retry must be allowed through.
        self.assertEqual(logs.records[0].levelname, "ERROR")
        release.assert_called_once()


if __name__ == "__main__":
    unittest.main()
