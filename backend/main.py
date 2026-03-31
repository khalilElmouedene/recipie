from contextlib import asynccontextmanager
import asyncio
import os
from pathlib import Path
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from sqlalchemy import select
from app.config import settings
from app.database import init_db, SessionLocal
from app.services.prompts import DEFAULT_PROMPTS

UPLOADS_DIR = Path("/app/uploads")

# Prompts that must always match the latest code default.
# If the DB value is outdated (missing the uid/group structure), it gets reset.
_FORCE_RESET_PROMPTS = {"recipe_json_user", "recipe_json_system", "article"}


async def _migrate_prompts() -> None:
    """Reset outdated recipe JSON prompts so new generation uses the fixed format."""
    from app.db_models import Prompt
    from sqlalchemy import delete as sql_delete
    async with SessionLocal() as db:
        for key in _FORCE_RESET_PROMPTS:
            if key not in DEFAULT_PROMPTS:
                continue
            new_value = DEFAULT_PROMPTS[key]["value"]
            result = await db.execute(
                select(Prompt).where(Prompt.key == key, Prompt.project_id.is_(None))
            )
            rows = result.scalars().all()
            if not rows:
                continue
            if len(rows) > 1:
                extra_ids = [r.id for r in rows[1:]]
                await db.execute(sql_delete(Prompt).where(Prompt.id.in_(extra_ids)))
            row = rows[0]
            if '"uid"' not in row.value:
                row.value = new_value
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    await init_db()
    await _migrate_prompts()
    from app.services.publish_scheduler import run_publish_scheduler
    from app.services.image_retention_scheduler import run_image_retention_scheduler
    from app.services.stale_job_reconciler import run_stale_job_reconciler
    from app.services.threads_scheduler import run_threads_scheduler
    stop_event = asyncio.Event()
    scheduler_task = asyncio.create_task(run_publish_scheduler(stop_event))
    retention_task = asyncio.create_task(run_image_retention_scheduler(stop_event))
    stale_task = asyncio.create_task(run_stale_job_reconciler(stop_event))
    threads_scheduler_task = asyncio.create_task(run_threads_scheduler(stop_event))
    yield
    stop_event.set()
    await scheduler_task
    await retention_task
    await stale_task
    await threads_scheduler_task


_debug = os.getenv("APP_ENV", "production").lower() != "production"
app = FastAPI(
    title="Recipe Automation Platform",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs" if _debug else None,
    redoc_url="/redoc" if _debug else None,
    openapi_url="/openapi.json" if _debug else None,
)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.routes.auth import router as auth_router
from app.routes.users import router as users_router
from app.routes.projects import router as projects_router
from app.routes.credentials import router as credentials_router
from app.routes.sites import router as sites_router
from app.routes.recipes import router as recipes_router
from app.routes.jobs import router as jobs_router
from app.routes.dashboard import router as dashboard_router
from app.routes.pinterest import router as pinterest_router
from app.routes.settings import router as settings_router
from app.routes.pin_designer_templates import router as pin_designer_templates_router
from app.routes.threads import router as threads_router
from app.ws.logs import router as ws_router

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(projects_router)
app.include_router(credentials_router)
app.include_router(sites_router)
app.include_router(recipes_router)
app.include_router(jobs_router)
app.include_router(dashboard_router)
app.include_router(pinterest_router)
app.include_router(settings_router)
app.include_router(pin_designer_templates_router)
app.include_router(threads_router)
app.include_router(ws_router)
