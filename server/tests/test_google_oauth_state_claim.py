"""The claim state machine, against a real database.

`claim` is a conditional UPDATE, and the property that matters — exactly one of
several concurrent callbacks may talk to Google — only exists at the database.
Mocking the session would assert nothing, so these run against the configured
Postgres and skip when it isn't reachable.
"""

import datetime
import secrets
import unittest
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import text

try:
    from app.database.crud.google_oauth_crud import (
        ClaimOutcome,
        google_oauth_state_crud,
    )
    from app.database.database import SessionLocal, engine
    from app.database.models import GoogleOAuthState

    with engine.connect() as probe:
        probe.execute(text("SELECT 1 FROM google_oauth_state LIMIT 1"))
    DB_AVAILABLE = True
except Exception:  # pragma: no cover - depends on the developer's environment
    DB_AVAILABLE = False


@unittest.skipUnless(DB_AVAILABLE, "requires a migrated Postgres")
class TestClaim(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()
        self.state = f"test-{secrets.token_urlsafe(16)}"
        self.addCleanup(self._cleanup)

    def _cleanup(self) -> None:
        self.db.query(GoogleOAuthState).filter(
            GoogleOAuthState.state.like("test-%")
        ).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def test_first_claim_wins_second_is_a_replay(self) -> None:
        google_oauth_state_crud.create(self.db, state=self.state)

        first = google_oauth_state_crud.claim(self.db, state=self.state)
        second = google_oauth_state_crud.claim(self.db, state=self.state)

        self.assertIs(first.outcome, ClaimOutcome.CLAIMED)
        self.assertIs(second.outcome, ClaimOutcome.REPLAY)
        self.assertIsNotNone(second.record)

    def test_unissued_state(self) -> None:
        result = google_oauth_state_crud.claim(self.db, state="test-never-issued")
        self.assertIs(result.outcome, ClaimOutcome.UNKNOWN)

    def test_expired_state(self) -> None:
        record = google_oauth_state_crud.create(self.db, state=self.state)
        record.expires_at = datetime.datetime.now(  # type: ignore[assignment]
            datetime.timezone.utc
        ) - datetime.timedelta(minutes=1)
        self.db.commit()

        result = google_oauth_state_crud.claim(self.db, state=self.state)
        self.assertIs(result.outcome, ClaimOutcome.EXPIRED)

    def test_release_lets_a_retry_through(self) -> None:
        google_oauth_state_crud.create(self.db, state=self.state)
        claimed = google_oauth_state_crud.claim(self.db, state=self.state)
        assert claimed.record is not None

        google_oauth_state_crud.release(self.db, record=claimed.record)

        # After a failure that never spent the code, the user retrying the same
        # URL must be able to complete rather than being told it's a replay.
        retry = google_oauth_state_crud.claim(self.db, state=self.state)
        self.assertIs(retry.outcome, ClaimOutcome.CLAIMED)

    def test_concurrent_callbacks_yield_exactly_one_winner(self) -> None:
        """A scanner and the browser hitting the callback at the same instant."""
        google_oauth_state_crud.create(self.db, state=self.state)

        def attempt() -> ClaimOutcome:
            db = SessionLocal()
            try:
                return google_oauth_state_crud.claim(db, state=self.state).outcome
            finally:
                db.close()

        with ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = list(pool.map(lambda _: attempt(), range(8)))

        self.assertEqual(outcomes.count(ClaimOutcome.CLAIMED), 1)
        self.assertEqual(outcomes.count(ClaimOutcome.REPLAY), 7)

    def test_delete_stale_spares_rows_still_in_retention(self) -> None:
        fresh = google_oauth_state_crud.create(self.db, state=self.state)
        stale = google_oauth_state_crud.create(self.db, state=f"{self.state}-stale")
        stale.expires_at = datetime.datetime.now(  # type: ignore[assignment]
            datetime.timezone.utc
        ) - datetime.timedelta(days=1)
        self.db.commit()

        # Read the values off before the delete; the instances go stale with it.
        fresh_state, stale_state = str(fresh.state), str(stale.state)

        google_oauth_state_crud.delete_stale(self.db)

        remaining = {
            row.state
            for row in self.db.query(GoogleOAuthState).filter(
                GoogleOAuthState.state.like("test-%")
            )
        }
        self.assertIn(fresh_state, remaining)
        self.assertNotIn(stale_state, remaining)


if __name__ == "__main__":
    unittest.main()
