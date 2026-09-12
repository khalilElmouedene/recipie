from __future__ import annotations

import hashlib
import os
import unittest
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "pinterest-test-only-" * 4)
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.crypto import decrypt, encrypt
from app.database import Base, get_db
from app.db_models import Project, Recipe, RecipeStatus, Site, User, UserRole
from app.dependencies import get_current_user
from app.pinterest_models import PinterestOAuthState, PinterestPublication, PinterestPublisher
from app.routes import pinterest_publishing as routes
from app.services import pinterest_api as api
from app.services import pinterest_publisher as service


class AsyncDb:
    """Real SQL/constraints on isolated SQLite; synchronous I/O behind async methods.

    PostgreSQL advisory locks are separately verified with connection contract tests.
    """
    def __init__(self, session): self.session = session
    def add(self, item): self.session.add(item)
    async def get(self, *args, **kwargs): return self.session.get(*args, **kwargs)
    async def scalar(self, *args, **kwargs): return self.session.scalar(*args, **kwargs)
    async def scalars(self, *args, **kwargs): return self.session.scalars(*args, **kwargs)
    async def execute(self, *args, **kwargs): return self.session.execute(*args, **kwargs)
    async def commit(self): self.session.commit()
    async def refresh(self, *args, **kwargs): self.session.refresh(*args, **kwargs)


class PinterestDatabaseTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine, expire_on_commit=False)
        self.db = AsyncDb(self.session)
        self.user = User(id=uuid.uuid4(), email=service.ALLOWED_EMAIL, full_name="Khalil", role=UserRole.owner)
        self.project = Project(id=uuid.uuid4(), name="Recipes", owner_id=self.user.id)
        self.site = Site(id=uuid.uuid4(), project_id=self.project.id, domain="example.com", wp_url="https://example.com")
        self.other_site = Site(id=uuid.uuid4(), project_id=self.project.id, domain="second.com", wp_url="https://second.com")
        self.session.add_all([self.user, self.project, self.site, self.other_site])
        self.publisher = PinterestPublisher(site_id=self.site.id, user_id=self.user.id,
            username="chef", access_token_encrypted=encrypt("access-test"), refresh_token_encrypted=encrypt("refresh-test"),
            token_expires_at=service.utcnow() + timedelta(days=10), enabled=True, daily_limit=10, interval_minutes=60)
        self.session.add(self.publisher)
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def recipe(self, **overrides):
        values = dict(id=uuid.uuid4(), site_id=self.site.id, created_by=self.user.id,
            image_url="https://example.com/food.jpg", recipe_text="Soup", pin_title="Cozy soup",
            pin_description="Make this cozy soup.", pin_board="Soups", pin_tags="cozy soup, winter recipes",
            pin_design_image="https://example.com/pin.jpg", wp_permalink="https://example.com/soup",
            status=RecipeStatus.generated)
        values.update(overrides)
        recipe = Recipe(**values)
        self.session.add(recipe)
        self.session.commit()
        return recipe

    @asynccontextmanager
    async def lock(self, *_): yield self.db

    async def sync(self):
        await service.sync_queue(self.db, self.site.id)
        return self.session.scalar(select(PinterestPublication).where(PinterestPublication.site_id == self.site.id))

    async def publish(self, result=None, error=None):
        request = AsyncMock(side_effect=error, return_value=result or {"id": "12345"})
        with patch.object(service, "locked_session", self.lock), patch.object(api, "ensure_board", AsyncMock(return_value="42")), patch.object(api, "request", request):
            await service.publish_one(self.db, self.publisher)
        return request

    async def test_queue_matches_gallery_and_is_site_scoped_idempotent(self):
        self.recipe()
        self.recipe(site_id=self.other_site.id)
        self.recipe(status=RecipeStatus.pending)
        item = await self.sync()
        await self.sync()
        items = self.session.scalars(select(PinterestPublication)).all()
        self.assertEqual(len(items), 1)
        self.assertEqual(item.title, "Cozy soup")
        self.assertEqual(item.image_url, "https://example.com/pin.jpg")

    async def test_success_stores_history_and_never_republishes(self):
        recipe = self.recipe()
        item = await self.sync()
        request = await self.publish()
        self.assertEqual(item.status, "published")
        self.assertEqual(item.pin_id, "12345")
        self.assertIsNotNone(item.published_at)
        payload = request.call_args.kwargs["json"]
        self.assertEqual(payload["board_id"], "42")
        self.assertEqual(payload["link"], recipe.wp_permalink)
        self.assertIn("winter recipes", payload["description"])
        self.publisher.last_attempt_at = None
        request = await self.publish()
        request.assert_not_called()
        self.session.delete(recipe)
        self.session.commit()
        self.assertIsNotNone(self.session.get(PinterestPublication, item.id))

    async def test_dispatch_is_committed_before_api_write(self):
        self.recipe()
        item = await self.sync()
        async def request(*args, **kwargs):
            self.assertEqual(item.status, "publishing")
            self.assertIsNotNone(item.dispatched_at)
            self.assertFalse(item.retry_safe)
            self.assertFalse(self.session.in_transaction())
            return {"id": "12345"}
        with patch.object(service, "locked_session", self.lock), patch.object(api, "ensure_board", AsyncMock(return_value="42")), patch.object(api, "request", request):
            await service.publish_one(self.db, self.publisher)

    async def test_missing_content_fails_without_board_or_pin_request(self):
        self.recipe(wp_permalink=None)
        item = await self.sync()
        request = await self.publish()
        request.assert_not_called()
        self.assertEqual(item.status, "failed")
        self.assertIn("article URL", item.error)
        self.assertIsNone(item.pin_id)
        self.assertTrue(item.retry_safe)

    async def test_safe_transient_failure_can_retry_without_exceeding_interval(self):
        self.recipe()
        item = await self.sync()
        await self.publish(error=api.PinterestError("Rate limited", retryable=True))
        self.assertEqual(item.status, "failed")
        self.assertIsNotNone(item.next_retry_at)
        self.assertEqual(await service.daily_usage(self.db, self.site.id, service.utcnow()), 0)
        (await self.publish()).assert_not_called()
        self.publisher.last_attempt_at = service.utcnow() - timedelta(hours=2)
        item.next_retry_at = service.utcnow() - timedelta(minutes=1)
        await self.publish()
        self.assertEqual(item.status, "published")
        self.assertEqual(item.attempt_count, 2)

    async def test_uncertain_failure_is_never_auto_retried_and_reserves_daily_slot(self):
        self.recipe()
        item = await self.sync()
        await self.publish(error=api.PinterestError("Unknown result", uncertain=True))
        self.assertEqual(item.status, "failed")
        self.assertFalse(item.retry_safe)
        self.assertIsNone(item.pin_id)
        self.assertIsNone(item.next_retry_at)
        self.assertEqual(await service.daily_usage(self.db, self.site.id, service.utcnow()), 1)
        self.publisher.last_attempt_at = None
        (await self.publish()).assert_not_called()
        with self.assertRaises(HTTPException) as result:
            await routes.retry_item(self.site.id, item.id, routes.RetryBody(), self.user, self.db)
        self.assertEqual(result.exception.status_code, 409)

    async def test_crash_recovery_distinguishes_before_and_after_dispatch(self):
        self.recipe()
        item = await self.sync()
        item.status = "publishing"
        self.session.commit()
        await service.recover_interrupted(self.db, self.site.id)
        self.session.refresh(item)
        self.assertTrue(item.retry_safe)
        self.assertEqual(item.status, "failed")
        item.status = "publishing"
        item.dispatched_at = service.utcnow()
        self.session.commit()
        await service.recover_interrupted(self.db, self.site.id)
        self.session.refresh(item)
        self.assertFalse(item.retry_safe)
        self.assertIsNone(item.next_retry_at)

    async def test_daily_limit_stops_next_item_and_interval_survives_restart(self):
        self.recipe()
        self.recipe(pin_title="Second pin")
        await self.sync()
        self.publisher.daily_limit = 1
        await self.publish()
        self.publisher.last_attempt_at = service.utcnow() - timedelta(hours=2)
        (await self.publish()).assert_not_called()
        self.assertEqual(sum(x.status == "pending" for x in self.session.scalars(select(PinterestPublication))), 1)
        self.publisher.daily_limit = 10
        self.publisher.last_attempt_at = service.utcnow()
        self.session.commit()
        self.session.expire_all()
        (await self.publish()).assert_not_called()

    async def test_stop_during_board_lookup_prevents_dispatch(self):
        self.recipe()
        item = await self.sync()
        async def board(*args):
            self.publisher.enabled = False
            self.session.commit()
            return "42"
        with patch.object(service, "locked_session", self.lock), patch.object(api, "ensure_board", board), patch.object(api, "request", AsyncMock()) as request:
            await service.publish_one(self.db, self.publisher)
            request.assert_not_called()
        self.assertEqual(item.status, "pending")

    async def test_changed_daily_limit_is_rechecked_before_dispatch(self):
        self.recipe()
        item = await self.sync()
        self.recipe(pin_title="Existing pin")
        await service.sync_queue(self.db, self.site.id)
        existing = self.session.scalar(select(PinterestPublication).where(PinterestPublication.id != item.id))
        existing.status = "published"
        existing.published_at = service.utcnow()
        self.session.commit()
        async def board(*args):
            self.publisher.daily_limit = 1
            self.session.commit()
            return "42"
        with patch.object(service, "locked_session", self.lock), patch.object(api, "ensure_board", board), patch.object(api, "request", AsyncMock()) as request:
            await service.publish_one(self.db, self.publisher)
            request.assert_not_called()
        self.assertEqual(item.status, "pending")

    async def test_token_refresh_rotates_encrypted_credentials(self):
        self.publisher.token_expires_at = service.utcnow() - timedelta(minutes=1)
        with patch.object(api, "exchange_token", AsyncMock(return_value={"access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 3600, "refresh_token_expires_in": 7200})) as exchange:
            self.assertEqual(await service.access_token(self.db, self.publisher), "new-access")
        self.assertEqual(exchange.call_args.kwargs["refresh_token"], "refresh-test")
        self.assertEqual(decrypt(self.publisher.refresh_token_encrypted), "new-refresh")
        self.assertNotIn("new-access", self.publisher.access_token_encrypted)
        self.assertGreater(service.aware(self.publisher.refresh_expires_at), service.utcnow())

    async def test_status_contains_no_credentials(self):
        status = await routes.publisher_status(self.db, self.publisher, self.site)
        self.assertFalse(any("token" in key or "secret" in key for key in status))
        self.assertNotIn("access-test", str(status))
        self.assertNotIn(self.publisher.access_token_encrypted, str(status))

    async def test_api_denies_other_email_even_for_owner(self):
        self.user.email = "another@gmail.com"
        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[get_current_user] = lambda: self.user
        async def database(): yield self.db
        app.dependency_overrides[get_db] = database
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            for method, path in [("GET", ""), ("GET", "/items"), ("POST", "/auth-url"), ("POST", "/sync"), ("DELETE", "/connection")]:
                result = await client.request(method, f"/api/sites/{self.site.id}/pinterest-publishing{path}")
                self.assertEqual(result.status_code, 403, result.text)

    async def test_denies_unrelated_website(self):
        self.project.owner_id = uuid.uuid4()
        self.session.commit()
        with self.assertRaises(HTTPException) as error:
            await routes.authorized_site(self.site.id, self.user, self.db)
        self.assertEqual(error.exception.status_code, 403)

    async def test_oauth_state_is_bound_expiring_and_one_use(self):
        with patch.object(settings, "pinterest_client_id", "test-id"), patch.object(settings, "pinterest_client_secret", "test-secret"):
            result = await routes.auth_url(self.site.id, self.user, self.db)
        state = result["state"]
        self.assertNotIn("test-secret", result["url"])
        row = self.session.get(PinterestOAuthState, hashlib.sha256(state.encode()).hexdigest())
        self.assertEqual(row.site_id, self.site.id)
        tokens = dict(access_token="oauth-access", refresh_token="oauth-refresh", expires_in=3600, scope=api.SCOPES)
        with patch.object(service, "site_lock", self.lock), patch.object(api, "exchange_token", AsyncMock(return_value=tokens)) as exchange, patch.object(api, "request", AsyncMock(return_value={"username": "connected-chef"})):
            with self.assertRaises(HTTPException):
                await routes.callback(routes.CallbackBody(site_id=self.other_site.id, code="code", state=state), self.user, self.db)
            exchange.assert_not_called()
            status = await routes.callback(routes.CallbackBody(site_id=self.site.id, code="code", state=state), self.user, self.db)
            self.assertTrue(status["connected"])
            self.assertFalse(status["enabled"])
            self.assertEqual(decrypt(self.publisher.refresh_token_encrypted), "oauth-refresh")
            with self.assertRaises(HTTPException):
                await routes.callback(routes.CallbackBody(site_id=self.site.id, code="code", state=state), self.user, self.db)
            self.assertEqual(exchange.await_count, 1)

    async def test_expired_state_is_rejected_before_exchange(self):
        state = "expired-state-with-enough-length"
        self.session.add(PinterestOAuthState(token_hash=hashlib.sha256(state.encode()).hexdigest(), site_id=self.site.id,
            user_id=self.user.id, expires_at=service.utcnow() - timedelta(minutes=1)))
        self.session.commit()
        with patch.object(service, "site_lock", self.lock), patch.object(api, "exchange_token", AsyncMock()) as exchange:
            with self.assertRaises(HTTPException):
                await routes.callback(routes.CallbackBody(site_id=self.site.id, code="code", state=state), self.user, self.db)
            exchange.assert_not_called()

    async def test_disconnect_preserves_history_and_clears_both_tokens(self):
        self.recipe()
        item = await self.sync()
        with patch.object(service, "site_lock", self.lock):
            await routes.disconnect(self.site.id, self.user, self.db)
        self.assertFalse(self.publisher.enabled)
        self.assertIsNone(self.publisher.access_token_encrypted)
        self.assertIsNone(self.publisher.refresh_token_encrypted)
        self.assertIsNotNone(self.session.get(PinterestPublication, item.id))

    async def test_unique_constraint_prevents_duplicate_source_items(self):
        self.recipe()
        item = await self.sync()
        self.session.add(PinterestPublication(site_id=self.site.id, recipe_id=item.recipe_id,
            title="copy", description="", board_name="", keywords="", image_url="", article_url=""))
        with self.assertRaises(IntegrityError): self.session.commit()
        self.session.rollback()

    async def test_retry_cannot_cross_sites_or_reset_published(self):
        self.recipe()
        item = await self.sync()
        await self.publish()
        for site_id, expected in [(self.other_site.id, 404), (self.site.id, 409)]:
            with self.assertRaises(HTTPException) as error:
                await routes.retry_item(site_id, item.id, routes.RetryBody(), self.user, self.db)
            self.assertEqual(error.exception.status_code, expected)

    async def test_cleanup_retains_unpublished_pinterest_sources(self):
        from app.services.image_retention_scheduler import _pinterest_source_needed
        recipe = self.recipe(status=RecipeStatus.published)
        other = self.recipe(site_id=self.other_site.id, status=RecipeStatus.published)
        needed = self.session.scalars(select(Recipe.id).where(_pinterest_source_needed())).all()
        self.assertEqual(needed, [recipe.id])
        item = await self.sync()
        item.status = "published"
        self.session.commit()
        self.assertEqual(self.session.scalars(select(Recipe.id).where(_pinterest_source_needed())).all(), [])

    async def test_reconcile_verifies_pin_before_saving(self):
        self.recipe()
        item = await self.sync()
        await self.publish(error=api.PinterestError("Unknown result", uncertain=True))
        with patch.object(service, "site_lock", self.lock), patch.object(api, "request", AsyncMock(return_value={"id": "67890", "board_id": "different", "link": item.article_url, "title": item.title})):
            with self.assertRaises(HTTPException):
                await routes.reconcile_item(self.site.id, item.id, routes.ReconcileBody(pin_id="67890"), self.user, self.db)
        self.assertEqual(item.status, "failed")
        with patch.object(service, "site_lock", self.lock), patch.object(api, "request", AsyncMock(return_value={"id": "67890", "board_id": "42", "link": item.article_url, "title": item.title, "created_at": "2026-09-12T10:00:00Z"})):
            await routes.reconcile_item(self.site.id, item.id, routes.ReconcileBody(pin_id="67890"), self.user, self.db)
        self.assertEqual(item.status, "published")
        self.assertEqual(item.pin_id, "67890")

    async def test_scheduler_disables_account_after_access_revocation(self):
        self.recipe()
        self.user.email = "revoked@example.com"
        self.session.commit()
        with patch.object(service, "site_lock", self.lock), patch.object(api, "request", AsyncMock()) as request:
            await service.run_site(self.site.id)
            request.assert_not_called()
        self.assertFalse(self.publisher.enabled)

    async def test_api_without_authentication_returns_401(self):
        app = FastAPI()
        app.include_router(routes.router)
        async def database(): yield self.db
        app.dependency_overrides[get_db] = database
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            result = await client.get(f"/api/sites/{self.site.id}/pinterest-publishing")
        self.assertEqual(result.status_code, 401)


class PinterestApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_board_lookup_paginates_and_reuses_owned_board(self):
        responses = [{"items": [{"id": "1", "name": "Soups", "owner": {"username": "someone-else"}}], "bookmark": "next"},
            {"items": [{"id": "42", "name": "  SOUPS ", "owner": {"username": "chef"}}]}]
        with patch.object(api, "request", AsyncMock(side_effect=responses)) as request:
            self.assertEqual(await api.ensure_board("token", "Soups", "chef"), "42")
            self.assertEqual(request.call_args.kwargs["params"]["bookmark"], "next")
            self.assertTrue(all(call.args[0] == "GET" for call in request.call_args_list))

    async def test_missing_board_created_but_read_failure_never_creates(self):
        with patch.object(api, "request", AsyncMock(side_effect=[{"items": []}, {"id": "42"}])) as request:
            self.assertEqual(await api.ensure_board("token", "Soups", "chef"), "42")
            self.assertEqual(request.call_args.args[:2], ("POST", "/boards"))
        with patch.object(api, "request", AsyncMock(side_effect=api.PinterestError("Unavailable"))) as request:
            with self.assertRaises(api.PinterestError): await api.ensure_board("token", "Soups", "chef")
            self.assertEqual(request.await_count, 1)

    async def test_http_failures_are_sanitized_and_ambiguous_writes_not_retryable(self):
        real_client = httpx.AsyncClient
        for code, uncertain, retryable in [(500, True, False), (429, False, True), (400, False, False), (401, False, False)]:
            transport = httpx.MockTransport(lambda req: httpx.Response(code, json={"message": "secret-token-leak"}))
            with patch.object(api.httpx, "AsyncClient", lambda **kw: real_client(transport=transport, **kw)):
                with self.assertRaises(api.PinterestError) as result: await api.request("POST", "/pins", "private-token", json={})
            self.assertEqual(result.exception.uncertain, uncertain)
            self.assertEqual(result.exception.retryable, retryable)
            self.assertNotIn("secret-token", str(result.exception))

    async def test_timeout_after_dispatch_is_uncertain(self):
        real_client = httpx.AsyncClient
        def timeout(request): raise httpx.ReadTimeout("test", request=request)
        with patch.object(api.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(timeout), **kw)):
            with self.assertRaises(api.PinterestError) as result: await api.request("POST", "/pins", "token", json={})
        self.assertTrue(result.exception.uncertain)
        self.assertFalse(result.exception.retryable)

    def test_midnight_does_not_reset_interval(self):
        now = datetime(2026, 9, 12, 0, 10, tzinfo=timezone.utc)
        publisher = SimpleNamespace(last_attempt_at=now - timedelta(minutes=20), interval_minutes=60, daily_limit=10)
        self.assertEqual(service.next_publication_at(publisher, 0, now), now + timedelta(minutes=40))
        self.assertEqual(service.next_publication_at(publisher, 10, now), now.replace(day=13, hour=0, minute=0))

    def test_invalid_settings_rejected(self):
        for daily, interval in [(0, 60), (10, 0), (1001, 60), (10, 10081), (1.5, 60), (True, 60)]:
            with self.assertRaises(ValidationError): routes.PublishingSettings(daily_limit=daily, interval_minutes=interval, enabled=True)

    def test_base64_image_and_description_limits(self):
        item = SimpleNamespace(board_name="Soups", title="T" * 120, description="D" * 495, keywords="keyword",
            article_url="https://example.com/recipe", image_url="data:image/png;base64,aW1hZ2U=")
        payload = api.pin_payload(item)
        self.assertEqual(len(payload["title"]), 100)
        self.assertEqual(len(payload["description"]), 495)
        self.assertEqual(payload["media_source"]["source_type"], "image_base64")


if __name__ == "__main__": unittest.main()
