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
    def test_video_publish_uses_page_video_endpoint_and_remote_file_url(self):
        response = Mock(ok=True)
        response.json.return_value = {"id": "video-123"}
        with patch.object(facebook_api.requests, "post", return_value=response) as post:
            post_id = facebook_api.publish_video(
                page_id="page-42",
                page_access_token="page-token",
                video_url="https://example.com/uploads/facebook/video.mp4",
                title="Recipe title",
                description="Recipe title",
            )

        self.assertEqual(post_id, "video-123")
        request_url = post.call_args.args[0]
        request_data = post.call_args.kwargs["data"]
        self.assertTrue(request_url.endswith("/page-42/videos"))
        self.assertEqual(
            request_data["file_url"],
            "https://example.com/uploads/facebook/video.mp4",
        )
        self.assertEqual(request_data["published"], "true")

    def test_first_comment_targets_the_published_video(self):
        response = Mock(ok=True)
        response.json.return_value = {"id": "comment-456"}
        with patch.object(facebook_api.requests, "post", return_value=response) as post:
            comment_id = facebook_api.add_first_comment(
                post_id="video-123",
                page_access_token="page-token",
                message="Full Recipe\nhttps://example.com/recipe",
            )

        self.assertEqual(comment_id, "comment-456")
        self.assertTrue(post.call_args.args[0].endswith("/video-123/comments"))
        self.assertEqual(
            post.call_args.kwargs["data"]["message"],
            "Full Recipe\nhttps://example.com/recipe",
        )


if __name__ == "__main__":
    unittest.main()
