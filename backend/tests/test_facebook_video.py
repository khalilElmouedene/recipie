from __future__ import annotations

import subprocess
import unittest
from unittest.mock import MagicMock, patch

from app.services.facebook_video import validate_video_file


class FacebookVideoValidationTests(unittest.TestCase):
    def _source_file(self, size: int = 2048) -> MagicMock:
        path = MagicMock()
        path.is_file.return_value = True
        path.stat.return_value.st_size = size
        path.__str__.return_value = "source.mp4"
        return path

    def test_returns_duration_for_a_valid_video(self):
        source = self._source_file()
        completed = subprocess.CompletedProcess(
            args=["ffprobe"],
            returncode=0,
            stdout='{"format":{"duration":"12.75"}}',
            stderr="",
        )
        with patch("app.services.facebook_video.subprocess.run", return_value=completed):
            duration = validate_video_file(source)

        self.assertEqual(duration, 12.75)

    def test_explains_incomplete_mp4_before_moviepy_runs(self):
        source = self._source_file()
        completed = subprocess.CompletedProcess(
            args=["ffprobe"],
            returncode=1,
            stdout="",
            stderr="moov atom not found\nInvalid data found when processing input",
        )
        with patch("app.services.facebook_video.subprocess.run", return_value=completed):
            with self.assertRaisesRegex(ValueError, "not a valid or complete video") as raised:
                validate_video_file(source)

        self.assertIn("moov atom not found", str(raised.exception))

    def test_rejects_an_empty_upload_without_running_ffprobe(self):
        source = self._source_file(size=6)
        with patch("app.services.facebook_video.subprocess.run") as run:
            with self.assertRaisesRegex(ValueError, "empty or incomplete"):
                validate_video_file(source)

        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
