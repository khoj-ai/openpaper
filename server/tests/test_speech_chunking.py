"""Cover the size of the text handed to the text-to-speech provider.

The bug these guard against: narration was chunked at 10k characters, which
is ~11 minutes of speech and ~2.5k input tokens. The TTS model takes 2k input
tokens and refuses to return a synthesis that long, so every "long" audio
overview -- whose first chunk was always full -- was rejected by the provider.
"""

import unittest

from app.llm.speech import MAX_CHUNK_SIZE, chunk_text

# What the provider will accept for one synthesis request, and the rates that
# turn a chunk of narration into those units.
PROVIDER_TOKEN_LIMIT = 2000
PROVIDER_MINUTE_LIMIT = 10
SPOKEN_WORDS_PER_MINUTE = 150
CHARS_PER_TOKEN = 4

VOCABULARY = (
    "the transformer architecture replaces recurrence with attention and "
    "scales to longer contexts without a corresponding loss in accuracy "
    "across benchmarks that measure retrieval grounding and reasoning"
).split()


def narration(word_count: int) -> str:
    """Build prose shaped like a narrative summary: sentences and paragraphs."""
    words = [VOCABULARY[i % len(VOCABULARY)] for i in range(word_count)]
    sentences = [
        " ".join(words[i : i + 15]).capitalize() + "." for i in range(0, len(words), 15)
    ]
    paragraphs = [" ".join(sentences[i : i + 6]) for i in range(0, len(sentences), 6)]
    return "\n\n".join(paragraphs)


class TestNarrationChunking(unittest.TestCase):
    def setUp(self) -> None:
        # The word count the "long" audio overview asks the model for.
        self.narration = narration(2000)

    def test_chunks_stay_inside_what_the_provider_will_synthesize(self) -> None:
        chunks = chunk_text(self.narration)

        self.assertGreater(len(chunks), 1, "a long overview has to be split")
        for index, chunk in enumerate(chunks):
            with self.subTest(chunk=index):
                self.assertLessEqual(len(chunk), MAX_CHUNK_SIZE)
                self.assertLess(len(chunk) / CHARS_PER_TOKEN, PROVIDER_TOKEN_LIMIT)
                self.assertLess(
                    len(chunk.split()) / SPOKEN_WORDS_PER_MINUTE,
                    PROVIDER_MINUTE_LIMIT,
                )

    def test_chunking_narrates_every_word_once(self) -> None:
        # Chunks are concatenated back into one file, so splitting must not be
        # allowed to buy its headroom by dropping text.
        chunks = chunk_text(self.narration)

        self.assertEqual(" ".join(chunks).split(), self.narration.split())

    def test_text_with_no_break_points_is_still_split(self) -> None:
        # A transcript with no whitespace to break on must fall back to a hard
        # split rather than hand the provider one oversized request.
        chunks = chunk_text("a" * (MAX_CHUNK_SIZE * 3))

        self.assertEqual(len(chunks), 3)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), MAX_CHUNK_SIZE)


if __name__ == "__main__":
    unittest.main()
