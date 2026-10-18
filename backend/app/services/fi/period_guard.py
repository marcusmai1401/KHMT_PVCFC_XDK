from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.domain import FIPeriodWriteGuardModel, TeamReportModel
from app.services.repositories import make_id


def _period_locked_error(team: str, month: int, year: int) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "PERIOD_LOCKED",
            "error_code": "PERIOD_LOCKED",
            "message": f"Kỳ {team} T{month}/{year} đã chốt và không nhận thay đổi",
            "fields": {"team": team, "month": month, "year": year},
        },
    )


def assert_period_mutable(db: Session, team: str, month: int, year: int) -> None:
    """Read-only guard used by every FI/OKR writer before touching period data."""
    locked_report = db.execute(
        select(TeamReportModel.id).where(
            TeamReportModel.team == team,
            TeamReportModel.report_month == month,
            TeamReportModel.report_year == year,
            TeamReportModel.report_status == "locked",
            TeamReportModel.is_current_version.is_(True),
        ).limit(1)
    ).scalar_one_or_none()
    guard = db.execute(
        select(FIPeriodWriteGuardModel).where(
            FIPeriodWriteGuardModel.team == team,
            FIPeriodWriteGuardModel.month == month,
            FIPeriodWriteGuardModel.year == year,
            FIPeriodWriteGuardModel.is_locked.is_(True),
        ).limit(1)
    ).scalar_one_or_none()
    if locked_report is not None or guard is not None:
        raise _period_locked_error(team, month, year)


def assert_period_state_mutable(guard: FIPeriodWriteGuardModel, team: str, month: int, year: int) -> None:
    """Check a period row that is already held by the current transaction."""
    if guard.is_locked:
        raise _period_locked_error(team, month, year)


def lock_period_state(db: Session, team: str, month: int, year: int) -> FIPeriodWriteGuardModel:
    """Lock/create the period row without changing its business lock state.

    Writers call this after acquiring the stable FI team guard and before
    acquiring any FI/report/allocation row.  Creating a cold row is part of a
    mutation transaction; read/preview paths must continue using the
    read-only ``assert_period_mutable`` check instead.
    """
    guard = db.execute(
        select(FIPeriodWriteGuardModel)
        .where(
            FIPeriodWriteGuardModel.team == team,
            FIPeriodWriteGuardModel.month == month,
            FIPeriodWriteGuardModel.year == year,
        )
        .with_for_update().execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if guard is None:
        guard = FIPeriodWriteGuardModel(
            id=make_id("fi-period-guard"),
            team=team,
            month=month,
            year=year,
            is_locked=False,
            revision=0,
        )
        db.add(guard)
    db.flush()
    return guard


def mark_period_locked(
    guard: FIPeriodWriteGuardModel,
    actor: str,
    reason: str | None,
) -> None:
    """Mark an already locked period row as locked without reordering locks."""
    now = datetime.now(timezone.utc)
    guard.is_locked = True
    guard.revision += 1
    guard.locked_at = now
    guard.locked_by = actor
    guard.lock_reason = reason


def lock_period(db: Session, team: str, month: int, year: int, actor: str, reason: str | None) -> None:
    guard = lock_period_state(db, team, month, year)
    mark_period_locked(guard, actor, reason)
    db.flush()


def mark_period_unlocked(guard: FIPeriodWriteGuardModel) -> None:
    guard.is_locked = False
    guard.revision += 1
    guard.locked_at = None
    guard.locked_by = None
    guard.lock_reason = None


def unlock_period(db: Session, team: str, month: int, year: int) -> None:
    guard = lock_period_state(db, team, month, year)
    if guard is None:
        return
    mark_period_unlocked(guard)
    db.flush()
