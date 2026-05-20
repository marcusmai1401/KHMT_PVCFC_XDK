from app.services.okr.kpi_rules import build_leader_kpi_allocations, kpi_rule_periods
from app.services.okr.rules import map_to_dashboard_status, normalize_assessment


def _report(team: str, month: int, assessment: str) -> dict:
    return {
        "team": team,
        "report_month": month,
        "report_year": 2026,
        "team_level": {"monthly_assessment": assessment},
    }


def _by_team(rows: list[dict], team: str) -> dict:
    return next(row for row in rows if row["team"] == team)


def test_excellent_assessment_is_preserved_and_maps_to_good_status():
    assert normalize_assessment("Hoàn thành xuất sắc nhiệm vụ") == "Hoàn thành xuất sắc"
    assert map_to_dashboard_status("Hoàn thành xuất sắc") == "GOOD"


def test_ntdg_9_reserves_a1_for_excellent_team_leader():
    allocations = build_leader_kpi_allocations([_report("TBCH", 4, "Hoàn thành xuất sắc")], 4, 2026)
    row = _by_team(allocations, "TBCH")

    assert row["a1"] == 1
    assert row["a2"] == 0
    assert [rule["rule"] for rule in row["triggered_rules"]] == ["NTĐG 9"]


def test_ntdg_10_and_11_use_consecutive_good_or_better_history():
    reports = [
        _report("TBĐL", 1, "Hoàn thành tốt"),
        _report("TBĐL", 2, "Hoàn thành tốt"),
        _report("TBĐL", 3, "Hoàn thành tốt"),
        _report("TBĐL", 4, "Hoàn thành tốt"),
    ]

    row = _by_team(build_leader_kpi_allocations(reports, 4, 2026), "TBĐL")

    assert row["good_or_better_streak_months"] == 4
    assert row["a2"] == 1
    assert row["a1"] == 1
    assert [rule["rule"] for rule in row["triggered_rules"]] == ["NTĐG 10", "NTĐG 11"]


def test_shift_team_counts_only_one_reserved_quota_when_multiple_rules_trigger():
    reports = [_report("TCĐK", 3, "Hoàn thành tốt"), _report("TCĐK", 4, "Hoàn thành xuất sắc")]

    row = _by_team(build_leader_kpi_allocations(reports, 4, 2026), "TCĐK")

    assert row["a1"] == 1
    assert row["a2"] == 0
    assert row["cap_note"]


def test_kpi_rule_periods_cross_year_boundary():
    assert kpi_rule_periods(2, 2026) == [(2, 2026), (1, 2026), (12, 2025), (11, 2025)]
