from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.domain import HistoricalSnapshotModel, TeamReportModel


PeriodSource = Literal["last_selected", "latest_data", "workbook", "current"]


@dataclass(frozen=True)
class ResolvedPeriod:
    month: int
    year: int
    source: PeriodSource
    label: str


def _valid_period(period: tuple[int | None, int | None] | None) -> tuple[int, int] | None:
    if period is None:
        return None
    month, year = period
    if month is None or year is None:
        return None
    try:
        month_int = int(month)
        year_int = int(year)
    except (TypeError, ValueError):
        return None
    if 1 <= month_int <= 12 and 2020 <= year_int <= 2100:
        return month_int, year_int
    return None


def resolve_default_period(
    *,
    last_selected: tuple[int | None, int | None] | None,
    latest_data: tuple[int | None, int | None] | None,
    workbook: tuple[int | None, int | None] | None,
    today: tuple[int | None, int | None],
) -> ResolvedPeriod:
    for source, candidate in (
        ("last_selected", last_selected),
        ("latest_data", latest_data),
        ("workbook", workbook),
        ("current", today),
    ):
        period = _valid_period(candidate)
        if period is not None:
            month, year = period
            return ResolvedPeriod(month=month, year=year, source=source, label=f"T{month}/{year}")  # type: ignore[arg-type]
    return ResolvedPeriod(month=1, year=2026, source="current", label="T1/2026")


def _latest_tuple(periods: list[tuple[int, int]]) -> tuple[int, int] | None:
    if not periods:
        return None
    year, month = max((year, month) for month, year in periods)
    return month, year


def find_latest_data_period(db: Session) -> tuple[int, int] | None:
    report_rows = db.execute(
        select(TeamReportModel.report_month, TeamReportModel.report_year)
        .where(
            TeamReportModel.is_current_version.is_(True),
            TeamReportModel.report_status.in_(["submitted", "locked"]),
            TeamReportModel.report_month.between(1, 12),
            TeamReportModel.report_year.is_not(None),
        )
        .group_by(TeamReportModel.report_month, TeamReportModel.report_year)
    ).all()
    snapshot_rows = db.execute(
        select(HistoricalSnapshotModel.month, HistoricalSnapshotModel.year)
        .where(
            HistoricalSnapshotModel.month.between(1, 12),
            HistoricalSnapshotModel.year.is_not(None),
        )
        .group_by(HistoricalSnapshotModel.month, HistoricalSnapshotModel.year)
    ).all()
    return _latest_tuple([(int(month), int(year)) for month, year in [*report_rows, *snapshot_rows]])


def find_workbook_period(db: Session) -> tuple[int, int] | None:
    row = db.execute(
        select(HistoricalSnapshotModel.month, HistoricalSnapshotModel.year)
        .where(
            HistoricalSnapshotModel.month.between(1, 12),
            HistoricalSnapshotModel.year.is_not(None),
        )
        .order_by(HistoricalSnapshotModel.imported_at.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    month, year = row
    return int(month), int(year)
