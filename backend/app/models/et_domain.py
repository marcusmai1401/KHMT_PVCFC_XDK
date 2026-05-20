from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.services.repositories import make_id


class CompetencyFramework(Base):
    __tablename__ = "competency_frameworks"
    __table_args__ = (UniqueConstraint("code", "version", name="uq_framework_code_version"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("etfw"))
    code: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    items: Mapped[list["CompetencyItem"]] = relationship(
        "CompetencyItem",
        back_populates="framework",
        cascade="all, delete-orphan",
        order_by="CompetencyItem.stt",
    )
    assessments: Mapped[list["CompetencyAssessment"]] = relationship("CompetencyAssessment", back_populates="framework")


class CompetencyItem(Base):
    __tablename__ = "competency_items"
    __table_args__ = (UniqueConstraint("framework_id", "nlcm_code", name="uq_item_framework_code"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("etitem"))
    framework_id: Mapped[str] = mapped_column(String, ForeignKey("competency_frameworks.id"), nullable=False, index=True)
    nlcm_code: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    competency_name: Mapped[str] = mapped_column(String(255), nullable=False)
    competency_detail: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    stt: Mapped[int] = mapped_column(Integer, nullable=False)
    level_requirements: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    month_hold_level: Mapped[int | None] = mapped_column(Integer)
    year_hold_level: Mapped[float | None] = mapped_column(Float)
    gap_reference: Mapped[int | None] = mapped_column(Integer)

    framework: Mapped[CompetencyFramework] = relationship("CompetencyFramework", back_populates="items")
    assessment_items: Mapped[list["AssessmentItem"]] = relationship("AssessmentItem", back_populates="competency_item")
    learning_plan_items: Mapped[list["LearningPlanItem"]] = relationship(
        "LearningPlanItem",
        back_populates="competency_item",
    )


class Personnel(Base):
    __tablename__ = "personnel"
    __table_args__ = (UniqueConstraint("employee_code", name="uq_personnel_employee_code"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("etperson"))
    employee_code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    position_code: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    team: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    current_level: Mapped[int] = mapped_column(Integer, nullable=False)
    hire_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    assessments: Mapped[list["CompetencyAssessment"]] = relationship("CompetencyAssessment", back_populates="personnel")
    learning_plans: Mapped[list["LearningPlan"]] = relationship("LearningPlan", back_populates="personnel")


class CompetencyAssessment(Base):
    __tablename__ = "competency_assessments"
    __table_args__ = (
        UniqueConstraint("personnel_id", "assessment_period", name="uq_assessment_personnel_period"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("etassess"))
    personnel_id: Mapped[str] = mapped_column(String, ForeignKey("personnel.id"), nullable=False, index=True)
    framework_id: Mapped[str] = mapped_column(String, ForeignKey("competency_frameworks.id"), nullable=False, index=True)
    framework_version: Mapped[int] = mapped_column(Integer, nullable=False)
    personnel_level_at_assessment: Mapped[int] = mapped_column(Integer, nullable=False)
    assessment_period: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    assessed_by: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False, index=True)
    overall_result: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(Text)
    training_content: Mapped[str | None] = mapped_column(Text)
    is_latest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    personnel: Mapped[Personnel] = relationship("Personnel", back_populates="assessments")
    framework: Mapped[CompetencyFramework] = relationship("CompetencyFramework", back_populates="assessments")
    items: Mapped[list["AssessmentItem"]] = relationship(
        "AssessmentItem",
        back_populates="assessment",
        cascade="all, delete-orphan",
    )


class AssessmentItem(Base):
    __tablename__ = "assessment_items"
    __table_args__ = (UniqueConstraint("assessment_id", "item_id", name="uq_assessment_item"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("etassitem"))
    assessment_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("competency_assessments.id"),
        nullable=False,
        index=True,
    )
    item_id: Mapped[str] = mapped_column(String, ForeignKey("competency_items.id"), nullable=False, index=True)
    required_score: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_score: Mapped[int | None] = mapped_column(Integer)
    gap: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    excluded_from_result: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    assessment: Mapped[CompetencyAssessment] = relationship("CompetencyAssessment", back_populates="items")
    competency_item: Mapped[CompetencyItem] = relationship("CompetencyItem", back_populates="assessment_items")


class LearningPlan(Base):
    __tablename__ = "learning_plans"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("etplan"))
    personnel_id: Mapped[str] = mapped_column(String, ForeignKey("personnel.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    duration_months: Mapped[int] = mapped_column(Integer, default=14, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    personnel: Mapped[Personnel] = relationship("Personnel", back_populates="learning_plans")
    items: Mapped[list["LearningPlanItem"]] = relationship(
        "LearningPlanItem",
        back_populates="plan",
        cascade="all, delete-orphan",
    )


class LearningPlanItem(Base):
    __tablename__ = "learning_plan_items"
    __table_args__ = (UniqueConstraint("plan_id", "item_id", name="uq_plan_item"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: make_id("etplanitem"))
    plan_id: Mapped[str] = mapped_column(String, ForeignKey("learning_plans.id"), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String, ForeignKey("competency_items.id"), nullable=False, index=True)
    target_week: Mapped[int | None] = mapped_column(Integer)
    target_month: Mapped[int | None] = mapped_column(Integer)
    target_year: Mapped[int | None] = mapped_column(Integer)
    target_level: Mapped[int | None] = mapped_column(Integer)
    actual_level: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="not_started", nullable=False, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    plan: Mapped[LearningPlan] = relationship("LearningPlan", back_populates="items")
    competency_item: Mapped[CompetencyItem] = relationship("CompetencyItem", back_populates="learning_plan_items")
