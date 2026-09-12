"""Opt-in real PostgreSQL checks; each test owns a fresh temporary schema.

Set PINTEREST_TEST_DATABASE_URL to a disposable local PostgreSQL test database.
No Pinterest network writes occur in these tests.
"""
import asyncio
import importlib.util
import os
from pathlib import Path
import unittest
import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "pinterest-test-only-" * 4)
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.crypto import encrypt
from app.database import Base
from app.db_models import Project, Recipe, RecipeStatus, Site, User
from app.pinterest_models import PinterestPublication, PinterestPublisher
from app.services import pinterest_api as api
from app.services import pinterest_publisher as service


@unittest.skipUnless(os.getenv("PINTEREST_TEST_DATABASE_URL"), "Disposable PostgreSQL URL not configured")
class PinterestPostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.schema = "pinterest_test_" + uuid.uuid4().hex
        self.engine = create_async_engine(os.environ["PINTEREST_TEST_DATABASE_URL"],
            connect_args={"server_settings": {"search_path": self.schema}})
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
            await conn.run_sync(Base.metadata.create_all)
        self.site_id = uuid.uuid4()
        self.user_id = uuid.uuid4()
        self.project_id = uuid.uuid4()
        async with self.sessions() as db:
            db.add(User(id=self.user_id, email=service.ALLOWED_EMAIL, full_name="Test"))
            await db.flush()
            db.add(Project(id=self.project_id, name="Test", owner_id=self.user_id))
            await db.flush()
            db.add(Site(id=self.site_id, project_id=self.project_id, domain="example.com", wp_url="https://example.com"))
            await db.flush()
            db.add(PinterestPublisher(site_id=self.site_id, user_id=self.user_id, username="test-chef",
                enabled=True, access_token_encrypted=encrypt("test-access"), token_expires_at=service.utcnow() + timedelta(days=5)))
            for i in range(3):
                db.add(Recipe(site_id=self.site_id, created_by=self.user_id, image_url="https://example.com/image.png",
                    recipe_text=f"Recipe {i}", pin_title=f"Pin {i}", pin_description="A warm meal.", pin_board="Meals",
                    pin_design_image="https://example.com/pin.png", wp_permalink=f"https://example.com/recipe-{i}", status=RecipeStatus.generated))
            await db.commit()
        self.patch_engine = patch.object(service, "engine", self.engine)
        self.patch_sessions = patch.object(service, "SessionLocal", self.sessions)
        self.patch_engine.start()
        self.patch_sessions.start()

    async def asyncTearDown(self):
        self.patch_engine.stop()
        self.patch_sessions.stop()
        async with self.engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        await self.engine.dispose()

    async def test_two_workers_publish_once_and_lock_is_released(self):
        async def board(*_):
            await asyncio.sleep(0.1)
            return "42"
        with patch.object(api, "ensure_board", board), patch.object(api, "request", AsyncMock(return_value={"id": "123456"})) as request:
            await asyncio.gather(service.run_site(self.site_id), service.run_site(self.site_id))
        self.assertEqual(request.await_count, 1)
        async with self.sessions() as db:
            items = (await db.scalars(select(PinterestPublication))).all()
            self.assertEqual(len(items), 3)
            self.assertEqual(sum(item.status == "published" for item in items), 1)
        async with service.site_lock(self.site_id) as db:
            self.assertIsNotNone(db)

    async def test_site_lock_survives_commit_and_prevents_competing_connection(self):
        async with service.site_lock(self.site_id) as first:
            await first.commit()
            async with service.site_lock(self.site_id) as second:
                self.assertIsNone(second)
        async with service.site_lock(self.site_id) as third:
            self.assertIsNotNone(third)

    async def test_concurrent_sync_has_one_record_per_recipe(self):
        async def sync():
            async with self.sessions() as db:
                await service.sync_queue(db, self.site_id)
        await asyncio.gather(sync(), sync())
        async with self.sessions() as db:
            self.assertEqual(len((await db.scalars(select(PinterestPublication))).all()), 3)

    async def test_failed_database_save_after_pin_write_is_not_resent(self):
        from sqlalchemy.ext.asyncio import AsyncSession
        real_commit = AsyncSession.commit
        async def commit(db):
            if any(isinstance(item, PinterestPublication) and item.status == "published" for item in db.dirty):
                raise RuntimeError("Simulated database outage after Pinterest accepted the pin")
            return await real_commit(db)
        with patch.object(api, "ensure_board", AsyncMock(return_value="42")), patch.object(api, "request", AsyncMock(return_value={"id": "123456"})) as request:
            with patch.object(AsyncSession, "commit", commit):
                with self.assertRaises(RuntimeError): await service.run_site(self.site_id)
            await service.run_site(self.site_id)
            self.assertEqual(request.await_count, 1)
        async with self.sessions() as db:
            item = await db.scalar(select(PinterestPublication).where(PinterestPublication.status == "failed"))
            self.assertFalse(item.retry_safe)
            self.assertIsNone(item.pin_id)

    async def test_migration_works_before_or_after_startup_create_all(self):
        path = Path(__file__).parents[1] / "alembic/versions/add_pinterest_publishing.py"
        spec = importlib.util.spec_from_file_location("pinterest_migration_test", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        credential_path = path.with_name("add_pinterest_app_credentials.py")
        credential_spec = importlib.util.spec_from_file_location("pinterest_credentials_migration_test", credential_path)
        credential_migration = importlib.util.module_from_spec(credential_spec)
        credential_spec.loader.exec_module(credential_migration)
        def check(connection):
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()  # startup tables already exist
                migration.downgrade()
                migration.upgrade()  # migration creates all tables
                migration.upgrade()  # idempotent
                credential_migration.upgrade()
                credential_migration.upgrade()  # supports tables created by startup
                credential_migration.downgrade()
                credential_migration.upgrade()
            inspector = inspect(connection)
            for table in (PinterestPublisher.__table__, PinterestPublication.__table__):
                columns = {col["name"]: col for col in inspector.get_columns(table.name)}
                self.assertEqual(set(columns), set(table.columns.keys()))
                for column in table.columns:
                    self.assertEqual(columns[column.name]["nullable"], column.nullable)
        async with self.engine.begin() as conn:
            await conn.run_sync(check)
