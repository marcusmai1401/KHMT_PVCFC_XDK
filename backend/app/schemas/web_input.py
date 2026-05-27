from typing import Any
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class KRAssessmentInput(BaseModel):
    workshop_kr_code: str
    implementation_report: str = Field(default="", max_length=10000)
    team_self_assessment: Literal[
        "Hoàn thành xuất sắc",
        "Hoàn thành tốt",
        "Hoàn thành",
        "Không hoàn thành",
        "N/A",
    ] | None = None
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("implementation_report", "notes", mode="before")
    @classmethod
    def normalize_text(cls, value: Any) -> str:
        return "" if value is None else str(value)

    @field_validator("team_self_assessment", mode="before")
    @classmethod
    def normalize_assessment(cls, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


class ArisingWorkItem(BaseModel):
    content: str = Field(default="", max_length=2000)
    status: Literal["Hoàn thành", "Đang thực hiện", "Chưa bắt đầu"] = "Hoàn thành"

    @field_validator("content", "status", mode="before")
    @classmethod
    def normalize_text(cls, value: Any) -> str:
        return "" if value is None else str(value)


class MonthlyConclusionInput(BaseModel):
    discipline_status: Literal["OK", "NOK"] = "OK"
    discipline_description: str | None = Field(default=None, max_length=2000)
    discipline_violators: list[str] = Field(default_factory=list, max_length=55)
    overall_assessment: Literal[
        "Hoàn thành xuất sắc nhiệm vụ",
        "Hoàn thành tốt nhiệm vụ",
        "Hoàn thành nhiệm vụ",
        "Không hoàn thành nhiệm vụ",
    ] = "Hoàn thành nhiệm vụ"
    detailed_description: str | None = Field(default=None, max_length=5000)

    @field_validator("discipline_status", "overall_assessment", mode="before")
    @classmethod
    def normalize_required_text(cls, value: Any) -> str:
        return "" if value is None else str(value).strip()

    @field_validator("discipline_description", "detailed_description", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: Any) -> str:
        return "" if value is None else str(value)

    @field_validator("discipline_violators", mode="before")
    @classmethod
    def normalize_violators(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value.strip() else []
        if not isinstance(value, list):
            return []
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            if item is None:
                continue
            text = str(item).strip()
            if text and text not in seen:
                seen.add(text)
                cleaned.append(text)
        return cleaned


class WebInputPayload(BaseModel):
    kr_assessments: list[KRAssessmentInput] = Field(default_factory=list)
    arising_work: list[ArisingWorkItem] = Field(default_factory=list)
    monthly_conclusion: MonthlyConclusionInput = Field(default_factory=MonthlyConclusionInput)
    objective_overrides: dict[
        str,
        Literal[
            "Hoàn thành xuất sắc nhiệm vụ",
            "Hoàn thành tốt nhiệm vụ",
            "Hoàn thành nhiệm vụ",
            "Không hoàn thành nhiệm vụ",
            "Không có kế hoạch",
        ] | None,
    ] = Field(default_factory=dict)


class WebInputSaveRequest(BaseModel):
    data: WebInputPayload
    expected_version: int | None = None


class LockRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class WebInputStatus(BaseModel):
    team: str
    month: int
    year: int
    status: str
    last_saved_at: str | None = None
    submitted_at: str | None = None
    version: int | None = None
