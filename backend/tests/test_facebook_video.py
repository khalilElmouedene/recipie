from __future__ import annotations

import subprocess
import sys
import unittest
from types import ModuleType
from unittest.mock import MagicMock, patch

from app.services.facebook_video import (
    _download_facebook_source,
    _download_source,
    _is_facebook_video_url,
    validate_video_file,
)


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


class FacebookReelDownloadTests(unittest.TestCase):
    reel_url = "https://www.facebook.com/reel/1050092727514659"

    def test_facebook_reel_is_sent_to_the_social_video_resolver(self):
        destination = MagicMock()
        with (
            patch("app.services.facebook_video._safe_workspace_path", return_value=None),
            patch("app.services.facebook_video._download_facebook_source") as download,
            patch("app.services.facebook_video.requests.get") as direct_request,
        ):
            _download_source(self.reel_url, destination)

        self.assertTrue(_is_facebook_video_url(self.reel_url))
        download.assert_called_once()
        direct_request.assert_not_called()

    def test_facebook_resolver_uses_ytdlp_and_moves_the_downloaded_video(self):
        captured_options = {}

        class DownloadError(Exception):
            pass

        class FakeYoutubeDL:
            def __init__(self, options):
                captured_options.update(options)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def extract_info(self, url, download):
                self.url = url
                self.download = download

        yt_dlp = ModuleType("yt_dlp")
        yt_dlp.YoutubeDL = FakeYoutubeDL
        yt_dlp_utils = ModuleType("yt_dlp.utils")
        yt_dlp_utils.DownloadError = DownloadError

        destination = MagicMock()
        destination.stem = "source"
        destination.with_name.return_value.__str__.return_value = (
            "/app/uploads/facebook/item/source-facebook.%(ext)s"
        )
        destination.stat.return_value.st_size = 3 * 1024 * 1024
        source = MagicMock()
        source.is_file.return_value = True
        source.suffix = ".mp4"
        source.stat.return_value.st_size = 3 * 1024 * 1024
        destination.parent.glob.side_effect = [[], [], [source]]
        messages = []

        with (
            patch.dict(sys.modules, {"yt_dlp": yt_dlp, "yt_dlp.utils": yt_dlp_utils}),
            patch("app.services.facebook_video._is_public_http_url", return_value=True),
            patch("app.services.facebook_video.shutil.move") as move,
        ):
            _download_facebook_source(
                self.reel_url,
                destination,
                log=messages.append,
            )

        move.assert_called_once_with(str(source), str(destination))
        self.assertTrue(captured_options["noplaylist"])
        self.assertEqual(captured_options["merge_output_format"], "mp4")
        self.assertEqual(captured_options["extractor_retries"], 3)
        self.assertIn("Mozilla/5.0", captured_options["http_headers"]["User-Agent"])
        self.assertTrue(any("Resolving" in message for message in messages))

    def test_facebook_resolver_explains_login_or_age_restricted_reels(self):
        class DownloadError(Exception):
            pass

        class FailingYoutubeDL:
            def __init__(self, _options):
                pass

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def extract_info(self, _url, download):
                raise DownloadError("Cannot parse data")

        yt_dlp = ModuleType("yt_dlp")
        yt_dlp.YoutubeDL = FailingYoutubeDL
        yt_dlp_utils = ModuleType("yt_dlp.utils")
        yt_dlp_utils.DownloadError = DownloadError
        destination = MagicMock()
        destination.stem = "source"
        destination.with_name.return_value.__str__.return_value = (
            "/app/uploads/facebook/item/source-facebook.%(ext)s"
        )
        destination.parent.glob.return_value = []
        messages = []

        with (
            patch.dict(sys.modules, {"yt_dlp": yt_dlp, "yt_dlp.utils": yt_dlp_utils}),
            patch.dict("os.environ", {"FACEBOOK_COOKIES_FILE": ""}),
            patch("app.services.facebook_video._is_public_http_url", return_value=True),
        ):
            with self.assertRaisesRegex(ValueError, r"age verification \(18\+\)"):
                _download_facebook_source(
                    self.reel_url,
                    destination,
                    log=messages.append,
                )

        self.assertTrue(any("Cannot parse data" in message for message in messages))

    def test_facebook_resolver_uses_configured_cookie_file(self):
        captured_options = {}

        class DownloadError(Exception):
            pass

        class FailingYoutubeDL:
            def __init__(self, options):
                captured_options.update(options)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def extract_info(self, _url, download):
                raise DownloadError("login required")

        yt_dlp = ModuleType("yt_dlp")
        yt_dlp.YoutubeDL = FailingYoutubeDL
        yt_dlp_utils = ModuleType("yt_dlp.utils")
        yt_dlp_utils.DownloadError = DownloadError
        destination = MagicMock()
        destination.stem = "source"
        destination.with_name.return_value.__str__.return_value = (
            "/app/uploads/facebook/item/source-facebook.%(ext)s"
        )
        destination.parent.glob.return_value = []
        messages = []

        cookie_path = MagicMock()
        cookie_path.is_file.return_value = True
        cookie_path.__str__.return_value = "/app/uploads/facebook/cookies.txt"
        with (
            patch.dict(sys.modules, {"yt_dlp": yt_dlp, "yt_dlp.utils": yt_dlp_utils}),
            patch.dict(
                "os.environ",
                {"FACEBOOK_COOKIES_FILE": "/app/uploads/facebook/cookies.txt"},
            ),
            patch("app.services.facebook_video.Path") as path_factory,
            patch("app.services.facebook_video._is_public_http_url", return_value=True),
        ):
            path_factory.return_value.resolve.return_value = cookie_path
            with self.assertRaisesRegex(ValueError, "Export a fresh Netscape"):
                _download_facebook_source(
                    self.reel_url,
                    destination,
                    log=messages.append,
                )

        self.assertEqual(
            captured_options["cookiefile"],
            "/app/uploads/facebook/cookies.txt",
        )
        self.assertTrue(any("configured Facebook browser session" in message for message in messages))


if __name__ == "__main__":
    unittest.main()
