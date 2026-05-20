from datetime import date

from app.services.et_gap_calculator import (
    calculate_gap,
    calculate_plan_week,
    calculate_progress_percentage,
    calculate_required_score,
    determine_overall_result,
)


def test_gap_calculation_allows_missing_actual_score():
    assert calculate_gap(None, 4) is None
    assert calculate_gap(5, 4) == 1
    assert calculate_gap(2, 4) == -2


def test_required_score_lookup_defaults_missing_levels_to_zero():
    assert calculate_required_score({"1": 2, "4": 5}, 4) == 5
    assert calculate_required_score({"1": 2, "4": 5}, 8) == 0


def test_overall_result_ignores_excluded_items_and_waits_for_incomplete_items():
    assert determine_overall_result([{"gap": -5, "excluded_from_result": True}, {"gap": 0}]) == "Đạt"
    assert determine_overall_result([{"gap": -1, "excluded_from_result": False}]) == "Không đạt"
    assert determine_overall_result([{"gap": None, "excluded_from_result": False}]) is None


def test_plan_week_and_progress_helpers():
    assert calculate_plan_week(date(2026, 4, 15), date(2026, 4, 15)) == 1
    assert calculate_plan_week(date(2026, 4, 15), date(2026, 4, 22)) == 2
    assert calculate_progress_percentage([{"status": "completed"}, {"status": "not_started"}]) == 50
