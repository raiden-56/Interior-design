import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import Base, engine
from .models import Project  # noqa: F401 (register ORM model)
from .routers import ai, health, projects
from .security import require_api_token

# backend/.env (see .env.example); real environment variables take precedence.
load_dotenv()

Base.metadata.create_all(bind=engine)
# Add the column introduced after the first release to databases created
# before it. SQLite has no "ADD COLUMN IF NOT EXISTS", hence the probe.
with engine.begin() as conn:
    cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(projects)")} if engine.dialect.name == "sqlite" else set()
    if engine.dialect.name == "sqlite" and cols and "client_updated_at" not in cols:
        conn.exec_driver_sql("ALTER TABLE projects ADD COLUMN client_updated_at BIGINT DEFAULT 0")

app = FastAPI(title="Interior Studio API", version="0.2.0")

# Comma-separated list, e.g. CORS_ORIGINS=https://studio.example.com,https://www.example.com
_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health stays open so the app can probe reachability before sign-in; the
# routes that carry project data require the shared token when one is set.
app.include_router(health.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1", dependencies=[Depends(require_api_token)])
app.include_router(ai.router, prefix="/api/v1", dependencies=[Depends(require_api_token)])
