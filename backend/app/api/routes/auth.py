from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.config import settings
from app.core.login_limiter import login_limiter
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


def _sandbox_enabled() -> bool:
    return settings.environment.strip().lower() != "production"


def _require_sandbox(principal: dict = Depends(current_principal)) -> dict:
    if not _sandbox_enabled() or not principal.get("sandbox"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chỉ dùng được trong môi trường kiểm thử")
    return principal


def _token_response_from_user(user: User, *, sandbox: bool = False) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(
            user.id,
            Role(user.role),
            team=getattr(user, "team", None),
            sandbox=sandbox,
            session_version=int(getattr(user, "session_version", 1)),
        ),
        must_change_password=bool(getattr(user, "must_change_password", False)) and not sandbox,
        display_name=user.display_name,
        role=user.role,
        team=getattr(user, "team", None),
    )


def _find_login_user(db: Session, user_id: str) -> User | None:
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


@router.post("/login", response_model=TokenResponse)
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user_id = payload.user_id.strip()
    client_ip = request.client.host if request.client else "unknown"
    retry_after = login_limiter.check(client_ip, user_id)
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RATE_LIMITED",
                "message": "Quá nhiều lần đăng nhập không thành công. Vui lòng thử lại sau.",
                "retry_after": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )
    if (
        _sandbox_enabled()
        and user_id.lower() == SANDBOX_LOGIN_ID
        and payload.password.strip() == SANDBOX_PASSWORD
    ):
        reset_sandbox_data()
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

    user = _find_login_user(db, user_id)
    if (
        user is not None
        and user.is_active
        and _verify_password_allowing_copy_whitespace(payload.password, user.password_hash)
    ):
        audit(db, user.id, "Account", user.id, "login", {"sandbox": False})
        db.commit()
        return _token_response_from_user(user)

    login_limiter.record_failure(client_ip, user_id)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sai tài khoản hoặc mật khẩu")


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


@router.get("/capabilities")
def capabilities(principal: dict = Depends(current_principal)) -> dict:
    """Return server-authoritative feature capabilities for the current session."""
    role = principal["role"]
    is_admin = role == Role.ADMIN.value
    can_et = role in {
        Role.ADMIN.value,
        Role.WORKSHOP_LEADER.value,
        Role.FI_COORDINATOR.value,
        Role.TEAM_ACCOUNT.value,
    }
    can_et_summary = role in {
        Role.ADMIN.value,
        Role.WORKSHOP_LEADER.value,
        Role.FI_COORDINATOR.value,
    }
    can_et_heatmap = role in {Role.ADMIN.value, Role.WORKSHOP_LEADER.value}
    can_et_personnel = role in {Role.ADMIN.value, Role.WORKSHOP_LEADER.value}
    can_et_assessments = role in {Role.ADMIN.value, Role.WORKSHOP_LEADER.value, Role.TEAM_ACCOUNT.value}
    can_et_plans = role in {Role.ADMIN.value, Role.WORKSHOP_LEADER.value, Role.TEAM_ACCOUNT.value}
    return {
        "role": role,
        "team": principal.get("team"),
        "capabilities": {
            "okr.read": True,
            "okr.write": is_admin,
            "et.read": can_et,
            "et.write": is_admin,
            "et.summary.read": can_et_summary,
            "et.heatmap.read": can_et_heatmap,
            "et.frameworks.read": role in {Role.ADMIN.value, Role.WORKSHOP_LEADER.value},
            "et.personnel.read": can_et_personnel,
            "et.assessments.read": can_et_assessments,
            "et.assessments.write": is_admin,
            "et.plans.read": can_et_plans,
            "et.scope": "own_linked_personnel" if role == Role.TEAM_ACCOUNT.value else ("all_allowed" if can_et else "none"),
            "fi.read": True,
            "fi.write": role in {
                Role.ADMIN.value,
                Role.FI_COORDINATOR.value,
                Role.TEAM_ACCOUNT.value,
                Role.STAFF.value,
            },
            "admin.read": is_admin,
            "admin.write": is_admin,
        },
    }


@router.post("/change-password", response_model=TokenResponse)
def change_password(
    payload: ChangePasswordRequest,
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
) -> TokenResponse:
    if principal.get("sandbox"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tài khoản kiểm thử không đổi được mật khẩu")
    user = db.scalar(select(User).where(User.id == principal["user_id"]).with_for_update().execution_options(populate_existing=True))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy tài khoản")
    if not _verify_password_allowing_copy_whitespace(payload.old_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu hiện tại không đúng")
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu mới phải khác mật khẩu cũ")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu mới phải có ít nhất 8 ký tự")
    has_letter = any(ch.isalpha() for ch in payload.new_password)
    has_digit = any(ch.isdigit() for ch in payload.new_password)
    if not (has_letter and has_digit):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu mới cần có cả chữ và số")
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.session_version = int(getattr(user, "session_version", 1)) + 1
    audit(db, user.id, "Account", user.id, "change_password", {})
    response = _token_response_from_user(user)
    db.commit()
    return response


@router.post("/revoke-all-sessions")
def revoke_all_sessions(
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    if principal.get("sandbox"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tài khoản kiểm thử không cần thu hồi phiên")
    user = db.scalar(select(User).where(User.id == principal["user_id"]).with_for_update().execution_options(populate_existing=True))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy tài khoản")
    user.session_version = int(getattr(user, "session_version", 1)) + 1
    audit(db, user.id, "Account", user.id, "revoke_all_sessions", {})
    db.commit()
    return {"revoked": True, "message": "Đã đăng xuất tất cả thiết bị. Vui lòng đăng nhập lại."}


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
    if not _sandbox_enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sandbox is disabled in production")
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
