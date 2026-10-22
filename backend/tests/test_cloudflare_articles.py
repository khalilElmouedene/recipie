"""Offline checks for the private Cloudflare article workflow (no paid API calls)."""
from __future__ import annotations

import base64
import io
import json
import os
import unittest
import uuid
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.crypto import decrypt
from app.database import get_db
from app.db_models import JobStatus, JobType, UserCredential
from app.dependencies import get_current_user
from app.models import JobStart
from app.routes import cloudflare, jobs
from app.services import article_generator, cloudflare_ai

CREDS = {"cloudflare_account_id": "a" * 32, "cloudflare_api_token": "test-private-token"}


def response(status=200, payload=None):
    img = io.BytesIO()
    Image.new("RGB", (12, 8), "orange").save(img, "JPEG")
    return SimpleNamespace(status_code=status, ok=status < 400,
                           json=lambda: payload if payload is not None else {
                               "success": True, "result": {"image": base64.b64encode(img.getvalue()).decode()}})


class CloudflareImageTests(unittest.TestCase):
    def setUp(self):
        # A regular workspace directory also works with restricted Windows temp ACLs.
        root = Path.cwd() / f".tmp_cloudflare_test_{uuid.uuid4().hex}"
        root.mkdir()
        self.temp = SimpleNamespace(name=str(root))
        def cleanup():
            for file in root.iterdir():
                file.unlink()
            root.rmdir()
        self.addCleanup(cleanup)
        self.env = patch.dict(os.environ, {"UPLOADS_DIR": self.temp.name})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_four_real_images_saved_and_reused_without_more_requests(self):
        with patch.object(cloudflare_ai.requests, "post", return_value=response()) as post:
            images = cloudflare_ai.generate_images("Tomato soup", CREDS, recipe_id="group1", log=lambda _: None)
            self.assertEqual(len(images), 4)
            self.assertEqual(post.call_count, 4)
            again = cloudflare_ai.generate_images("Tomato soup", CREDS, recipe_id="group1", log=lambda _: None)
            self.assertEqual(images, again)
            self.assertEqual(post.call_count, 4)
            self.assertEqual(len(list(Path(self.temp.name).glob("cf_*.jpg"))), 4)
            for path in Path(self.temp.name).glob("cf_*.jpg"):
                with Image.open(path) as img:
                    self.assertEqual(img.format, "JPEG")
            self.assertIn(cloudflare_ai.MODEL, post.call_args.args[0])
            self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer test-private-token")
            self.assertNotIn("--ar", post.call_args.kwargs["json"]["prompt"])

    def test_quota_failure_preserves_partial_batch_and_resume_generates_only_remainder(self):
        quota = response(400, {"success": False, "errors": [{"code": 4006}]})
        with patch.object(cloudflare_ai.requests, "post", side_effect=[response(), quota]) as post:
            with self.assertRaisesRegex(RuntimeError, "daily free allocation"):
                cloudflare_ai.generate_images("Soup", CREDS, recipe_id="same-group", log=lambda _: None)
            self.assertEqual(post.call_count, 2)
        with patch.object(cloudflare_ai.requests, "post", return_value=response()) as post:
            images = cloudflare_ai.generate_images("Soup", CREDS, recipe_id="same-group", log=lambda _: None)
            self.assertEqual(len(images), 4)
            self.assertEqual(post.call_count, 3)

    def test_invalid_credentials_and_stop_make_no_requests(self):
        with patch.object(cloudflare_ai.requests, "post") as post:
            with self.assertRaises(ValueError):
                cloudflare_ai.generate_images("Soup", {**CREDS, "cloudflare_account_id": "../bad"})
            self.assertEqual(cloudflare_ai.generate_images("Soup", CREDS, should_stop=lambda: True), [])
            post.assert_not_called()

    def test_bad_images_rate_limit_and_auth_do_not_expose_secret(self):
        for reply, message in [(response(429), "quota"), (response(403), "credentials"),
                               (response(200, {"success": True, "result": {"image": "not-image"}}), "valid image")]:
            with self.subTest(reply=reply), patch.object(cloudflare_ai.requests, "post", return_value=reply):
                with self.assertRaisesRegex(RuntimeError, message) as caught:
                    cloudflare_ai.generate_images("Soup", CREDS, count=1, log=lambda _: None)
                self.assertNotIn(CREDS["cloudflare_api_token"], str(caught.exception))

    def test_cloudflare_replaces_only_image_stage_in_existing_text_pipeline(self):
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
            cf = stack.enter_context(patch.object(cloudflare_ai, "generate_images", return_value=["https://app/uploads/cf.jpg"]))
            result = article_generator.generate_for_recipe("recipe1", "Tomato soup", "https://source/image.jpg",
                "https://site.test", {**CREDS, "image_provider": "cloudflare", "openai": "existing-key", "discord_auth": "must-not-use"}, log=lambda _: None)
            self.assertNotIn("error_message", result)
            self.assertEqual(json.loads(result["generated_images"]), ["https://app/uploads/cf.jpg"])
            self.assertEqual(result["generated_article"], outputs["generate_article"])
            self.assertEqual(result["generated_json"], outputs["generate_recipe_json"])
            self.assertEqual(result["focus_keyword"], "tomato soup")
            for name in ("generate_full_recipe", "generate_article", "generate_recipe_json", "generate_meta_description", "generate_seo_title"):
                mocks[name].assert_called_once()
            cf.assert_called_once()
            mj.assert_not_called()


class CloudflareApiTests(unittest.TestCase):
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
                                  ("POST", f"/api/projects/{self.project_id}/jobs", {"job_type": "articles_all_sites", "image_provider": "cloudflare", "shared_recipes": [{"image_url": "https://source/img", "recipe_text": "Soup"}]})]:
            with self.subTest(url=url), patch.object(jobs, "check_project_access", new_callable=AsyncMock):
                reply = self.client.request(method, url, json=body)
                self.assertEqual(reply.status_code, 403, reply.text)
        self.db.commit.assert_not_called()

    def test_config_is_encrypted_and_raw_token_is_never_returned(self):
        absent = Mock(); absent.scalar_one_or_none.return_value = None
        stored = Mock(); stored.scalars.return_value.all.return_value = []
        self.db.execute.side_effect = [absent, absent, stored]
        reply = self.client.put("/api/cloudflare/config", json={"account_id": "a" * 32, "api_token": "test-private-token"})
        self.assertEqual(reply.status_code, 200, reply.text)
        saved = [call.args[0] for call in self.db.add.call_args_list]
        self.assertTrue(all(isinstance(row, UserCredential) for row in saved))
        self.assertEqual({row.key_type: decrypt(row.encrypted_value) for row in saved}, CREDS)
        self.assertNotIn("test-private-token", reply.text)

    def test_invalid_provider_and_account_id_are_rejected(self):
        self.assertEqual(self.client.put("/api/cloudflare/config", json={"account_id": "bad"}).status_code, 422)
        self.assertEqual(self.client.post(f"/api/projects/{self.project_id}/jobs", json={"job_type": "articles", "image_provider": "other"}).status_code, 422)
        self.assertEqual(JobStart(job_type="articles").image_provider, "midjourney")

    def test_start_job_persists_provider_and_uses_existing_manager(self):
        job = SimpleNamespace(id=uuid.uuid4(), project_id=self.project_id, created_by=self.user.id,
                              job_type="articles_all_sites", image_provider="cloudflare", status="pending",
                              created_at="2026-10-22T00:00:00Z")
        result = Mock(); result.scalar_one_or_none.return_value = SimpleNamespace(id=self.project_id)
        result.scalar_one.return_value = job
        self.db.execute.return_value = result
        with patch.object(jobs, "check_project_access", new_callable=AsyncMock), \
             patch.object(jobs, "load_cloudflare_credentials", new_callable=AsyncMock, return_value=CREDS), \
             patch.object(jobs.job_manager, "start_job", new_callable=AsyncMock) as run:
            reply = self.client.post(f"/api/projects/{self.project_id}/jobs", json={"job_type": "articles_all_sites", "image_provider": "cloudflare", "shared_recipes": [{"image_url": "https://source/img", "recipe_text": "Soup"}]})
            self.assertEqual(reply.status_code, 201, reply.text)
            self.assertEqual(self.db.add.call_args.args[0].image_provider, "cloudflare")
            self.assertEqual(reply.json()["image_provider"], "cloudflare")
            run.assert_awaited_once()

    def test_missing_credentials_reject_start_before_creating_job(self):
        with patch.object(jobs, "check_project_access", new_callable=AsyncMock), \
             patch.object(jobs, "load_cloudflare_credentials", new_callable=AsyncMock, side_effect=ValueError("Save credentials")):
            reply = self.client.post(f"/api/projects/{self.project_id}/jobs", json={"job_type": "articles", "image_provider": "cloudflare"})
            self.assertEqual(reply.status_code, 400)
            self.db.add.assert_not_called()

    def test_other_accounts_cannot_view_resume_stop_delete_or_read_results(self):
        self.user.email = "other@example.com"
        job = SimpleNamespace(id=uuid.uuid4(), project_id=self.project_id, image_provider="cloudflare")
        result = Mock(); result.scalar_one_or_none.return_value = job
        self.db.execute.return_value = result
        for method, suffix in [("GET", ""), ("GET", "/logs"), ("GET", "/generated-recipes"),
                                ("POST", "/resume"), ("POST", "/stop"), ("DELETE", "")]:
            reply = self.client.request(method, f"/api/jobs/{job.id}{suffix}")
            self.assertEqual(reply.status_code, 403, reply.text)

    def test_resume_retries_failed_cloudflare_recipes(self):
        job = SimpleNamespace(id=uuid.uuid4(), project_id=self.project_id, job_type=JobType.articles_all_sites,
                              created_by=self.user.id, image_provider="cloudflare", status=JobStatus.failed,
                              error="quota", created_at="2026-10-22T00:00:00Z")
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


class CloudflareCredentialTests(unittest.IsolatedAsyncioTestCase):
    async def test_credentials_are_scoped_to_the_authorized_creator(self):
        user_id = uuid.uuid4()
        db = AsyncMock()
        user = Mock(); user.scalar_one_or_none.return_value = SimpleNamespace(id=user_id, email="KHALIL@gmail.com")
        creds = Mock(); creds.scalars.return_value.all.return_value = []
        db.execute.side_effect = [user, creds]
        with self.assertRaisesRegex(ValueError, "Account ID"):
            await cloudflare_ai.load_cloudflare_credentials(db, user_id)
        # No fallback to project owners, members, or another user's token.
        self.assertEqual(db.execute.await_count, 2)
        query = db.execute.call_args.args[0]
        self.assertIn(user_id, query.compile().params.values())


class CloudflareMigrationTests(unittest.TestCase):
    def test_upgrade_preserves_existing_jobs_and_supports_cloudflare_then_downgrades(self):
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
                conn.execute(sa.text("INSERT INTO jobs (id, image_provider) VALUES (2, 'cloudflare')"))
                self.assertEqual(conn.execute(sa.text("SELECT image_provider FROM jobs WHERE id = 2")).scalar(), "cloudflare")
                migration.downgrade()
            self.assertEqual(conn.execute(sa.text("SELECT COUNT(*) FROM jobs")).scalar(), 2)
            self.assertNotIn("image_provider", {col["name"] for col in sa.inspect(conn).get_columns("jobs")})
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
