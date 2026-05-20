from __future__ import annotations

from pathlib import Path
from typing import Any

from app.core.config import settings
from app.models.domain import TeamReportModel
from app.services.okr.validation import OBJECTIVES


ASSESSMENT_MAPPING = {
    "Hoàn thành": "Hoàn thành nhiệm vụ",
    "Hoàn thành tốt": "Hoàn thành tốt nhiệm vụ",
    "Hoàn thành xuất sắc": "Hoàn thành xuất sắc nhiệm vụ",
    "Không hoàn thành": "Không hoàn thành nhiệm vụ",
    "N/A": "Không có kế hoạch",
}
ASSESSMENT_RANK = {
    "Không hoàn thành": 0,
    "Hoàn thành": 1,
    "Hoàn thành tốt": 2,
    "Hoàn thành xuất sắc": 3,
}


def derive_objective_assessments(
    kr_assessments: list[dict[str, Any]],
    objective_overrides: dict[str, str | None] | None = None,
) -> dict[str, str]:
    by_objective: dict[str, list[str]] = {objective: [] for objective in OBJECTIVES}
    for kr in kr_assessments:
        code = str(kr.get("workshop_kr_code") or "")
        objective = code.split(".", 1)[0]
        assessment = str(kr.get("team_self_assessment") or "")
        if objective not in by_objective or assessment in {"", "N/A"}:
            continue
        if assessment in ASSESSMENT_RANK:
            by_objective[objective].append(assessment)

    result: dict[str, str] = {}
    for objective in OBJECTIVES:
        values = by_objective[objective]
        if values:
            worst = min(values, key=lambda item: ASSESSMENT_RANK[item])
            result[objective] = ASSESSMENT_MAPPING[worst]
        else:
            result[objective] = ASSESSMENT_MAPPING["N/A"]

    for objective, override in (objective_overrides or {}).items():
        if objective in result and override:
            result[objective] = override
    return result


def generate_email_report(report: TeamReportModel) -> str:
    team_level = report.team_level or {}
    objective_assessments = derive_objective_assessments(
        report.assessments or [],
        team_level.get("objective_overrides") or {},
    )
    lines = ["1. Báo cáo tổng quát:"]
    for objective in OBJECTIVES:
        lines.append(f"• Mục tiêu ĐK.{objective}.{report.team}.{objective}: {objective_assessments[objective]}")

    arising_work = report.arising_work or []
    if arising_work:
        lines.append("• Ngoài kế hoạch mục tiêu trong tháng đội có thực hiện thêm các việc phát sinh:")
        for item in arising_work:
            status = item.get("status") or "Hoàn thành"
            content = item.get("content") or ""
            suffix = f" ({status})" if status != "Hoàn thành" else ""
            lines.append(f"  - {content}{suffix}")

    monthly = team_level.get("monthly_assessment") or team_level.get("overall_assessment") or "Hoàn thành nhiệm vụ"
    lines.append("")
    lines.append(f"2. Đánh giá chung kết quả tháng {report.report_month}: {monthly}")
    detail = team_level.get("detailed_description")
    if detail:
        lines.append(str(detail))
    return "\n".join(lines)


def email_report_path(report: TeamReportModel) -> Path:
    settings.storage_dir.joinpath("exports").mkdir(parents=True, exist_ok=True)
    return (
        settings.storage_dir
        / "exports"
        / f"email-bao-cao-okr-{report.team}-T{report.report_month}-{report.report_year}.txt"
    )


def write_email_report_file(report: TeamReportModel) -> Path:
    path = email_report_path(report)
    path.write_text(generate_email_report(report), encoding="utf-8")
    return path
