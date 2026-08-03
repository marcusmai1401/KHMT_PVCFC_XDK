from __future__ import annotations

from pathlib import Path
import re
from typing import Iterable

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import create_session
from app.models import et_domain  # noqa: F401 - register ET tables with SQLAlchemy metadata
from app.models.domain import (
    AuditLogModel,
    FIMonthlyAllocationModel,
    HistoricalSnapshotModel,
    NotificationModel,
    SKCTKTModel,
    SKCodeSequenceModel,
    SKImageModel,
    SystemConfigModel,
    TeamHeadcountModel,
    TeamMonthlySummaryModel,
    TeamReportModel,
    TemplateModel,
    User,
    VHDNExemptionModel,
    WarningModel,
)
from app.models.et_domain import (
    AssessmentItem,
    CompetencyAssessment,
    CompetencyFramework,
    CompetencyItem,
    LearningPlan,
    LearningPlanItem,
    Personnel,
)
from app.services.bootstrap import DEMO_USERS, create_schema, seed_baseline
from app.services.cache import cache_delete_prefix


HISTORICAL_SOURCE_TYPE = "historical_import"
VERIFIED_HISTORICAL_YEAR = 2026
VERIFIED_HISTORICAL_MONTHS = {0, 1, 2, 3, 4, 5, 6}
SK_CODE_PATTERN = re.compile(r"^(?P<prefix>.+)-(?P<number>\d{4})$")


def _delete_statement(db: Session, model, *conditions) -> int:
    statement = delete(model)
    if conditions:
        statement = statement.where(*conditions)
    result = db.execute(statement)
    return int(result.rowcount or 0)


def _resolve_workspace_path(value: str | None) -> Path | None:
    if not value:
        return None
    path = Path(value)
    if not path.is_absolute():
        path = settings.workspace_dir / path
    try:
        return path.resolve()
    except OSError:
        return path


def _safe_unlink(path: Path | None) -> int:
    if path is None:
        return 0
    try:
        if path.is_file():
            path.unlink()
            return 1
    except OSError:
        return 0
    return 0


def _clear_directory(path: Path, preserve: Iterable[Path] = ()) -> int:
    path.mkdir(parents=True, exist_ok=True)
    preserved = {item.resolve() for item in preserve if item.exists()}
    deleted = 0
    for file_path in sorted(path.rglob("*"), reverse=True):
        if file_path.name == ".gitkeep":
            continue
        try:
            resolved = file_path.resolve()
        except OSError:
            resolved = file_path
        if file_path.is_file():
            if resolved in preserved:
                continue
            deleted += _safe_unlink(file_path)
        elif file_path.is_dir():
            try:
                file_path.rmdir()
            except OSError:
                pass
    gitkeep = path / ".gitkeep"
    if not gitkeep.exists():
        gitkeep.touch()
    return deleted


def _preserved_report_ids(db: Session) -> set[str]:
    return set(
        db.scalars(
            select(TeamReportModel.id).where(TeamReportModel.source_type == HISTORICAL_SOURCE_TYPE)
        ).all()
    )


def _preserved_summary_keys(db: Session) -> set[tuple[str, int, int]]:
    rows = db.execute(
        select(TeamReportModel.team, TeamReportModel.report_month, TeamReportModel.report_year).where(
            TeamReportModel.source_type == HISTORICAL_SOURCE_TYPE,
            TeamReportModel.team.is_not(None),
            TeamReportModel.report_month.is_not(None),
            TeamReportModel.report_year.is_not(None),
        )
    ).all()
    return {(str(team), int(month), int(year)) for team, month, year in rows}


def _delete_non_historical_summaries(db: Session) -> int:
    preserved_keys = _preserved_summary_keys(db)
    deleted = 0
    for summary in db.scalars(select(TeamMonthlySummaryModel)).all():
        key = (summary.team, summary.month, summary.year)
        if key in preserved_keys:
            continue
        db.delete(summary)
        deleted += 1
    return deleted


def _delete_non_verified_snapshots(db: Session) -> int:
    return _delete_statement(
        db,
        HistoricalSnapshotModel,
        or_(
            HistoricalSnapshotModel.year != VERIFIED_HISTORICAL_YEAR,
            HistoricalSnapshotModel.month.not_in(VERIFIED_HISTORICAL_MONTHS),
        ),
    )


def _delete_demo_reports_and_warnings(db: Session) -> dict[str, int]:
    preserved_ids = _preserved_report_ids(db)
    all_report_ids = set(db.scalars(select(TeamReportModel.id)).all())
    demo_report_ids = all_report_ids - preserved_ids
    counts = {
        "fi_monthly_allocations": 0,
        "warnings": 0,
        "team_reports": 0,
        "team_monthly_summaries": 0,
        "historical_snapshots": 0,
    }
    if demo_report_ids:
        counts["fi_monthly_allocations"] += _delete_statement(
            db,
            FIMonthlyAllocationModel,
            FIMonthlyAllocationModel.report_id.in_(demo_report_ids),
        )
        counts["warnings"] += _delete_statement(db, WarningModel, WarningModel.team_report_id.in_(demo_report_ids))
        counts["team_reports"] += _delete_statement(db, TeamReportModel, TeamReportModel.id.in_(demo_report_ids))
    counts["warnings"] += _delete_statement(db, WarningModel, WarningModel.team_report_id.is_(None))
    remaining_report_ids = _preserved_report_ids(db)
    if remaining_report_ids:
        counts["warnings"] += _delete_statement(
            db,
            WarningModel,
            WarningModel.team_report_id.is_not(None),
            WarningModel.team_report_id.not_in(remaining_report_ids),
        )
    else:
        counts["warnings"] += _delete_statement(db, WarningModel, WarningModel.team_report_id.is_not(None))
    if remaining_report_ids:
        counts["fi_monthly_allocations"] += _delete_statement(
            db,
            FIMonthlyAllocationModel,
            FIMonthlyAllocationModel.report_id.not_in(remaining_report_ids),
        )
    else:
        counts["fi_monthly_allocations"] += _delete_statement(db, FIMonthlyAllocationModel)
    counts["team_monthly_summaries"] += _delete_non_historical_summaries(db)
    counts["historical_snapshots"] += _delete_non_verified_snapshots(db)
    return counts


def _delete_demo_sk_data(db: Session) -> tuple[int, int, list[Path]]:
    demo_sk_ids = set(
        db.scalars(select(SKCTKTModel.id).where(SKCTKTModel.is_historical_import.is_(False))).all()
    )
    image_paths: list[Path] = []
    if demo_sk_ids:
        for image in db.scalars(select(SKImageModel).where(SKImageModel.sk_ctkt_id.in_(demo_sk_ids))).all():
            path = _resolve_workspace_path(image.file_path)
            if path is not None:
                image_paths.append(path)
        image_count = _delete_statement(db, SKImageModel, SKImageModel.sk_ctkt_id.in_(demo_sk_ids))
        sk_count = _delete_statement(db, SKCTKTModel, SKCTKTModel.id.in_(demo_sk_ids))
    else:
        image_count = 0
        sk_count = 0
    preserved_sk_ids = set(db.scalars(select(SKCTKTModel.id)).all())
    if preserved_sk_ids:
        orphan_images = db.scalars(select(SKImageModel).where(SKImageModel.sk_ctkt_id.not_in(preserved_sk_ids))).all()
    else:
        orphan_images = db.scalars(select(SKImageModel)).all()
    for image in orphan_images:
        path = _resolve_workspace_path(image.file_path)
        if path is not None:
            image_paths.append(path)
        db.delete(image)
        image_count += 1
    return sk_count, image_count, image_paths


def _reset_sk_sequences(db: Session) -> int:
    deleted = _delete_statement(db, SKCodeSequenceModel)
    next_values: dict[str, int] = {}
    for code in db.scalars(select(SKCTKTModel.sk_code)).all():
        match = SK_CODE_PATTERN.match(code or "")
        if not match:
            continue
        prefix = match.group("prefix")
        number = int(match.group("number"))
        next_values[prefix] = max(next_values.get(prefix, 1), number + 1)
    for prefix, next_value in next_values.items():
        db.add(SKCodeSequenceModel(prefix=prefix, next_value=next_value))
    return deleted


def _delete_et_data(db: Session) -> dict[str, int]:
    return {
        "assessment_items": _delete_statement(db, AssessmentItem),
        "competency_assessments": _delete_statement(db, CompetencyAssessment),
        "learning_plan_items": _delete_statement(db, LearningPlanItem),
        "learning_plans": _delete_statement(db, LearningPlan),
        "competency_items": _delete_statement(db, CompetencyItem),
        "competency_frameworks": _delete_statement(db, CompetencyFramework),
        "personnel": _delete_statement(db, Personnel),
    }


def _reset_reference_demo_edits(db: Session) -> dict[str, int]:
    baseline_user_ids = {str(item["id"]) for item in DEMO_USERS}
    if settings.bootstrap_admin_id:
        baseline_user_ids.add(settings.bootstrap_admin_id)
    counts = {
        "team_headcounts": _delete_statement(db, TeamHeadcountModel),
        "vhdn_exemptions": _delete_statement(db, VHDNExemptionModel),
        "system_config": _delete_statement(db, SystemConfigModel),
        "templates": _delete_statement(db, TemplateModel),
        "users": 0,
    }
    counts["users"] = _delete_statement(db, User, User.id.not_in(baseline_user_ids))
    return counts


def _preserved_runtime_files(db: Session) -> set[Path]:
    preserved: set[Path] = set()
    for report_path in db.scalars(select(TeamReportModel.file_path)).all():
        path = _resolve_workspace_path(report_path)
        if path is not None:
            preserved.add(path)
    for image_path in db.scalars(select(SKImageModel.file_path)).all():
        path = _resolve_workspace_path(image_path)
        if path is not None:
            preserved.add(path)
    return preserved


def reset_demo_data() -> dict[str, int]:
    create_schema()
    counts: dict[str, int] = {}
    deleted_image_paths: list[Path] = []
    with create_session() as db:
        counts.update({f"okr_{key}": value for key, value in _delete_demo_reports_and_warnings(db).items()})
        sk_count, image_count, deleted_image_paths = _delete_demo_sk_data(db)
        counts["sk_ctkt"] = sk_count
        counts["sk_images"] = image_count
        counts["sk_code_sequences"] = _reset_sk_sequences(db)
        counts.update({f"et_{key}": value for key, value in _delete_et_data(db).items()})
        counts["notifications"] = _delete_statement(db, NotificationModel)
        counts["audit_logs"] = _delete_statement(db, AuditLogModel)
        counts.update({f"reference_{key}": value for key, value in _reset_reference_demo_edits(db).items()})
        db.flush()
        seed_baseline(db)
        preserved_files = _preserved_runtime_files(db)
        db.commit()
    counts["deleted_image_files"] = sum(_safe_unlink(path) for path in deleted_image_paths)
    counts["upload_files"] = _clear_directory(settings.storage_dir / "uploads", preserved_files)
    counts["export_files"] = _clear_directory(settings.storage_dir / "exports")
    cache_delete_prefix("okr:dashboard")
    return counts


def main() -> None:
    counts = reset_demo_data()
    print("Demo data reset complete. Verified historical import data is preserved.")
    for key in sorted(counts):
        print(f"{key}: {counts[key]}")


if __name__ == "__main__":
    main()
