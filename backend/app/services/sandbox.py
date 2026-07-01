from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.core.security import Role, hash_password, verify_password
from app.db.session import Base, create_session, sandbox_engine
from app.models import et_domain  # noqa: F401 - register ET tables for sandbox metadata
from app.models.domain import SystemConfigModel, User
from app.services.bootstrap import seed_baseline
from app.services.cache import cache_delete_prefix
from app.services.repositories import audit, model_to_dict


SANDBOX_LOGIN_ID = "test"
SANDBOX_PASSWORD = "PVCFC@123"
SANDBOX_INITIALIZED_KEY = "sandbox_initialized_from_production"
SANDBOX_DIRECT_LOGIN_PREFIX = "sandbox_direct_login_enabled:"


@dataclass(frozen=True)
class SandboxIdentity:
    id: str
    display_name: str
    role: Role


SANDBOX_IDENTITIES = {
    "test": SandboxIdentity("test", "Khách kiểm thử - Quản trị", Role.ADMIN),
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
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    required_user_columns = {"full_name", "team", "must_change_password"}
    if not required_user_columns.issubset(user_columns):
        reset_sandbox_data()
        return
    if "sk_ctkt" in inspector.get_table_names():
        sk_columns = {column["name"] for column in inspector.get_columns("sk_ctkt")}
        if "completed_at" not in sk_columns:
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


def _direct_login_key(user_id: str) -> str:
    return f"{SANDBOX_DIRECT_LOGIN_PREFIX}{user_id}"


def _find_sandbox_user(db: Session, user_id: str) -> User | None:
    user = db.get(User, user_id)
    if user is not None:
        return user
    lowered = user_id.lower()
    if lowered == user_id:
        return None
    return db.get(User, lowered)


def _verify_password_allowing_copy_whitespace(password: str, password_hash: str) -> bool:
    if verify_password(password, password_hash):
        return True
    stripped = password.strip()
    return stripped != password and verify_password(stripped, password_hash)


def _direct_login_enabled(db: Session, user_id: str) -> bool:
    marker = db.get(SystemConfigModel, _direct_login_key(user_id))
    if marker is None:
        return False
    value = marker.value if isinstance(marker.value, dict) else {}
    return bool(value.get("enabled"))


def authenticate_sandbox_direct_login(user_id: str, password: str) -> dict[str, str | None] | None:
    """Authenticate a sandbox user from the normal login screen.

    Production direct sandbox login is disabled until a production Admin resets
    that sandbox account. This avoids keeping the static default password usable
    on production while still giving Admins a recoverable test account.
    """
    ensure_sandbox_data()
    with create_session(sandbox=True) as db:
        user = _find_sandbox_user(db, user_id.strip())
        if user is None or not user.is_active:
            return None
        if not _direct_login_enabled(db, user.id):
            return None
        if not _verify_password_allowing_copy_whitespace(password, user.password_hash):
            return None
        return {
            "id": user.id,
            "display_name": user.display_name,
            "role": user.role,
            "team": getattr(user, "team", None),
        }


def list_sandbox_accounts() -> list[dict[str, str | bool | None]]:
    ensure_sandbox_data()
    with create_session(sandbox=True) as db:
        users = list(db.execute(select(User).order_by(User.role, User.id)).scalars())
        rows = []
        for user in users:
            data = model_to_dict(user) | {
                "password_hash": None,
                "account_scope": "sandbox",
                "direct_login_enabled": _direct_login_enabled(db, user.id),
            }
            rows.append(data)
        return rows


def reset_sandbox_account_password(user_id: str, new_password: str, actor: str) -> dict:
    ensure_sandbox_data()
    with create_session(sandbox=True) as db:
        user = _find_sandbox_user(db, user_id.strip())
        if user is None:
            raise KeyError("Không tìm thấy tài khoản kiểm thử")
        user.password_hash = hash_password(new_password)
        user.must_change_password = False
        marker = db.get(SystemConfigModel, _direct_login_key(user.id))
        value = {"enabled": True, "reset_by": actor}
        if marker is None:
            db.add(
                SystemConfigModel(
                    key=_direct_login_key(user.id),
                    value=value,
                    updated_by=actor,
                )
            )
        else:
            marker.value = value
            marker.updated_by = actor
        audit(
            db,
            actor,
            "SandboxAccount",
            user.id,
            "admin_reset_sandbox_password",
            {"direct_login_enabled": True},
        )
        db.commit()
        db.refresh(user)
        return model_to_dict(user) | {
            "password_hash": None,
            "account_scope": "sandbox",
            "direct_login_enabled": True,
        }


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
