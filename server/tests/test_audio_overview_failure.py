"""Cover what a failed audio overview does to the request that started it.

The bug this guards against: the task re-raised after recording the failure.
Running as a FastAPI background task, that reached uvicorn long after the 202
response had been sent, which logged the traceback a second time under
"Exception in ASGI application", on top of the error the task had already
logged itself.
"""

import asyncio
import unittest
import uuid
from unittest.mock import MagicMock, patch

from app.database.models import JobStatus
from app.schemas.responses import AudioOverviewForLLM
from app.schemas.user import CurrentUser
from app.tasks.audio_overview import generate_audio_overview


class TestAudioOverviewFailureHandling(unittest.TestCase):
    def setUp(self) -> None:
        self.job_crud = MagicMock()
        self.speaker = MagicMock()
        # What the provider raises when it won't return a synthesis this long.
        self.speaker.generate_speech_from_text.side_effect = Exception(
            "audio response exceeds the provider's length limit"
        )

        operations = MagicMock()
        operations.create_narrative_summary.return_value = AudioOverviewForLLM(
            summary="A narrated walk through the paper.",
            citations=[],
            title="Overview",
        )

        for target, replacement in (
            ("SessionLocal", MagicMock()),
            ("audio_overview_job_crud", self.job_crud),
            ("paper_crud", MagicMock()),
            ("operations", operations),
            ("speaker", self.speaker),
            ("track_event", MagicMock()),
        ):
            patcher = patch(f"app.tasks.audio_overview.{target}", replacement)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_provider_rejection_is_recorded_without_escaping_the_task(self) -> None:
        user = CurrentUser(id=uuid.uuid4(), email="reader@example.com")

        asyncio.run(
            generate_audio_overview(
                user=user,
                audio_overview_job_id=uuid.uuid4(),
                paper_id=uuid.uuid4(),
            )
        )

        # The client learns about this by polling the job, so the row is the
        # one place the failure has to land.
        statuses = [
            call.kwargs["status"] for call in self.job_crud.update_status.call_args_list
        ]
        self.assertEqual(statuses[-1], JobStatus.FAILED)
        self.assertNotIn(JobStatus.COMPLETED, statuses)

        # And the message shown is ours, not the provider's diagnostics.
        self.assertNotIn(
            "exceeds", self.job_crud.update_status.call_args.kwargs["status_message"]
        )


if __name__ == "__main__":
    unittest.main()
