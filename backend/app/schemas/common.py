from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    user_id: str
    password: str


class SKCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": "Create the SK-CTKT draft fields only. Supporting images are managed via the /images endpoints after creation."
        }
    )

    author_name: str
    team: str
    title: str
    content_description: str
    completion_plan: str
    registration_month: int | None = Field(default=None, ge=1, le=12)
    registration_year: int | None = Field(default=None, ge=2020, le=2100)
    author_user_id: str | None = None
    year: int | None = None


class SKUpdate(BaseModel):
    author_name: str | None = None
    team: str | None = None
    title: str | None = None
    content_description: str | None = None
    completion_plan: str | None = None


class TransitionRequest(BaseModel):
    note: str | None = None
    comments: str | None = None


class KHMTAssignRequest(BaseModel):
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2020, le=2100)


class WarningResolveRequest(BaseModel):
    admin_action: str
    admin_notes: str | None = None
    adjusted_value: Any | None = None


class UserCreate(BaseModel):
    id: str
    display_name: str
    password: str
    role: str = "Team_Account"
    is_active: bool = True


class UserRoleUpdate(BaseModel):
    role: str
    is_active: bool | None = None


class HeadcountUpdate(BaseModel):
    team: str
    total_headcount: int = Field(ge=0)
    vhdn_eligible_headcount: int = Field(ge=0)
    effective_month: int = Field(default=1, ge=1, le=12)
    effective_year: int = Field(default=2026, ge=2020, le=2100)
    notes: str | None = None


class LeaderKPIAllocationUpdate(BaseModel):
    a1: int | None = Field(default=None, ge=0, le=99)
    a2: int | None = Field(default=None, ge=0, le=99)


class SystemConfigUpdate(BaseModel):
    submission_deadline_day: int | None = Field(default=None, ge=1, le=31)
    notification_channel: str | None = None


class TemplateUpdate(BaseModel):
    name: str | None = None
    definition: dict[str, Any]
