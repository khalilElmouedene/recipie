from __future__ import annotations

import subprocess
import sys
import unittest
import json
from types import ModuleType
from unittest.mock import MagicMock, patch

from app.services.facebook_video import (
    _cover_resize_dimensions,
    _download_facebook_html_fallback,
    _download_facebook_source,
    _download_source,
    _extract_facebook_progressive_urls,
    _facebook_video_id,
    _is_facebook_video_url,
    validate_facebook_reel_file,
    validate_video_file,
    video_dimensions,
)


class FacebookVideoValidationTests(unittest.TestCase):
    def test_cover_resize_fills_a_portrait_target_without_padding(self):
        width, height = _cover_resize_dimensions(720, 1280, 1024, 1536)

        self.assertGreaterEqual(width, 1024)
        self.assertGreaterEqual(height, 1536)
        self.assertEqual(width % 2, 0)
        self.assertEqual(height % 2, 0)

    def test_cover_resize_fills_a_vertical_reel_from_landscape_video(self):
        width, height = _cover_resize_dimensions(1920, 1080, 1080, 1920)

        self.assertGreaterEqual(width, 1080)
        self.assertEqual(height, 1920)

    def test_video_format_presets_have_expected_dimensions(self):
        self.assertEqual(video_dimensions("2:3"), (1024, 1536))
        self.assertEqual(video_dimensions("9:16"), (1080, 1920))
        self.assertEqual(video_dimensions("4:5"), (1080, 1350))
        self.assertEqual(video_dimensions("1:1"), (1080, 1080))

    def test_unknown_video_format_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unsupported Facebook video format"):
            video_dimensions("16:9")

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

    def test_validates_rendered_facebook_reel_metadata(self):
        source = self._source_file()
        completed = subprocess.CompletedProcess(
            args=["ffprobe"],
            returncode=0,
            stdout=json.dumps(
                {
                    "streams": [
                        {
                            "width": 1080,
                            "height": 1920,
                            "avg_frame_rate": "30/1",
                        }
                    ],
                    "format": {"duration": "15.25", "format_name": "mov,mp4"},
                }
            ),
            stderr="",
        )
        with patch("app.services.facebook_video.subprocess.run", return_value=completed):
            metadata = validate_facebook_reel_file(source)

        self.assertEqual(metadata["width"], 1080)
        self.assertEqual(metadata["height"], 1920)
        self.assertEqual(metadata["fps"], 30.0)
        self.assertEqual(metadata["duration"], 15.25)

    def test_reel_validation_explains_every_incompatible_property(self):
        source = self._source_file()
        completed = subprocess.CompletedProcess(
            args=["ffprobe"],
            returncode=0,
            stdout=json.dumps(
                {
                    "streams": [
                        {
                            "width": 500,
                            "height": 750,
                            "avg_frame_rate": "20/1",
                        }
                    ],
                    "format": {"duration": "72"},
                }
            ),
            stderr="",
        )
        with patch("app.services.facebook_video.subprocess.run", return_value=completed):
            with self.assertRaisesRegex(ValueError, "not publishable") as raised:
                validate_facebook_reel_file(source)

        message = str(raised.exception)
        self.assertIn("resolution is 500x750", message)
        self.assertIn("require 9:16", message)
        self.assertIn("duration is 72.0s", message)
        self.assertIn("20.00 fps", message)


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

    def test_direct_downloader_rejects_http_200_html_before_writing_a_fake_mp4(self):
        direct_url = "https://cdn.example.com/not-really-a-video.mp4"
        destination = MagicMock()
        response = MagicMock()
        response.is_redirect = False
        response.is_permanent_redirect = False
        response.status_code = 200
        response.headers = {"Content-Type": "text/html; charset=utf-8"}
        response.__enter__.return_value = response
        response.__exit__.return_value = False

        with (
            patch("app.services.facebook_video._safe_workspace_path", return_value=None),
            patch("app.services.facebook_video._is_public_http_url", return_value=True),
            patch("app.services.facebook_video.requests.get", return_value=response),
        ):
            with self.assertRaisesRegex(ValueError, "HTTP 200 with text/html"):
                _download_source(direct_url, destination)

        destination.open.assert_not_called()

    def test_extracts_target_reel_progressive_urls_in_bitrate_order(self):
        low_url = "https://scontent.example.fbcdn.net/video.mp4?bitrate=316946&tag=sve_sd"
        high_url = "https://scontent.example.fbcdn.net/video.mp4?bitrate=1001687&tag=720p"
        unrelated_url = "https://scontent.example.fbcdn.net/other.mp4?bitrate=9000000"
        target_payload = {
            "id": self.reel_url.rsplit("/", 1)[-1],
            "videoDeliveryResponseFragment": {
                "videoDeliveryResponseResult": {
                    "progressive_urls": [
                        {"progressive_url": low_url},
                        {"progressive_url": high_url},
                    ]
                }
            },
        }
        unrelated_payload = {
            "id": "999",
            "progressive_urls": [{"progressive_url": unrelated_url}],
        }
        html = (
            '<html><script type="application/json">'
            f"{json.dumps(target_payload)}"
            "</script>"
            '<script type="application/json">'
            f"{json.dumps(unrelated_payload)}"
            "</script></html>"
        )

        self.assertEqual(_facebook_video_id(self.reel_url), "1050092727514659")
        self.assertEqual(
            _extract_facebook_progressive_urls(html, "1050092727514659"),
            [high_url, low_url],
        )

    def test_authenticated_html_fallback_downloads_highest_bitrate_candidate(self):
        low_url = "https://scontent.example.fbcdn.net/video.mp4?bitrate=300000"
        high_url = "https://scontent.example.fbcdn.net/video.mp4?bitrate=1000000"
        payload = {
            "video_id": "1050092727514659",
            "progressive_urls": [
                {"progressive_url": low_url},
                {"progressive_url": high_url},
            ],
        }
        html = f'<script type="application/json">{json.dumps(payload)}</script>'
        destination = MagicMock()
        messages = []

        with (
            patch(
                "app.services.facebook_video._fetch_authenticated_facebook_html",
                return_value=html,
            ),
            patch("app.services.facebook_video._download_source") as download_source,
        ):
            downloaded = _download_facebook_html_fallback(
                self.reel_url,
                destination,
                cookie_path=MagicMock(),
                log=messages.append,
            )

        self.assertTrue(downloaded)
        download_source.assert_called_once_with(high_url, destination, log=messages.append)
        self.assertTrue(any("2 progressive MP4" in message for message in messages))


if __name__ == "__main__":
    unittest.main()
