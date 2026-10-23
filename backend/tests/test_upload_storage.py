from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from contextlib import contextmanager

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "upload-storage-test-secret-" * 3)

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.db_models import Project, Recipe, RecipeStatus, Site, User
from app.services import image_retention_scheduler as scheduler
from app.services import upload_storage as storage


@contextmanager
def test_directory():
    parent = Path(__file__).resolve().parent
    directory = parent / f"upload-storage-{uuid.uuid4().hex}"
    directory.mkdir()
    try:
        yield directory
    finally:
        # Verify every recursive cleanup target stays in this test's directory.
        if directory.resolve().parent != parent or not directory.name.startswith("upload-storage-"):
            raise ValueError("Invalid test cleanup path")
        shutil.rmtree(directory)


class AsyncDb:
    def __init__(self, engine):
        self.bind = engine
        self.session = Session(engine, expire_on_commit=False)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        self.session.close()

    async def execute(self, statement, params=None):
        return self.session.execute(statement, params or {})

    async def stream(self, statement):
        rows = self.session.execute(statement)

        async def iterate():
            for row in rows:
                yield row

        return iterate()

    async def delete(self, item):
        self.session.delete(item)

    async def commit(self):
        self.session.commit()


class UploadStorageTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.directory = test_directory()
        self.root = self.directory.__enter__()
        self.owner_id, self.project_id, self.site_id = (uuid.uuid4() for _ in range(3))
        with Session(self.engine) as db:
            db.add(User(id=self.owner_id, email="storage@example.com", full_name="Storage"))
            db.add(Project(id=self.project_id, owner_id=self.owner_id, name="Storage"))
            db.add(Site(id=self.site_id, project_id=self.project_id, domain="example.com", wp_url="https://example.com"))
            db.commit()
        for target, name, value in [
            (storage, "UPLOADS_DIR", self.root),
            (storage, "SessionLocal", lambda: AsyncDb(self.engine)),
            (scheduler, "UPLOADS_DIR", self.root),
            (scheduler, "SessionLocal", lambda: AsyncDb(self.engine)),
            (scheduler.settings, "server_base_url", "https://old-host.example"),
        ]:
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.directory.__exit__, None, None, None)
        self.future = time.time() + 7 * 86400

    def image(self, *, folder="recipes", name=None):
        path = self.root / folder / (name or f"{uuid.uuid4().hex}.jpg")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"test image data")
        return path

    def recipe(self, path=None, **values):
        recipe_id = uuid.uuid4()
        with Session(self.engine) as db:
            db.add(Recipe(
                id=recipe_id, site_id=self.site_id, created_by=self.owner_id,
                image_url=f"https://old-host.example/uploads/{path.relative_to(self.root).as_posix()}" if path else "https://external.example/food.jpg",
                recipe_text="Soup", status=RecipeStatus.published, **values,
            ))
            db.commit()
        return recipe_id

    async def prune(self, **kwargs):
        with patch.object(storage.time, "time", return_value=self.future):
            return await storage.prune_orphan_uploads(**kwargs)

    async def test_preview_changes_nothing_and_counts_allocated_bytes(self):
        path = self.image()
        result = await self.prune()
        self.assertEqual(result["candidates"], 1)
        self.assertGreater(result["candidate_bytes"], 0)
        self.assertEqual(result["deleted"], 0)
        self.assertTrue(path.exists())

    async def test_references_in_html_and_template_json_preserve_images(self):
        from app.db_models import PinDesignerTemplate
        recipe_image = self.image()
        html_image = self.image()
        template_image = self.image()
        self.recipe(recipe_image, generated_article=f'<img src="&#47;uploads&#47;recipes&#47;{html_image.name}">')
        # Use the real template column which was missing from the initial server audit.
        table = PinDesignerTemplate.__table__
        with Session(self.engine) as db:
            db.execute(table.insert().values(
                id=uuid.uuid4(), name="Storage template", owner_id=self.owner_id,
                elements_json=json.dumps([{"src": f"/uploads/recipes/{template_image.name}"}]),
            ))
            db.commit()
        result = await self.prune(dry_run=False)
        self.assertEqual(result["referenced"], 3)
        self.assertEqual(result["deleted"], 0)

    async def test_root_cache_is_reclaimed_but_custom_root_files_are_preserved(self):
        orphan = self.image(folder="")
        custom = self.image(folder="", name="logo.png")
        result = await self.prune(dry_run=False, scope="all")
        self.assertEqual(result["deleted"], 1)
        self.assertFalse(orphan.exists())
        self.assertTrue(custom.exists())

    async def test_audit_history_does_not_keep_deleted_recipe_images_forever(self):
        from app.db_models import AuditLog
        orphan = self.image()
        with Session(self.engine) as db:
            db.add(AuditLog(
                action="delete", table_name="recipes",
                old_values={"image_url": f"/uploads/recipes/{orphan.name}"},
            ))
            db.commit()
        result = await self.prune(dry_run=False)
        self.assertEqual(result["deleted"], 1)
        self.assertFalse(orphan.exists())

    async def test_replaced_file_is_not_deleted_from_a_stale_candidate(self):
        path = self.image()
        original = Path.lstat
        stats = 0

        def lstat(candidate, *args, **kwargs):
            nonlocal stats
            if candidate == path:
                stats += 1
                if stats == 2:
                    candidate.write_bytes(b"a newly replaced file must survive")
            return original(candidate, *args, **kwargs)

        with patch.object(Path, "lstat", lstat):
            result = await self.prune(dry_run=False)
        self.assertEqual(result["deleted"], 0)
        self.assertTrue(path.exists())

    async def test_collects_escaped_json_and_encoded_urls(self):
        key = "recipes/" + "a" * 32 + ".jpg"
        values = [
            json.dumps({"src": "/uploads/" + key}).replace("/", "\\/"),
            '<img src="%2Fuploads%2F' + key + '">',
            json.dumps({"src": "/uploads/" + key}).replace("/", "\\u002f"),
        ]
        for value in values:
            self.assertIn(key, storage.upload_keys(value))
        self.assertEqual(storage.upload_keys("/uploads/../secret"), set())

    async def test_age_grace_unknown_files_and_other_media_are_preserved(self):
        recent = self.image()
        os.utime(recent, (self.future, self.future))
        custom = self.image(name="custom-logo.jpg")
        facebook = self.image(folder="facebook")
        orphan = self.image()
        result = await self.prune(dry_run=False)
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["recent"], 1)
        self.assertTrue(recent.exists() and custom.exists() and facebook.exists())
        self.assertFalse(orphan.exists())

    async def test_limit_and_failed_removal_are_retried_on_next_pass(self):
        first, second = self.image(), self.image()
        original = Path.unlink

        def unlink(path, *args, **kwargs):
            if path == first:
                raise PermissionError("locked file")
            return original(path, *args, **kwargs)

        with patch.object(Path, "unlink", unlink), self.assertLogs(storage.logger, level="ERROR"):
            result = await self.prune(dry_run=False, limit=0)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["deleted"], 1)
        self.assertTrue(first.exists())
        self.assertFalse(second.exists())
        retried = await self.prune(dry_run=False)
        self.assertEqual(retried["deleted"], 1)

    async def test_batch_limit_does_not_delete_all_candidates(self):
        paths = [self.image() for _ in range(3)]
        result = await self.prune(dry_run=False, limit=1)
        self.assertEqual(result["candidates"], 3)
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(sum(path.exists() for path in paths), 2)

    async def test_database_failure_aborts_without_deleting_files(self):
        path = self.image()
        with patch.object(storage, "collect_upload_references", AsyncMock(side_effect=RuntimeError("DB unavailable"))):
            with self.assertRaises(RuntimeError):
                await self.prune(dry_run=False)
        self.assertTrue(path.exists())

    async def test_api_deletion_preserves_shared_source_until_last_owner_is_deleted(self):
        path = self.image()
        first, second = self.recipe(path), self.recipe(path)
        async with AsyncDb(self.engine) as db:
            await scheduler.delete_recipe_records(db, [db.session.get(Recipe, first)])
        self.assertTrue(path.exists())
        async with AsyncDb(self.engine) as db:
            await scheduler.delete_recipe_records(db, [db.session.get(Recipe, second)])
        self.assertFalse(path.exists())

    async def test_failed_api_file_removal_leaves_an_orphan_that_the_sweeper_retries(self):
        path = self.image()
        recipe_id = self.recipe(path)
        with patch.object(Path, "unlink", side_effect=PermissionError("locked")):
            with self.assertLogs(level="ERROR"):
                async with AsyncDb(self.engine) as db:
                    await scheduler.delete_recipe_records(db, [db.session.get(Recipe, recipe_id)])
        with Session(self.engine) as db:
            self.assertIsNone(db.get(Recipe, recipe_id))
        self.assertTrue(path.exists())
        result = await self.prune(dry_run=False)
        self.assertEqual(result["deleted"], 1)

    async def test_db_commit_failure_keeps_recipe_and_file(self):
        path = self.image()
        recipe_id = self.recipe(path)
        with patch.object(AsyncDb, "commit", AsyncMock(side_effect=RuntimeError("disk full"))):
            with self.assertRaises(RuntimeError):
                await scheduler._system_cleanup_all_published()
        self.assertTrue(path.exists())
        with Session(self.engine) as db:
            self.assertIsNotNone(db.get(Recipe, recipe_id))

    async def test_postgres_apply_locks_reference_tables_before_scanning(self):
        from sqlalchemy.dialects.postgresql import dialect
        db = SimpleNamespace(bind=SimpleNamespace(dialect=dialect()), execute=AsyncMock())
        # AsyncMock's nested result must be a synchronous SQL result.
        from unittest.mock import MagicMock
        db.execute.return_value = MagicMock()
        db.execute.return_value.scalar_one.return_value = True
        self.assertTrue(await storage._lock_reference_tables(db))
        sql = [str(call.args[0]) for call in db.execute.await_args_list]
        self.assertIn("pg_try_advisory_xact_lock", sql[0])
        self.assertTrue(sql[-1].startswith("LOCK TABLE "))
        self.assertIn("pin_designer_templates", sql[-1])
        self.assertTrue(sql[-1].endswith("IN SHARE MODE"))


class CleanupSchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def run_once(self, *, system_error=False, owner_error=False):
        stop = asyncio.Event()

        async def prune(**_kwargs):
            stop.set()
            return {"deleted": 0}

        names = dict(
            _is_system_cleanup_due=AsyncMock(return_value=True),
            _system_cleanup_all_published=AsyncMock(side_effect=OSError("file failed") if system_error else None),
            _cleanup_threads_media_once=AsyncMock(),
            _update_system_cleanup_last_run=AsyncMock(),
            _get_due_cleanup_configs=AsyncMock(return_value=[("owner", 2)]),
            _cleanup_once=AsyncMock(side_effect=OSError("file failed") if owner_error else None),
            _cleanup_pending_stale_source_images=AsyncMock(),
            _update_last_run_at=AsyncMock(),
            prune_orphan_uploads=AsyncMock(side_effect=prune),
        )
        with patch.multiple(scheduler, **names):
            if system_error or owner_error:
                with self.assertLogs(scheduler.logger, level="ERROR"):
                    await asyncio.wait_for(scheduler.run_image_retention_scheduler(stop), 2)
            else:
                await asyncio.wait_for(scheduler.run_image_retention_scheduler(stop), 2)
        return names

    async def test_failed_system_pass_does_not_postpone_retry_and_still_sweeps_orphans(self):
        calls = await self.run_once(system_error=True)
        calls["_update_system_cleanup_last_run"].assert_not_awaited()
        calls["_update_last_run_at"].assert_awaited_once()
        calls["prune_orphan_uploads"].assert_awaited_once()

    async def test_failed_owner_pass_does_not_postpone_retry(self):
        calls = await self.run_once(owner_error=True)
        calls["_update_last_run_at"].assert_not_awaited()
        calls["_update_system_cleanup_last_run"].assert_awaited_once()

    async def test_successful_passes_record_success(self):
        calls = await self.run_once()
        calls["_update_system_cleanup_last_run"].assert_awaited_once()
        calls["_update_last_run_at"].assert_awaited_once()


class CapacityTests(unittest.TestCase):
    def test_reserves_headroom_for_database_and_docker(self):
        with test_directory() as directory:
            with patch.object(storage.shutil, "disk_usage", return_value=SimpleNamespace(free=512 * 1024**2)):
                with self.assertRaises(OSError):
                    storage.ensure_upload_capacity(1, Path(directory))


if __name__ == "__main__":
    unittest.main()
