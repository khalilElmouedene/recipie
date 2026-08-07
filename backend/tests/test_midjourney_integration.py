from __future__ import annotations

import os
import shutil
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


os.environ.setdefault("APP_ENV", "development")

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services import article_generator, midjourney  # noqa: E402


def _mock_response(
    *,
    status_code: int = 200,
    json_data: object | None = None,
    text: str = "",
    headers: dict[str, str] | None = None,
    content: bytes = b"",
) -> Mock:
    response = Mock()
    response.status_code = status_code
    response.text = text
    response.headers = headers or {}
    response.content = content
    response.json.return_value = [] if json_data is None else json_data
    response.raise_for_status = Mock()
    return response


class MidjourneyIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.credentials = {
            "discord_app_id": "app",
            "discord_guild": "guild",
            "discord_channel": "channel",
            "mj_version": "version",
            "mj_id": "command",
            "discord_auth": "token",
        }
        self.prompts = {"midjourney_imagine": "Recipe: {recipe_name} Image: {img_url}"}

    def test_generate_images_stops_after_default_attempt_limit(self) -> None:
        send_response = _mock_response(status_code=500, text="server error")
        with (
            patch.object(midjourney.MidjourneyApi, "send_message", return_value=send_response) as send_mock,
            patch.object(midjourney.time, "sleep", return_value=None),
        ):
            with self.assertRaisesRegex(ValueError, "failed after 3 attempt"):
                midjourney.generate_images(
                    "Tacos",
                    "https://example.com/image.png",
                    self.credentials,
                    prompts=self.prompts,
                    retry_delay_seconds=1,
                    log=lambda _msg: None,
                )

        self.assertEqual(send_mock.call_count, 3)

    def test_generate_images_fails_fast_on_invalid_auth(self) -> None:
        send_response = _mock_response(status_code=401, text="bad token")
        with patch.object(midjourney.MidjourneyApi, "send_message", return_value=send_response) as send_mock:
            with self.assertRaisesRegex(ValueError, "status 401"):
                midjourney.generate_images(
                    "Tacos",
                    "https://example.com/image.png",
                    self.credentials,
                    prompts=self.prompts,
                    log=lambda _msg: None,
                )

        self.assertEqual(send_mock.call_count, 1)

    def test_grid_detection_prefers_matching_recipe_message(self) -> None:
        api = midjourney.MidjourneyApi(
            prompt="Recipe: Tacos Image: https://example.com/image.png",
            application_id="app",
            guild_id="guild",
            channel_id="channel",
            version="version",
            mj_id="command",
            authorization="token",
            recipe_name="Tacos",
            source_img_url="https://example.com/image.png",
            log=lambda _msg: None,
        )
        messages = [
            {
                "id": "1",
                "content": "Other recipe",
                "components": [{"components": [{"label": "U1", "custom_id": "a1"}, {"label": "U2", "custom_id": "a2"}, {"label": "U3", "custom_id": "a3"}, {"label": "U4", "custom_id": "a4"}]}],
            },
            {
                "id": "2",
                "content": "Recipe: Tacos freshly plated",
                "components": [{"components": [{"label": "U1", "custom_id": "b1"}, {"label": "U2", "custom_id": "b2"}, {"label": "U3", "custom_id": "b3"}, {"label": "U4", "custom_id": "b4"}]}],
            },
        ]

        found = api._find_grid_in_messages(messages)

        self.assertTrue(found)
        self.assertEqual(api.message_id, "2")
        self.assertEqual(api.custom_ids, ["b1", "b2", "b3", "b4"])

    def test_download_image_prefers_messages_linked_to_grid(self) -> None:
        api = midjourney.MidjourneyApi(
            prompt="Recipe: Tacos Image: https://example.com/image.png",
            application_id="app",
            guild_id="guild",
            channel_id="channel",
            version="version",
            mj_id="command",
            authorization="token",
            recipe_name="Tacos",
            source_img_url="https://example.com/image.png",
            log=lambda _msg: None,
        )
        api.message_id = "grid-1"
        api.upscale_baseline_id = "0"
        api.expected_upscale_count = 1

        response = _mock_response(
            json_data=[
                {"id": "11", "content": "Other recipe", "attachments": [{"url": "https://cdn.example.com/unrelated.webp"}]},
                {
                    "id": "12",
                    "content": "Finished tacos upscale",
                    "attachments": [{"url": "https://cdn.example.com/matching.webp"}],
                    "message_reference": {"message_id": "grid-1"},
                },
            ]
        )

        with (
            patch.object(api, "_interruptible_sleep", return_value=None),
            patch.object(midjourney.requests, "get", return_value=response),
        ):
            result = api.download_image(post_upscale_wait=10, poll_interval=10)

        self.assertEqual(result, ["https://cdn.example.com/matching.webp"])

    def test_download_image_rejects_multiple_ambiguous_attachments(self) -> None:
        api = midjourney.MidjourneyApi(
            prompt="Recipe: Tacos Image: https://example.com/image.png",
            application_id="app",
            guild_id="guild",
            channel_id="channel",
            version="version",
            mj_id="command",
            authorization="token",
            recipe_name="Tacos",
            source_img_url="https://example.com/image.png",
            log=lambda _msg: None,
        )
        api.message_id = "grid-1"
        api.upscale_baseline_id = "0"

        response = _mock_response(
            json_data=[
                {"id": "11", "content": "Other recipe one", "attachments": [{"url": "https://cdn.example.com/one.webp"}]},
                {"id": "12", "content": "Other recipe two", "attachments": [{"url": "https://cdn.example.com/two.webp"}]},
            ]
        )

        with (
            patch.object(api, "_interruptible_sleep", return_value=None),
            patch.object(midjourney.requests, "get", return_value=response),
        ):
            with self.assertRaisesRegex(ValueError, "Expected 4 upscaled images"):
                api.download_image(post_upscale_wait=10, poll_interval=10)

    def test_download_image_waits_for_all_images_linked_to_grid(self) -> None:
        api = midjourney.MidjourneyApi(
            prompt="Recipe: Tacos Image: https://example.com/image.png",
            application_id="app",
            guild_id="guild",
            channel_id="channel",
            version="version",
            mj_id="command",
            authorization="token",
            recipe_name="Tacos",
            source_img_url="https://example.com/image.png",
            log=lambda _msg: None,
        )
        api.message_id = "grid-1"
        api.upscale_baseline_id = "0"

        first_poll = _mock_response(
            json_data=[
                {
                    "id": "11",
                    "attachments": [{"url": "https://cdn.example.com/one.webp"}],
                    "message_reference": {"message_id": "grid-1"},
                },
                {
                    "id": "90",
                    "content": "Unrelated generation",
                    "attachments": [{"url": "https://cdn.example.com/unrelated.webp"}],
                    "message_reference": {"message_id": "other-grid"},
                },
            ]
        )
        second_poll = _mock_response(
            json_data=[
                {
                    "id": str(10 + number),
                    "attachments": [{"url": f"https://cdn.example.com/{number}.webp"}],
                    "message_reference": {"message_id": "grid-1"},
                }
                for number in range(1, 5)
            ]
        )

        with (
            patch.object(api, "_interruptible_sleep", return_value=None),
            patch.object(midjourney.requests, "get", side_effect=[first_poll, second_poll]) as get_mock,
        ):
            result = api.download_image(post_upscale_wait=20, poll_interval=10)

        self.assertEqual(get_mock.call_count, 2)
        self.assertEqual(
            result,
            [f"https://cdn.example.com/{number}.webp" for number in range(1, 5)],
        )
        self.assertNotIn("https://cdn.example.com/unrelated.webp", result)

    def test_download_image_rejects_same_prompt_without_grid_reference(self) -> None:
        api = midjourney.MidjourneyApi(
            prompt="Recipe: Tacos Image: https://example.com/image.png",
            application_id="app",
            guild_id="guild",
            channel_id="channel",
            version="version",
            mj_id="command",
            authorization="token",
            recipe_name="Tacos",
            source_img_url="https://example.com/image.png",
            log=lambda _msg: None,
        )
        api.message_id = "grid-1"
        api.upscale_baseline_id = "0"
        api.expected_upscale_count = 1
        response = _mock_response(
            json_data=[
                {
                    "id": "11",
                    "content": "Recipe: Tacos Image: https://example.com/image.png",
                    "attachments": [{"url": "https://cdn.example.com/wrong.webp"}],
                }
            ]
        )

        with (
            patch.object(api, "_interruptible_sleep", return_value=None),
            patch.object(midjourney.requests, "get", return_value=response),
        ):
            with self.assertRaisesRegex(ValueError, "received 0"):
                api.download_image(post_upscale_wait=10, poll_interval=10)

    def test_grid_poll_tracks_one_progress_message_by_id(self) -> None:
        api = midjourney.MidjourneyApi(
            prompt="Recipe: Tacos Image: https://example.com/image.png",
            application_id="app",
            guild_id="guild",
            channel_id="channel",
            version="version",
            mj_id="command",
            authorization="token",
            recipe_name="Tacos",
            source_img_url="https://example.com/image.png",
            log=lambda _msg: None,
        )
        api.baseline_id = "100"
        progress = _mock_response(
            json_data=[
                {
                    "id": "101",
                    "content": "Recipe: Tacos Image: https://example.com/image.png (31%)",
                }
            ]
        )
        completed = _mock_response(
            json_data={
                "id": "101",
                "content": "Recipe: Tacos Image: https://example.com/image.png",
                "attachments": [{"url": "https://cdn.example.com/grid.webp"}],
                "components": [{
                    "components": [
                        {"label": f"U{number}", "custom_id": f"button-{number}"}
                        for number in range(1, 5)
                    ]
                }],
            }
        )

        with patch.object(midjourney.requests, "get", side_effect=[progress, completed]) as get_mock:
            self.assertFalse(api._poll_grid_once())
            self.assertEqual(api.tracked_message_id, "101")
            self.assertTrue(api._poll_grid_once())

        self.assertEqual(api.message_id, "101")
        self.assertIn("/messages/101", get_mock.call_args_list[1].args[0])

    def test_cache_image_keeps_real_extension(self) -> None:
        response = _mock_response(
            headers={"Content-Type": "image/png"},
            content=b"png-bytes",
        )
        tmpdir = REPO_ROOT / "backend" / "tests" / ".tmp_midjourney_cache"
        if tmpdir.exists():
            shutil.rmtree(tmpdir)
        tmpdir.mkdir(parents=True, exist_ok=True)
        try:
            with (
                patch.object(article_generator.requests, "get", return_value=response),
                patch.object(article_generator, "UPLOADS_DIR", tmpdir),
            ):
                cached_url = article_generator._cache_image(
                    "https://cdn.example.com/image",
                    log=lambda _msg: None,
                )

            self.assertTrue(cached_url.endswith(".png"))
            self.assertEqual(len(list(tmpdir.glob("*.png"))), 1)
        finally:
            if tmpdir.exists():
                shutil.rmtree(tmpdir, ignore_errors=True)

    def test_grid_wait_uses_shared_upper_bound(self) -> None:
        self.assertEqual(article_generator._mj_grid_wait_from_credentials({"mj_grid_wait_seconds": "900"}), 900)


if __name__ == "__main__":
    unittest.main()
