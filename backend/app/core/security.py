from datetime import datetime, timedelta, timezone
from enum import StrEnum
from typing import Any

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.domain import User


class Role(StrEnum):
    TEAM_ACCOUNT = "Team_Account"
    FI_COORDINATOR = "FI_Coordinator"
    WORKSHOP_LEADER = "Workshop_Leader"
    STAFF = "Staff"
    ADMIN = "Admin"


bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (TypeError, ValueError):
        return False


def create_access_token(
    subject: str,
    role: Role,
    *,
    team: str | None = None,
    sandbox: bool = False,
) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    payload: dict[str, Any] = {"sub": subject, "role": role.value, "exp": expires}
    if team:
        payload["team"] = team
    if sandbox:
        payload["sandbox"] = True
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc


def current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Chưa đăng nhập")
    payload = decode_token(credentials.credentials)
    user_id = str(payload["sub"])
    if payload.get("sandbox"):
        from app.services.sandbox import ensure_sandbox_data

        ensure_sandbox_data()
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Phiên đăng nhập không hợp lệ")
    team = getattr(user, "team", None) or payload.get("team")
    return {
        "user_id": user.id,
        "role": user.role,
        "team": team,
        "display_name": user.display_name,
        "full_name": getattr(user, "full_name", None),
        "must_change_password": bool(getattr(user, "must_change_password", False)),
        "sandbox": bool(payload.get("sandbox")),
    }


def require_password_change_complete(
    principal: dict[str, Any] = Depends(current_principal),
) -> dict[str, Any]:
    """Block business APIs until a temporary password has been replaced.

    Authentication endpoints intentionally use ``current_principal`` directly,
    allowing a pending account to inspect its session and change its password.
    Every role-protected application endpoint passes through this dependency.
    """
    if principal.get("must_change_password") and not principal.get("sandbox"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn phải đổi mật khẩu trước khi sử dụng hệ thống",
        )
    return principal


def require_role(*roles: Role):
    allowed = {role.value for role in roles}

    def dependency(
        principal: dict[str, Any] = Depends(require_password_change_complete),
    ) -> dict[str, Any]:
        if principal["role"] not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản không có quyền thực hiện thao tác này")
        return principal

    return dependency
