from __future__ import annotations

from fastapi import HTTPException


def require_expected_revision(value: int | None, resource: str) -> int:
    if value is None:
        raise HTTPException(
            status_code=428,
            detail={
                "code": "CLIENT_UPDATE_REQUIRED",
                "error_code": "CLIENT_UPDATE_REQUIRED",
                "message": f"{resource} yêu cầu client mới có expected_revision để tránh ghi đè dữ liệu",
                "fields": {"expected_revision": "required"},
            },
        )
    return value


def require_fi_preview_binding(expected_fi_team_revision: int | None, expected_plan_hash: str | None, resource: str) -> None:
    if expected_fi_team_revision is None or not expected_plan_hash:
        raise HTTPException(
            status_code=428,
            detail={
                "code": "CLIENT_UPDATE_REQUIRED",
                "error_code": "CLIENT_UPDATE_REQUIRED",
                "message": f"{resource} yêu cầu preview phân bổ FI còn hiệu lực trước khi chốt",
                "fields": {
                    "expected_fi_team_revision": "required",
                    "expected_plan_hash": "required",
                },
            },
        )
