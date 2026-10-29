import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, auth, et, feedback, fi, llm, notifications, okr, web_input
from app.core.config import settings
from app.core.login_limiter import login_limiter
from app.db.session import create_session
from app.services.bootstrap import create_schema, seed_baseline
from app.services.cache import cache_delete_prefix
from app.services.fi.auto_completion import apply_completion_schedule

logger = logging.getLogger(__name__)


def _run_completion_schedule() -> None:
    with create_session() as db:
        changed = apply_completion_schedule(db)
    if changed:
        cache_delete_prefix("fi:public_sk")
        cache_delete_prefix("okr:dashboard")


async def _completion_schedule_loop(interval: int) -> None:
    # Tới ngày dự kiến thì SK tự chuyển sang "Đã hoàn thành"; chạy định kỳ để
    # không phụ thuộc việc có người mở trang.
    while True:
        try:
            await asyncio.to_thread(_run_completion_schedule)
        except Exception:
            logger.exception("FI completion schedule failed")
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    create_schema()
    with create_session() as db:
        seed_baseline(db)
    interval = settings.fi_completion_schedule_seconds
    task = asyncio.create_task(_completion_schedule_loop(interval)) if interval > 0 else None
    yield
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth.router, prefix=settings.api_prefix)
    app.include_router(admin.router, prefix=settings.api_prefix)
    app.include_router(okr.router, prefix=settings.api_prefix)
    app.include_router(web_input.router, prefix=settings.api_prefix)
    app.include_router(et.router, prefix=settings.api_prefix)
    app.include_router(fi.router, prefix=settings.api_prefix)
    app.include_router(notifications.router, prefix=settings.api_prefix)
    app.include_router(llm.router, prefix=settings.api_prefix)
    app.include_router(feedback.router, prefix=settings.api_prefix)

    @app.get("/health")
    def health():
        return {"status": "ok", "app": settings.app_name, "rate_limiter": login_limiter.health()}

    return app


app = create_app()
