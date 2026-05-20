from types import SimpleNamespace

from hypothesis import given, strategies as st
from pydantic import ValidationError

from app.schemas.web_input import ArisingWorkItem, MonthlyConclusionInput
from app.services.okr.email_report import ASSESSMENT_MAPPING, derive_objective_assessments, generate_email_report
from app.services.okr.validation import (
    validate_arising_work,
    validate_kr_assessment,
    validate_monthly_conclusion,
    validate_month_year,
)


KR_VALUES = ["Hoàn thành xuất sắc", "Hoàn thành tốt", "Hoàn thành", "Không hoàn thành", "N/A"]
NON_NA_VALUES = ["Hoàn thành xuất sắc", "Hoàn thành tốt", "Hoàn thành", "Không hoàn thành"]


@given(st.integers(min_value=1, max_value=12), st.integers(min_value=2024, max_value=2035))
def test_month_year_range_accepts_valid_values(month, year):
    assert validate_month_year(month, year) == []


@given(st.sampled_from(KR_VALUES))
def test_kr_assessment_required_for_submission(assessment):
    errors = validate_kr_assessment("kr", "O1.KR1", None, "done", "", require_complete=True)
    assert errors
    assert errors[0].field == "kr.team_self_assessment"


@given(st.sampled_from(NON_NA_VALUES))
def test_implementation_report_required_for_non_na(assessment):
    assert validate_kr_assessment("kr", "O1.KR1", "N/A", "", "", require_complete=True) == []
    assert validate_kr_assessment("kr", "O1.KR1", assessment, "", "", require_complete=True)


@given(st.text(min_size=1, max_size=10000).filter(lambda value: bool(value.strip())))
def test_implementation_report_any_non_empty_length_is_valid(text):
    assert validate_kr_assessment("kr", "O1.KR1", "Hoàn thành", text, "", require_complete=True) == []


@given(st.integers(min_value=0, max_value=2100))
def test_arising_work_content_length_property(length):
    content = "x" * length
    if 1 <= length <= 2000:
        errors = validate_arising_work([ArisingWorkItem(content=content)])
        assert errors == []
    else:
        try:
            errors = validate_arising_work([ArisingWorkItem(content=content)])
        except ValidationError:
            errors = ["schema rejected"]
        assert errors


@given(st.sampled_from(["OK", "NOK"]), st.text(max_size=50))
def test_discipline_description_required_for_nok(status, description):
    errors = validate_monthly_conclusion(
        MonthlyConclusionInput(discipline_status=status, discipline_description=description)
    )
    if status == "NOK" and not description.strip():
        assert errors
    else:
        assert all(error.field != "monthly_conclusion.discipline_description" for error in errors)


@given(st.integers(min_value=0, max_value=30))
def test_non_completion_reason_minimum_length(length):
    errors = validate_monthly_conclusion(
        MonthlyConclusionInput(
            overall_assessment="Không hoàn thành nhiệm vụ",
            detailed_description="x" * length,
        )
    )
    if length < 20:
        assert errors
    else:
        assert errors == []


@given(st.lists(st.sampled_from(KR_VALUES), min_size=1, max_size=20))
def test_objective_assessment_derivation_worst_wins(values):
    assessments = [{"workshop_kr_code": f"O1.KR{index + 1}", "team_self_assessment": value} for index, value in enumerate(values)]
    result = derive_objective_assessments(assessments)
    planned = [value for value in values if value != "N/A"]
    rank = {"Không hoàn thành": 0, "Hoàn thành": 1, "Hoàn thành tốt": 2, "Hoàn thành xuất sắc": 3}
    expected = "Không có kế hoạch" if not planned else ASSESSMENT_MAPPING[min(planned, key=lambda value: rank[value])]
    assert result["O1"] == expected


@given(st.booleans())
def test_arising_work_email_section_included_iff_items_exist(has_arising_work):
    report = SimpleNamespace(
        team="TBCH",
        report_month=4,
        team_level={"monthly_assessment": "Hoàn thành nhiệm vụ"},
        assessments=[],
        arising_work=[{"content": "Việc phát sinh", "status": "Hoàn thành"}] if has_arising_work else [],
    )
    email = generate_email_report(report)
    assert ("Ngoài kế hoạch mục tiêu" in email) is has_arising_work


@given(st.sampled_from(KR_VALUES))
def test_email_assessment_mapping_is_complete(value):
    assert ASSESSMENT_MAPPING[value]


@given(st.lists(st.sampled_from(KR_VALUES), min_size=0, max_size=37))
def test_email_structure_has_exactly_six_objective_lines(values):
    report = SimpleNamespace(
        team="TBCH",
        report_month=4,
        team_level={"monthly_assessment": "Hoàn thành nhiệm vụ"},
        assessments=[
            {"workshop_kr_code": f"O{index % 6 + 1}.KR{index + 1}", "team_self_assessment": value}
            for index, value in enumerate(values)
        ],
        arising_work=[],
    )
    email = generate_email_report(report)
    assert email.count("Mục tiêu ĐK.") == 6
    assert email.startswith("1. Báo cáo tổng quát:")
