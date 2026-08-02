from __future__ import annotations

import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

from app.services import facebook_api


class FacebookOAuthContractTests(unittest.TestCase):
    def test_oauth_url_requests_only_page_management_permissions(self):
        url = facebook_api.get_oauth_url(
            app_id="123456",
            redirect_uri="https://example.com/facebook/callback",
            state="signed-state",
        )
        query = parse_qs(urlparse(url).query)

        self.assertEqual(query["client_id"], ["123456"])
        self.assertEqual(query["redirect_uri"], ["https://example.com/facebook/callback"])
        self.assertEqual(query["state"], ["signed-state"])
        self.assertEqual(
            set(query["scope"][0].split(",")),
            {
                "pages_show_list",
                "pages_read_engagement",
                "pages_manage_posts",
                "pages_manage_engagement",
            },
        )
        self.assertNotIn("pages_read_user_content", query["scope"][0])


class FacebookPublishingContractTests(unittest.TestCase):
    def test_reel_ready_is_not_published_until_publishing_phase_completes(self):
        self.assertFalse(
            facebook_api.reel_is_published(
                {
                    "video_status": "ready",
                    "publishing_phase": {"status": "not_started"},
                }
            )
        )
        self.assertFalse(
            facebook_api.reel_is_published(
                {
                    "video_status": "ready",
                    "publishing_phase": {"status": "in_progress"},
                }
            )
        )
        self.assertTrue(
            facebook_api.reel_is_published(
                {
                    "video_status": "ready",
                    "publishing_phase": {"status": "complete"},
                }
            )
        )

    def test_legacy_video_without_publishing_phase_uses_video_status(self):
        self.assertTrue(facebook_api.reel_is_published({"video_status": "ready"}))

    def test_reel_publish_uses_staged_reels_api_and_remote_file_url(self):
        start_response = Mock(ok=True)
        start_response.json.return_value = {
            "video_id": "video-123",
            "upload_url": "https://rupload.facebook.com/video-upload/v24.0/video-123",
        }
        upload_response = Mock(ok=True)
        upload_response.json.return_value = {"success": True}
        finish_response = Mock(ok=True)
        finish_response.json.return_value = {"success": True}
        with patch.object(
            facebook_api.requests,
            "post",
            side_effect=[start_response, upload_response, finish_response],
        ) as post:
            post_id = facebook_api.publish_reel(
                page_id="page-42",
                page_access_token="page-token",
                video_url="https://example.com/uploads/facebook/video.mp4",
                title="Recipe title",
                description="Recipe title",
            )

        self.assertEqual(post_id, "video-123")
        start_url = post.call_args_list[0].args[0]
        start_data = post.call_args_list[0].kwargs["data"]
        self.assertTrue(start_url.endswith("/page-42/video_reels"))
        self.assertEqual(start_data["upload_phase"], "start")

        upload_url = post.call_args_list[1].args[0]
        upload_headers = post.call_args_list[1].kwargs["headers"]
        self.assertEqual(
            upload_url,
            "https://rupload.facebook.com/video-upload/v24.0/video-123",
        )
        self.assertEqual(
            upload_headers["file_url"],
            "https://example.com/uploads/facebook/video.mp4",
        )
        self.assertEqual(upload_headers["Authorization"], "OAuth page-token")

        finish_url = post.call_args_list[2].args[0]
        finish_data = post.call_args_list[2].kwargs["data"]
        self.assertTrue(finish_url.endswith("/page-42/video_reels"))
        self.assertEqual(finish_data["upload_phase"], "finish")
        self.assertEqual(finish_data["video_state"], "PUBLISHED")

    def test_reel_status_waits_for_publishing_to_complete(self):
        processing_response = Mock(ok=True)
        processing_response.json.return_value = {
            "status": {
                "video_status": "processing",
                "publishing_phase": {"status": "in_progress"},
            }
        }
        published_response = Mock(ok=True)
        published_response.json.return_value = {
            "status": {
                "video_status": "ready",
                "publishing_phase": {"status": "complete"},
            }
        }
        with (
            patch.object(
                facebook_api.requests,
                "get",
                side_effect=[processing_response, published_response],
            ) as get,
            patch.object(facebook_api.time, "sleep") as sleep,
        ):
            status = facebook_api.wait_for_reel_published(
                video_id="video-123",
                page_access_token="page-token",
            )

        self.assertEqual(status["publishing_phase"]["status"], "complete")
        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(facebook_api.REEL_STATUS_INTERVAL)

    def test_first_comment_targets_the_published_video(self):
        response = Mock(ok=True)
        response.json.return_value = {"id": "comment-456"}
        with patch.object(facebook_api.requests, "post", return_value=response) as post:
            comment_id = facebook_api.add_first_comment(
                post_id="video-123",
                page_access_token="page-token",
                message="Ingredients\n- Garlic\n\nInstructions\n1. Blend.\n\nhttps://example.com/recipe",
            )

        self.assertEqual(comment_id, "comment-456")
        self.assertTrue(post.call_args.args[0].endswith("/video-123/comments"))
        self.assertEqual(
            post.call_args.kwargs["data"]["message"],
            "Ingredients\n- Garlic\n\nInstructions\n1. Blend.\n\nhttps://example.com/recipe",
        )


class FacebookPageConnectionHealthTests(unittest.TestCase):
    def test_page_connection_diagnostic_checks_app_page_and_permissions(self):
        debug_response = Mock(ok=True)
        debug_response.json.return_value = {
            "data": {
                "app_id": "app-123",
                "type": "PAGE",
                "is_valid": True,
                "expires_at": 2_000_000_000,
                "data_access_expires_at": 2_000_000_100,
                "scopes": [
                    "pages_show_list",
                    "pages_read_engagement",
                    "pages_manage_posts",
                    "pages_manage_engagement",
                ],
            }
        }
        page_response = Mock(ok=True)
        page_response.json.return_value = {
            "id": "page-42",
            "name": "Recipe Page",
            "picture": {"data": {"url": "https://example.com/page.jpg"}},
        }

        with patch.object(
            facebook_api.requests,
            "get",
            side_effect=[debug_response, page_response],
        ) as get:
            diagnostic = facebook_api.inspect_page_connection(
                page_access_token="page-token",
                app_id="app-123",
                app_secret="app-secret",
                expected_page_id="page-42",
            )

        self.assertTrue(diagnostic["token_valid"])
        self.assertTrue(diagnostic["app_matches"])
        self.assertTrue(diagnostic["page_matches"])
        self.assertEqual(diagnostic["missing_permissions"], [])
        debug_call = get.call_args_list[0]
        self.assertEqual(debug_call.kwargs["params"], {"input_token": "page-token"})
        self.assertEqual(
            debug_call.kwargs["headers"]["Authorization"],
            "Bearer app-123|app-secret",
        )

    def test_page_connection_diagnostic_reports_missing_publish_permissions(self):
        debug_response = Mock(ok=True)
        debug_response.json.return_value = {
            "data": {
                "app_id": "app-123",
                "type": "PAGE",
                "is_valid": True,
                "scopes": ["pages_show_list"],
            }
        }
        page_response = Mock(ok=True)
        page_response.json.return_value = {"id": "page-42", "name": "Recipe Page"}

        with patch.object(
            facebook_api.requests,
            "get",
            side_effect=[debug_response, page_response],
        ):
            diagnostic = facebook_api.inspect_page_connection(
                page_access_token="page-token",
                app_id="app-123",
                app_secret="app-secret",
                expected_page_id="page-42",
            )

        self.assertEqual(
            diagnostic["missing_permissions"],
            [
                "pages_manage_engagement",
                "pages_manage_posts",
                "pages_read_engagement",
            ],
        )


if __name__ == "__main__":
    unittest.main()
