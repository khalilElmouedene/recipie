from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from dataclasses import dataclass

from sqlalchemy import select, update

from app.database import SessionLocal
from app.db_models import (
    FacebookContent,
    FacebookContentStatus,
    FacebookDelivery,
    FacebookDeliveryStatus,
    FacebookProject,
    Project,
    Prompt,
    Recipe,
    RecipeStatus,
    Site,
)
from app.services.article_generator import generate_for_recipe
from app.services.credentials_loader import load_credentials_for_job
from app.services.facebook_video import FacebookVideoProcessor
from app.services.facebook_logs import write_facebook_log
from app.services.prompts import DEFAULT_PROMPTS

logger = logging.getLogger(__name__)


class FacebookGenerationCancelled(Exception):
    """Raised at a safe pipeline checkpoint after a project cancellation."""


@dataclass(frozen=True)
class _GenerationContext:
    facebook_project_id: uuid.UUID
    content_project_id: uuid.UUID
    site_id: uuid.UUID
    site_domain: str
    pinterest_url: str
    generate_recipe_json: bool
    credentials: dict[str, str]
    prompts: dict[str, str]
    video_format: str
    video_intro_seconds: float
    video_fps: int
    video_bitrate_kbps: int


class FacebookGenerationManager:
    """Run the video and existing article pipeline once per shared content item."""

    def __init__(self) -> None:
        self._running: set[uuid.UUID] = set()
        self._project_running: dict[uuid.UUID, set[uuid.UUID]] = {}
        self._resume_events: dict[uuid.UUID, threading.Event] = {}
        self._cancel_events: dict[uuid.UUID, threading.Event] = {}
        self._guard = threading.Lock()
        self._video = FacebookVideoProcessor()

    def _control_events_locked(
        self, project_id: uuid.UUID
    ) -> tuple[threading.Event, threading.Event]:
        resume_event = self._resume_events.get(project_id)
        if resume_event is None:
            resume_event = threading.Event()
            resume_event.set()
            self._resume_events[project_id] = resume_event
        cancel_event = self._cancel_events.setdefault(project_id, threading.Event())
        return resume_event, cancel_event

    def pause(self, project_id: uuid.UUID) -> None:
        with self._guard:
            resume_event, _cancel_event = self._control_events_locked(project_id)
            resume_event.clear()

    def resume(self, project_id: uuid.UUID) -> None:
        with self._guard:
            resume_event, _cancel_event = self._control_events_locked(project_id)
            resume_event.set()

    def cancel(self, project_id: uuid.UUID) -> None:
        with self._guard:
            resume_event, cancel_event = self._control_events_locked(project_id)
            cancel_event.set()
            resume_event.set()

    def reset_cancel(self, project_id: uuid.UUID) -> None:
        with self._guard:
            resume_event, cancel_event = self._control_events_locked(project_id)
            cancel_event.clear()
            resume_event.set()

    def is_cancelling(self, project_id: uuid.UUID) -> bool:
        with self._guard:
            cancel_event = self._cancel_events.get(project_id)
            return bool(
                cancel_event
                and cancel_event.is_set()
                and self._project_running.get(project_id)
            )

    def is_running(self, content_id: uuid.UUID) -> bool:
        with self._guard:
            return content_id in self._running

    def _cancel_requested(self, project_id: uuid.UUID) -> bool:
        with self._guard:
            cancel_event = self._cancel_events.get(project_id)
            return bool(cancel_event and cancel_event.is_set())

    def _checkpoint(self, project_id: uuid.UUID) -> None:
        with self._guard:
            resume_event, cancel_event = self._control_events_locked(project_id)
        if cancel_event.is_set():
            raise FacebookGenerationCancelled()
        while not resume_event.wait(timeout=0.5):
            if cancel_event.is_set():
                raise FacebookGenerationCancelled()
        if cancel_event.is_set():
            raise FacebookGenerationCancelled()

    def _release(self, project_id: uuid.UUID, content_id: uuid.UUID) -> None:
        with self._guard:
            self._running.discard(content_id)
            project_running = self._project_running.get(project_id)
            if project_running is None:
                return
            project_running.discard(content_id)
            if project_running:
                return
            self._project_running.pop(project_id, None)
            cancel_event = self._cancel_events.get(project_id)
            if cancel_event is not None:
                cancel_event.clear()

    async def _load_context(
        self, facebook_project_id: uuid.UUID, created_by: uuid.UUID
    ) -> _GenerationContext:
        async with SessionLocal() as db:
            project = (
                await db.execute(
                    select(FacebookProject).where(FacebookProject.id == facebook_project_id)
                )
            ).scalar_one()
            site = (
                await db.execute(
                    select(Site)
                    .where(Site.project_id == project.content_project_id)
                    .order_by(Site.created_at.asc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if site is None:
                raise ValueError("Configure the project website before starting generation.")

            credentials = await load_credentials_for_job(db, project.content_project_id, created_by)
            if not credentials.get("openai"):
                raise ValueError("Configure an OpenAI API key before starting Facebook generation.")

            prompts: dict[str, str] = {
                key: item["value"] for key, item in DEFAULT_PROMPTS.items()
            }
            content_project = (
                await db.execute(
                    select(Project).where(Project.id == project.content_project_id)
                )
            ).scalar_one()
            fallback = await db.execute(
                select(Prompt).where(
                    Prompt.owner_id == content_project.owner_id,
                    Prompt.project_id.is_(None),
                )
            )
            for prompt in fallback.scalars().all():
                prompts[prompt.key] = prompt.value
            overrides = await db.execute(
                select(Prompt).where(
                    Prompt.owner_id == content_project.owner_id,
                    Prompt.project_id == content_project.id,
                )
            )
            for prompt in overrides.scalars().all():
                prompts[prompt.key] = prompt.value

            return _GenerationContext(
                facebook_project_id=project.id,
                content_project_id=project.content_project_id,
                site_id=site.id,
                site_domain=site.domain,
                pinterest_url=site.pinterest_url or "",
                generate_recipe_json=bool(getattr(site, "generate_recipe_json", True)),
                credentials=credentials,
                prompts=prompts,
                video_format=project.video_format,
                video_intro_seconds=project.video_intro_seconds,
                video_fps=project.video_fps,
                video_bitrate_kbps=project.video_bitrate_kbps,
            )

    async def _load_content_payloads(
        self, content_ids: list[uuid.UUID]
    ) -> list[dict[str, str]]:
        async with SessionLocal() as db:
            rows = await db.execute(
                select(FacebookContent)
                .where(
                    FacebookContent.id.in_(content_ids),
                    FacebookContent.status == FacebookContentStatus.processing,
                    FacebookContent.generation_cancelled.is_(False),
                )
                .order_by(FacebookContent.created_at.asc())
            )
            return [
                {
                    "id": str(content.id),
                    "title": content.title,
                    "source_url": content.source_video_url,
                }
                for content in rows.scalars().all()
            ]

    async def _store_processed_video(
        self,
        content_id: uuid.UUID,
        *,
        screenshot_url: str,
        processed_video_url: str,
        site_id: uuid.UUID,
        created_by: uuid.UUID,
        title: str,
    ) -> uuid.UUID:
        async with SessionLocal() as db:
            content = (
                await db.execute(
                    select(FacebookContent).where(
                        FacebookContent.id == content_id,
                        FacebookContent.status == FacebookContentStatus.processing,
                        FacebookContent.generation_cancelled.is_(False),
                    ).with_for_update()
                )
            ).scalar_one_or_none()
            if content is None:
                raise FacebookGenerationCancelled()
            recipe = Recipe(
                site_id=site_id,
                created_by=created_by,
                image_url=screenshot_url,
                recipe_text=title,
                status=RecipeStatus.generating,
            )
            db.add(recipe)
            await db.flush()
            content.recipe_id = recipe.id
            content.screenshot_url = screenshot_url
            content.processed_video_url = processed_video_url
            await db.commit()
            return recipe.id

    async def _complete(
        self,
        content_id: uuid.UUID,
        recipe_id: uuid.UUID,
        generated: dict,
        original_title: str,
    ) -> None:
        async with SessionLocal() as db:
            content = (
                await db.execute(
                    select(FacebookContent).where(
                        FacebookContent.id == content_id,
                        FacebookContent.status == FacebookContentStatus.processing,
                        FacebookContent.generation_cancelled.is_(False),
                    ).with_for_update()
                )
            ).scalar_one_or_none()
            if content is None:
                raise FacebookGenerationCancelled()
            recipe = (
                await db.execute(select(Recipe).where(Recipe.id == recipe_id))
            ).scalar_one()
            recipe_fields = {
                "generated_full_recipe",
                "generated_images",
                "generated_article",
                "generated_json",
                "meta_description",
                "category",
                "seo_title",
                "pin_board",
                "pin_title",
                "pin_description",
                "pin_tags",
                "focus_keyword",
                "wp_tags",
            }
            for key in recipe_fields:
                if key in generated:
                    setattr(recipe, key, generated[key])
            recipe.status = RecipeStatus.generated
            recipe.error_message = None

            content.generated_images = generated.get("generated_images")
            content.generated_article = generated.get("generated_article")
            content.title = generated.get("seo_title") or original_title
            content.status = FacebookContentStatus.ready
            content.error_message = None
            await db.execute(
                update(FacebookDelivery)
                .where(
                    FacebookDelivery.content_id == content_id,
                    FacebookDelivery.status == FacebookDeliveryStatus.processing,
                    FacebookDelivery.scheduled_at.is_not(None),
                )
                .values(status=FacebookDeliveryStatus.scheduled)
            )
            await db.execute(
                update(FacebookDelivery)
                .where(
                    FacebookDelivery.content_id == content_id,
                    FacebookDelivery.status == FacebookDeliveryStatus.processing,
                    FacebookDelivery.scheduled_at.is_(None),
                )
                .values(status=FacebookDeliveryStatus.draft)
            )
            await db.commit()

    async def _fail(
        self, content_id: uuid.UUID, message: str, recipe_id: uuid.UUID | None = None
    ) -> None:
        safe_message = str(message)[:2000]
        async with SessionLocal() as db:
            await db.execute(
                update(FacebookContent)
                .where(
                    FacebookContent.id == content_id,
                    FacebookContent.generation_cancelled.is_(False),
                )
                .values(status=FacebookContentStatus.failed, error_message=safe_message)
            )
            await db.execute(
                update(FacebookDelivery)
                .where(
                    FacebookDelivery.content_id == content_id,
                    FacebookDelivery.status == FacebookDeliveryStatus.processing,
                )
                .values(status=FacebookDeliveryStatus.failed, error_message=safe_message)
            )
            if recipe_id is not None:
                await db.execute(
                    update(Recipe)
                    .where(Recipe.id == recipe_id)
                    .values(status=RecipeStatus.failed, error_message=safe_message)
                )
            await db.commit()

    async def start_batch(
        self,
        *,
        facebook_project_id: uuid.UUID,
        content_ids: list[uuid.UUID],
        created_by: uuid.UUID,
    ) -> None:
        with self._guard:
            project_running = self._project_running.setdefault(
                facebook_project_id, set()
            )
            _resume_event, cancel_event = self._control_events_locked(
                facebook_project_id
            )
            if cancel_event.is_set() and project_running:
                raise RuntimeError(
                    "The previous Facebook generation cancellation is still finishing."
                )
            if not project_running:
                cancel_event.clear()
            pending = [content_id for content_id in content_ids if content_id not in self._running]
            self._running.update(pending)
            project_running.update(pending)
        if not pending:
            return

        try:
            context = await self._load_context(facebook_project_id, created_by)
            payloads = await self._load_content_payloads(pending)
        except Exception as exc:
            for content_id in pending:
                await write_facebook_log(
                    facebook_project_id,
                    f"Could not initialize generation: {exc}",
                    content_id=content_id,
                    level="error",
                    stage="setup",
                )
                await self._fail(content_id, str(exc))
            with self._guard:
                for content_id in pending:
                    self._running.discard(content_id)
                project_running = self._project_running.get(facebook_project_id)
                if project_running is not None:
                    project_running.difference_update(pending)
                    if not project_running:
                        self._project_running.pop(facebook_project_id, None)
            return

        loaded_ids = {uuid.UUID(payload["id"]) for payload in payloads}
        for content_id in pending:
            if content_id not in loaded_ids:
                self._release(facebook_project_id, content_id)
        if not payloads:
            return

        loop = asyncio.get_running_loop()

        def emit(
            content_id: uuid.UUID,
            message: str,
            *,
            stage: str = "generation",
            level: str = "info",
        ) -> None:
            log_method = logger.error if level == "error" else logger.info
            log_method("[facebook:%s:%s] %s", content_id, stage, str(message)[:1000])
            try:
                asyncio.run_coroutine_threadsafe(
                    write_facebook_log(
                        facebook_project_id,
                        message,
                        content_id=content_id,
                        level=level,
                        stage=stage,
                    ),
                    loop,
                ).result(timeout=15)
            except Exception:
                logger.exception("Could not forward Facebook generation progress")

        def run() -> None:
            for payload in payloads:
                content_id = uuid.UUID(payload["id"])
                recipe_id: uuid.UUID | None = None

                def progress(message: str, *, stage: str) -> None:
                    self._checkpoint(facebook_project_id)
                    emit(content_id, str(message), stage=stage)
                    self._checkpoint(facebook_project_id)

                try:
                    self._checkpoint(facebook_project_id)
                    emit(content_id, "Generation worker started.", stage="setup")
                    processed = self._video.process(
                        content_id=content_id,
                        source_url=payload["source_url"],
                        recipe_title=payload["title"],
                        openai_api_key=context.credentials["openai"],
                        script_prompt=context.prompts["facebook_video_script"],
                        recipe_card_prompt=context.prompts["facebook_recipe_card"],
                        video_format=context.video_format,
                        intro_seconds=context.video_intro_seconds,
                        fps=context.video_fps,
                        bitrate_kbps=context.video_bitrate_kbps,
                        log=lambda message: progress(message, stage="video"),
                    )
                    self._checkpoint(facebook_project_id)
                    recipe_id = asyncio.run_coroutine_threadsafe(
                        self._store_processed_video(
                            content_id,
                            screenshot_url=processed.screenshot_url,
                            processed_video_url=processed.processed_video_url,
                            site_id=context.site_id,
                            created_by=created_by,
                            title=payload["title"],
                        ),
                        loop,
                    ).result()
                    self._checkpoint(facebook_project_id)
                    emit(content_id, "Starting article and image generation.", stage="article")
                    generated = generate_for_recipe(
                        recipe_id=str(recipe_id),
                        recipe_text=payload["title"],
                        image_url=processed.screenshot_url,
                        site_domain=context.site_domain,
                        credentials=context.credentials,
                        prompts=context.prompts,
                        pinterest_url=context.pinterest_url,
                        generate_recipe_json=context.generate_recipe_json,
                        log=lambda message: progress(str(message), stage="article"),
                        should_stop=lambda: self._cancel_requested(facebook_project_id),
                    )
                    self._checkpoint(facebook_project_id)
                    if generated.get("error_message") or not generated.get("generated_article"):
                        raise ValueError(
                            generated.get("error_message")
                            or "Article generation did not return an article."
                        )
                    asyncio.run_coroutine_threadsafe(
                        self._complete(content_id, recipe_id, generated, payload["title"]),
                        loop,
                    ).result()
                    emit(
                        content_id,
                        "Generation completed. The shared content is ready for its Page deliveries.",
                        stage="complete",
                        level="success",
                    )
                except FacebookGenerationCancelled:
                    emit(
                        content_id,
                        "Generation cancelled. The source was returned to Spy Sheet.",
                        stage="cancelled",
                        level="warning",
                    )
                except Exception as exc:
                    logger.exception("Facebook generation failed for content %s", content_id)
                    emit(
                        content_id,
                        f"Generation failed: {exc}",
                        stage="failed",
                        level="error",
                    )
                    asyncio.run_coroutine_threadsafe(
                        self._fail(content_id, str(exc), recipe_id), loop
                    ).result()
                finally:
                    self._release(facebook_project_id, content_id)

        threading.Thread(
            target=run,
            name=f"facebook-generation-{str(facebook_project_id)[:8]}",
            daemon=True,
        ).start()

    async def resume_pending(self) -> None:
        async with SessionLocal() as db:
            rows = await db.execute(
                select(FacebookContent)
                .join(FacebookProject, FacebookProject.id == FacebookContent.project_id)
                .where(
                    FacebookContent.status == FacebookContentStatus.processing,
                    FacebookContent.generation_cancelled.is_(False),
                    FacebookProject.generation_paused.is_(False),
                )
            )
            by_project: dict[tuple[uuid.UUID, uuid.UUID], list[uuid.UUID]] = {}
            for content in rows.scalars().all():
                if content.created_by is None:
                    continue
                by_project.setdefault(
                    (content.project_id, content.created_by), []
                ).append(content.id)
        for (project_id, created_by), content_ids in by_project.items():
            await self.start_batch(
                facebook_project_id=project_id,
                content_ids=content_ids,
                created_by=created_by,
            )


facebook_generation_manager = FacebookGenerationManager()
