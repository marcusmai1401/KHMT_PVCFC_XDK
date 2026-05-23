from pathlib import Path

from fastapi import Request
from jose import JWTError, jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


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
