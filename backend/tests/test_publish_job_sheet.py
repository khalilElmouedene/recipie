from __future__ import annotations

import os
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "publish-sheet-test-" * 4)
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.db_models import Job, JobLog, JobStatus, JobType, Project, Recipe, RecipeStatus, Site, User, UserRole
from app.routes.jobs import get_job_pinterest_sheet
from app.workers.job_manager import _serialize_publish_meta


class AsyncDb:
    def __init__(self, session):
        self.session = session

    async def get(self, *args):
        return self.session.get(*args)

    async def execute(self, *args):
        return self.session.execute(*args)


class PublishJobSheetTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine, expire_on_commit=False)
        self.db = AsyncDb(self.session)
        self.user = User(id=uuid.uuid4(), email="khalil@gmail.com", full_name="Khalil", role=UserRole.owner)
        self.project = Project(id=uuid.uuid4(), name="Recipes", owner_id=self.user.id)
        self.site = Site(id=uuid.uuid4(), project_id=self.project.id, domain="example.com", wp_url="https://example.com")
        self.generation = Job(id=uuid.uuid4(), project_id=self.project.id, created_by=self.user.id,
                              job_type=JobType.articles, status=JobStatus.completed)
        self.job = Job(id=uuid.uuid4(), project_id=self.project.id, created_by=self.user.id,
                       job_type=JobType.publisher, status=JobStatus.completed)
        self.session.add_all([self.user, self.project, self.site, self.generation, self.job])
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def recipe(self, **overrides):
        values = dict(id=uuid.uuid4(), site_id=self.site.id, created_by=self.user.id,
                      created_by_job_id=self.generation.id, image_url="https://example.com/source.jpg",
                      recipe_text="Soup", pin_title="Cozy soup", pin_description="Description: Make soup.",
                      pin_tags="soup, dinner", pin_board="Dinner", status=RecipeStatus.published,
                      pin_design_image="https://example.com/rendered.png", wp_permalink="https://example.com/soup",
                      generated_images='["https://example.com/midjourney.jpg"]')
        values.update(overrides)
        recipe = Recipe(**values)
        self.session.add(recipe)
        self.session.commit()
        return recipe

    def metadata(self, recipes, mode="manual_backdate"):
        self.session.add(JobLog(id=1, job_id=self.job.id, message=_serialize_publish_meta({
            "mode": mode, "_claimed_recipe_ids": [str(recipe.id) for recipe in recipes],
        })))
        self.session.commit()

    async def export(self):
        return await get_job_pinterest_sheet(self.job.id, self.user, self.db)

    async def test_other_accounts_rejected_before_database(self):
        self.user.email = "other@gmail.com"
        db = AsyncMock()
        with self.assertRaises(HTTPException) as caught:
            await get_job_pinterest_sheet(self.job.id, self.user, db)
        self.assertEqual(caught.exception.status_code, 403)
        db.get.assert_not_awaited()

    async def test_missing_job(self):
        with self.assertRaises(HTTPException) as caught:
            await get_job_pinterest_sheet(uuid.uuid4(), self.user, self.db)
        self.assertEqual(caught.exception.status_code, 404)

    async def test_project_access_required(self):
        with patch("app.routes.jobs.check_project_access", AsyncMock(side_effect=HTTPException(403, "No access"))):
            with self.assertRaises(HTTPException) as caught:
                await self.export()
        self.assertEqual(caught.exception.status_code, 403)

    async def test_only_completed_publisher_jobs_can_export(self):
        for status in (JobStatus.pending, JobStatus.running, JobStatus.stopped, JobStatus.failed):
            with self.subTest(status=status):
                self.job.status = status
                with self.assertRaises(HTTPException) as caught:
                    await self.export()
                self.assertEqual(caught.exception.status_code, 409)
        self.job.status = JobStatus.completed
        self.job.job_type = JobType.articles
        with self.assertRaises(HTTPException) as caught:
            await self.export()
        self.assertEqual(caught.exception.status_code, 400)

    async def test_both_modes_export_only_successful_claimed_recipes_with_rendered_images(self):
        self.user.email = " KHALIL@GMAIL.COM "
        recipe = self.recipe()
        failed = self.recipe(status=RecipeStatus.failed)
        self.recipe(pin_title="Unrelated recipe")
        for mode in ("manual_backdate", "wordpress_scheduled"):
            with self.subTest(mode=mode):
                self.session.query(JobLog).delete()
                self.metadata([recipe, failed], mode)
                rows = await self.export()
                self.assertEqual(rows, [dict(recipe_id=str(recipe.id), site_id=str(self.site.id),
                    title="Cozy soup", image_url="https://example.com/rendered.png", description="Make soup.",
                    tags="soup, dinner", article_link="https://example.com/soup", status="draft", board="Dinner")])
        self.assertEqual(recipe.created_by_job_id, self.generation.id)

    async def test_claimed_ids_cannot_include_another_projects_recipes(self):
        project = Project(id=uuid.uuid4(), name="Other", owner_id=self.user.id)
        site = Site(id=uuid.uuid4(), project_id=project.id, domain="other.com", wp_url="https://other.com")
        self.session.add_all([project, site])
        self.session.commit()
        foreign_recipe = self.recipe(site_id=site.id)
        own_recipe = self.recipe()
        self.metadata([own_recipe, foreign_recipe])
        self.assertEqual([row["recipe_id"] for row in await self.export()], [str(own_recipe.id)])

    async def test_legacy_jobs_and_article_post_id_fallback(self):
        recipe = self.recipe(created_by_job_id=self.job.id, wp_permalink=None, wp_post_id="123")
        rows = await self.export()
        self.assertEqual(rows[0]["article_link"], "https://example.com/?p=123")
        self.assertEqual(rows[0]["recipe_id"], str(recipe.id))

    async def test_empty_claims_do_not_fall_back_to_generation_ownership(self):
        self.recipe(created_by_job_id=self.job.id)
        self.metadata([])
        with self.assertRaises(HTTPException) as caught:
            await self.export()
        self.assertEqual(caught.exception.status_code, 422)

    async def test_failed_only_batch_cannot_export_empty_workbook(self):
        self.metadata([self.recipe(status=RecipeStatus.failed)])
        with self.assertRaises(HTTPException) as caught:
            await self.export()
        self.assertEqual(caught.exception.status_code, 422)

    async def test_missing_image_or_article_link_is_actionable(self):
        recipe = self.recipe(pin_design_image=None)
        self.metadata([recipe])
        for image, link in ((None, "https://example.com/soup"), ("https://example.com/pin.png", None)):
            recipe.pin_design_image = image
            recipe.wp_permalink = link
            with self.assertRaises(HTTPException) as caught:
                await self.export()
            self.assertEqual(caught.exception.status_code, 422)
            self.assertIn("rendered pin image or article link", caught.exception.detail)

    async def test_saved_base64_render_is_returned_for_client_hosting(self):
        recipe = self.recipe(pin_design_image="data:image/png;base64,abc")
        self.metadata([recipe])
        self.assertEqual((await self.export())[0]["image_url"], "data:image/png;base64,abc")


if __name__ == "__main__":
    unittest.main()
