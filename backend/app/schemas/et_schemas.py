from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ImportErrorItem(BaseModel):
    sheet: str | None = None
    row: int | None = None
    column: str | None = None
    field: str | None = None
    message: str
    value: Any | None = None


class FrameworkItemBase(BaseModel):
    nlcm_code: str
    competency_name: str
    competency_detail: str | None = None
    definition: str | None = None
    requirements_text: str | None = None
    category: str
    stt: int
    level_requirements: dict[str, int] = Field(default_factory=dict)
    month_hold_level: int | None = None
    year_hold_level: float | None = None
    gap_reference: int | None = None


class FrameworkItemCreate(FrameworkItemBase):
    pass


class FrameworkItemUpdate(BaseModel):
    nlcm_code: str | None = None
    competency_name: str | None = None
    competency_detail: str | None = None
    definition: str | None = None
    requirements_text: str | None = None
    category: str | None = None
    stt: int | None = None
    level_requirements: dict[str, int] | None = None
    month_hold_level: int | None = None
    year_hold_level: float | None = None
    gap_reference: int | None = None


class FrameworkItemResponse(FrameworkItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    framework_id: str


class FrameworkBase(BaseModel):
    code: str
    title: str
    version: int = 1
    is_active: bool = True


class FrameworkCreate(BaseModel):
    code: str
    title: str
    is_active: bool = True
    items: list[FrameworkItemCreate] = Field(default_factory=list)


class FrameworkUpdate(BaseModel):
    code: str | None = None
    title: str | None = None
    is_active: bool | None = None


class FrameworkResponse(FrameworkBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_by: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


class FrameworkWithItemsResponse(FrameworkResponse):
    items: list[FrameworkItemResponse] = Field(default_factory=list)
    level_sums: dict[str, int] = Field(default_factory=dict)


class ItemReorderRequest(BaseModel):
    orders: list[dict[str, int | str]]


class PersonnelBase(BaseModel):
    employee_code: str | None = None
    full_name: str
    role: str | None = None
    position_code: str | None = None
    team: str | None = None
    current_level: int | None = Field(default=None, ge=1, le=8)
    salary_grade: str | None = None
    hire_date: date | None = None
    status: str = "active"
    user_id: str | None = None


class PersonnelCreate(PersonnelBase):
    pass


class PersonnelUpdate(BaseModel):
    employee_code: str | None = None
    full_name: str | None = None
    role: str | None = None
    position_code: str | None = None
    team: str | None = None
    current_level: int | None = Field(default=None, ge=1, le=8)
    salary_grade: str | None = None
    hire_date: date | None = None
    status: str | None = None
    user_id: str | None = None


class PersonnelResponse(PersonnelBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PersonnelBulkLevelUpdate(BaseModel):
    personnel_ids: list[str]
    current_level: int = Field(ge=1, le=8)


class AssessmentItemUpdate(BaseModel):
    id: str
    actual_score: int | None = Field(default=None, ge=0, le=5)
    notes: str | None = None


class AssessmentCreate(BaseModel):
    personnel_id: str
    assessment_period: str


class AssessmentUpdate(BaseModel):
    notes: str | None = None
    training_content: str | None = None
    items: list[AssessmentItemUpdate] = Field(default_factory=list)


class AssessmentSubmitResponse(BaseModel):
    id: str
    status: str
    overall_result: str | None
    is_latest: bool


class LearningPlanItemCreate(BaseModel):
    item_id: str
    target_week: int | None = None
    target_month: int | None = None
    target_year: int | None = None
    target_level: int | None = Field(default=None, ge=1, le=8)
    actual_level: int | None = Field(default=None, ge=0, le=8)
    status: str = "not_started"


class LearningPlanCreate(BaseModel):
    personnel_id: str
    title: str
    start_date: date
    duration_months: int = Field(default=14, ge=1, le=60)
    status: str = "active"
    items: list[LearningPlanItemCreate] = Field(default_factory=list)


class LearningPlanItemUpdate(BaseModel):
    id: str | None = None
    item_id: str | None = None
    target_week: int | None = None
    target_month: int | None = None
    target_year: int | None = None
    target_level: int | None = Field(default=None, ge=1, le=8)
    actual_level: int | None = Field(default=None, ge=0, le=8)
    status: str | None = None


class LearningPlanUpdate(BaseModel):
    title: str | None = None
    start_date: date | None = None
    duration_months: int | None = Field(default=None, ge=1, le=60)
    status: str | None = None
    items: list[LearningPlanItemUpdate] | None = None


class LearningPlanAutoGenerateRequest(BaseModel):
    assessment_id: str | None = None
    mark_non_gap_completed: bool = True


class LearningPlanCompleteRequest(BaseModel):
    actual_level: int | None = Field(default=None, ge=0, le=8)


class DashboardFilters(BaseModel):
    team: str | None = None
    position: str | None = None
    level: int | None = Field(default=None, ge=1, le=8)
    result: str | None = None
