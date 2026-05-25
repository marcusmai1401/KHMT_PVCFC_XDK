from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.core.security import Role, hash_password
from app.db.session import Base, create_session, sandbox_engine
from app.models import et_domain  # noqa: F401 - register ET tables for sandbox metadata
from app.models.domain import SystemConfigModel, User
from app.services.bootstrap import seed_baseline
from app.services.cache import cache_delete_prefix


SANDBOX_LOGIN_ID = "test"
SANDBOX_PASSWORD = "PVCFC-KHMT-Test-2026!r7Qp"
SANDBOX_INITIALIZED_KEY = "sandbox_initialized_from_production"


@dataclass(frozen=True)
class SandboxIdentity:
    id: str
    display_name: str
    role: Role


SANDBOX_IDENTITIES = {
    "admin": SandboxIdentity("admin", "Kiểm thử - Quản trị", Role.ADMIN),
    "leader": SandboxIdentity("leader", "Kiểm thử - Lãnh đạo Xưởng", Role.WORKSHOP_LEADER),
    "fi": SandboxIdentity("fi", "Kiểm thử - Đầu mối SK", Role.FI_COORDINATOR),
    "TBHTĐK": SandboxIdentity("TBHTĐK", "Kiểm thử - TBHTĐK", Role.TEAM_ACCOUNT),
    "TBCH": SandboxIdentity("TBCH", "Kiểm thử - TBCH", Role.TEAM_ACCOUNT),
    "TBĐL": SandboxIdentity("TBĐL", "Kiểm thử - TBĐL", Role.TEAM_ACCOUNT),
    "TCĐK": SandboxIdentity("TCĐK", "Kiểm thử - TCĐK", Role.TEAM_ACCOUNT),
}


def _seed_sandbox_users(db: Session) -> None:
    password_hash = hash_password(SANDBOX_PASSWORD)
    for identity in SANDBOX_IDENTITIES.values():
        user = db.get(User, identity.id)
        if user is None:
            db.add(
                User(
                    id=identity.id,
                    display_name=identity.display_name,
                    password_hash=password_hash,
                    role=identity.role.value,
                    is_active=True,
                )
            )
            continue
        user.display_name = identity.display_name
        user.password_hash = password_hash
        user.role = identity.role.value
        user.is_active = True


def _clone_production_data(sandbox_db: Session) -> dict[str, int]:
    counts: dict[str, int] = {}
    with create_session() as production_db:
        for table in Base.metadata.sorted_tables:
            rows = [dict(row) for row in production_db.execute(select(table)).mappings().all()]
            if not rows:
                counts[table.name] = 0
                continue
            sandbox_db.execute(table.insert(), rows)
            counts[table.name] = len(rows)
    return counts


def _mark_sandbox_initialized(db: Session) -> None:
    marker = db.get(SystemConfigModel, SANDBOX_INITIALIZED_KEY)
    value = {"source": "production_clone", "at": datetime.now(timezone.utc).isoformat()}
    if marker is None:
        db.add(SystemConfigModel(key=SANDBOX_INITIALIZED_KEY, value=value, updated_by="sandbox"))
        return
    marker.value = value
    marker.updated_by = "sandbox"


def reset_sandbox_data() -> dict[str, int | str]:
    Base.metadata.drop_all(bind=sandbox_engine)
    Base.metadata.create_all(bind=sandbox_engine)
    with create_session(sandbox=True) as db:
        counts = _clone_production_data(db)
        seed_baseline(db)
        _seed_sandbox_users(db)
        _mark_sandbox_initialized(db)
        db.commit()
    cache_delete_prefix("admin:")
    cache_delete_prefix("okr:dashboard")
    cache_delete_prefix("fi:public_sk")
    return {
        "cloned_rows": sum(counts.values()),
        "database": Path(sandbox_engine.url.database or "").name,
        "users": len(SANDBOX_IDENTITIES),
    }


def ensure_sandbox_data() -> None:
    inspector = inspect(sandbox_engine)
    if "users" not in inspector.get_table_names():
        reset_sandbox_data()
        return
    with create_session(sandbox=True) as db:
        needs_reset = db.get(SystemConfigModel, SANDBOX_INITIALIZED_KEY) is None
    if needs_reset:
        reset_sandbox_data()
        return
    with create_session(sandbox=True) as db:
        missing_identity = any(db.get(User, identity.id) is None for identity in SANDBOX_IDENTITIES.values())
        if missing_identity:
            _seed_sandbox_users(db)
            db.commit()


def sandbox_identity(user_id: str) -> SandboxIdentity | None:
    """Trả về identity để switch role trong sandbox.

    Ưu tiên các identity hardcoded (cho legacy/test). Nếu không có, lookup
    trực tiếp trong sandbox DB — cho phép admin giả lập bất kỳ user thật nào.
    """
    static = SANDBOX_IDENTITIES.get(user_id)
    if static is not None:
        return static
    ensure_sandbox_data()
    with create_session(sandbox=True) as db:
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            return None
        try:
            role = Role(user.role)
        except ValueError:
            return None
        return SandboxIdentity(id=user.id, display_name=user.display_name, role=role)


def list_sandbox_identities() -> list[dict[str, str | None]]:
    """Trả về danh sách tất cả user trong sandbox DB để admin chọn giả lập."""
    ensure_sandbox_data()
    with create_session(sandbox=True) as db:
        users = list(db.execute(select(User).order_by(User.role, User.id)).scalars())
    return [
        {
            "id": user.id,
            "display_name": user.display_name,
            "role": user.role,
            "team": getattr(user, "team", None),
        }
        for user in users
    ]
