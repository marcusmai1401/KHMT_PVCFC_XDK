from datetime import date, timedelta

from hypothesis import given, strategies as st

from app.services.et_gap_calculator import (
    calculate_framework_sum,
    calculate_gap,
    calculate_plan_week,
    calculate_progress_percentage,
    calculate_required_score,
    determine_overall_result,
)


@given(st.integers(min_value=0, max_value=100), st.integers(min_value=0, max_value=100))
def test_gap_identity(actual: int, required: int):
    assert calculate_gap(actual, required) == actual - required


@given(
    st.dictionaries(st.integers(min_value=1, max_value=8).map(str), st.integers(min_value=0, max_value=5)),
    st.integers(min_value=1, max_value=8),
)
def test_required_score_lookup_property(requirements: dict[str, int], level: int):
    assert calculate_required_score(requirements, level) == int(requirements.get(str(level), 0))


@given(
    st.lists(
        st.fixed_dictionaries(
            {
                "gap": st.one_of(st.none(), st.integers(min_value=-10, max_value=10)),
                "excluded_from_result": st.booleans(),
            }
        ),
        min_size=1,
    )
)
def test_overall_result_property(items: list[dict]):
    result = determine_overall_result(items)
    relevant = [item for item in items if not item["excluded_from_result"]]
    if not relevant or any(item["gap"] is None for item in relevant):
        assert result is None
    elif all(item["gap"] >= 0 for item in relevant):
        assert result == "Đạt"
    else:
        assert result == "Không đạt"


@given(
    st.lists(
        st.fixed_dictionaries(
            {
                "level_requirements": st.dictionaries(
                    st.integers(min_value=1, max_value=8).map(str),
                    st.integers(min_value=0, max_value=5),
                )
            }
        ),
        max_size=40,
    ),
    st.integers(min_value=1, max_value=8),
)
def test_framework_sum_property(items: list[dict], level: int):
    expected = sum(item["level_requirements"].get(str(level), 0) for item in items)
    assert calculate_framework_sum(items, level) == expected


@given(st.integers(min_value=0, max_value=500))
def test_plan_week_property(days_after_start: int):
    start = date(2026, 1, 1)
    target = start + timedelta(days=days_after_start)
    assert calculate_plan_week(start, target) == (days_after_start // 7) + 1


@given(st.lists(st.sampled_from(["completed", "not_started", "in_progress"]), max_size=50))
def test_progress_percentage_property(statuses: list[str]):
    items = [{"status": status} for status in statuses]
    result = calculate_progress_percentage(items)
    expected = round((statuses.count("completed") / len(statuses)) * 100, 2) if statuses else 0
    assert result == expected
