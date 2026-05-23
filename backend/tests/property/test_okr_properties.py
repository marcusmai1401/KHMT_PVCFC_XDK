from hypothesis import given, settings as hyp_settings, strategies as st

from app.services.okr.constants import TEAMS
from app.services.okr.chart_blocks import build_chart_blocks
from app.services.okr.dashboard import (
    build_dashboard_matrix,
    build_dashboard_view,
    build_empty_data_sheet,
    populate_data_sheet_from_reports,
)
from app.services.okr.evaluation_rules import classify_dashboard_assessment
from app.services.okr.objective_sections import resolve_indicator_value
from app.services.okr.objective_types import REQUIRED_VISUAL_KINDS_BY_OBJECTIVE, VALID_DATA_STATES, VALID_OBJECTIVE_CODES, VALID_OBJECTIVE_STATUSES
from app.services.okr.period_resolver import resolve_default_period
from app.services.okr.rules import calculate_vhdn_eligible, map_to_dashboard_status


@given(
    st.sampled_from(["Hoàn thành tốt", "HT tốt", "Hoàn thành", "HT", "Không hoàn thành", "Không HT", "N/A"]),
    st.booleans(),
)
def test_assessment_mapping_is_deterministic(assessment: str, has_plan: bool):
    first = map_to_dashboard_status(assessment, has_plan)
    second = map_to_dashboard_status(assessment, has_plan)
    assert first == second
    assert first in {"GOOD", "OK", "NG", "#N/A"}


def test_no_plan_hoan_thanh_maps_ok():
    assert map_to_dashboard_status("Hoàn thành", has_plan=False) == "OK"
    assert map_to_dashboard_status("Không có kế hoạch", has_plan=False) == "#N/A"


def test_data_sheet_has_exact_shape():
    rows = build_empty_data_sheet()
    assert len(rows) == 142
    assert all(len(row) == 16 for row in rows)


def test_data_sheet_populates_required_blocks():
    rows = populate_data_sheet_from_reports(
        [
            {
                "team": "TBCH",
                "report_month": 4,
                "assessments": [
                    {
                        "workshop_kr_code": "O2.KR1",
                        "metrics": [{"actual": 10, "total": 12, "percentage": 83.3, "target": 98}],
                    },
                    {
                        "workshop_kr_code": "O5.KR12",
                        "metrics": [{"actual": 2, "total": 3, "percentage": 66.7, "target": 1}],
                    }
                ],
            }
        ]
    )

    assert rows[2][0] == "T1"
    assert rows[13][0] == "T12"
    assert rows[14][0] == "YTD"
    assert [rows[row][1] for row in range(15, 18)] == ["TBHTĐK", "TBCH", "TBĐL"]
    assert {rows[row][1] for row in range(20, 35)} == {"TCĐK"}
    assert [rows[row][2] for row in range(85, 89)] == ["O6.KR1"] * 4
    assert [rows[row][2] for row in range(90, 94)] == ["O6.KR2"] * 4
    assert rows[116][0] == "W14"
    assert rows[124][0] == "W22"
    assert [rows[row][1] for row in range(109, 113)] == list(TEAMS)
    assert {rows[row][2] for row in range(64, 84)} == {"O3.KR2"}
    assert {rows[row][2] for row in range(109, 114)} == {"O5.KR12"}
    assert {rows[row][2] for row in range(129, 142)} == {"O5.KR1"}
    assert rows[113][0] == "Total"


def test_dashboard_displays_only_four_teams():
    dashboard = build_dashboard_matrix([])
    assert [row["team"] for row in dashboard["teams"]] == list(TEAMS)
    assert dashboard["workshop_staff_displayed"] is False


def test_vhdn_fallback_creates_warning():
    eligible, warning = calculate_vhdn_eligible("TBCH")
    assert eligible == 13
    assert warning is not None
    assert warning["warning_type"] == "VHDN_ELIGIBLE_CALCULATED"


@given(st.booleans(), st.booleans(), st.sampled_from(["O6.KR1", "O6.KR2", "O5.KR13"]))
def test_property_evaluation_rule_fidelity(discipline_violation: bool, has_ng: bool, bonus_code: str):
    statuses = {"O1.KR1": "NG" if has_ng else "OK", bonus_code: "GOOD"}
    discipline = "NOK" if discipline_violation else "OK"

    result = classify_dashboard_assessment(statuses, discipline)

    if discipline_violation or has_ng:
        assert result == "Không HT"
    else:
        assert result == "HT tốt"


@given(st.integers(min_value=9, max_value=20))
def test_property_competency_excess_data_preserved(count: int):
    rows = [{"label": f"Position {index}", "value": index} for index in range(count)]

    blocks = build_chart_blocks(
        [],
        month=4,
        year=2026,
        historical_snapshots=[{"chart_payload": {"block_type": "competency", "rows": rows}}],
    )

    competency = blocks["competency"]
    assert len(competency["items"]) == 8
    assert len(competency["extra_items"]) == count - 8
    assert competency["warnings"][0]["warning_type"] == "COMPETENCY_EXCESS_POSITIONS"


@given(st.lists(st.integers(min_value=0, max_value=20), min_size=4, max_size=4))
def test_property_participation_rate_always_displayed(actuals: list[int]):
    reports = [
        {
            "team": team,
            "report_month": 4,
            "report_year": 2026,
            "assessments": [
                {
                    "workshop_kr_code": "O6.KR1",
                    "metrics": [{"actual": actual, "total": 20, "target": 0.5}],
                }
            ],
        }
        for team, actual in zip(TEAMS, actuals, strict=True)
    ]

    items = build_chart_blocks(reports, month=4, year=2026)["vhdn_running"]["items"]

    assert [item["team"] for item in items] == list(TEAMS)
    assert all(item["participation_target"] == 0.5 for item in items)
    assert [item["actual"] for item in items] == actuals


def test_property_missing_chart_data_keeps_null_until_explicit_zero():
    missing = [
        {
            "team": "TBCH",
            "report_month": 4,
            "report_year": 2026,
            "assessments": [{"workshop_kr_code": "O3.KR2", "metrics": []}],
        }
    ]
    explicit_zero = [
        {
            "team": "TBCH",
            "report_month": 4,
            "report_year": 2026,
            "assessments": [{"workshop_kr_code": "O3.KR2", "metrics": [{"actual": 0}]}],
        }
    ]

    assert build_chart_blocks(missing, month=4, year=2026, visible_teams=["TBCH"])["stop_by_team"]["datasets"][0]["data"] == [None]
    assert build_chart_blocks(explicit_zero, month=4, year=2026, visible_teams=["TBCH"])["stop_by_team"]["datasets"][0]["data"] == [0.0]


@given(st.lists(st.integers(min_value=1, max_value=12), unique=True))
@hyp_settings(max_examples=25, deadline=None)
def test_property_monthly_history_completeness(months: list[int]):
    reports = [
        {
            "team": "TBCH",
            "report_month": month,
            "report_year": 2026,
            "team_level": {"monthly_assessment": "Hoàn thành"},
            "assessments": [],
        }
        for month in months
    ]

    data = build_dashboard_view(
        4,
        2026,
        reports,
        history_reports=reports,
        principal={"role": "Team_Account", "user_id": "TBCH"},
    )

    history = next(row for row in data["monthly_history"] if row["team"] == "TBCH")["months"]
    assert len(history) == 12
    for item in history:
        if item["month"] in months:
            assert item["assessment"] == "HT"
            assert item["source"] == "db"
        else:
            assert item["assessment"] is None
            assert item["source"] is None


@given(st.integers(min_value=1, max_value=12))
def test_property_kr_summary_complete_coverage(count: int):
    master = [
        {
            "workshop_kr_code": f"O1.KR{index}",
            "kr_name": f"KR {index}",
            "dashboard_column": "L",
            "measurement_type": "Number",
            "target_value": str(index),
            "source_row": index,
        }
        for index in range(1, count + 1)
    ]

    data = build_dashboard_view(4, 2026, [], master=master)

    assert len(data["minor_okr_summary"]) == count
    assert [row["workshop_kr_code"] for row in data["minor_okr_summary"]] == [row["workshop_kr_code"] for row in master]


def test_property_numeric_metric_conditional_display():
    master = [
        {
            "workshop_kr_code": "O3.KR2",
            "kr_name": "STOP",
            "dashboard_column": "U",
            "measurement_type": "Number",
            "target_value": "200",
            "source_row": 1,
        },
        {
            "workshop_kr_code": "O6.KR4",
            "kr_name": "GapoWork",
            "dashboard_column": "AV",
            "measurement_type": "Status",
            "target_value": "1",
            "source_row": 2,
        },
    ]
    reports = [
        {
            "team": "TBCH",
            "report_month": 4,
            "report_year": 2026,
            "assessments": [
                {
                    "workshop_kr_code": "O3.KR2",
                    "dashboard_status": "OK",
                    "metrics": [{"actual": 10, "target": 200}],
                },
                {"workshop_kr_code": "O6.KR4", "dashboard_status": "OK", "metrics": []},
            ],
        }
    ]

    rows = build_dashboard_view(4, 2026, reports, master=master)["minor_okr_summary"]

    assert rows[0]["numeric_metric"] is not None
    assert rows[1]["numeric_metric"] is None


def test_property_unconfirmed_blocks_are_not_silent():
    data = build_dashboard_view(4, 2026, [])
    blocks = data["source_references"]["unconfirmed_blocks"]

    assert {block["source_range"] for block in blocks} == {"data!A117:D127"}
    assert all(block["mapping_status"] == "needs_confirmation" for block in blocks)
    assert any(warning["warning_type"] == "UNCONFIRMED_EXCEL_BLOCKS" for warning in data["warnings"])


period_strategy = st.one_of(st.none(), st.tuples(st.integers(min_value=1, max_value=12), st.integers(min_value=2020, max_value=2100)))


@given(period_strategy, period_strategy, period_strategy, st.tuples(st.integers(min_value=1, max_value=12), st.integers(min_value=2020, max_value=2100)))
@hyp_settings(max_examples=100, deadline=None)
def test_property_objective_period_resolver_priority(last_selected, latest_data, workbook, today):
    resolved = resolve_default_period(last_selected=last_selected, latest_data=latest_data, workbook=workbook, today=today)
    expected = last_selected or latest_data or workbook or today

    assert (resolved.month, resolved.year) == expected
    assert resolved.label == f"T{resolved.month}/{resolved.year}"
    assert resolve_default_period(last_selected=last_selected, latest_data=latest_data, workbook=workbook, today=today) == resolved


@given(
    st.one_of(st.none(), st.integers(min_value=0, max_value=100)),
    st.one_of(st.none(), st.integers(min_value=0, max_value=100)),
    st.one_of(st.none(), st.integers(min_value=0, max_value=100)),
    st.booleans(),
)
@hyp_settings(max_examples=100, deadline=None)
def test_property_objective_indicator_priority(locked, normalized, snapshot, has_plan):
    value, source, data_state = resolve_indicator_value(locked, normalized, snapshot, has_plan)

    if locked is not None:
        assert (value, source, data_state) == (locked, "db_locked", "ready")
    elif normalized is not None:
        assert (value, source, data_state) == (normalized, "normalized", "ready")
    elif snapshot is not None:
        assert (value, source, data_state) == (snapshot, "dashboard_snapshot", "ready")
    elif has_plan:
        assert (value, source, data_state) == (None, None, "no_data")
    else:
        assert (value, source, data_state) == (None, None, "no_plan")


@given(st.integers(min_value=1, max_value=12), st.integers(min_value=2020, max_value=2100))
@hyp_settings(max_examples=100, deadline=None)
def test_property_objective_sections_schema_and_required_kinds(month: int, year: int):
    data = build_dashboard_view(month, year, [], history_reports=[], historical_snapshots=[])
    sections = data["objective_sections"]

    assert [section["objective_code"] for section in sections] == list(VALID_OBJECTIVE_CODES)
    for section in sections:
        assert section["status"] in VALID_OBJECTIVE_STATUSES
        required_kinds = set(REQUIRED_VISUAL_KINDS_BY_OBJECTIVE[section["objective_code"]])
        actual_kinds = {visual["kind"] for visual in section["visuals"]}
        assert required_kinds.issubset(actual_kinds)
        for visual in section["visuals"]:
            assert visual["data_state"] in VALID_DATA_STATES
            if visual["data_state"] in {"no_plan", "no_data"}:
                assert visual["empty_message"]
            assert "EMPTY_CHART_DATA" not in str(visual.get("title"))
            assert "UNCONFIRMED_EXCEL_BLOCKS" not in str(visual.get("title"))
    assert any(warning["warning_type"] == "UNCONFIRMED_EXCEL_BLOCKS" for warning in data["warnings"])


@given(st.integers(min_value=0, max_value=20), st.integers(min_value=0, max_value=20))
def test_property_sk_and_ctkt_separation(sk_count: int, ctkt_count: int):
    reports = [
        {
            "team": "TBCH",
            "report_month": 4,
            "report_year": 2026,
            "assessments": [
                {"workshop_kr_code": "O5.KR12", "metrics": [{"actual": sk_count}]},
            ],
        }
    ]

    blocks = build_chart_blocks(
        reports,
        month=4,
        year=2026,
        visible_teams=["TBCH"],
        fi_counts_by_team={"TBCH": ctkt_count},
    )

    assert blocks["sk_initiatives"]["kr_code"] == "O5.KR12"
    assert blocks["ctkt_fi"]["kr_code"] == "O5.KR13"
    assert blocks["sk_initiatives"]["datasets"][0]["data"] == [float(sk_count)]
    assert blocks["ctkt_fi"]["datasets"][0]["data"] == [ctkt_count]
