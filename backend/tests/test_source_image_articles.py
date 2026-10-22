"""Source-image transforms, cache, article pipeline and private workspace checks."""
from __future__ import annotations

import io
import json
import os
import unittest
import uuid
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock, patch

from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.db_models import JobStatus, JobType
from app.dependencies import get_current_user
from app.models import JobStart
from app.routes import cloudflare, jobs
from app.services import article_generator, source_image


class SourceImageTests(unittest.TestCase):
    def setUp(self):
        self.root = Path.cwd() / f".tmp_source_image_test_{uuid.uuid4().hex}"
        self.root.mkdir()
        def cleanup():
            for file in self.root.iterdir():
                file.unlink()
            self.root.rmdir()
        self.addCleanup(cleanup)
        env = patch.dict(os.environ, {"UPLOADS_DIR": str(self.root)})
        env.start(); self.addCleanup(env.stop)
        # Asymmetric gradient proves mirroring and cropping independently of file metadata.
        img = Image.new("RGB", (110, 66))
        img.putdata([(x * 2, y * 3, 40) for y in range(66) for x in range(110)])
        self.original = self.root / "input.png"
        img.save(self.original)
        self.data = self.original.read_bytes()

    def test_source_is_zoomed_mirrored_same_dimensions_and_original_is_untouched(self):
        with patch.object(source_image.requests, "get") as get, patch.object(source_image.requests, "post") as post:
            urls = source_image.prepare_image("/uploads/input.png", recipe_id="input1", log=lambda _: None)
            self.assertEqual(len(urls), 1)
            output = self.root / urls[0].rsplit("/", 1)[-1]
            with Image.open(output) as edited:
                self.assertEqual(edited.size, (110, 66))
                self.assertEqual(edited.format, "JPEG")
                # Zoom crops x=0..4 and x=105..109; horizontal mirror reverses x.
                self.assertAlmostEqual(edited.getpixel((0, 33))[0], 208, delta=6)
                self.assertAlmostEqual(edited.getpixel((109, 33))[0], 10, delta=6)
                self.assertAlmostEqual(edited.getpixel((55, 0))[1], 9, delta=6)
                self.assertAlmostEqual(edited.getpixel((55, 65))[1], 186, delta=6)
            self.assertEqual(self.original.read_bytes(), self.data)
            get.assert_not_called(); post.assert_not_called()
            from app.workers.job_manager import _split_images
            self.assertEqual(_split_images(urls, 3), [urls, urls, urls])

    def test_resume_reuses_one_saved_image_without_downloading_or_editing_again(self):
        urls = source_image.prepare_image("/uploads/input.png", recipe_id="input1", log=lambda _: None)
        with patch.object(source_image, "_source_bytes") as read:
            again = source_image.prepare_image("/uploads/input.png", recipe_id="input1", log=lambda _: None)
            self.assertEqual(again, urls)
            read.assert_not_called()
        self.assertEqual(len(list(self.root.glob("source_*.jpg"))), 1)

    def test_remote_input_is_downloaded_once_and_saved(self):
        reply = MagicMock(status_code=200, headers={})
        reply.__enter__.return_value = reply
        reply.iter_content.return_value = [self.data]
        with patch.object(source_image, "_is_public_url", return_value=True), patch.object(source_image.requests, "get", return_value=reply) as get:
            urls = source_image.prepare_image("https://example.com/input.png", log=lambda _: None)
            self.assertEqual(len(urls), 1)
            get.assert_called_once()
            self.assertEqual(get.call_args.kwargs["headers"]["User-Agent"], "Mozilla/5.0")

    def test_chefkoch_403_reports_status_and_upload_action_without_exposing_url_tokens(self):
        reply = MagicMock(status_code=403, headers={})
        reply.__enter__.return_value = reply
        url = "https://img.chefkoch-cdn.de/rezepte/1244411229360664/bilder/1325491/crop-960x640/heisse-feige-mit-naturjoghurt.jpg?token=private"
        with patch.object(source_image, "_is_public_url", return_value=True), patch.object(source_image.requests, "get", return_value=reply) as get:
            with self.assertRaises(ValueError) as caught:
                source_image.prepare_image(url, log=lambda _: None)
            message = str(caught.exception)
            self.assertIn("HTTP 403", message)
            self.assertIn("img.chefkoch-cdn.de", message)
            self.assertIn("Upload", message)
            self.assertNotIn("token=private", message)
            self.assertEqual(get.call_count, 1)
            reply.iter_content.assert_not_called()
        self.assertEqual(list(self.root.glob("source_*.jpg")), [])

    def test_external_failures_have_distinct_actionable_errors(self):
        for status, expected in [(404, "missing or its link expired"), (410, "missing or its link expired"), (503, "HTTP 503")]:
            reply = MagicMock(status_code=status, headers={})
            reply.__enter__.return_value = reply
            with self.subTest(status=status), patch.object(source_image, "_is_public_url", return_value=True), patch.object(source_image.requests, "get", return_value=reply):
                with self.assertRaisesRegex(ValueError, expected):
                    source_image.prepare_image("https://example.com/input.png", log=lambda _: None)
        for error, expected in [(source_image.requests.Timeout(), "timed out"),
                                (source_image.requests.exceptions.SSLError(), "certificate"),
                                (source_image.requests.ConnectionError(), "Could not connect")]:
            with self.subTest(error=type(error).__name__), patch.object(source_image, "_is_public_url", return_value=True), patch.object(source_image.requests, "get", side_effect=error):
                with self.assertRaisesRegex(ValueError, expected):
                    source_image.prepare_image("https://example.com/input.png", log=lambda _: None)

    def test_invalid_missing_sources_and_traversal_fail_without_api_calls(self):
        (self.root / "invalid.png").write_bytes(b"not an image")
        for url in ("", "/uploads/absent.png", "/uploads/invalid.png", "/uploads/../private.png"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                source_image.prepare_image(url, log=lambda _: None)
        self.assertEqual(list(self.root.glob("source_*.jpg")), [])

    def test_redirect_to_private_url_is_rejected_before_fetching_it(self):
        reply = MagicMock(status_code=302, headers={"Location": "http://127.0.0.1/private"})
        reply.__enter__.return_value = reply
        with patch.object(source_image, "_is_public_url", side_effect=[True, False]), patch.object(source_image.requests, "get", return_value=reply) as get:
            with self.assertRaisesRegex(ValueError, "public HTTP"):
                source_image.prepare_image("https://example.com/input.png", log=lambda _: None)
            self.assertEqual(get.call_count, 1)

    def test_stop_makes_no_requests_or_output(self):
        with patch.object(source_image, "_source_bytes") as read:
            self.assertEqual(source_image.prepare_image("/uploads/input.png", should_stop=lambda: True), [])
            read.assert_not_called()

    def test_oversize_remote_image_is_rejected(self):
        reply = MagicMock(status_code=200, headers={})
        reply.__enter__.return_value = reply
        reply.iter_content.return_value = [b"x" * 513]
        with patch.object(source_image, "MAX_BYTES", 512), patch.object(source_image, "_is_public_url", return_value=True), patch.object(source_image.requests, "get", return_value=reply):
            with self.assertRaisesRegex(ValueError, "25 MB"):
                source_image.prepare_image("https://example.com/input.png", log=lambda _: None)

    def test_new_and_legacy_provider_use_input_image_with_no_midjourney_calls(self):
        for provider in ("source_image", "cloudflare"):
            with self.subTest(provider=provider), patch.object(source_image, "prepare_image", return_value=["https://app/uploads/source.jpg"]) as prepare, patch.object(article_generator.midjourney, "generate_images") as midjourney:
                result = article_generator.generate_images_only("Soup", "/uploads/input.png", {"image_provider": provider, "discord_auth": "unused"})
                self.assertEqual(json.loads(result), ["https://app/uploads/source.jpg"])
                self.assertEqual(prepare.call_args.args[0], "/uploads/input.png")
                midjourney.assert_not_called()

    def test_input_image_replaces_only_image_stage_in_existing_text_pipeline(self):
        outputs = {"generate_full_recipe": "Tomato soup\nTomatoes and basil.", "generate_focus_keyword": "tomato soup",
                   "generate_article": "<p>Tomato soup article</p>", "generate_recipe_json": '{"name":"Soup"}',
                   "generate_meta_description": "Make tomato soup.", "generate_category": "Soup",
                   "generate_seo_title": "Tomato soup recipe", "generate_wp_tags": "soup, tomato",
                   "generate_pinterest_pin_board": "Soup", "generate_pinterest_pin_title": "Tomato soup",
                   "generate_pinterest_pin_description": "Fresh soup", "generate_pinterest_pin_tags": "soup"}
        with ExitStack() as stack:
            mocks = {name: stack.enter_context(patch.object(article_generator.openai_service, name, return_value=value))
                     for name, value in outputs.items()}
            stack.enter_context(patch.object(article_generator, "get_sitemap_links", return_value=[]))
            mj = stack.enter_context(patch.object(article_generator.midjourney, "generate_images"))
            result = article_generator.generate_for_recipe("recipe1", "Tomato soup", "/uploads/input.png",
                "https://site.test", {"image_provider": "source_image", "openai": "existing-key", "discord_auth": "unused"}, log=lambda _: None)
            self.assertNotIn("error_message", result)
            urls = json.loads(result["generated_images"])
            self.assertEqual(len(urls), 1)
            self.assertIn("source_", urls[0])
            self.assertEqual(result["generated_article"], outputs["generate_article"])
            self.assertEqual(result["generated_json"], outputs["generate_recipe_json"])
            self.assertEqual(result["focus_keyword"], "tomato soup")
            for name in ("generate_full_recipe", "generate_article", "generate_recipe_json", "generate_meta_description", "generate_seo_title"):
                mocks[name].assert_called_once()
            mj.assert_not_called()


class SourceImageApiTests(unittest.TestCase):
    def setUp(self):
        self.user = SimpleNamespace(id=uuid.uuid4(), email="khalil@gmail.com", role="owner")
        self.db = AsyncMock()
        self.db.add = Mock()
        self.app = FastAPI()
        self.app.state.limiter = jobs.limiter
        self.app.include_router(cloudflare.router)
        self.app.include_router(jobs.router)
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.project_id = uuid.uuid4()

    def test_other_accounts_including_owners_cannot_configure_test_or_generate(self):
        self.user.email = "other@example.com"
        for method, url, body in [("GET", "/api/cloudflare/config", None),
                                  ("PUT", "/api/cloudflare/config", {"account_id": "a" * 32, "api_token": "secret"}),
                                  ("POST", "/api/cloudflare/test", None),
                                  ("POST", f"/api/projects/{self.project_id}/jobs", {"job_type": "articles_all_sites", "image_provider": "source_image", "shared_recipes": [{"image_url": "https://source/img", "recipe_text": "Soup"}]})]:
            with self.subTest(url=url), patch.object(jobs, "check_project_access", new_callable=AsyncMock):
                reply = self.client.request(method, url, json=body)
                self.assertEqual(reply.status_code, 403, reply.text)
        self.db.commit.assert_not_called()

    def test_retired_cloudflare_endpoints_never_generate_images(self):
        for method, path in [("GET", "/config"), ("PUT", "/config"), ("POST", "/test")]:
            reply = self.client.request(method, "/api/cloudflare" + path)
            self.assertEqual(reply.status_code, 410)

    def test_invalid_provider_is_rejected(self):
        reply = self.client.post(f"/api/projects/{self.project_id}/jobs", json={"job_type": "articles", "image_provider": "other"})
        self.assertEqual(reply.status_code, 422)
        self.assertEqual(JobStart(job_type="articles").image_provider, "midjourney")

    def test_start_job_persists_provider_and_uses_existing_manager(self):
        job = SimpleNamespace(id=uuid.uuid4(), project_id=self.project_id, created_by=self.user.id,
                              job_type="articles_all_sites", image_provider="source_image", status="pending",
                              created_at="2026-10-22T00:00:00Z")
        result = Mock(); result.scalar_one_or_none.return_value = SimpleNamespace(id=self.project_id)
        result.scalar_one.return_value = job
        self.db.execute.return_value = result
        with patch.object(jobs, "check_project_access", new_callable=AsyncMock), \
             patch.object(jobs.job_manager, "start_job", new_callable=AsyncMock) as run:
            reply = self.client.post(f"/api/projects/{self.project_id}/jobs", json={"job_type": "articles_all_sites", "image_provider": "source_image", "shared_recipes": [{"image_url": "https://source/img", "recipe_text": "Soup"}]})
            self.assertEqual(reply.status_code, 201, reply.text)
            self.assertEqual(self.db.add.call_args.args[0].image_provider, "source_image")
            self.assertEqual(reply.json()["image_provider"], "source_image")
            run.assert_awaited_once()

    def test_other_accounts_cannot_view_resume_stop_delete_or_read_results(self):
        self.user.email = "other@example.com"
        job = SimpleNamespace(id=uuid.uuid4(), project_id=self.project_id, image_provider="source_image")
        result = Mock(); result.scalar_one_or_none.return_value = job
        self.db.execute.return_value = result
        for method, suffix in [("GET", ""), ("GET", "/logs"), ("GET", "/generated-recipes"),
                                ("POST", "/resume"), ("POST", "/stop"), ("DELETE", "")]:
            reply = self.client.request(method, f"/api/jobs/{job.id}{suffix}")
            self.assertEqual(reply.status_code, 403, reply.text)

    def test_resume_retries_failed_source_image_recipes(self):
        job = SimpleNamespace(id=uuid.uuid4(), project_id=self.project_id, job_type=JobType.articles_all_sites,
                              created_by=self.user.id, image_provider="source_image", status=JobStatus.failed,
                              error="Missing image", created_at="2026-10-22T00:00:00Z")
        found = Mock(); found.scalar_one_or_none.return_value = job; found.scalar_one.return_value = job
        absent = Mock(); absent.scalar_one_or_none.return_value = None
        self.db.execute.side_effect = [found, absent, Mock(), found]
        with patch.object(jobs, "check_project_access", new_callable=AsyncMock), \
             patch.object(jobs.job_manager, "resume_job", new_callable=AsyncMock, return_value=True) as resume:
            reply = self.client.post(f"/api/jobs/{job.id}/resume")
            self.assertEqual(reply.status_code, 200, reply.text)
            statement = self.db.execute.call_args_list[2].args[0]
            params = statement.compile().params
            self.assertIn("failed", [str(getattr(s, "value", s)) for value in params.values() if isinstance(value, list) for s in value])
            resume.assert_awaited_once_with(job.id)



class ImageProviderMigrationTests(unittest.TestCase):
    def test_upgrade_preserves_existing_jobs_and_supports_source_images_then_downgrades(self):
        import importlib.util
        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        path = Path(__file__).resolve().parents[1] / "alembic/versions/add_job_image_provider.py"
        spec = importlib.util.spec_from_file_location("cloudflare_migration", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        engine = sa.create_engine("sqlite://")
        with engine.begin() as conn:
            conn.execute(sa.text("CREATE TABLE jobs (id INTEGER PRIMARY KEY)"))
            conn.execute(sa.text("INSERT INTO jobs (id) VALUES (1)"))
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
                migration.upgrade()  # Docker may create the current schema before Alembic runs.
                self.assertEqual(conn.execute(sa.text("SELECT image_provider FROM jobs WHERE id = 1")).scalar(), "midjourney")
                conn.execute(sa.text("INSERT INTO jobs (id, image_provider) VALUES (2, 'source_image')"))
                self.assertEqual(conn.execute(sa.text("SELECT image_provider FROM jobs WHERE id = 2")).scalar(), "source_image")
                migration.downgrade()
            self.assertEqual(conn.execute(sa.text("SELECT COUNT(*) FROM jobs")).scalar(), 2)
            self.assertNotIn("image_provider", {col["name"] for col in sa.inspect(conn).get_columns("jobs")})
        engine.dispose()


