from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import (
    Role,
    create_access_token,
    current_principal,
    hash_password,
    require_role,
    verify_password,
)
from app.db.session import get_db
from app.models.domain import User
from app.schemas.common import ChangePasswordRequest, LoginRequest, TokenResponse
from app.services.repositories import audit
from app.services.sandbox import (
    SANDBOX_LOGIN_ID,
    SANDBOX_PASSWORD,
    ensure_sandbox_data,
    list_sandbox_identities,
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


def _token_response_from_user(user: User, *, sandbox: bool = False) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(
            user.id,
            Role(user.role),
            team=getattr(user, "team", None),
            sandbox=sandbox,
        ),
        must_change_password=bool(getattr(user, "must_change_password", False)) and not sandbox,
        display_name=user.display_name,
        role=user.role,
        team=getattr(user, "team", None),
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    if payload.user_id.strip() == SANDBOX_LOGIN_ID and payload.password == SANDBOX_PASSWORD:
        ensure_sandbox_data()
        identity = sandbox_identity(SANDBOX_LOGIN_ID)
        if identity is None:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Sandbox is not configured")
        return TokenResponse(
            access_token=create_access_token(identity.id, identity.role, sandbox=True),
            must_change_password=False,
            display_name=identity.display_name,
            role=identity.role.value,
            team=None,
        )

    user = db.get(User, payload.user_id)
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sai tài khoản hoặc mật khẩu")
    audit(db, user.id, "Account", user.id, "login", {"sandbox": False})
    db.commit()
    return _token_response_from_user(user)


@router.get("/me")
def whoami(principal: dict = Depends(current_principal)) -> dict:
    return {
        "user_id": principal["user_id"],
        "role": principal["role"],
        "team": principal.get("team"),
        "display_name": principal.get("display_name"),
        "must_change_password": bool(principal.get("must_change_password")),
        "sandbox": bool(principal.get("sandbox")),
    }


@router.post("/change-password", response_model=TokenResponse)
def change_password(
    payload: ChangePasswordRequest,
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
) -> TokenResponse:
    if principal.get("sandbox"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tài khoản kiểm thử không đổi được mật khẩu")
    user = db.get(User, principal["user_id"])
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy tài khoản")
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu hiện tại không đúng")
    if payload.old_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu mới phải khác mật khẩu cũ")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu mới phải có ít nhất 8 ký tự")
    has_letter = any(ch.isalpha() for ch in payload.new_password)
    has_digit = any(ch.isdigit() for ch in payload.new_password)
    if not (has_letter and has_digit):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu mới cần có cả chữ và số")
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    audit(db, user.id, "Account", user.id, "change_password", {})
    db.commit()
    db.refresh(user)
    return _token_response_from_user(user)


@router.post("/sandbox/enter", response_model=TokenResponse)
def enter_sandbox(
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Admin (prod) yêu cầu mở phiên sandbox để kiểm thử/giả lập role.

    Trả về token sandbox với role Admin; sau đó dùng /sandbox/switch-role để
    giả lập bất kỳ user nào trong sandbox DB.
    """
    if principal.get("sandbox"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Đang ở môi trường kiểm thử")
    ensure_sandbox_data()
    identity = sandbox_identity("admin")
    if identity is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Sandbox is not configured")
    return TokenResponse(
        access_token=create_access_token(identity.id, identity.role, sandbox=True),
        must_change_password=False,
        display_name=f"{identity.display_name} (kiểm thử)",
        role=identity.role.value,
        team=None,
    )


@router.get("/sandbox/identities")
def sandbox_identities(_: dict = Depends(_require_sandbox)) -> list[dict]:
    return list_sandbox_identities()


@router.post("/sandbox/switch-role", response_model=TokenResponse)
def switch_sandbox_role(payload: SandboxRoleRequest, _: dict = Depends(_require_sandbox)) -> TokenResponse:
    identity = sandbox_identity(payload.user_id)
    if identity is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không tìm thấy tài khoản để giả lập")
    return TokenResponse(
        access_token=create_access_token(
            identity.id,
            identity.role,
            team=_team_for_sandbox_identity(identity.id),
            sandbox=True,
        ),
        must_change_password=False,
        display_name=identity.display_name,
        role=identity.role.value,
        team=_team_for_sandbox_identity(identity.id),
    )


def _team_for_sandbox_identity(user_id: str) -> str | None:
    """Tra team của user trong sandbox DB để gắn vào JWT."""
    from app.db.session import create_session

    with create_session(sandbox=True) as db:
        user = db.get(User, user_id)
        return getattr(user, "team", None) if user else None


@router.post("/sandbox/reset")
def reset_sandbox(_: dict = Depends(_require_sandbox)):
    return reset_sandbox_data()
