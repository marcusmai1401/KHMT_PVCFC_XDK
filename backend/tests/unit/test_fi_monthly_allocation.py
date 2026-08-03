from datetime import datetime, timezone

import pytest

from app.models.domain import FIMonthlyAllocationModel, SKCTKTModel, TeamReportModel
from app.services.fi.monthly_allocation import (
    FIAllocationError,
    finalize_monthly_fi_allocation,
    mark_monthly_fi_allocation_reopened,
    preview_monthly_fi_allocation,
    quota_for_assessment,
)


def _dt(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, 8, 0, tzinfo=timezone.utc)


def _report(
    *,
    team: str = "TBCH",
    month: int = 7,
    year: int = 2026,
    assessment: str = "Hoàn thành nhiệm vụ",
) -> TeamReportModel:
    return TeamReportModel(
        id=f"report-{team}-{month}-{year}",
        team=team,
        report_month=month,
        report_year=year,
        file_name="report.xlsx",
        file_path="",
        file_hash="hash",
        version=2,
        is_current_version=True,
        uploaded_by="admin",
        uploaded_at=_dt(year, month, 25),
        source_type="web_input",
        report_status="submitted",
        team_level={"monthly_assessment": assessment},
    )


def _sk(
    index: int,
    *,
    team: str = "TBCH",
    approved_at: datetime | None = None,
    assigned_period: tuple[int, int] | None = None,
    status: str = "Approved",
) -> SKCTKTModel:
    assigned = assigned_period is not None
    return SKCTKTModel(
        id=f"sk-auto-{team}-{index}",
        sk_code=f"FI/07/2026-{team}-{index:02d}",
        title=f"FI tự động {index}",
        author_name=f"Tác giả {index}",
        author_user_id=f"staff-{index}",
        team=team,
        content_description="Nội dung FI",
        completion_plan="Kế hoạch hoàn thành",
        status=status,
        status_history=[],
        consider_for_khmt=assigned,
        khmt_month=assigned_period[0] if assigned_period else None,
        khmt_year=assigned_period[1] if assigned_period else None,
        is_public=True,
        is_counted_for_okr=assigned,
        is_historical_import=False,
        created_at=approved_at or _dt(2026, 1, 1),
        submitted_at=approved_at or _dt(2026, 1, 1),
        approved_at=approved_at,
    )


def test_assessment_quota_mapping():
    assert quota_for_assessment("Không hoàn thành nhiệm vụ") == 0
    assert quota_for_assessment("Hoàn thành nhiệm vụ") == 1
    assert quota_for_assessment("Hoàn thành tốt nhiệm vụ") == 3
    assert quota_for_assessment("Hoàn thành xuất sắc nhiệm vụ") == 3
    assert quota_for_assessment("Không hoàn thành") == 0
    assert quota_for_assessment("Hoàn thành") == 1
    assert quota_for_assessment("HT tốt") == 3

    with pytest.raises(FIAllocationError) as exc_info:
        quota_for_assessment("Chưa chốt")
    assert exc_info.value.code == "FI_ASSESSMENT_UNSUPPORTED"


def test_preview_selects_oldest_approved_records_and_respects_period_cutoff(db_session):
    report = _report(assessment="Hoàn thành tốt nhiệm vụ")
    records = [
        _sk(1, approved_at=_dt(2026, 4, 1)),
        _sk(2, approved_at=_dt(2026, 5, 1)),
        _sk(3, approved_at=_dt(2026, 6, 1)),
        _sk(4, approved_at=_dt(2026, 7, 1)),
        _sk(5, approved_at=_dt(2026, 8, 1)),
        _sk(6, team="TBĐL", approved_at=_dt(2026, 3, 1)),
    ]
    db_session.add_all([report, *records])
    db_session.commit()

    preview = preview_monthly_fi_allocation(db_session, report)

    assert preview["required_count"] == 3
    assert preview["available_count"] == 4
    assert preview["can_finalize"] is True
    assert preview["selected_sk_ids"] == [records[0].id, records[1].id, records[2].id]
    assert records[4].id not in preview["selected_sk_ids"]


def test_period_cutoff_uses_vietnam_business_date(db_session):
    report = _report(month=7, assessment="Hoàn thành nhiệm vụ")
    before_midnight_vietnam = _sk(
        1,
        approved_at=datetime(2026, 7, 31, 16, 59, tzinfo=timezone.utc),
    )
    after_midnight_vietnam = _sk(
        2,
        approved_at=datetime(2026, 7, 31, 17, 1, tzinfo=timezone.utc),
    )
    db_session.add_all([report, before_midnight_vietnam, after_midnight_vietnam])
    db_session.commit()

    preview = preview_monthly_fi_allocation(db_session, report)

    assert preview["available_count"] == 1
    assert preview["selected_sk_ids"] == [before_midnight_vietnam.id]


def test_finalize_is_idempotent_and_keeps_exact_quota(db_session):
    report = _report(assessment="Hoàn thành tốt nhiệm vụ")
    records = [_sk(index, approved_at=_dt(2026, index + 1, 1)) for index in range(1, 5)]
    db_session.add_all([report, *records])
    db_session.commit()

    first = finalize_monthly_fi_allocation(db_session, report, "admin")
    db_session.commit()
    first_plan_id = first["allocation"]["id"]
    second = finalize_monthly_fi_allocation(db_session, report, "admin")
    db_session.commit()

    assigned = [record for record in records if record.consider_for_khmt]
    assert len(assigned) == 3
    assert {record.id for record in assigned} == set(first["selected_sk_ids"])
    assert second["allocation"]["id"] == first_plan_id
    assert second["to_assign_sk_ids"] == []
    assert second["to_release_sk_ids"] == []
    assert db_session.query(FIMonthlyAllocationModel).count() == 1


def test_refinalize_lower_level_releases_surplus_to_pool(db_session):
    report = _report(assessment="Hoàn thành tốt nhiệm vụ")
    records = [_sk(index, approved_at=_dt(2026, index + 1, 1)) for index in range(1, 5)]
    db_session.add_all([report, *records])
    db_session.commit()

    finalize_monthly_fi_allocation(db_session, report, "admin")
    db_session.commit()
    report.team_level = {"monthly_assessment": "Hoàn thành nhiệm vụ"}
    result = finalize_monthly_fi_allocation(db_session, report, "admin")
    db_session.commit()

    assigned = [record for record in records if record.consider_for_khmt]
    released = [record for record in records if not record.consider_for_khmt]
    assert len(assigned) == 1
    assert assigned[0].id == records[0].id
    assert len(result["to_release_sk_ids"]) == 2
    assert all(record.khmt_month is None and not record.is_counted_for_okr for record in released)
    assert any(item["reason"] == "khmt_auto_unassignment" for item in records[1].status_history)


def test_non_completion_releases_all_current_period_assignments(db_session):
    report = _report(assessment="Không hoàn thành nhiệm vụ")
    records = [
        _sk(1, approved_at=_dt(2026, 4, 1), assigned_period=(7, 2026)),
        _sk(2, approved_at=_dt(2026, 5, 1), assigned_period=(7, 2026)),
    ]
    db_session.add_all([report, *records])
    db_session.commit()

    result = finalize_monthly_fi_allocation(db_session, report, "admin")
    db_session.commit()

    assert result["required_count"] == 0
    assert result["selected_sk_ids"] == []
    assert set(result["to_release_sk_ids"]) == {record.id for record in records}
    assert all(not record.consider_for_khmt and record.khmt_month is None for record in records)


def test_shortage_does_not_mutate_existing_assignments(db_session):
    report = _report(assessment="Hoàn thành tốt nhiệm vụ")
    only_record = _sk(1, approved_at=_dt(2026, 4, 1))
    db_session.add_all([report, only_record])
    db_session.commit()

    with pytest.raises(FIAllocationError) as exc_info:
        finalize_monthly_fi_allocation(db_session, report, "admin")

    assert exc_info.value.code == "FI_ALLOCATION_SHORTAGE"
    assert exc_info.value.details["shortage_count"] == 2
    assert only_record.consider_for_khmt is False
    assert only_record.khmt_month is None
    assert db_session.query(FIMonthlyAllocationModel).count() == 0


def test_reopen_marks_plan_but_preserves_selected_fi(db_session):
    report = _report()
    record = _sk(1, approved_at=_dt(2026, 4, 1))
    db_session.add_all([report, record])
    db_session.commit()
    finalize_monthly_fi_allocation(db_session, report, "admin")
    db_session.commit()

    plan = mark_monthly_fi_allocation_reopened(
        db_session,
        team="TBCH",
        month=7,
        year=2026,
        actor="admin",
        reason="Điều chỉnh kết luận",
    )
    db_session.commit()

    assert plan is not None
    assert plan.status == "reopened"
    assert record.consider_for_khmt is True
    assert record.khmt_month == 7
