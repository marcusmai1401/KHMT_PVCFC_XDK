from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.domain import SystemConfigModel, User
from app.models.et_domain import (
    AssessmentItem,
    CompetencyAssessment,
    CompetencyFramework,
    CompetencyItem,
    LearningPlanItem,
)
from app.services.repositories import audit


SEED_CONFIG_KEY = "pvcfc_knl_seed_commit"
SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "pvcfc_knl_seed.json"


def load_pvcfc_knl_seed_data() -> dict[str, Any]:
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def seed_pvcfc_knl_frameworks(db: Session, actor_id: str = "admin", force: bool = False) -> dict[str, Any]:
    data = load_pvcfc_knl_seed_data()
    source_commit = str(data["source_commit"])
    frameworks = list(data.get("frameworks") or [])

    marker = db.get(SystemConfigModel, SEED_CONFIG_KEY)
    if not force and marker and marker.value == source_commit and _snapshot_present(db, frameworks):
        return {"skipped": True, "source_commit": source_commit, "frameworks": 0, "items": 0}

    actor = _resolve_actor(db, actor_id)
    if actor is None:
        raise RuntimeError("Cannot seed PVCFC-KNL frameworks before at least one user exists")

    result = {"skipped": False, "source_commit": source_commit, "frameworks": 0, "items": 0, "versioned": 0}
    for framework_data in frameworks:
        framework, versioned = _get_or_create_seed_target(db, framework_data, actor, force=force)
        if versioned:
            result["versioned"] += 1
        _apply_framework_snapshot(db, framework, framework_data, actor, source_commit)
        result["frameworks"] += 1
        result["items"] += len(framework_data.get("items") or [])

    if marker is None:
        marker = SystemConfigModel(key=SEED_CONFIG_KEY, value=source_commit, updated_by=actor)
        db.add(marker)
    else:
        marker.value = source_commit
        marker.updated_by = actor
    db.flush()
    return result


def _snapshot_present(db: Session, frameworks: list[dict[str, Any]]) -> bool:
    for framework_data in frameworks:
        framework = db.execute(
            select(CompetencyFramework)
            .options(selectinload(CompetencyFramework.items))
            .where(
                CompetencyFramework.code == str(framework_data["code"]),
                CompetencyFramework.is_active.is_(True),
            )
            .order_by(CompetencyFramework.version.desc())
        ).scalar_one_or_none()
        if framework is None:
            return False
        expected_items = list(framework_data.get("items") or [])
        current_items = {item.nlcm_code: item for item in framework.items}
        if len(current_items) != len(expected_items):
            return False
        for item_data in expected_items:
            item = current_items.get(str(item_data["nlcm_code"]))
            if item is None:
                return False
            if item.definition != item_data.get("definition"):
                return False
            if item.requirements_text != item_data.get("requirements_text"):
                return False
    return True


def _resolve_actor(db: Session, actor_id: str) -> str | None:
    if db.get(User, actor_id):
        return actor_id
    return db.scalar(select(User.id).order_by(User.id))


def _get_or_create_seed_target(
    db: Session,
    framework_data: dict[str, Any],
    actor: str,
    *,
    force: bool,
) -> tuple[CompetencyFramework, bool]:
    code = str(framework_data["code"])
    current = db.execute(
        select(CompetencyFramework)
        .options(selectinload(CompetencyFramework.items))
        .where(CompetencyFramework.code == code, CompetencyFramework.is_active.is_(True))
        .order_by(CompetencyFramework.version.desc())
    ).scalar_one_or_none()
    if current is None:
        framework = CompetencyFramework(
            code=code,
            title=str(framework_data["title"]),
            version=_next_framework_version(db, code),
            is_active=True,
            created_by=actor,
        )
        db.add(framework)
        db.flush()
        return framework, False

    if not force and not _framework_has_seed_references(db, current):
        return current, False

    framework = CompetencyFramework(
        code=code,
        title=str(framework_data["title"]),
        version=_next_framework_version(db, code),
        is_active=True,
        created_by=actor,
    )
    current.is_active = False
    db.add(framework)
    db.flush()
    return framework, True


def _framework_has_seed_references(db: Session, framework: CompetencyFramework) -> bool:
    assessment_count = (
        db.scalar(
            select(func.count())
            .select_from(CompetencyAssessment)
            .where(CompetencyAssessment.framework_id == framework.id)
        )
        or 0
    )
    if assessment_count:
        return True
    item_ids = [item.id for item in framework.items]
    if not item_ids:
        return False
    assessment_item_count = (
        db.scalar(select(func.count()).select_from(AssessmentItem).where(AssessmentItem.item_id.in_(item_ids))) or 0
    )
    learning_plan_item_count = (
        db.scalar(select(func.count()).select_from(LearningPlanItem).where(LearningPlanItem.item_id.in_(item_ids))) or 0
    )
    return bool(assessment_item_count or learning_plan_item_count)


def _apply_framework_snapshot(
    db: Session,
    framework: CompetencyFramework,
    framework_data: dict[str, Any],
    actor: str,
    source_commit: str,
) -> None:
    framework.code = str(framework_data["code"])
    framework.title = str(framework_data["title"])
    framework.is_active = True
    _deactivate_other_versions(db, framework.code, framework.id)

    expected_codes = set()
    existing = {item.nlcm_code: item for item in framework.items}
    for item_data in framework_data.get("items") or []:
        nlcm_code = str(item_data["nlcm_code"])
        expected_codes.add(nlcm_code)
        item = existing.get(nlcm_code)
        if item is None:
            item = CompetencyItem(framework_id=framework.id, nlcm_code=nlcm_code)
            db.add(item)
        item.competency_name = str(item_data["competency_name"])
        item.competency_detail = item_data.get("competency_detail")
        item.definition = item_data.get("definition")
        item.requirements_text = item_data.get("requirements_text")
        item.category = str(item_data["category"])
        item.stt = int(item_data["stt"])
        item.level_requirements = {
            str(level): int(value or 0)
            for level, value in (item_data.get("level_requirements") or {}).items()
        }

    for item in list(framework.items):
        if item.nlcm_code not in expected_codes and not _item_is_referenced(db, item):
            db.delete(item)

    db.flush()
    audit(
        db,
        actor,
        "CompetencyFramework",
        framework.id,
        "seed_pvcfc_knl",
        {
            "source_commit": source_commit,
            "code": framework.code,
            "version": framework.version,
            "item_count": len(framework_data.get("items") or []),
        },
    )


def _item_is_referenced(db: Session, item: CompetencyItem) -> bool:
    assessment_item_count = (
        db.scalar(select(func.count()).select_from(AssessmentItem).where(AssessmentItem.item_id == item.id)) or 0
    )
    learning_plan_item_count = (
        db.scalar(select(func.count()).select_from(LearningPlanItem).where(LearningPlanItem.item_id == item.id)) or 0
    )
    return bool(assessment_item_count or learning_plan_item_count)


def _deactivate_other_versions(db: Session, code: str, keep_id: str) -> None:
    for framework in db.execute(
        select(CompetencyFramework).where(
            CompetencyFramework.code == code,
            CompetencyFramework.id != keep_id,
            CompetencyFramework.is_active.is_(True),
        )
    ).scalars():
        framework.is_active = False


def _next_framework_version(db: Session, code: str) -> int:
    current = db.scalar(select(func.max(CompetencyFramework.version)).where(CompetencyFramework.code == code))
    return int(current or 0) + 1
