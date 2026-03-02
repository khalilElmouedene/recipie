from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Recipe Automation Platform", version="2.0.0", lifespan=lifespan)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
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
from app.ws.logs import router as ws_router

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(projects_router)
app.include_router(credentials_router)
app.include_router(sites_router)
app.include_router(recipes_router)
app.include_router(jobs_router)
app.include_router(dashboard_router)
app.include_router(pinterest_router)
app.include_router(ws_router)
