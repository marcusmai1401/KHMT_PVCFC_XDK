from datetime import datetime
from typing import Any

from sqlalchemy import Index, BigInteger, Boolean, DateTime, Integer, JSON, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    team: Mapped[str | None] = mapped_column(String)
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    session_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class KRMappingModel(Base):
    __tablename__ = "kr_mapping"

    workshop_kr_code: Mapped[str] = mapped_column(String, primary_key=True)
    kr_name: Mapped[str] = mapped_column(Text, nullable=False)
    dashboard_column: Mapped[str] = mapped_column(String, nullable=False)
    measurement_type: Mapped[str] = mapped_column(String, nullable=False)
    target_value: Mapped[str] = mapped_column(String, nullable=False, default="")
    source_row: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class TeamReportModel(Base):
    __tablename__ = "team_reports"
    __table_args__ = (
        Index("uq_report_current_draft", "team", "report_month", "report_year", unique=True,
              sqlite_where=text("is_current_version = true AND report_status = 'draft'"),
              postgresql_where=text("is_current_version = true AND report_status = 'draft'")),
        Index("uq_report_current_published", "team", "report_month", "report_year", unique=True,
              sqlite_where=text("is_current_version = true AND report_status IN ('submitted', 'locked')"),
              postgresql_where=text("is_current_version = true AND report_status IN ('submitted', 'locked')")),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    team: Mapped[str | None] = mapped_column(String, index=True)
    report_month: Mapped[int | None] = mapped_column(Integer, index=True)
    report_year: Mapped[int | None] = mapped_column(Integer, index=True)
    file_name: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    file_hash: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    # Optimistic-concurrency token. ``version`` remains the business/report version.
    revision: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    replaced_report_id: Mapped[str | None] = mapped_column(String)
    is_current_version: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    uploaded_by: Mapped[str] = mapped_column(String, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    sheet_name: Mapped[str | None] = mapped_column(String)
    validation_status: Mapped[str] = mapped_column(String, default="VALID")
    parsing_status: Mapped[str] = mapped_column(String, default="PARSED")
    team_month_assigned_manually: Mapped[bool] = mapped_column(Boolean, default=False)
    assessments: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    team_level: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    source_cell_references: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    source_type: Mapped[str] = mapped_column(
        String,
        default="excel_upload",
        server_default="excel_upload",
        nullable=False,
    )
    report_status: Mapped[str] = mapped_column(
        String,
        default="draft",
        server_default="draft",
        nullable=False,
        index=True,
    )
    arising_work: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON,
        default=list,
        server_default=text("'[]'"),
        nullable=False,
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(String)
    lock_reason: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_auto_save: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WarningModel(Base):
    __tablename__ = "warnings"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    team_report_id: Mapped[str | None] = mapped_column(String, index=True)
    warning_type: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, nullable=False)
    source_cell: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    extracted_value: Mapped[Any | None] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    admin_action: Mapped[str] = mapped_column(String, default="PENDING")
    admin_notes: Mapped[str | None] = mapped_column(Text)
    adjusted_value: Mapped[Any | None] = mapped_column(JSON)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class TeamMonthlySummaryModel(Base):
    __tablename__ = "team_monthly_summaries"
    __table_args__ = (UniqueConstraint("team", "month", "year", name="uq_team_month_year"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    team: Mapped[str] = mapped_column(String, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    discipline_status: Mapped[str] = mapped_column(String, default="OK")
    discipline_description: Mapped[str | None] = mapped_column(Text)
    related_kr: Mapped[str | None] = mapped_column(String)
    monthly_assessment: Mapped[str] = mapped_column(String, default="Hoàn thành")
    stats: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class HistoricalSnapshotModel(Base):
    __tablename__ = "historical_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "source_file_hash",
            "team",
            "month",
            "year",
            "source_range",
            name="uq_historical_snapshot_source_period_team_range",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    source_file_name: Mapped[str] = mapped_column(String, nullable=False)
    source_file_hash: Mapped[str] = mapped_column(String, nullable=False, index=True)
    source_sheet: Mapped[str] = mapped_column(String, nullable=False)
    source_range: Mapped[str] = mapped_column(String, nullable=False)
    source_label: Mapped[str | None] = mapped_column(String)
    team: Mapped[str] = mapped_column(String, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    monthly_assessment: Mapped[str | None] = mapped_column(String)
    kr_statuses: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    chart_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    warnings: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    imported_by: Mapped[str] = mapped_column(String, nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_historical_snapshot: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class SKCTKTModel(Base):
    __tablename__ = "sk_ctkt"
    __table_args__ = (
        Index("ix_fi_history_order", text("coalesce(created_at, submitted_at, updated_at) DESC"), text("id DESC")),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    sk_code: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    author_name: Mapped[str] = mapped_column(String, nullable=False)
    author_user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    team: Mapped[str] = mapped_column(String, nullable=False, index=True)
    content_description: Mapped[str] = mapped_column(Text, nullable=False)
    completion_plan: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"), nullable=False)
    status_history: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    fi_coordinator_comments: Mapped[str | None] = mapped_column(Text)
    workshop_leader_conclusion: Mapped[str | None] = mapped_column(Text)
    decision_note: Mapped[str | None] = mapped_column(Text)
    consider_for_khmt: Mapped[bool] = mapped_column(Boolean, default=False)
    khmt_month: Mapped[int | None] = mapped_column(Integer, index=True)
    khmt_year: Mapped[int | None] = mapped_column(Integer, index=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    is_counted_for_okr: Mapped[bool] = mapped_column(Boolean, default=False)
    is_historical_import: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    bm01_source_file: Mapped[str | None] = mapped_column(Text)
    bm01_source_sheet: Mapped[str | None] = mapped_column(String)
    bm01_source_row: Mapped[int | None] = mapped_column(Integer)
    bm01_raw_conclusion: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FIMonthlyAllocationModel(Base):
    __tablename__ = "fi_monthly_allocations"
    __table_args__ = (UniqueConstraint("team", "month", "year", name="uq_fi_allocation_team_period"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    team: Mapped[str] = mapped_column(String, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    assessment: Mapped[str] = mapped_column(String, nullable=False)
    required_count: Mapped[int] = mapped_column(Integer, nullable=False)
    allocated_count: Mapped[int] = mapped_column(Integer, nullable=False)
    available_count: Mapped[int] = mapped_column(Integer, nullable=False)
    selected_sk_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    released_sk_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    allocation_strategy: Mapped[str] = mapped_column(
        String,
        default="oldest_approved_first",
        server_default="oldest_approved_first",
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String,
        default="finalized",
        server_default="finalized",
        nullable=False,
        index=True,
    )
    report_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    report_version: Mapped[int] = mapped_column(Integer, nullable=False)
    finalized_by: Mapped[str] = mapped_column(String, nullable=False)
    finalized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class FIPeriodWriteGuardModel(Base):
    """One lock record for every FI/OKR team period that has been finalized."""

    __tablename__ = "fi_period_write_guards"
    __table_args__ = (UniqueConstraint("team", "month", "year", name="uq_fi_period_write_guard"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    team: Mapped[str] = mapped_column(String, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(String)
    lock_reason: Mapped[str | None] = mapped_column(Text)


class FITeamWriteGuardModel(Base):
    """Stable lock/revision row for the FI candidate pool of one team."""

    __tablename__ = "fi_team_write_guards"

    team: Mapped[str] = mapped_column(String, primary_key=True)
    revision: Mapped[int] = mapped_column(BigInteger, default=0, server_default=text("0"), nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class SKImageModel(Base):
    __tablename__ = "sk_images"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    sk_ctkt_id: Mapped[str] = mapped_column(String, nullable=False)
    file_name: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String)
    uploaded_by: Mapped[str] = mapped_column(String, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NotificationModel(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    recipient_role: Mapped[str | None] = mapped_column(String, index=True)
    recipient_user_id: Mapped[str | None] = mapped_column(String, index=True)
    event: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class NotificationReceiptModel(Base):
    __tablename__ = "notification_receipts"
    __table_args__ = (UniqueConstraint("notification_id", "user_id", name="uq_notification_receipt_user"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    notification_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class IdempotencyKeyModel(Base):
    __tablename__ = "idempotency_keys"
    __table_args__ = (UniqueConstraint("actor", "scope", "key", name="uq_idempotency_actor_scope_key"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    actor: Mapped[str] = mapped_column(String, nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String, nullable=False)
    key: Mapped[str] = mapped_column(String, nullable=False)
    request_hash: Mapped[str] = mapped_column(String, nullable=False)
    response: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, default=200)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserFeedbackModel(Base):
    __tablename__ = "user_feedback"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    feedback_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    build_id: Mapped[str | None] = mapped_column(String(100))
    consent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class AuditLogModel(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    actor: Mapped[str] = mapped_column(String, nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String, nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    changes: Mapped[Any | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class TeamHeadcountModel(Base):
    __tablename__ = "team_headcounts"
    __table_args__ = (UniqueConstraint("team", "effective_month", "effective_year", name="uq_headcount_effective"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    team: Mapped[str] = mapped_column(String, nullable=False)
    effective_month: Mapped[int] = mapped_column(Integer, default=1)
    effective_year: Mapped[int] = mapped_column(Integer, default=2026)
    total_headcount: Mapped[int] = mapped_column(Integer, nullable=False)
    vhdn_eligible_headcount: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VHDNExemptionModel(Base):
    __tablename__ = "vhdn_exemptions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    personnel_name: Mapped[str] = mapped_column(String, nullable=False)
    team: Mapped[str] = mapped_column(String, nullable=False)
    exemption_reason: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SystemConfigModel(Base):
    __tablename__ = "system_config"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    updated_by: Mapped[str | None] = mapped_column(String)


class TemplateModel(Base):
    __tablename__ = "templates"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    definition: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    updated_by: Mapped[str | None] = mapped_column(String)


class SKCodeSequenceModel(Base):
    __tablename__ = "sk_code_sequences"

    prefix: Mapped[str] = mapped_column(String, primary_key=True)
    next_value: Mapped[int] = mapped_column(Integer, default=1)
