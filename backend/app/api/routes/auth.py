from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import Role, create_access_token, current_principal, verify_password
from app.db.session import get_db
from app.models.domain import User
from app.schemas.common import LoginRequest, TokenResponse
from app.services.sandbox import (
    SANDBOX_LOGIN_ID,
    SANDBOX_PASSWORD,
    ensure_sandbox_data,
    reset_sandbox_data,
    sandbox_identity,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class SandboxRoleRequest(BaseModel):
    user_id: str


def _require_sandbox(principal: dict = Depends(current_principal)) -> dict:
    if not principal.get("sandbox"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chỉ dùng được trong môi trường kiểm thử")
    return principal


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    if payload.user_id == SANDBOX_LOGIN_ID and payload.password == SANDBOX_PASSWORD:
        ensure_sandbox_data()
        identity = sandbox_identity("admin")
        if identity is None:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Sandbox is not configured")
        return TokenResponse(access_token=create_access_token(identity.id, identity.role, sandbox=True))
    user = db.get(User, payload.user_id)
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sai tài khoản hoặc mật khẩu")
    return TokenResponse(access_token=create_access_token(user.id, Role(user.role)))


@router.post("/sandbox/switch-role", response_model=TokenResponse)
def switch_sandbox_role(payload: SandboxRoleRequest, _: dict = Depends(_require_sandbox)) -> TokenResponse:
    identity = sandbox_identity(payload.user_id)
    if identity is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Vai trò kiểm thử không hợp lệ")
    ensure_sandbox_data()
    return TokenResponse(access_token=create_access_token(identity.id, identity.role, sandbox=True))


@router.post("/sandbox/reset")
def reset_sandbox(_: dict = Depends(_require_sandbox)):
    return reset_sandbox_data()
