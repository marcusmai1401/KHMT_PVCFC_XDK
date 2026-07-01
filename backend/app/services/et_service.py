from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.domain import User
from app.models.et_domain import (
    AssessmentItem,
    CompetencyAssessment,
    CompetencyFramework,
    CompetencyItem,
    LearningPlan,
    LearningPlanItem,
    Personnel,
    PersonnelHiddenRow,
)
from app.services.et_gap_calculator import (
    EXCLUDED_CATEGORY,
    calculate_framework_sum,
    calculate_gap,
    calculate_plan_week,
    calculate_progress_percentage,
    calculate_required_score,
    determine_overall_result,
    is_excluded_category,
)
from app.services.repositories import audit, model_to_dict, now_utc


class ETValidationError(Exception):
    def __init__(self, message: str, errors: list[dict[str, Any]] | None = None, status_code: int = 400):
        self.message = message
        self.errors = errors or []
        self.status_code = status_code
        super().__init__(message)


def serialize_item(item: CompetencyItem) -> dict[str, Any]:
    return model_to_dict(item)


def serialize_framework(framework: CompetencyFramework, include_items: bool = False) -> dict[str, Any]:
    data = model_to_dict(framework)
    if include_items:
        items = sorted(framework.items, key=lambda item: (item.category, item.stt, item.nlcm_code))
        data["items"] = [serialize_item(item) for item in items]
        data["level_sums"] = {str(level): calculate_framework_sum(items, level) for level in range(1, 9)}
    return data


def serialize_personnel(personnel: Personnel) -> dict[str, Any]:
    data = model_to_dict(personnel)
    data["source_type"] = "personnel"
    return data


def serialize_user_personnel(user: User) -> dict[str, Any]:
    return {
        "id": f"user:{user.id}",
        "employee_code": "",
        "full_name": user.full_name or user.display_name,
        "role": user.role,
        "position_code": "",
        "team": user.team or "",
        "current_level": None,
        "salary_grade": "",
        "hire_date": None,
        "status": "active" if user.is_active else "inactive",
        "user_id": user.id,
        "source_type": "user",
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


def serialize_assessment_item(item: AssessmentItem) -> dict[str, Any]:
    data = model_to_dict(item)
    competency = item.competency_item
    data.update(
        {
            "nlcm_code": competency.nlcm_code,
            "competency_name": competency.competency_name,
            "competency_detail": competency.competency_detail,
            "definition": competency.definition,
            "requirements_text": competency.requirements_text,
            "category": competency.category,
            "stt": competency.stt,
        }
    )
    return data


def serialize_assessment(assessment: CompetencyAssessment, include_items: bool = True) -> dict[str, Any]:
    data = model_to_dict(assessment)
    data["personnel"] = serialize_personnel(assessment.personnel)
    data["framework"] = serialize_framework(assessment.framework)
    if include_items:
        data["items"] = [
            serialize_assessment_item(item)
            for item in sorted(assessment.items, key=lambda row: row.competency_item.stt)
        ]
        scored = [item for item in assessment.items if not item.excluded_from_result and item.actual_score is not None]
        relevant = [item for item in assessment.items if not item.excluded_from_result]
        data["summary"] = {
            "total_items": len(relevant),
            "scored_items": len(scored),
            "achieved_items": sum(1 for item in relevant if item.gap is not None and item.gap >= 0),
            "gap_items": sum(1 for item in relevant if item.gap is not None and item.gap < 0),
            "overall_result": assessment.overall_result,
        }
    return data


def serialize_learning_plan_item(item: LearningPlanItem) -> dict[str, Any]:
    data = model_to_dict(item)
    competency = item.competency_item
    data.update(
        {
            "nlcm_code": competency.nlcm_code,
            "competency_name": competency.competency_name,
            "competency_detail": competency.competency_detail,
            "definition": competency.definition,
            "requirements_text": competency.requirements_text,
            "category": competency.category,
            "stt": competency.stt,
        }
    )
    return data


def serialize_learning_plan(plan: LearningPlan, include_items: bool = True) -> dict[str, Any]:
    data = model_to_dict(plan)
    data["personnel"] = serialize_personnel(plan.personnel)
    if include_items:
        data["items"] = [
            serialize_learning_plan_item(item)
            for item in sorted(plan.items, key=lambda row: (row.competency_item.category, row.target_week or 9999))
        ]
        completed = sum(1 for item in plan.items if item.status == "completed")
        total = len(plan.items)
        overdue = sum(
            1
            for item in plan.items
            if item.status != "completed" and item.target_week and _target_date(plan.start_date, item.target_week) < date.today()
        )
        data["progress"] = {
            "completed_items": completed,
            "total_items": total,
            "completion_percentage": calculate_progress_percentage(plan.items),
            "overdue_items": overdue,
            "status": "behind_schedule" if overdue else "on_track",
        }
    return data


def list_frameworks(db: Session) -> list[CompetencyFramework]:
    return db.execute(select(CompetencyFramework).order_by(CompetencyFramework.code, CompetencyFramework.version)).scalars().all()


def get_framework(db: Session, framework_id: str) -> CompetencyFramework:
    framework = db.execute(
        select(CompetencyFramework).options(selectinload(CompetencyFramework.items)).where(CompetencyFramework.id == framework_id)
    ).scalar_one_or_none()
    if framework is None:
        raise ETValidationError("Framework not found", status_code=404)
    return framework


def get_active_framework_for_position(db: Session, position_code: str) -> CompetencyFramework:
    framework = db.execute(
        select(CompetencyFramework)
        .options(selectinload(CompetencyFramework.items))
        .where(CompetencyFramework.code == position_code, CompetencyFramework.is_active.is_(True))
        .order_by(CompetencyFramework.version.desc())
    ).scalar_one_or_none()
    if framework is None:
        raise ETValidationError(
            "Active competency framework not found",
            [{"field": "position_code", "message": f"No active framework for {position_code}"}],
            status_code=404,
        )
    return framework


def create_framework(db: Session, data: Any, actor: str) -> CompetencyFramework:
    payload = _dump(data)
    code = str(payload["code"]).strip()
    version = _next_framework_version(db, code)
    framework = CompetencyFramework(
        code=code,
        title=str(payload["title"]).strip(),
        version=version,
        is_active=bool(payload.get("is_active", True)),
        created_by=actor,
    )
    if framework.is_active:
        _deactivate_other_frameworks(db, code)
    db.add(framework)
    db.flush()
    for item_data in payload.get("items", []):
        add_framework_item(db, framework.id, item_data, actor=None)
    audit(db, actor, "CompetencyFramework", framework.id, "create", serialize_framework(framework, include_items=True))
    return get_framework(db, framework.id)


def update_framework(db: Session, framework_id: str, data: Any, actor: str) -> CompetencyFramework:
    framework = get_framework(db, framework_id)
    before = serialize_framework(framework, include_items=True)
    payload = _dump(data, exclude_unset=True)
    if "code" in payload and payload["code"]:
        framework.code = str(payload["code"]).strip()
    if "title" in payload and payload["title"]:
        framework.title = str(payload["title"]).strip()
    if "is_active" in payload and payload["is_active"] is not None:
        framework.is_active = bool(payload["is_active"])
        if framework.is_active:
            _deactivate_other_frameworks(db, framework.code, except_id=framework.id)
    db.flush()
    audit(db, actor, "CompetencyFramework", framework.id, "update", {"before": before, "after": serialize_framework(framework, True)})
    return get_framework(db, framework.id)


def delete_framework(db: Session, framework_id: str, actor: str) -> None:
    framework = get_framework(db, framework_id)
    errors = []
    personnel_count = db.scalar(select(func.count()).select_from(Personnel).where(Personnel.position_code == framework.code)) or 0
    assessment_count = (
        db.scalar(select(func.count()).select_from(CompetencyAssessment).where(CompetencyAssessment.framework_id == framework.id))
        or 0
    )
    plan_count = (
        db.scalar(
            select(func.count())
            .select_from(LearningPlan)
            .join(Personnel, Personnel.id == LearningPlan.personnel_id)
            .where(Personnel.position_code == framework.code)
        )
        or 0
    )
    if personnel_count:
        errors.append({"message": f"Found {personnel_count} personnel linked to this position code"})
    if assessment_count:
        errors.append({"message": f"Found {assessment_count} assessments referencing this framework"})
    if plan_count:
        errors.append({"message": f"Found {plan_count} learning plans linked to this position code"})
    if errors:
        raise ETValidationError("Cannot delete framework with dependent records", errors, status_code=409)
    before = serialize_framework(framework, True)
    db.delete(framework)
    audit(db, actor, "CompetencyFramework", framework_id, "delete", {"before": before})


def duplicate_framework(db: Session, framework_id: str, actor: str) -> CompetencyFramework:
    source = get_framework(db, framework_id)
    version = _next_framework_version(db, source.code)
    duplicate = CompetencyFramework(
        code=source.code,
        title=source.title,
        version=version,
        is_active=False,
        created_by=actor,
    )
    db.add(duplicate)
    db.flush()
    for item in source.items:
        db.add(
            CompetencyItem(
                framework_id=duplicate.id,
                nlcm_code=item.nlcm_code,
                competency_name=item.competency_name,
                competency_detail=item.competency_detail,
                definition=item.definition,
                requirements_text=item.requirements_text,
                category=item.category,
                stt=item.stt,
                level_requirements=dict(item.level_requirements or {}),
                month_hold_level=item.month_hold_level,
                year_hold_level=item.year_hold_level,
                gap_reference=item.gap_reference,
            )
        )
    db.flush()
    audit(db, actor, "CompetencyFramework", duplicate.id, "duplicate", {"source_id": source.id, "version": version})
    return get_framework(db, duplicate.id)


def activate_framework(db: Session, framework_id: str, actor: str) -> CompetencyFramework:
    framework = get_framework(db, framework_id)
    _deactivate_other_frameworks(db, framework.code, except_id=framework.id)
    framework.is_active = True
    audit(db, actor, "CompetencyFramework", framework.id, "activate", {"code": framework.code, "version": framework.version})
    db.flush()
    return framework


def add_framework_item(db: Session, framework_id: str, data: Any, actor: str | None) -> CompetencyItem:
    framework = get_framework(db, framework_id)
    payload = _dump(data)
    nlcm_code = str(payload["nlcm_code"]).strip()
    _validate_level_requirements(payload.get("level_requirements") or {})
    existing = db.execute(
        select(CompetencyItem).where(CompetencyItem.framework_id == framework.id, CompetencyItem.nlcm_code == nlcm_code)
    ).scalar_one_or_none()
    if existing is not None:
        raise ETValidationError(
            "Competency item code already exists in framework",
            [{"field": "nlcm_code", "message": nlcm_code}],
            status_code=409,
        )
    item = CompetencyItem(
        framework_id=framework.id,
        nlcm_code=nlcm_code,
        competency_name=str(payload["competency_name"]).strip(),
        competency_detail=payload.get("competency_detail"),
        definition=payload.get("definition"),
        requirements_text=payload.get("requirements_text"),
        category=str(payload["category"]).strip(),
        stt=int(payload["stt"]),
        level_requirements={str(level): int(value) for level, value in (payload.get("level_requirements") or {}).items()},
        month_hold_level=payload.get("month_hold_level"),
        year_hold_level=payload.get("year_hold_level"),
        gap_reference=payload.get("gap_reference"),
    )
    db.add(item)
    db.flush()
    if actor:
        audit(db, actor, "CompetencyItem", item.id, "create", serialize_item(item))
    return item


def update_framework_item(db: Session, framework_id: str, item_id: str, data: Any, actor: str) -> CompetencyItem:
    get_framework(db, framework_id)
    item = _get_framework_item(db, framework_id, item_id)
    before = serialize_item(item)
    payload = _dump(data, exclude_unset=True)
    if "nlcm_code" in payload and payload["nlcm_code"]:
        nlcm_code = str(payload["nlcm_code"]).strip()
        duplicate = db.execute(
            select(CompetencyItem).where(
                CompetencyItem.framework_id == framework_id,
                CompetencyItem.nlcm_code == nlcm_code,
                CompetencyItem.id != item.id,
            )
        ).scalar_one_or_none()
        if duplicate:
            raise ETValidationError("Competency item code already exists in framework", status_code=409)
        item.nlcm_code = nlcm_code
    for field in [
        "competency_name",
        "competency_detail",
        "definition",
        "requirements_text",
        "category",
        "stt",
        "month_hold_level",
        "year_hold_level",
        "gap_reference",
    ]:
        if field in payload:
            setattr(item, field, payload[field])
    if "level_requirements" in payload and payload["level_requirements"] is not None:
        _validate_level_requirements(payload["level_requirements"])
        item.level_requirements = {str(level): int(value) for level, value in payload["level_requirements"].items()}
    db.flush()
    audit(db, actor, "CompetencyItem", item.id, "update", {"before": before, "after": serialize_item(item)})
    return item


def delete_framework_item(db: Session, framework_id: str, item_id: str, actor: str) -> None:
    item = _get_framework_item(db, framework_id, item_id)
    referenced = db.scalar(select(func.count()).select_from(AssessmentItem).where(AssessmentItem.item_id == item.id)) or 0
    if referenced:
        raise ETValidationError("Cannot delete item used by assessments", status_code=409)
    before = serialize_item(item)
    db.delete(item)
    audit(db, actor, "CompetencyItem", item.id, "delete", {"before": before})


def reorder_framework_items(db: Session, framework_id: str, orders: list[dict[str, Any]], actor: str) -> list[CompetencyItem]:
    get_framework(db, framework_id)
    items_by_id = {item.id: item for item in db.execute(select(CompetencyItem).where(CompetencyItem.framework_id == framework_id)).scalars()}
    for order in orders:
        item_id = str(order.get("id") or order.get("item_id"))
        if item_id in items_by_id:
            items_by_id[item_id].stt = int(order["stt"])
    audit(db, actor, "CompetencyFramework", framework_id, "reorder_items", {"orders": orders})
    db.flush()
    return list(items_by_id.values())


def list_personnel(db: Session, filters: dict[str, Any] | None = None) -> list[Personnel]:
    hidden_ids = _hidden_source_ids(db, "personnel")
    statement = select(Personnel).order_by(Personnel.team, Personnel.full_name)
    if hidden_ids:
        statement = statement.where(Personnel.id.not_in(hidden_ids))
    filters = filters or {}
    if filters.get("team"):
        statement = statement.where(Personnel.team == filters["team"])
    if filters.get("position"):
        statement = statement.where(Personnel.position_code == filters["position"])
    if filters.get("level"):
        statement = statement.where(Personnel.current_level == int(filters["level"]))
    if filters.get("status"):
        statement = statement.where(Personnel.status == filters["status"])
    if filters.get("search"):
        term = f"%{filters['search']}%"
        statement = statement.where(
            or_(
                Personnel.full_name.ilike(term),
                Personnel.employee_code.ilike(term),
                Personnel.role.ilike(term),
                Personnel.team.ilike(term),
                Personnel.position_code.ilike(term),
                Personnel.status.ilike(term),
                Personnel.salary_grade.ilike(term),
                Personnel.user_id.ilike(term),
            )
        )
    return db.execute(statement).scalars().all()


def list_user_personnel_rows(db: Session, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    filters = filters or {}
    hidden_user_ids = _hidden_source_ids(db, "user")
    linked_user_ids = {
        user_id
        for user_id in db.execute(select(Personnel.user_id).where(Personnel.user_id.is_not(None))).scalars()
        if user_id
    }
    users = db.execute(select(User).order_by(User.team, User.display_name)).scalars().all()
    rows = [serialize_user_personnel(user) for user in users if user.id not in linked_user_ids and user.id not in hidden_user_ids]
    if filters.get("team"):
        rows = [row for row in rows if row["team"] == filters["team"]]
    if filters.get("position"):
        rows = [row for row in rows if row["role"] == filters["position"]]
    if filters.get("status"):
        rows = [row for row in rows if row["status"] == filters["status"]]
    if filters.get("search"):
        term = str(filters["search"]).casefold()
        rows = [
            row
            for row in rows
            if term in str(row["full_name"]).casefold()
            or term in str(row["user_id"]).casefold()
            or term in str(row["role"]).casefold()
            or term in str(row["team"]).casefold()
            or term in str(row["status"]).casefold()
            or term in str(row["salary_grade"]).casefold()
        ]
    return rows


def get_personnel(db: Session, personnel_id: str) -> Personnel:
    personnel = db.get(Personnel, personnel_id)
    if personnel is None:
        raise ETValidationError("Personnel not found", status_code=404)
    return personnel


def create_personnel(db: Session, data: Any, actor: str | None = None) -> Personnel:
    payload = _normalize_personnel_payload(_dump(data))
    if payload.get("current_level") is not None:
        _validate_level(payload["current_level"])
    if payload.get("position_code"):
        _validate_position_code_exists(db, payload["position_code"])
    if payload.get("employee_code") and db.execute(select(Personnel).where(Personnel.employee_code == payload["employee_code"])).scalar_one_or_none():
        raise ETValidationError("Employee code already exists", status_code=409)
    personnel = Personnel(**payload)
    db.add(personnel)
    db.flush()
    if personnel.user_id:
        _unhide_source(db, "user", personnel.user_id)
    if actor:
        audit(db, actor, "Personnel", personnel.id, "create", serialize_personnel(personnel))
    return personnel


def update_personnel(db: Session, personnel_id: str, data: Any, actor: str) -> Personnel:
    personnel = get_personnel(db, personnel_id)
    before = serialize_personnel(personnel)
    payload = _normalize_personnel_payload(_dump(data, exclude_unset=True))
    if "employee_code" in payload and payload["employee_code"] and payload["employee_code"] != personnel.employee_code:
        existing = db.execute(select(Personnel).where(Personnel.employee_code == payload["employee_code"])).scalar_one_or_none()
        if existing:
            raise ETValidationError("Employee code already exists", status_code=409)
    if "position_code" in payload and payload["position_code"]:
        _validate_position_code_exists(db, payload["position_code"])
    if "current_level" in payload and payload["current_level"] is not None:
        _validate_level(payload["current_level"])
    for field, value in payload.items():
        setattr(personnel, field, value)
    db.flush()
    audit(db, actor, "Personnel", personnel.id, "update", {"before": before, "after": serialize_personnel(personnel)})
    return personnel


def hide_personnel_row(db: Session, source_type: str, source_id: str, actor: str) -> PersonnelHiddenRow:
    if source_type not in {"personnel", "user"}:
        raise ETValidationError("Unsupported personnel source type", status_code=400)
    if source_type == "personnel":
        get_personnel(db, source_id)
    else:
        if db.get(User, source_id) is None:
            raise ETValidationError("User not found", status_code=404)
    existing = db.execute(
        select(PersonnelHiddenRow).where(
            PersonnelHiddenRow.source_type == source_type,
            PersonnelHiddenRow.source_id == source_id,
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    row = PersonnelHiddenRow(source_type=source_type, source_id=source_id, hidden_by=actor)
    db.add(row)
    db.flush()
    audit(db, actor, "Personnel", source_id, "hide", {"source_type": source_type})
    return row


def bulk_update_personnel_level(db: Session, personnel_ids: list[str], current_level: int, actor: str) -> list[Personnel]:
    _validate_level(current_level)
    personnel = db.execute(select(Personnel).where(Personnel.id.in_(personnel_ids))).scalars().all()
    for row in personnel:
        before = row.current_level
        row.current_level = current_level
        audit(db, actor, "Personnel", row.id, "bulk_level_update", {"before": before, "after": current_level})
    db.flush()
    return personnel


def personnel_summary(db: Session) -> dict[str, Any]:
    rows = list_personnel(db)
    return {
        "total": len(rows),
        "by_position": dict(Counter(row.position_code or "N/A" for row in rows)),
        "by_team": dict(Counter(row.team or "N/A" for row in rows)),
        "by_level": {str(key): value for key, value in Counter(row.current_level if row.current_level is not None else "N/A" for row in rows).items()},
    }


def personnel_summary_with_users(db: Session) -> dict[str, Any]:
    personnel_rows = [serialize_personnel(row) for row in list_personnel(db)]
    rows = personnel_rows + list_user_personnel_rows(db)
    return {
        "total": len(rows),
        "by_position": dict(Counter(row.get("role") or row.get("position_code") or "N/A" for row in rows)),
        "by_team": dict(Counter(row.get("team") or "N/A" for row in rows)),
        "by_level": {str(key): value for key, value in Counter(row.get("salary_grade") or "N/A" for row in rows).items()},
    }


def create_assessment(db: Session, data: Any, actor: str) -> CompetencyAssessment:
    payload = _dump(data)
    personnel = get_personnel(db, payload["personnel_id"])
    if personnel.status != "active":
        raise ETValidationError("Assessment can only be created for active personnel")
    if not personnel.position_code or personnel.current_level is None:
        raise ETValidationError(
            "Personnel profile is incomplete",
            [
                {"field": "position_code", "message": "Position code is required for assessment"},
                {"field": "current_level", "message": "Current level is required for assessment"},
            ],
            status_code=422,
        )
    existing = db.execute(
        select(CompetencyAssessment).where(
            CompetencyAssessment.personnel_id == personnel.id,
            CompetencyAssessment.assessment_period == payload["assessment_period"],
        )
    ).scalar_one_or_none()
    if existing:
        raise ETValidationError("Assessment already exists for this period", status_code=409)
    framework = get_active_framework_for_position(db, personnel.position_code)
    assessment = CompetencyAssessment(
        personnel_id=personnel.id,
        framework_id=framework.id,
        framework_version=framework.version,
        personnel_level_at_assessment=personnel.current_level,
        assessment_period=payload["assessment_period"],
        assessed_by=actor,
        status="draft",
        overall_result=None,
        is_latest=False,
    )
    db.add(assessment)
    db.flush()
    _populate_assessment_items(assessment, framework.items, personnel.current_level)
    db.flush()
    audit(db, actor, "CompetencyAssessment", assessment.id, "create", serialize_assessment(assessment))
    return get_assessment(db, assessment.id)


def list_assessments(db: Session, filters: dict[str, Any] | None = None) -> list[CompetencyAssessment]:
    statement = (
        select(CompetencyAssessment)
        .options(
            selectinload(CompetencyAssessment.personnel),
            selectinload(CompetencyAssessment.framework),
            selectinload(CompetencyAssessment.items).selectinload(AssessmentItem.competency_item),
        )
        .join(Personnel, Personnel.id == CompetencyAssessment.personnel_id)
        .order_by(CompetencyAssessment.assessed_at.desc())
    )
    filters = filters or {}
    if filters.get("personnel_id"):
        statement = statement.where(CompetencyAssessment.personnel_id == filters["personnel_id"])
    if filters.get("team"):
        statement = statement.where(Personnel.team == filters["team"])
    if filters.get("period"):
        statement = statement.where(CompetencyAssessment.assessment_period == filters["period"])
    if filters.get("status"):
        statement = statement.where(CompetencyAssessment.status == filters["status"])
    return db.execute(statement).scalars().all()


def get_assessment(db: Session, assessment_id: str) -> CompetencyAssessment:
    assessment = db.execute(
        select(CompetencyAssessment)
        .options(
            selectinload(CompetencyAssessment.personnel),
            selectinload(CompetencyAssessment.framework),
            selectinload(CompetencyAssessment.items).selectinload(AssessmentItem.competency_item),
        )
        .where(CompetencyAssessment.id == assessment_id)
    ).scalar_one_or_none()
    if assessment is None:
        raise ETValidationError("Assessment not found", status_code=404)
    return assessment


def update_assessment(db: Session, assessment_id: str, data: Any, actor: str) -> CompetencyAssessment:
    assessment = get_assessment(db, assessment_id)
    before = serialize_assessment(assessment)
    payload = _dump(data, exclude_unset=True)
    if "notes" in payload:
        assessment.notes = payload["notes"]
    if "training_content" in payload:
        assessment.training_content = payload["training_content"]
    items_by_id = {item.id: item for item in assessment.items}
    for item_data in payload.get("items", []):
        item_id = item_data["id"]
        if item_id not in items_by_id:
            raise ETValidationError("Assessment item not found", [{"field": "id", "value": item_id}], status_code=404)
        row = items_by_id[item_id]
        if "actual_score" in item_data:
            _validate_actual_score(item_data["actual_score"])
            row.actual_score = item_data["actual_score"]
            row.gap = calculate_gap(row.actual_score, row.required_score)
        if "notes" in item_data:
            row.notes = item_data["notes"]
    assessment.overall_result = determine_overall_result(assessment.items)
    db.flush()
    audit(db, actor, "CompetencyAssessment", assessment.id, "update", {"before": before, "after": serialize_assessment(assessment)})
    return get_assessment(db, assessment.id)


def refresh_required_scores(db: Session, assessment_id: str, actor: str) -> CompetencyAssessment:
    assessment = get_assessment(db, assessment_id)
    if assessment.status != "draft":
        raise ETValidationError("Only draft assessments can refresh required scores", status_code=409)
    before = serialize_assessment(assessment)
    personnel = assessment.personnel
    framework = get_active_framework_for_position(db, personnel.position_code)
    existing_by_code = {item.competency_item.nlcm_code: item for item in assessment.items}
    assessment.framework_id = framework.id
    assessment.framework_version = framework.version
    assessment.personnel_level_at_assessment = personnel.current_level
    assessment.items.clear()
    db.flush()
    for competency in sorted(framework.items, key=lambda row: row.stt):
        previous = existing_by_code.get(competency.nlcm_code)
        actual = previous.actual_score if previous else None
        required = calculate_required_score(competency.level_requirements, personnel.current_level)
        assessment.items.append(
            AssessmentItem(
                item_id=competency.id,
                required_score=required,
                actual_score=actual,
                gap=calculate_gap(actual, required),
                notes=previous.notes if previous else None,
                excluded_from_result=is_excluded_category(competency.category),
            )
        )
    assessment.overall_result = determine_overall_result(assessment.items)
    audit(db, actor, "CompetencyAssessment", assessment.id, "refresh_required_scores", {"before": before})
    db.flush()
    return get_assessment(db, assessment.id)


def submit_assessment(db: Session, assessment_id: str, actor: str) -> CompetencyAssessment:
    assessment = get_assessment(db, assessment_id)
    assessment.overall_result = determine_overall_result(assessment.items)
    if assessment.overall_result is None:
        raise ETValidationError("Assessment is not complete", status_code=409)
    previous = db.execute(
        select(CompetencyAssessment).where(
            CompetencyAssessment.personnel_id == assessment.personnel_id,
            CompetencyAssessment.status == "submitted",
            CompetencyAssessment.is_latest.is_(True),
            CompetencyAssessment.id != assessment.id,
        )
    ).scalars()
    for row in previous:
        row.is_latest = False
    assessment.status = "submitted"
    assessment.is_latest = True
    assessment.assessed_at = now_utc()
    audit(db, actor, "CompetencyAssessment", assessment.id, "submit", {"overall_result": assessment.overall_result})
    db.flush()
    return get_assessment(db, assessment.id)


def get_assessment_history(db: Session, personnel_id: str) -> list[CompetencyAssessment]:
    get_personnel(db, personnel_id)
    return list_assessments(db, {"personnel_id": personnel_id})


def compare_assessments(db: Session, left_id: str, right_id: str) -> dict[str, Any]:
    left = get_assessment(db, left_id)
    right = get_assessment(db, right_id)
    if left.personnel_id != right.personnel_id:
        raise ETValidationError("Assessments must belong to the same personnel", status_code=400)
    right_by_code = {item.competency_item.nlcm_code: item for item in right.items}
    rows = []
    for left_item in left.items:
        code = left_item.competency_item.nlcm_code
        right_item = right_by_code.get(code)
        rows.append(
            {
                "nlcm_code": code,
                "competency_name": left_item.competency_item.competency_name,
                "left_gap": left_item.gap,
                "right_gap": right_item.gap if right_item else None,
                "delta": (right_item.gap - left_item.gap) if right_item and right_item.gap is not None and left_item.gap is not None else None,
            }
        )
    return {"personnel": serialize_personnel(left.personnel), "left": serialize_assessment(left, False), "right": serialize_assessment(right, False), "rows": rows}


def list_learning_plans(db: Session, filters: dict[str, Any] | None = None) -> list[LearningPlan]:
    statement = (
        select(LearningPlan)
        .options(
            selectinload(LearningPlan.personnel),
            selectinload(LearningPlan.items).selectinload(LearningPlanItem.competency_item),
        )
        .join(Personnel, Personnel.id == LearningPlan.personnel_id)
        .order_by(LearningPlan.created_at.desc())
    )
    filters = filters or {}
    if filters.get("personnel_id"):
        statement = statement.where(LearningPlan.personnel_id == filters["personnel_id"])
    if filters.get("team"):
        statement = statement.where(Personnel.team == filters["team"])
    return db.execute(statement).scalars().all()


def get_learning_plan(db: Session, plan_id: str) -> LearningPlan:
    plan = db.execute(
        select(LearningPlan)
        .options(
            selectinload(LearningPlan.personnel),
            selectinload(LearningPlan.items).selectinload(LearningPlanItem.competency_item),
        )
        .where(LearningPlan.id == plan_id)
    ).scalar_one_or_none()
    if plan is None:
        raise ETValidationError("Learning plan not found", status_code=404)
    return plan


def create_learning_plan(db: Session, data: Any, actor: str) -> LearningPlan:
    payload = _dump(data)
    get_personnel(db, payload["personnel_id"])
    plan = LearningPlan(
        personnel_id=payload["personnel_id"],
        title=payload["title"],
        start_date=payload["start_date"],
        duration_months=payload.get("duration_months", 14),
        status=payload.get("status", "active"),
        created_by=actor,
    )
    db.add(plan)
    db.flush()
    for item_data in payload.get("items", []):
        _append_learning_plan_item(db, plan, item_data)
    audit(db, actor, "LearningPlan", plan.id, "create", serialize_learning_plan(plan))
    db.flush()
    return get_learning_plan(db, plan.id)


def update_learning_plan(db: Session, plan_id: str, data: Any, actor: str) -> LearningPlan:
    plan = get_learning_plan(db, plan_id)
    before = serialize_learning_plan(plan)
    payload = _dump(data, exclude_unset=True)
    for field in ["title", "start_date", "duration_months", "status"]:
        if field in payload:
            setattr(plan, field, payload[field])
    if payload.get("items") is not None:
        items_by_id = {item.id: item for item in plan.items}
        for item_data in payload["items"]:
            if item_data.get("id") and item_data["id"] in items_by_id:
                row = items_by_id[item_data["id"]]
                for field in ["target_week", "target_month", "target_year", "target_level", "actual_level", "status"]:
                    if field in item_data:
                        setattr(row, field, item_data[field])
            elif item_data.get("item_id"):
                _append_learning_plan_item(db, plan, item_data)
    audit(db, actor, "LearningPlan", plan.id, "update", {"before": before, "after": serialize_learning_plan(plan)})
    db.flush()
    return get_learning_plan(db, plan.id)


def auto_generate_learning_plan(db: Session, plan_id: str, data: Any, actor: str) -> LearningPlan:
    plan = get_learning_plan(db, plan_id)
    payload = _dump(data, exclude_unset=True)
    assessment = (
        get_assessment(db, payload["assessment_id"])
        if payload.get("assessment_id")
        else _latest_submitted_assessment(db, plan.personnel_id)
    )
    if assessment is None:
        raise ETValidationError("No submitted assessment found for personnel", status_code=404)
    if assessment.personnel_id != plan.personnel_id:
        raise ETValidationError("Assessment does not belong to learning plan personnel")
    plan.items.clear()
    db.flush()
    negative = [item for item in assessment.items if not item.excluded_from_result and item.gap is not None and item.gap < 0]
    non_negative = [item for item in assessment.items if not item.excluded_from_result and item.gap is not None and item.gap >= 0]
    negative.sort(key=lambda item: (item.gap, item.competency_item.stt))
    mark_completed = payload.get("mark_non_gap_completed", True)
    week = 1
    for row in negative:
        target = _target_date(plan.start_date, week)
        plan.items.append(
            LearningPlanItem(
                item_id=row.item_id,
                target_week=week,
                target_month=target.month,
                target_year=target.year,
                target_level=row.required_score,
                status="not_started",
            )
        )
        week += 1
    later_week = max(week, plan.duration_months * 4)
    for row in non_negative:
        target_week = week if not mark_completed else None
        target = _target_date(plan.start_date, target_week or later_week)
        plan.items.append(
            LearningPlanItem(
                item_id=row.item_id,
                target_week=target_week,
                target_month=target.month if target_week else None,
                target_year=target.year if target_week else None,
                target_level=row.required_score,
                actual_level=row.actual_score if mark_completed else None,
                status="completed" if mark_completed else "not_started",
                completed_at=now_utc() if mark_completed else None,
            )
        )
        if not mark_completed:
            week += 1
    audit(db, actor, "LearningPlan", plan.id, "auto_generate", {"assessment_id": assessment.id})
    db.flush()
    return get_learning_plan(db, plan.id)


def mark_plan_item_complete(db: Session, plan_id: str, item_id: str, actual_level: int | None, actor: str) -> LearningPlan:
    plan = get_learning_plan(db, plan_id)
    row = next((item for item in plan.items if item.id == item_id or item.item_id == item_id), None)
    if row is None:
        raise ETValidationError("Learning plan item not found", status_code=404)
    row.status = "completed"
    row.actual_level = actual_level
    row.completed_at = now_utc()
    audit(db, actor, "LearningPlan", plan.id, "complete_item", {"item_id": row.id, "actual_level": actual_level})
    db.flush()
    return get_learning_plan(db, plan.id)


def get_dashboard_summary(db: Session, filters: dict[str, Any] | None = None) -> dict[str, Any]:
    personnel_rows = _filtered_active_personnel(db, filters or {})
    personnel_ids = [person.id for person in personnel_rows]
    latest_by_personnel = _latest_submitted_assessments_by_personnel(db, personnel_ids)
    draft_personnel_ids = _draft_personnel_ids(db, personnel_ids)
    rows = []
    total_active = len(personnel_rows)
    result_counts = Counter()
    top_item_counter: Counter[str] = Counter()
    top_item_names: dict[str, str] = {}
    top_personnel = []
    for person in personnel_rows:
        latest = latest_by_personnel.get(person.id)
        draft_exists = person.id in draft_personnel_ids
        row = {
            "personnel_id": person.id,
            "employee_code": person.employee_code,
            "full_name": person.full_name,
            "team": person.team,
            "position_code": person.position_code,
            "current_level": person.current_level,
            "assessment_id": latest.id if latest else None,
            "status": "submitted" if latest else ("draft_only" if draft_exists else "not_assessed"),
            "overall_result": latest.overall_result if latest else ("Đang đánh giá" if draft_exists else "Chưa đánh giá"),
            "achieved_count": 0,
            "gap_count": 0,
            "total_gap": 0,
            "has_draft": draft_exists,
        }
        if latest:
            relevant = [item for item in latest.items if not item.excluded_from_result and item.gap is not None]
            row["achieved_count"] = sum(1 for item in relevant if item.gap >= 0)
            row["gap_count"] = sum(1 for item in relevant if item.gap < 0)
            row["total_gap"] = sum(item.gap or 0 for item in relevant)
            result_counts[latest.overall_result or "Chưa hoàn tất"] += 1
            for item in relevant:
                if item.gap < 0:
                    top_item_counter[item.competency_item.nlcm_code] += 1
                    top_item_names[item.competency_item.nlcm_code] = item.competency_item.competency_name
            top_personnel.append(row)
        elif draft_exists:
            result_counts["Đang đánh giá"] += 1
        else:
            result_counts["Chưa đánh giá"] += 1
        rows.append(row)
    if filters and filters.get("result"):
        rows = [row for row in rows if row["overall_result"] == filters["result"]]
    top_personnel.sort(key=lambda row: (row["gap_count"], -row["total_gap"]), reverse=True)
    return {
        "aggregate": {
            "total_active_personnel": total_active,
            "pass_count": result_counts["Đạt"],
            "pass_percentage": round((result_counts["Đạt"] / total_active) * 100, 2) if total_active else 0,
            "fail_count": result_counts["Không đạt"],
            "not_assessed_count": result_counts["Chưa đánh giá"],
            "draft_count": result_counts["Đang đánh giá"],
        },
        "rows": rows,
        "top_gap_items": [
            {"nlcm_code": code, "competency_name": top_item_names.get(code, code), "gap_personnel_count": count}
            for code, count in top_item_counter.most_common(5)
        ],
        "top_gap_personnel": top_personnel[:5],
    }


def get_heatmap_data(db: Session, filters: dict[str, Any] | None = None) -> dict[str, Any]:
    personnel_rows = _filtered_active_personnel(db, filters or {})
    personnel_ids = [person.id for person in personnel_rows]
    latest_by_personnel = _latest_submitted_assessments_by_personnel(db, personnel_ids)
    draft_personnel_ids = _draft_personnel_ids(db, personnel_ids)
    active_frameworks = db.execute(
        select(CompetencyFramework)
        .options(selectinload(CompetencyFramework.items))
        .where(CompetencyFramework.is_active.is_(True))
        .order_by(CompetencyFramework.code)
    ).scalars().all()
    item_by_code: dict[str, CompetencyItem] = {}
    framework_codes: dict[str, set[str]] = defaultdict(set)
    for framework in active_frameworks:
        for item in framework.items:
            item_by_code.setdefault(item.nlcm_code, item)
            framework_codes[framework.code].add(item.nlcm_code)
    rows = []
    for code, item in sorted(item_by_code.items(), key=lambda pair: (pair[1].category, pair[1].stt, pair[0])):
        cells = []
        for person in personnel_rows:
            latest = latest_by_personnel.get(person.id)
            draft_exists = person.id in draft_personnel_ids
            if code not in framework_codes.get(person.position_code, set()):
                cells.append(_heatmap_cell(person, "not_applicable", "N/A"))
                continue
            if latest is None:
                cells.append(_heatmap_cell(person, "draft_only" if draft_exists else "not_assessed", "Đang đánh giá" if draft_exists else "Chưa đánh giá"))
                continue
            assessment_item = next((row for row in latest.items if row.competency_item.nlcm_code == code), None)
            if assessment_item is None:
                cells.append(_heatmap_cell(person, "not_applicable", "N/A"))
            elif assessment_item.excluded_from_result:
                cells.append(_heatmap_cell(person, "excluded", "Không đánh giá", assessment_item.gap, latest.id))
            elif assessment_item.gap is None:
                cells.append(_heatmap_cell(person, "not_scored", "Chưa chấm", None, latest.id))
            elif assessment_item.gap >= 0:
                cells.append(_heatmap_cell(person, "achieved", str(assessment_item.gap), assessment_item.gap, latest.id))
            elif assessment_item.gap == -1:
                cells.append(_heatmap_cell(person, "near_gap", "-1", -1, latest.id))
            else:
                cells.append(_heatmap_cell(person, "gap", str(assessment_item.gap), assessment_item.gap, latest.id))
        rows.append(
            {
                "nlcm_code": code,
                "competency_name": item.competency_name,
                "category": item.category,
                "cells": cells,
            }
        )
    return {"personnel": [serialize_personnel(person) for person in personnel_rows], "rows": rows}


def can_access_personnel(db: Session, principal: dict[str, str], personnel_id: str) -> bool:
    role = principal["role"]
    if role in {"Admin", "Workshop_Leader"}:
        return True
    if role == "Team_Account":
        personnel = db.get(Personnel, personnel_id)
        return bool(personnel and personnel.user_id == principal["user_id"])
    return False


def _populate_assessment_items(assessment: CompetencyAssessment, items: list[CompetencyItem], level: int) -> None:
    for item in sorted(items, key=lambda row: row.stt):
        assessment.items.append(
            AssessmentItem(
                item_id=item.id,
                required_score=calculate_required_score(item.level_requirements, level),
                actual_score=None,
                gap=None,
                excluded_from_result=is_excluded_category(item.category),
            )
        )


def _latest_submitted_assessment(db: Session, personnel_id: str) -> CompetencyAssessment | None:
    return db.execute(
        select(CompetencyAssessment)
        .options(
            selectinload(CompetencyAssessment.personnel),
            selectinload(CompetencyAssessment.framework),
            selectinload(CompetencyAssessment.items).selectinload(AssessmentItem.competency_item),
        )
        .where(CompetencyAssessment.personnel_id == personnel_id, CompetencyAssessment.status == "submitted")
        .order_by(CompetencyAssessment.is_latest.desc(), CompetencyAssessment.assessed_at.desc())
    ).scalars().first()


def _draft_exists(db: Session, personnel_id: str) -> bool:
    return bool(
        db.execute(
            select(CompetencyAssessment.id).where(
                CompetencyAssessment.personnel_id == personnel_id,
                CompetencyAssessment.status == "draft",
            )
        ).first()
    )


def _latest_submitted_assessments_by_personnel(
    db: Session, personnel_ids: list[str]
) -> dict[str, CompetencyAssessment]:
    """Bulk equivalent of calling _latest_submitted_assessment per personnel_id.

    Avoids one query per person (was O(N), and O(N*M) when called inside the
    heatmap's per-competency-item loop) by fetching all submitted assessments
    for the requested personnel in a single query, ordered the same way
    (is_latest desc, assessed_at desc) so the first row seen per personnel_id
    is the same "latest" row the per-person query would have returned.
    """
    if not personnel_ids:
        return {}
    assessments = db.execute(
        select(CompetencyAssessment)
        .options(
            selectinload(CompetencyAssessment.personnel),
            selectinload(CompetencyAssessment.framework),
            selectinload(CompetencyAssessment.items).selectinload(AssessmentItem.competency_item),
        )
        .where(
            CompetencyAssessment.personnel_id.in_(personnel_ids),
            CompetencyAssessment.status == "submitted",
        )
        .order_by(
            CompetencyAssessment.personnel_id,
            CompetencyAssessment.is_latest.desc(),
            CompetencyAssessment.assessed_at.desc(),
        )
    ).scalars().all()
    latest_by_personnel: dict[str, CompetencyAssessment] = {}
    for assessment in assessments:
        latest_by_personnel.setdefault(assessment.personnel_id, assessment)
    return latest_by_personnel


def _draft_personnel_ids(db: Session, personnel_ids: list[str]) -> set[str]:
    """Bulk equivalent of calling _draft_exists per personnel_id."""
    if not personnel_ids:
        return set()
    return set(
        db.execute(
            select(CompetencyAssessment.personnel_id).where(
                CompetencyAssessment.personnel_id.in_(personnel_ids),
                CompetencyAssessment.status == "draft",
            )
        ).scalars()
    )


def _filtered_active_personnel(db: Session, filters: dict[str, Any]) -> list[Personnel]:
    statement = select(Personnel).where(Personnel.status == "active").order_by(Personnel.team, Personnel.full_name)
    hidden_ids = _hidden_source_ids(db, "personnel")
    if hidden_ids:
        statement = statement.where(Personnel.id.not_in(hidden_ids))
    statement = statement.where(Personnel.position_code.is_not(None), Personnel.current_level.is_not(None))
    if filters.get("team"):
        statement = statement.where(Personnel.team == filters["team"])
    if filters.get("position"):
        statement = statement.where(Personnel.position_code == filters["position"])
    if filters.get("level"):
        statement = statement.where(Personnel.current_level == int(filters["level"]))
    return db.execute(statement).scalars().all()


def _heatmap_cell(
    person: Personnel,
    state: str,
    display: str,
    gap: int | None = None,
    assessment_id: str | None = None,
) -> dict[str, Any]:
    return {
        "personnel_id": person.id,
        "assessment_id": assessment_id,
        "state": state,
        "display": display,
        "gap": gap,
    }


def _append_learning_plan_item(db: Session, plan: LearningPlan, item_data: dict[str, Any]) -> None:
    item = db.get(CompetencyItem, item_data["item_id"])
    if item is None:
        raise ETValidationError("Competency item not found", [{"field": "item_id", "value": item_data["item_id"]}], 404)
    if any(existing.item_id == item.id for existing in plan.items):
        return
    plan.items.append(
        LearningPlanItem(
            item_id=item.id,
            competency_item=item,
            target_week=item_data.get("target_week"),
            target_month=item_data.get("target_month"),
            target_year=item_data.get("target_year"),
            target_level=item_data.get("target_level"),
            actual_level=item_data.get("actual_level"),
            status=item_data.get("status", "not_started"),
        )
    )


def _get_framework_item(db: Session, framework_id: str, item_id: str) -> CompetencyItem:
    item = db.execute(
        select(CompetencyItem).where(CompetencyItem.framework_id == framework_id, CompetencyItem.id == item_id)
    ).scalar_one_or_none()
    if item is None:
        raise ETValidationError("Competency item not found", status_code=404)
    return item


def _next_framework_version(db: Session, code: str) -> int:
    max_version = db.scalar(select(func.max(CompetencyFramework.version)).where(CompetencyFramework.code == code))
    return int(max_version or 0) + 1


def _deactivate_other_frameworks(db: Session, code: str, except_id: str | None = None) -> None:
    statement = select(CompetencyFramework).where(CompetencyFramework.code == code, CompetencyFramework.is_active.is_(True))
    if except_id:
        statement = statement.where(CompetencyFramework.id != except_id)
    for framework in db.execute(statement).scalars():
        framework.is_active = False


def _hidden_source_ids(db: Session, source_type: str) -> set[str]:
    return set(
        db.execute(select(PersonnelHiddenRow.source_id).where(PersonnelHiddenRow.source_type == source_type))
        .scalars()
        .all()
    )


def _unhide_source(db: Session, source_type: str, source_id: str) -> None:
    row = db.execute(
        select(PersonnelHiddenRow).where(
            PersonnelHiddenRow.source_type == source_type,
            PersonnelHiddenRow.source_id == source_id,
        )
    ).scalar_one_or_none()
    if row is not None:
        db.delete(row)


def _normalize_personnel_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    for field in ["employee_code", "role", "position_code", "team", "salary_grade", "user_id"]:
        if field in normalized and normalized[field] is not None:
            value = str(normalized[field]).strip()
            normalized[field] = value or None
    if "full_name" in normalized and normalized["full_name"] is not None:
        normalized["full_name"] = str(normalized["full_name"]).strip()
    if "current_level" in normalized and normalized["current_level"] in {"", None}:
        normalized["current_level"] = None
    return normalized


def _validate_level(level: int) -> None:
    if int(level) < 1 or int(level) > 8:
        raise ETValidationError("Level must be between 1 and 8", [{"field": "current_level", "value": level}])


def _validate_position_code_exists(db: Session, position_code: str) -> None:
    exists = db.execute(select(CompetencyFramework.id).where(CompetencyFramework.code == position_code)).first()
    if not exists:
        raise ETValidationError("Position code does not reference an existing framework", [{"field": "position_code", "value": position_code}])


def _validate_level_requirements(requirements: dict[str, Any]) -> None:
    for key, value in requirements.items():
        if str(key) not in {str(level) for level in range(1, 9)}:
            raise ETValidationError("Level requirement key must be 1 through 8", [{"field": "level_requirements", "value": key}])
        if value is None or int(value) < 0:
            raise ETValidationError("Level requirement values must be non-negative integers", [{"field": "level_requirements", "value": value}])


def _validate_actual_score(actual_score: int | None) -> None:
    if actual_score is None:
        return
    if int(actual_score) < 0 or int(actual_score) > 5:
        raise ETValidationError("Actual score must be between 0 and 5", [{"field": "actual_score", "value": actual_score}])


def _target_date(start_date: date, target_week: int) -> date:
    return start_date + timedelta(days=max(int(target_week) - 1, 0) * 7)


def _dump(data: Any, exclude_unset: bool = False) -> dict[str, Any]:
    if hasattr(data, "model_dump"):
        return data.model_dump(exclude_unset=exclude_unset)
    if isinstance(data, dict):
        return dict(data)
    return dict(data)
