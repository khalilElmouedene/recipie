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


class FacebookGenerationManager:
    """Run the video and existing article pipeline once per shared content item."""

    def __init__(self) -> None:
        self._running: set[uuid.UUID] = set()
        self._guard = threading.Lock()
        self._video = FacebookVideoProcessor()

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
            )

    async def _load_content_payloads(
        self, content_ids: list[uuid.UUID]
    ) -> list[dict[str, str]]:
        async with SessionLocal() as db:
            rows = await db.execute(
                select(FacebookContent)
                .where(FacebookContent.id.in_(content_ids))
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
                    select(FacebookContent).where(FacebookContent.id == content_id)
                )
            ).scalar_one()
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

            content = (
                await db.execute(
                    select(FacebookContent).where(FacebookContent.id == content_id)
                )
            ).scalar_one()
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
                .where(FacebookContent.id == content_id)
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
            pending = [content_id for content_id in content_ids if content_id not in self._running]
            self._running.update(pending)
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
                self._running.difference_update(pending)
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
                try:
                    emit(content_id, "Generation worker started.", stage="setup")
                    processed = self._video.process(
                        content_id=content_id,
                        source_url=payload["source_url"],
                        recipe_title=payload["title"],
                        openai_api_key=context.credentials["openai"],
                        script_prompt=context.prompts["facebook_video_script"],
                        recipe_card_prompt=context.prompts["facebook_recipe_card"],
                        log=lambda message: emit(content_id, message, stage="video"),
                    )
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
                        log=lambda message: emit(content_id, str(message), stage="article"),
                    )
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
                    with self._guard:
                        self._running.discard(content_id)

        threading.Thread(
            target=run,
            name=f"facebook-generation-{str(facebook_project_id)[:8]}",
            daemon=True,
        ).start()

    async def resume_pending(self) -> None:
        async with SessionLocal() as db:
            rows = await db.execute(
                select(FacebookContent).where(
                    FacebookContent.status == FacebookContentStatus.processing
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
