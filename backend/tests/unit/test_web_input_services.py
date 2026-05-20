from hypothesis import given, strategies as st

from app.schemas.web_input import ArisingWorkItem, KRAssessmentInput, MonthlyConclusionInput, WebInputPayload
from app.services.okr.email_report import derive_objective_assessments
from app.services.okr.validation import validate_arising_work, validate_kr_assessment, validate_monthly_conclusion


def test_kr_assessment_requires_report_unless_na():
    assert validate_kr_assessment("kr", "O1.KR1", "N/A", "", "", require_complete=True) == []
    errors = validate_kr_assessment("kr", "O1.KR1", "Hoàn thành", "", "", require_complete=True)
    assert errors
    assert errors[0].field == "kr.implementation_report"


@given(st.text(min_size=1, max_size=10000).filter(lambda value: bool(value.strip())))
def test_implementation_report_has_no_minimum_length(text):
    errors = validate_kr_assessment("kr", "O1.KR1", "Hoàn thành", text, "", require_complete=True)
    assert not errors


def test_arising_work_content_and_count_validation():
    assert validate_arising_work([ArisingWorkItem(content="Hoàn thành xử lý phát sinh")]) == []
    assert validate_arising_work([ArisingWorkItem(content="")])
    assert validate_arising_work([ArisingWorkItem(content="x") for _ in range(21)])


def test_monthly_conclusion_conditional_requirements():
    assert validate_monthly_conclusion(MonthlyConclusionInput(discipline_status="NOK"))
    assert validate_monthly_conclusion(
        MonthlyConclusionInput(
            overall_assessment="Không hoàn thành nhiệm vụ",
            detailed_description="ngắn",
        )
    )
    assert validate_monthly_conclusion(
        MonthlyConclusionInput(
            discipline_status="NOK",
            discipline_description="Có vi phạm",
            overall_assessment="Không hoàn thành nhiệm vụ",
            detailed_description="Mô tả nguyên nhân không hoàn thành đủ dài",
        )
    ) == []


def test_objective_derivation_uses_worst_kr_and_override():
    result = derive_objective_assessments(
        [
            {"workshop_kr_code": "O1.KR1", "team_self_assessment": "Hoàn thành tốt"},
            {"workshop_kr_code": "O1.KR2", "team_self_assessment": "Không hoàn thành"},
            {"workshop_kr_code": "O2.KR1", "team_self_assessment": "N/A"},
        ],
        {"O1": "Hoàn thành nhiệm vụ"},
    )
    assert result["O1"] == "Hoàn thành nhiệm vụ"
    assert result["O2"] == "Không có kế hoạch"


def test_web_input_payload_accepts_draft_missing_assessment():
    payload = WebInputPayload(
        kr_assessments=[
            KRAssessmentInput(workshop_kr_code="O1.KR1", team_self_assessment=None),
        ]
    )
    assert payload.kr_assessments[0].team_self_assessment is None
