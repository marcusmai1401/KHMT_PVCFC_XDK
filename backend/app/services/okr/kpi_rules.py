from typing import Any

from app.services.okr.constants import TEAM_DISPLAY_NAMES, TEAMS
from app.services.okr.rules import normalize_assessment


def _periods_ending(month: int, year: int, count: int) -> list[tuple[int, int]]:
    periods: list[tuple[int, int]] = []
    current_month = month
    current_year = year
    for _ in range(count):
        periods.append((current_month, current_year))
        current_month -= 1
        if current_month == 0:
            current_month = 12
            current_year -= 1
    return periods


def kpi_rule_periods(month: int, year: int) -> list[tuple[int, int]]:
    return _periods_ending(month, year, 4)


def _monthly_assessment(report: dict[str, Any]) -> str:
    team_level = report.get("team_level") or {}
    return normalize_assessment(team_level.get("monthly_assessment")) or ""


def _is_good_or_better(assessment: str) -> bool:
    # TCĐG defines "Hoàn thành xuất sắc" as "Hoàn thành tốt" plus extra conditions.
    return assessment in {"Hoàn thành tốt", "Hoàn thành xuất sắc"}


def _triggered_rules(current_assessment: str, good_or_better_streak: int) -> list[dict[str, Any]]:
    rules: list[dict[str, Any]] = []
    if current_assessment == "Hoàn thành xuất sắc":
        rules.append(
            {
                "rule": "NTĐG 9",
                "grade": "A1",
                "quantity": 1,
                "reason": "Đội/tổ hoàn thành xuất sắc nhiệm vụ",
            }
        )
    if good_or_better_streak >= 2:
        rules.append(
            {
                "rule": "NTĐG 10",
                "grade": "A2",
                "quantity": 1,
                "reason": "Đội/tổ hoàn thành tốt nhiệm vụ trong 02 tháng liên tiếp",
            }
        )
    if good_or_better_streak >= 4:
        rules.append(
            {
                "rule": "NTĐG 11",
                "grade": "A1",
                "quantity": 1,
                "reason": "Đội/tổ hoàn thành tốt nhiệm vụ trong 04 tháng liên tiếp",
            }
        )
    return rules


def build_leader_kpi_allocations(team_reports: list[dict[str, Any]], month: int, year: int) -> list[dict[str, Any]]:
    by_team_period: dict[tuple[str, int, int], str] = {}
    for report in team_reports:
        team = report.get("team")
        report_month = report.get("report_month")
        report_year = report.get("report_year")
        if team not in TEAMS or not report_month or not report_year:
            continue
        by_team_period[(team, int(report_month), int(report_year))] = _monthly_assessment(report)

    periods = _periods_ending(month, year, 4)
    rows: list[dict[str, Any]] = []
    for team in TEAMS:
        history = []
        good_or_better_streak = 0
        still_counting = True
        for period_month, period_year in periods:
            assessment = by_team_period.get((team, period_month, period_year), "")
            normalized = normalize_assessment(assessment) or ""
            history.append({"month": period_month, "year": period_year, "assessment": normalized})
            if still_counting and _is_good_or_better(normalized):
                good_or_better_streak += 1
            else:
                still_counting = False

        current_assessment = history[0]["assessment"] if history else ""
        rules = _triggered_rules(current_assessment, good_or_better_streak)
        reserved_a1 = 1 if any(rule["grade"] == "A1" for rule in rules) else 0
        reserved_a2 = 1 if any(rule["grade"] == "A2" for rule in rules) else 0
        cap_note = ""
        if team == "TCĐK" and reserved_a1 + reserved_a2 > 1:
            reserved_a2 = 0
            cap_note = "Tổ trực ca chỉ tính 01 chỉ tiêu; ưu tiên A1 khi nhiều nguyên tắc cùng kích hoạt."

        rows.append(
            {
                "team": team,
                "team_name": TEAM_DISPLAY_NAMES[team],
                "current_assessment": current_assessment,
                "good_or_better_streak_months": good_or_better_streak,
                "a1": reserved_a1,
                "a2": reserved_a2,
                "triggered_rules": rules,
                "history": history,
                "cap_note": cap_note,
            }
        )
    return rows


def summarize_leader_kpi_allocations(allocations: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "A1": sum(int(row.get("a1") or 0) for row in allocations),
        "A2": sum(int(row.get("a2") or 0) for row in allocations),
    }
