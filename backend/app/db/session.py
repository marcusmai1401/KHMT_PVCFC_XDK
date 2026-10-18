from pathlib import Path

from fastapi import Request
from jose import JWTError, jwt
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
import re
import unicodedata
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


@event.listens_for(Engine, "connect")
def sqlite_text_functions(connection, _record):
    if connection.__class__.__module__.startswith("sqlite3"):
        connection.create_function("normalize", 2, lambda value, form: unicodedata.normalize(form, str(value or "")), deterministic=True)
        connection.create_function("translate", 3, lambda value, source, target: str(value or "").translate({ord(char): target[index] if index < len(target) else None for index, char in enumerate(source)}), deterministic=True)
        connection.create_function("regexp_replace", 4, lambda value, pattern, replacement, flags: re.sub(pattern, replacement, str(value or ""), count=0 if "g" in flags else 1), deterministic=True)


class Base(DeclarativeBase):
    pass


connect_args = {"check_same_thread": False} if settings.effective_database_url.startswith("sqlite") else {}
engine = create_engine(settings.effective_database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

sandbox_dir = settings.storage_dir / "sandbox"
sandbox_dir.mkdir(parents=True, exist_ok=True)
sandbox_database_url = f"sqlite:///{sandbox_dir / 'okr_sandbox.db'}"
sandbox_engine = create_engine(
    sandbox_database_url,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False},
)
SandboxSessionLocal = sessionmaker(bind=sandbox_engine, autoflush=False, autocommit=False)


def _request_is_sandbox(request: Request) -> bool:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return False
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return False
    return bool(payload.get("sandbox"))


def get_db(request: Request):
    session_factory = SandboxSessionLocal if _request_is_sandbox(request) else SessionLocal
    db = session_factory()
    try:
        yield db
    finally:
        db.close()


def create_session(*, sandbox: bool = False) -> Session:
    return SandboxSessionLocal() if sandbox else SessionLocal()
