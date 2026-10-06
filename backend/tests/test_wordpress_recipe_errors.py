"""Offline regressions for recipe-card failures shown in publishing deliveries."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import publisher, wordpress


SITE = {"wp_url": "https://example.com/xmlrpc.php", "domain": "https://example.com",
        "wp_username": "author", "wp_password": "secret"}
CARD = {"name": "Cake", "ingredients_flat": ["200 g flour"],
        "instructions_flat": ["Bake for 30 minutes."]}


def wp_response(status, body):
    response = requests.Response()
    response.status_code = status
    response._content = json.dumps(body).encode()
    return response


class WordPressRecipeErrorTests(unittest.TestCase):
    def test_http_errors_include_wordpress_reason_and_relevant_guidance(self):
        cases = [
            (401, "rest_not_logged_in", "Application Password"),
            (403, "rest_cannot_create", "recipe permissions"),
            (404, "rest_no_route", "WP Recipe Maker is active"),
            (500, "internal_server_error", "HTTP 500"),
        ]
        for status, code, guidance in cases:
            with self.subTest(status=status):
                session = Mock()
                session.post.return_value = wp_response(status, {"code": code, "message": "<b>Recipe rejected</b>"})
                with patch.object(wordpress, "_wp_session", return_value=session):
                    with self.assertRaises(wordpress.RecipeCardCreationError) as caught:
                        wordpress.add_recipe(dict(CARD), SITE, log=lambda _: None, raise_on_error=True)
                message = str(caught.exception)
                self.assertIn(code, message)
                self.assertIn("Recipe rejected", message)
                self.assertIn(guidance, message)
                self.assertNotIn("<b>", message)
                self.assertEqual(session.post.call_count, 1)

    def test_non_json_firewall_response_does_not_expose_html(self):
        response = wp_response(403, {})
        response._content = b"<html>private firewall diagnostics</html>"
        session = Mock()
        session.post.return_value = response
        with patch.object(wordpress, "_wp_session", return_value=session):
            with self.assertRaises(wordpress.RecipeCardCreationError) as caught:
                wordpress.add_recipe(dict(CARD), SITE, log=lambda _: None, raise_on_error=True)
        self.assertIn("HTTP 403", str(caught.exception))
        self.assertNotIn("private firewall", str(caught.exception))

    def test_success_requires_a_positive_integer_recipe_id(self):
        for body in ({}, {"id": 0}, {"id": -1}, {"id": True}, {"id": "12"}, []):
            with self.subTest(body=body):
                session = Mock()
                session.post.return_value = wp_response(201, body)
                with patch.object(wordpress, "_wp_session", return_value=session):
                    with self.assertRaisesRegex(wordpress.RecipeCardCreationError, "no valid recipe ID"):
                        wordpress.add_recipe(dict(CARD), SITE, log=lambda _: None, raise_on_error=True)
        session.post.return_value = wp_response(201, {"id": 12})
        with patch.object(wordpress, "_wp_session", return_value=session):
            self.assertEqual(wordpress.add_recipe(dict(CARD), SITE, log=lambda _: None, raise_on_error=True), 12)

    def test_invalid_json_success_is_unconfirmed(self):
        response = wp_response(200, {})
        response._content = b"<html>Login</html>"
        session = Mock()
        session.post.return_value = response
        with patch.object(wordpress, "_wp_session", return_value=session):
            with self.assertRaisesRegex(wordpress.RecipeCardCreationError, "invalid JSON response"):
                wordpress.add_recipe(dict(CARD), SITE, log=lambda _: None, raise_on_error=True)

    def test_timeout_is_unconfirmed_and_not_retried(self):
        session = Mock()
        session.post.side_effect = requests.Timeout("request timed out")
        with patch.object(wordpress, "_wp_session", return_value=session):
            with self.assertRaisesRegex(wordpress.RecipeCardCreationError, "timed out"):
                wordpress.add_recipe(dict(CARD), SITE, log=lambda _: None, raise_on_error=True)
        self.assertEqual(session.post.call_count, 1)

    def test_legacy_callers_still_receive_none_and_error_log(self):
        session = Mock()
        session.post.return_value = wp_response(403, {"code": "rest_cannot_create", "message": "Cannot create recipes"})
        logs = []
        with patch.object(wordpress, "_wp_session", return_value=session):
            self.assertIsNone(wordpress.add_recipe(dict(CARD), SITE, log=logs.append))
        self.assertIn("rest_cannot_create", logs[-1])

    def test_publisher_preserves_remote_error_and_does_not_create_article(self):
        session = Mock()
        session.post.return_value = wp_response(403, {"code": "rest_cannot_create", "message": "Cannot create recipes"})
        recipe = {"recipe_text": "Cake", "generated_article": "<h1>Cake</h1><p>How to bake a cake.</p>",
                  "generated_json": json.dumps(CARD)}
        with (
            patch.object(publisher, "require_generated_text"),
            patch.object(publisher, "validate_recipe_card"),
            patch.object(publisher, "upload_image", return_value=(10, "https://example.com/cake.jpg")),
            patch.object(publisher, "_random_delay"),
            patch.object(wordpress, "_wp_session", return_value=session),
            patch.object(publisher, "_wp_session") as article_session,
        ):
            result = publisher.publish_recipe(recipe, SITE, log=lambda _: None)
        self.assertIn("article was not published", result["error_message"])
        self.assertIn("HTTP 403 (rest_cannot_create): Cannot create recipes", result["error_message"])
        self.assertNotIn("wp_post_id", result)
        article_session.assert_not_called()


if __name__ == "__main__":
    unittest.main()
