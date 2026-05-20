from __future__ import annotations

from datetime import date
from typing import Any, Iterable


EXCLUDED_CATEGORY = "Nghiệp vụ hành chính"
RESULT_PASS = "Đạt"
RESULT_FAIL = "Không đạt"
RESULT_INCOMPLETE = None


def is_excluded_category(category: str | None) -> bool:
    return (category or "").strip().casefold() == EXCLUDED_CATEGORY.casefold()


def calculate_gap(actual_score: int | None, required_score: int) -> int | None:
    if actual_score is None:
        return None
    return int(actual_score) - int(required_score)


def calculate_required_score(level_requirements: dict[str, Any] | None, level: int) -> int:
    requirements = level_requirements or {}
    value = requirements.get(str(level), requirements.get(level, 0))
    if value in (None, ""):
        return 0
    return int(value)


def determine_overall_result(items: Iterable[Any]) -> str | None:
    relevant = []
    for item in items:
        excluded = _get(item, "excluded_from_result", False)
        if excluded:
            continue
        gap = _get(item, "gap")
        if gap is None:
            return RESULT_INCOMPLETE
        relevant.append(int(gap))
    if not relevant:
        return RESULT_INCOMPLETE
    return RESULT_PASS if all(gap >= 0 for gap in relevant) else RESULT_FAIL


def calculate_framework_sum(items: Iterable[Any], level: int) -> int:
    total = 0
    for item in items:
        total += calculate_required_score(_get(item, "level_requirements", {}), level)
    return total


def calculate_plan_week(start_date: date, target_date: date) -> int:
    if target_date < start_date:
        return 1
    return ((target_date - start_date).days // 7) + 1


def calculate_progress_percentage(items: Iterable[Any]) -> float:
    rows = list(items)
    if not rows:
        return 0.0
    completed = sum(1 for item in rows if _get(item, "status") == "completed")
    return round((completed / len(rows)) * 100, 2)


def _get(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)
