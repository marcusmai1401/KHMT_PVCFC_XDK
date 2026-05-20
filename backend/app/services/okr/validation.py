from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.schemas.web_input import ArisingWorkItem, MonthlyConclusionInput, WebInputPayload
from app.services.okr.extraction import extract_metrics
from app.services.okr.kr_mapping import mapping_by_code
from app.services.okr.rules import expected_status_for_kr, map_to_dashboard_status


KR_ASSESSMENT_OPTIONS = {
    "Hoàn thành xuất sắc",
    "Hoàn thành tốt",
    "Hoàn thành",
    "Không hoàn thành",
    "N/A",
}
ARISING_WORK_STATUSES = {"Hoàn thành", "Đang thực hiện", "Chưa bắt đầu"}
MONTHLY_ASSESSMENT_OPTIONS = {
    "Hoàn thành xuất sắc nhiệm vụ",
    "Hoàn thành tốt nhiệm vụ",
    "Hoàn thành nhiệm vụ",
    "Không hoàn thành nhiệm vụ",
}
OBJECTIVE_OVERRIDE_OPTIONS = MONTHLY_ASSESSMENT_OPTIONS | {"Không có kế hoạch"}
OBJECTIVES = tuple(f"O{i}" for i in range(1, 7))


@dataclass(frozen=True)
class ValidationIssue:
    field: str
    message: str
    kr_code: str | None = None
    error_code: str = "VALIDATION_ERROR"

    def to_dict(self) -> dict[str, Any]:
        return {
            "field": self.field,
            "message": self.message,
            "kr_code": self.kr_code,
            "error_code": self.error_code,
        }


@dataclass(frozen=True)
class ValidationWarning:
    warning_type: str
    severity: str
    reason: str
    field: str | None = None
    kr_code: str | None = None
    expected_status: str | None = None
    actual_status: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "warning_type": self.warning_type,
            "severity": self.severity,
            "reason": self.reason,
            "field": self.field,
            "kr_code": self.kr_code,
            "expected_status": self.expected_status,
            "actual_status": self.actual_status,
        }


def validate_month_year(month: int, year: int) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if month < 1 or month > 12:
        issues.append(ValidationIssue("month", "Tháng báo cáo phải nằm trong khoảng 1-12"))
    if year < 2024 or year > 2035:
        issues.append(ValidationIssue("year", "Năm báo cáo phải nằm trong khoảng 2024-2035"))
    return issues


def validate_kr_assessment(
    field_prefix: str,
    kr_code: str,
    assessment: str | None,
    implementation_report: str,
    notes: str | None,
    *,
    require_complete: bool,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if not assessment:
        if require_complete:
            issues.append(
                ValidationIssue(
                    f"{field_prefix}.team_self_assessment",
                    f"KR Assessment is required for {kr_code}",
                    kr_code,
                )
            )
        return issues
    if assessment not in KR_ASSESSMENT_OPTIONS:
        issues.append(
            ValidationIssue(
                f"{field_prefix}.team_self_assessment",
                f"Giá trị đánh giá không hợp lệ cho {kr_code}",
                kr_code,
            )
        )
    if assessment != "N/A" and not implementation_report.strip():
        issues.append(
            ValidationIssue(
                f"{field_prefix}.implementation_report",
                f"Tình hình thực hiện là bắt buộc cho {kr_code}",
                kr_code,
            )
        )
    if len(implementation_report) > 10000:
        issues.append(
            ValidationIssue(
                f"{field_prefix}.implementation_report",
                f"Tình hình thực hiện vượt quá 10.000 ký tự cho {kr_code}",
                kr_code,
            )
        )
    if notes and len(notes) > 5000:
        issues.append(
            ValidationIssue(
                f"{field_prefix}.notes",
                f"Ghi chú vượt quá 5.000 ký tự cho {kr_code}",
                kr_code,
            )
        )
    return issues


def validate_arising_work(items: list[ArisingWorkItem]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if len(items) > 20:
        issues.append(ValidationIssue("arising_work", "Công việc phát sinh tối đa 20 mục"))
    for index, item in enumerate(items):
        content = item.content.strip()
        if not content:
            issues.append(
                ValidationIssue(
                    f"arising_work[{index}].content",
                    f"Nội dung công việc phát sinh #{index + 1} là bắt buộc",
                )
            )
        if len(content) > 2000:
            issues.append(
                ValidationIssue(
                    f"arising_work[{index}].content",
                    f"Nội dung công việc phát sinh #{index + 1} vượt quá 2.000 ký tự",
                )
            )
        if item.status not in ARISING_WORK_STATUSES:
            issues.append(
                ValidationIssue(
                    f"arising_work[{index}].status",
                    f"Trạng thái công việc phát sinh #{index + 1} không hợp lệ",
                )
            )
    return issues


def validate_monthly_conclusion(conclusion: MonthlyConclusionInput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if conclusion.discipline_status not in {"OK", "NOK"}:
        issues.append(ValidationIssue("monthly_conclusion.discipline_status", "Kỷ luật phải là OK hoặc NOK"))
    if conclusion.discipline_status == "NOK" and not (conclusion.discipline_description or "").strip():
        issues.append(
            ValidationIssue(
                "monthly_conclusion.discipline_description",
                "Mô tả kỷ luật là bắt buộc khi trạng thái kỷ luật là NOK",
            )
        )
    if conclusion.overall_assessment not in MONTHLY_ASSESSMENT_OPTIONS:
        issues.append(
            ValidationIssue(
                "monthly_conclusion.overall_assessment",
                "Đánh giá chung kết quả tháng không hợp lệ",
            )
        )
    if (
        conclusion.overall_assessment == "Không hoàn thành nhiệm vụ"
        and len((conclusion.detailed_description or "").strip()) < 20
    ):
        issues.append(
            ValidationIssue(
                "monthly_conclusion.detailed_description",
                "Cần nhập lý do ít nhất 20 ký tự khi Không hoàn thành nhiệm vụ",
            )
        )
    return issues


def validate_objective_overrides(overrides: dict[str, str | None]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for objective, value in overrides.items():
        if objective not in OBJECTIVES:
            issues.append(ValidationIssue(f"objective_overrides.{objective}", "Mục tiêu override không hợp lệ"))
            continue
        if value in {None, ""}:
            continue
        if value not in OBJECTIVE_OVERRIDE_OPTIONS:
            issues.append(
                ValidationIssue(
                    f"objective_overrides.{objective}",
                    f"Đánh giá override cho {objective} không hợp lệ",
                )
            )
    return issues


def check_assessment_conflict(
    kr_code: str,
    assessment: str | None,
    implementation_report: str,
    notes: str | None,
    field: str | None = None,
) -> ValidationWarning | None:
    if not assessment or assessment not in KR_ASSESSMENT_OPTIONS or assessment == "N/A":
        return None
    metrics = [metric.to_dict() for metric in extract_metrics(implementation_report or "", kr_code)]
    expected = expected_status_for_kr(kr_code, metrics, notes or "")
    actual = map_to_dashboard_status(assessment, has_plan=True)
    if expected and expected != "#N/A" and expected != actual:
        return ValidationWarning(
            warning_type="ASSESSMENT_MISMATCH",
            severity="MEDIUM",
            reason=f"Dữ liệu số gợi ý {expected} nhưng đánh giá đang chọn tương ứng {actual}",
            field=field,
            kr_code=kr_code,
            expected_status=expected,
            actual_status=actual,
        )
    return None


def validate_web_input_payload(
    payload: WebInputPayload,
    *,
    require_complete: bool,
) -> tuple[list[ValidationIssue], list[ValidationWarning]]:
    master = mapping_by_code()
    master_codes = set(master)
    issues: list[ValidationIssue] = []
    warnings: list[ValidationWarning] = []
    seen: set[str] = set()

    for index, item in enumerate(payload.kr_assessments):
        field_prefix = f"kr_assessments[{index}]"
        kr_code = item.workshop_kr_code
        if kr_code in seen:
            issues.append(ValidationIssue(f"{field_prefix}.workshop_kr_code", f"KR bị trùng: {kr_code}", kr_code))
        seen.add(kr_code)
        if kr_code not in master_codes:
            issues.append(ValidationIssue(f"{field_prefix}.workshop_kr_code", f"KR không hợp lệ: {kr_code}", kr_code))
            continue
        issues.extend(
            validate_kr_assessment(
                field_prefix,
                kr_code,
                item.team_self_assessment,
                item.implementation_report,
                item.notes,
                require_complete=require_complete,
            )
        )
        warning = check_assessment_conflict(
            kr_code,
            item.team_self_assessment,
            item.implementation_report,
            item.notes,
            f"{field_prefix}.team_self_assessment",
        )
        if warning:
            warnings.append(warning)

    if require_complete:
        missing = sorted(master_codes - seen, key=lambda code: (int(code[1]), int(code.split("KR", 1)[1])))
        for kr_code in missing:
            issues.append(ValidationIssue("kr_assessments", f"Thiếu dữ liệu KR bắt buộc: {kr_code}", kr_code))

    issues.extend(validate_arising_work(payload.arising_work))
    issues.extend(validate_monthly_conclusion(payload.monthly_conclusion))
    issues.extend(validate_objective_overrides(payload.objective_overrides))
    return issues, warnings
