"""Offline regressions for the SEO generation and WordPress write boundary."""
from __future__ import annotations

import json
import os
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

os.environ.setdefault("APP_ENV", "development")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bs4 import BeautifulSoup
from app.services import article_generator, openai_service, publisher, seo, wordpress


KEYWORD = "pumpkin cookies"
SOURCE = "Pumpkin cookies\n200 g flour\n100 g pumpkin\nBake for 15 minutes."
CARD = {
    "name": "Pumpkin cookies",
    "ingredients_flat": [{"type": "ingredient", "name": "flour", "amount": "200", "unit": "g"}],
    "instructions_flat": [{"type": "instruction", "text": "Bake for 15 minutes."}],
}
SITE = {"wp_url": "https://example.com/xmlrpc.php", "domain": "https://example.com",
        "wp_username": "test-author", "wp_password": "test-password"}


def article(keyword=KEYWORD, words=650):
    # Word count boundary fixture; real content quality is reviewed separately.
    return f"<h1>{keyword}</h1><p>{keyword} are easy to prepare.</p><h2>How to make {keyword}</h2><p>" + "guidance " * words + "</p>"


def response(value, finish_reason="stop"):
    return SimpleNamespace(choices=[SimpleNamespace(finish_reason=finish_reason,
                                                   message=SimpleNamespace(content=value))])


class SeoValidationTests(unittest.TestCase):
    def test_unicode_keyword_and_word_boundaries(self):
        keyword = seo.clean_focus_keyword('"Spaghetti-Kürbis mit Käse"')
        self.assertEqual(keyword, "spaghetti-kürbis mit käse")
        self.assertTrue(seo.contains_keyword("SPAGHETTI-KÜRBIS mit Käse Rezept", keyword))
        self.assertFalse(seo.contains_keyword("pumpkin cookiesauce", KEYWORD))

    def test_keyword_lists_and_failed_responses_are_rejected(self):
        for value in ("", "Error: quota exceeded", "pumpkin cookies, cookies", "cookies\npumpkin"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                seo.clean_focus_keyword(value)

    def test_h1_and_hidden_scripts_do_not_satisfy_body_length(self):
        value = article(words=570) + "<script>" + "hidden " * 100 + "</script>"
        self.assertTrue(any("600" in issue for issue in seo.article_issues(value, KEYWORD)))
        self.assertEqual(seo.article_issues(article(), KEYWORD), [])

    def test_valid_grouped_recipe_card(self):
        grouped = {"name": "Cookies", "ingredients": [{"ingredients": [{"name": "flour"}]}],
                   "instructions": [{"instructions": [{"text": "Bake."}]}]}
        self.assertIs(seo.validate_recipe_card(grouped), grouped)

    def test_recipe_card_needs_ingredients_and_instructions(self):
        for key in ("ingredients_flat", "instructions_flat"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                seo.validate_recipe_card({**CARD, key: []})


class AiGenerationTests(unittest.TestCase):
    def test_api_failure_raises_and_only_waits_between_attempts(self):
        client = Mock()
        client.chat.completions.create.side_effect = RuntimeError("offline")
        with patch.object(openai_service, "_get_client", return_value=client), patch.object(openai_service.time, "sleep") as sleep:
            with self.assertRaises(RuntimeError):
                openai_service.generate_with_openai("prompt", "test-key", log=lambda _: None)
        self.assertEqual(client.chat.completions.create.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_truncated_response_is_rejected(self):
        with self.assertRaises(ValueError):
            openai_service._response_text(response("partial", "length"))

    def test_full_recipe_prompt_preserves_complete_input(self):
        with patch.object(openai_service, "generate_with_openai", return_value=SOURCE) as generate:
            openai_service.generate_full_recipe(SOURCE, "test-key", prompts={"full_recipe": "Legacy {recipe_title}"})
        self.assertIn(SOURCE, generate.call_args.args[0])

    def test_custom_article_prompt_gets_shared_keyword_and_safe_link_fallback(self):
        with patch.object(openai_service, "generate_with_openai", return_value=article()) as generate:
            openai_service.generate_article("Cookies", SOURCE, "", [], "test-key",
                prompts={"article": "Legacy {recipe_title}: {full_recipe}\n{internal_links}"},
                focus_keyword=KEYWORD)
        prompt = generate.call_args.args[0]
        self.assertIn(KEYWORD, prompt)
        self.assertIn("never invent recipe URLs", prompt)
        self.assertEqual(generate.call_count, 1)

    def test_article_has_one_repair_attempt(self):
        with patch.object(openai_service, "generate_with_openai", side_effect=["<p>Too short</p>", "```html\n" + article() + "\n```"] ) as generate:
            value = openai_service.generate_article("Cookies", SOURCE, "", [], "test-key", focus_keyword=KEYWORD)
        self.assertEqual(generate.call_count, 2)
        self.assertNotIn("```", value)
        self.assertEqual(seo.article_issues(value, KEYWORD), [])

    def test_unrepaired_article_continues_with_warning(self):
        logs = []
        with patch.object(openai_service, "generate_with_openai", return_value="<p>Too short</p>") as generate:
            value = openai_service.generate_article("Cookies", SOURCE, "", [], "test-key", focus_keyword=KEYWORD, log=logs.append)
        self.assertEqual(value, "<p>Too short</p>")
        self.assertTrue(any("SEO warning" in message and "Generation will continue" in message for message in logs))
        self.assertEqual(generate.call_count, 2)

    def test_missing_keyword_in_first_paragraph_is_not_fatal(self):
        original = article().replace(f"<p>{KEYWORD} are easy to prepare.</p>", "<p>A warm, cozy recipe for autumn.</p>")
        logs = []
        with patch.object(openai_service, "generate_with_openai", return_value=original):
            value = openai_service.generate_article("Cookies", SOURCE, "", [], "test-key", focus_keyword=KEYWORD, log=logs.append)
        self.assertEqual(value, original)
        self.assertTrue(any("first paragraph" in message and "SEO warning" in message for message in logs))

    def test_failed_or_invalid_seo_repair_keeps_original_article(self):
        original = article().replace(f"<p>{KEYWORD} are easy to prepare.</p>", "<p>A cozy autumn recipe.</p>")
        for repair in (RuntimeError("API unavailable"), "Error: failed", "", "<p></p>", "<p>Shorter and worse</p>"):
            with self.subTest(repair=repair), patch.object(openai_service, "generate_with_openai", side_effect=[original, repair]):
                value = openai_service.generate_article("Cookies", SOURCE, "", [], "test-key", focus_keyword=KEYWORD, log=lambda _: None)
            self.assertEqual(value, original)

    def test_failed_initial_article_generation_still_raises(self):
        with patch.object(openai_service, "generate_with_openai", side_effect=RuntimeError("API unavailable")):
            with self.assertRaises(RuntimeError):
                openai_service.generate_article("Cookies", SOURCE, "", [], "test-key", focus_keyword=KEYWORD)

    def test_empty_initial_html_still_fails_without_seo_repair(self):
        with patch.object(openai_service, "generate_with_openai", return_value="<p></p>") as generate:
            with self.assertRaisesRegex(ValueError, "empty content"):
                openai_service.generate_article("Cookies", SOURCE, "", [], "test-key", focus_keyword=KEYWORD)
        self.assertEqual(generate.call_count, 1)

    def test_description_repair_returns_plain_text(self):
        with patch.object(openai_service, "generate_with_openai", side_effect=["Wrong phrase", '<b>Make pumpkin cookies with simple ingredients.</b>']) as generate:
            value = openai_service.generate_meta_description(article(), "test-key", focus_keyword=KEYWORD)
        self.assertEqual(value, "Make pumpkin cookies with simple ingredients.")
        self.assertEqual(generate.call_count, 2)

    def test_title_repair_uses_keyword(self):
        client = Mock()
        client.chat.completions.create.return_value = response("Wrong phrase")
        with patch.object(openai_service, "_get_client", return_value=client), patch.object(openai_service, "generate_with_openai", return_value="Pumpkin Cookies Recipe"):
            value = openai_service.generate_seo_title(article(), "test-key", focus_keyword=KEYWORD)
        self.assertEqual(value, "Pumpkin Cookies Recipe")

    def test_metadata_seo_issues_and_repair_failures_do_not_fail_generation(self):
        description = "A cozy autumn dessert. " * 8
        title = "A cozy autumn dessert"
        logs = []
        with patch.object(openai_service, "generate_with_openai", side_effect=[description, RuntimeError("API unavailable")]):
            value = openai_service.generate_meta_description(article(), "test-key", focus_keyword=KEYWORD, log=logs.append)
        self.assertEqual(value, description.strip())
        self.assertTrue(any("Generation will continue" in message for message in logs))
        client = Mock()
        client.chat.completions.create.return_value = response(title)
        with patch.object(openai_service, "_get_client", return_value=client), patch.object(openai_service, "generate_with_openai", return_value=title):
            value = openai_service.generate_seo_title(article(), "test-key", focus_keyword=KEYWORD, log=lambda _: None)
        self.assertEqual(value, title)

    def test_recipe_json_preserves_quantities_without_fake_time_defaults(self):
        with patch.object(openai_service, "generate_with_openai", return_value=json.dumps(CARD)) as generate:
            data = json.loads(openai_service.generate_recipe_json("Cookies", article(), "", "test-key", full_recipe=SOURCE))
        self.assertIn(SOURCE, generate.call_args.args[0])
        self.assertEqual(data["ingredients_flat"][0]["amount"], "200")
        self.assertEqual(data["prep_time"], 0)
        self.assertEqual(data["nutrition"]["calories"], "")

    def test_bad_json_does_not_become_empty_fallback_card(self):
        for value in ("not JSON", '{}', json.dumps({**CARD, "ingredients_flat": []})):
            with self.subTest(value=value), patch.object(openai_service, "generate_with_openai", return_value=value):
                with self.assertRaisesRegex(ValueError, "incomplete recipe card"):
                    openai_service.generate_recipe_json("Cookies", article(), "", "test-key")


class GenerationPipelineTests(unittest.TestCase):
    def run_generation(self, *, existing_keyword="", generated_article=None):
        names = {"generate_full_recipe": SOURCE, "generate_focus_keyword": KEYWORD,
                 "generate_article": generated_article or article(), "generate_recipe_json": json.dumps(CARD),
                 "generate_meta_description": "Make pumpkin cookies at home.", "generate_category": "Cookies",
                 "generate_seo_title": "Pumpkin Cookies Recipe", "generate_wp_tags": "pumpkin, cookies",
                 "generate_pinterest_pin_board": "Cookies", "generate_pinterest_pin_title": "Cookies",
                 "generate_pinterest_pin_description": "Make cookies", "generate_pinterest_pin_tags": "cookies"}
        with ExitStack() as stack:
            mocks = {key: stack.enter_context(patch.object(openai_service, key, return_value=value)) for key, value in names.items()}
            stack.enter_context(patch.object(article_generator, "get_sitemap_links", return_value=[]))
            result = article_generator.generate_for_recipe("test-recipe", SOURCE, "", "https://example.com",
                {"openai": "test-key"}, log=lambda _: None, focus_keyword=existing_keyword)
        return result, mocks

    def test_complete_source_and_shared_phrase_reach_every_seo_stage(self):
        result, mocks = self.run_generation()
        self.assertNotIn("error_message", result)
        self.assertEqual(mocks["generate_full_recipe"].call_args.args[0], SOURCE)
        self.assertEqual(result["focus_keyword"], KEYWORD)
        for name in ("generate_article", "generate_meta_description", "generate_seo_title"):
            self.assertEqual(mocks[name].call_args.kwargs["focus_keyword"], KEYWORD)
        self.assertEqual(mocks["generate_recipe_json"].call_args.kwargs["full_recipe"], SOURCE)
        self.assertEqual(result["wp_tags"], "pumpkin, cookies")

    def test_existing_keyword_is_preserved(self):
        result, mocks = self.run_generation(existing_keyword="Soft Pumpkin Cookies")
        mocks["generate_focus_keyword"].assert_not_called()
        self.assertEqual(result["focus_keyword"], "soft pumpkin cookies")

    def test_error_text_stops_before_recipe_card_and_metadata(self):
        result, mocks = self.run_generation(generated_article="Error: quota exceeded")
        self.assertIn("error_message", result)
        self.assertNotIn("generated_article", result)
        mocks["generate_recipe_json"].assert_not_called()
        mocks["generate_meta_description"].assert_not_called()


class WordpressSeoTests(unittest.TestCase):
    def test_http_success_is_not_enough_to_claim_saved(self):
        expected = {"rank_math_title": "Pumpkin Cookies Recipe", "rank_math_description": "Make pumpkin cookies.", "rank_math_focus_keyword": KEYWORD}
        for saved, status in (({}, "unverified"), ({**expected, "rank_math_focus_keyword": ""}, "failed"), (expected, "verified")):
            with self.subTest(status=status):
                session = Mock()
                session.get.return_value.json.return_value = {"id": 123, "meta": saved}
                with patch.object(wordpress, "_wp_session", return_value=session):
                    result = wordpress.set_rank_math_meta("123", KEYWORD, expected["rank_math_description"], SITE,
                        seo_title=expected["rank_math_title"], log=lambda _: None)
                self.assertEqual(result["status"], status)
                self.assertEqual(session.get.call_args.kwargs["params"]["context"], "edit")

    def test_inline_image_alt_preserves_keyword_and_escapes_quotes(self):
        value = wordpress.inject_images_into_html(BeautifulSoup("<p>Introduction</p>", "html.parser"),
                    "https://example.com/cookies.webp", alt_text='pumpkin cookies "soft"')
        image = BeautifulSoup(value, "html.parser").find("img")
        self.assertEqual(image["alt"], 'pumpkin cookies "soft"')

    def test_invalid_card_stops_before_media_upload_or_post_creation(self):
        with patch.object(publisher, "upload_image") as upload, patch.object(publisher, "_wp_session") as session:
            result = publisher.publish_recipe({"generated_article": article(), "generated_json": '{}'}, SITE, log=lambda _: None)
        self.assertIn("error_message", result)
        upload.assert_not_called()
        session.assert_not_called()

    def test_card_creation_failure_does_not_publish_article(self):
        with patch.object(publisher, "upload_image", return_value=(10, "https://example.com/image.webp")), \
                patch.object(publisher, "_random_delay"), patch.object(publisher, "add_recipe", return_value=None), \
                patch.object(publisher, "_wp_session") as session:
            result = publisher.publish_recipe({"recipe_text": "Cookies", "generated_article": article(), "generated_json": json.dumps(CARD)}, SITE, log=lambda _: None)
        self.assertIn("card creation failed", result["error_message"])
        session.assert_not_called()

    def test_seo_warning_retains_post_id_and_batch_does_not_retry_publish(self):
        session = Mock()
        session.post.return_value.json.return_value = {"id": 123, "link": "https://example.com/pumpkin-cookies/"}
        recipe = {"id": "test-recipe", "recipe_text": "Cookies", "generated_article": article(),
                  "focus_keyword": KEYWORD, "seo_title": "Pumpkin Cookies Recipe", "meta_description": "<b>Make pumpkin cookies.</b>"}
        completed = []
        with patch.object(publisher, "_wp_session", return_value=session), \
                patch.object(publisher, "upload_image", return_value=(10, "https://example.com/image.webp")), \
                patch.object(publisher, "_random_delay"), \
                patch.object(publisher, "set_rank_math_meta", return_value={"status": "unverified", "message": "Enable bridge"}):
            counts = publisher.publish_recipes_from_db([recipe], SITE, log=lambda _: None,
                on_recipe_done=lambda recipe_id, result: completed.append(result))
        self.assertEqual(counts, (1, 1, 0))
        self.assertEqual(session.post.call_count, 1)
        self.assertEqual(completed[0]["wp_post_id"], "123")
        self.assertEqual(completed[0]["seo_status"], "unverified")
        payload = session.post.call_args.kwargs["json"]
        self.assertEqual(payload["slug"], "pumpkin-cookies")
        self.assertEqual(payload["excerpt"], "Make pumpkin cookies.")
        self.assertEqual(payload["meta"]["rank_math_focus_keyword"], KEYWORD)


if __name__ == "__main__":
    unittest.main()
