from datetime import date, datetime, timezone
from io import BytesIO

from openpyxl import load_workbook

from app.models.domain import (
    FIMonthlyAllocationModel,
    FIPeriodWriteGuardModel,
    HistoricalSnapshotModel,
    SKCTKTModel,
    TeamReportModel,
)
from app.services.fi.dashboard_matrix import (
    build_fi_dashboard_matrix_payload,
    get_fi_dashboard_cell,
    get_fi_dashboard_pool,
)
from app.services.fi.period_guard import lock_period_state, mark_period_locked
from app.services.fi.service import (
    assign_khmt,
    build_fi_report_export_filters,
    create_sk_ctkt,
    export_fi_reports_to_excel,
    fi_dashboard,
    transition_sk_ctkt,
)
from app.services.repositories import model_to_dict


def _make_sk(
    db,
    *,
    team: str,
    title: str,
    reg_month: int,
    reg_year: int = 2026,
    approve: bool = True,
    khmt_month: int | None = None,
    khmt_year: int | None = None,
    actor: str = "u1",
) -> SKCTKTModel:
    record = create_sk_ctkt(
        db,
        {
            "author_name": f"Author {title}",
            "author_user_id": actor,
            "team": team,
            "title": title,
            "content_description": f"Content for {title}",
            "completion_plan": f"T{reg_month}/{reg_year}",
            "registration_month": reg_month,
            "registration_year": reg_year,
        },
        actor,
        submit_immediately=True,
    )
    if approve:
        record = transition_sk_ctkt(db, record.id, "approve", "fi1", "FI_Coordinator")
    if khmt_month is not None and khmt_year is not None:
        record = assign_khmt(db, record.id, khmt_month, khmt_year, "admin", "Admin")
    return record


def test_khmt_matrix_covers_all_12_months_and_separates_workshop_staff(db_session):
    _make_sk(db_session, team="TBCH", title="TBCH Jan", reg_month=1, khmt_month=1, khmt_year=2026)
    for idx in range(3):
        _make_sk(db_session, team="TBĐL", title=f"TBDL Mar {idx}", reg_month=3, khmt_month=3, khmt_year=2026)
    # 4th manual FI in August -> triggers soft warning quota_status == "excess"
    for idx in range(4):
        _make_sk(db_session, team="TCĐK", title=f"TCDK Aug {idx}", reg_month=8, khmt_month=8, khmt_year=2026)
    # Unassigned approved pool item & pending item for TBHTĐK
    _make_sk(db_session, team="TBHTĐK", title="TBHTDK Pool", reg_month=5, approve=True)
    _make_sk(db_session, team="TBHTĐK", title="TBHTDK Pending", reg_month=6, approve=False)
    # Non-OKR team record
    _make_sk(db_session, team="Workshop_Staff", title="Workshop Idea", reg_month=7, approve=False)

    # Lock TBĐL month 3 and add a report assessment for TBCH month 2 ("Không hoàn thành") and TBCH month 1 ("Hoàn thành tốt")
    mark_period_locked(lock_period_state(db_session, "TBĐL", 3, 2026), "admin", "Chốt T3")
    db_session.add(
        TeamReportModel(
            id="rep-tbch-1",
            team="TBCH",
            report_month=1,
            report_year=2026,
            file_name="tbch-1.xlsx",
            file_path="/tmp/tbch-1.xlsx",
            file_hash="h1",
            uploaded_by="admin",
            report_status="submitted",
            is_current_version=True,
            team_level={"monthly_assessment": "Hoàn thành tốt"},
        )
    )
    db_session.add(
        HistoricalSnapshotModel(
            id="snap-tbch-2",
            source_file_name="hist.xlsx",
            source_file_hash="sh1",
            source_sheet="Dash",
            source_range="A1:Z1",
            team="TBCH",
            month=2,
            year=2026,
            monthly_assessment="Không HT",
            imported_by="admin",
        )
    )
    # Month 4: TBCH rated "Không HT" (safety/discipline) still has 1 FI -> normal ("matched", no warning)
    _make_sk(db_session, team="TBCH", title="TBCH Apr normal 1 FI", reg_month=4, khmt_month=4, khmt_year=2026)
    db_session.add(
        HistoricalSnapshotModel(
            id="snap-tbch-4",
            source_file_name="hist.xlsx",
            source_file_hash="sh2",
            source_sheet="Dash",
            source_range="A1:Z1",
            team="TBCH",
            month=4,
            year=2026,
            monthly_assessment="Không hoàn thành",
            imported_by="admin",
        )
    )
    db_session.commit()

    records = db_session.query(SKCTKTModel).all()
    payload = build_fi_dashboard_matrix_payload(db_session, records, year=2026, today=date(2026, 11, 23))

    matrix = payload["khmt_matrix"]
    assert matrix["okr_teams"] == ["TBCH", "TBĐL", "TBHTĐK", "TCĐK"]
    assert len(matrix["rows"]) == 4

    rows_by_team = {row["team"]: row for row in matrix["rows"]}

    tbch = rows_by_team["TBCH"]
    assert len(tbch["months"]) == 12
    # Month 1: 1 FI vs "Hoàn thành tốt" (quota 3) -> shortage
    assert tbch["months"][0]["count"] == 1
    assert tbch["months"][0]["kr_tier"] == "ok"
    assert tbch["months"][0]["required_count"] == 3
    assert tbch["months"][0]["quota_status"] == "shortage"
    # Month 2: 0 FI vs "Không HT" (quota 0) -> exempt_zero + matched
    assert tbch["months"][1]["count"] == 0
    assert tbch["months"][1]["kr_tier"] == "exempt_zero"
    assert tbch["months"][1]["quota_status"] == "matched"
    # Month 4: 1 FI vs "Không hoàn thành" (non-FI violation) -> ok + matched (normal, no ! warning)
    assert tbch["months"][3]["count"] == 1
    assert tbch["months"][3]["kr_tier"] == "ok"
    assert tbch["months"][3]["quota_status"] == "matched"
    # Month 11: current month, 0 FI -> none + missing_fi
    assert tbch["months"][10]["is_current_month"] is True
    assert tbch["months"][10]["kr_tier"] == "none"
    # Month 12: future month -> future
    assert tbch["months"][11]["is_future_month"] is True
    assert tbch["months"][11]["kr_tier"] == "future"

    tbdl = rows_by_team["TBĐL"]
    assert tbdl["months"][2]["count"] == 3
    assert tbdl["months"][2]["kr_tier"] == "good"
    assert tbdl["months"][2]["is_locked"] is True

    tcdk = rows_by_team["TCĐK"]
    assert tcdk["months"][7]["count"] == 4
    assert tcdk["months"][7]["kr_tier"] == "good"
    assert tcdk["months"][7]["quota_status"] == "excess"

    tbhtdk = rows_by_team["TBHTĐK"]
    assert tbhtdk["approved_unassigned_count"] == 1
    assert tbhtdk["pending_count"] == 1

    # Workshop_Staff separated cleanly into non_okr_summary
    assert len(matrix["non_okr_summary"]) == 1
    assert matrix["non_okr_summary"][0]["team"] == "Workshop_Staff"
    assert matrix["non_okr_summary"][0]["display_name"] == "Xưởng quản lí"
    assert matrix["non_okr_summary"][0]["pending_count"] == 1
    assert matrix["workshop_totals"]["year_khmt_total"] == 9
    assert matrix["workshop_totals"]["approved_unassigned_count"] == 1
    assert matrix["workshop_totals"]["pending_count"] == 1


def test_dashboard_cell_and_pool_permissions_and_ordering(db_session):
    older = _make_sk(db_session, team="TBCH", title="Older Pool", reg_month=2, approve=True)
    older.approved_at = datetime(2026, 2, 10, tzinfo=timezone.utc)
    newer = _make_sk(db_session, team="TBCH", title="Newer Pool", reg_month=4, approve=True)
    newer.approved_at = datetime(2026, 4, 10, tzinfo=timezone.utc)
    assigned = _make_sk(db_session, team="TBCH", title="Assigned Aug", reg_month=5, khmt_month=8, khmt_year=2026)
    db_session.commit()

    serializer = lambda rec, db: model_to_dict(rec)

    # Team_Account of TBCH can edit unlocked TBCH cell
    team_res = get_fi_dashboard_cell(
        db_session,
        team="TBCH",
        year=2026,
        month=8,
        mode="khmt",
        principal={"user_id": "linhln", "role": "Team_Account", "team": "TBCH"},
        serializer=serializer,
    )
    assert team_res["cell"]["can_edit_khmt"] is True
    assert [item["id"] for item in team_res["items"]] == [assigned.id]
    assert [item["id"] for item in team_res["available_pool"]] == [older.id, newer.id]

    # Team_Account of TBĐL cannot edit TBCH cell
    other_team_res = get_fi_dashboard_cell(
        db_session,
        team="TBCH",
        year=2026,
        month=8,
        mode="khmt",
        principal={"user_id": "haint", "role": "Team_Account", "team": "TBĐL"},
        serializer=serializer,
    )
    assert other_team_res["cell"]["can_edit_khmt"] is False

    # Workshop_Leader & Staff cannot edit
    leader_res = get_fi_dashboard_cell(
        db_session,
        team="TBCH",
        year=2026,
        month=8,
        mode="khmt",
        principal={"user_id": "kiaq", "role": "Workshop_Leader", "team": "Workshop_Staff"},
        serializer=serializer,
    )
    assert leader_res["cell"]["can_edit_khmt"] is False

    # Locking month 8 blocks even Admin
    mark_period_locked(lock_period_state(db_session, "TBCH", 8, 2026), "admin", "Đã chốt T8")
    db_session.commit()
    locked_res = get_fi_dashboard_cell(
        db_session,
        team="TBCH",
        year=2026,
        month=8,
        mode="khmt",
        principal={"user_id": "admin", "role": "Admin", "team": None},
        serializer=serializer,
    )
    assert locked_res["cell"]["is_locked"] is True
    assert locked_res["cell"]["can_edit_khmt"] is False

    # Pool endpoint returns unassigned approved items oldest-first
    pool = get_fi_dashboard_pool(
        db_session,
        team="TBCH",
        kind="unassigned_approved",
        principal={"user_id": "linhln", "role": "Team_Account", "team": "TBCH"},
        serializer=serializer,
    )
    assert pool["total"] == 2
    assert [item["id"] for item in pool["items"]] == [older.id, newer.id]


def test_fi_dashboard_backwards_compat_and_excel_export_contains_matrix(db_session):
    _make_sk(db_session, team="TBCH", title="Export SK 1", reg_month=6, khmt_month=6, khmt_year=2026)
    _make_sk(db_session, team="TBĐL", title="Export SK 2", reg_month=6, approve=True)

    dash = fi_dashboard(db_session, {"user_id": "admin", "role": "Admin"}, year=2026)
    assert {"generated_at", "teams", "totals", "khmt_by_month", "status_order", "khmt_matrix", "registration_matrix"}.issubset(dash.keys())
    assert dash["khmt_by_month"] == [{"year": 2026, "month": 6, "count": 1}]
    assert dash["khmt_matrix"]["workshop_totals"]["year_khmt_total"] == 1
    assert dash["khmt_matrix"]["workshop_totals"]["approved_unassigned_count"] == 1

    filters = build_fi_report_export_filters()
    path = export_fi_reports_to_excel(db_session, filters, matrix_year=2026)
    wb = load_workbook(path)
    assert set(wb.sheetnames) == {"Tong hop", "Du lieu FI"}
    summary = wb["Tong hop"]
    all_values = [cell.value for row in summary.iter_rows() for cell in row if cell.value is not None]
    assert any("MA TRẬN FI XÉT VÀO KHMT" in str(val) for val in all_values)
    assert "Tổng 4 đội/tổ" in all_values
    assert "T12" in all_values


def test_fi_history_disjunctive_facets_and_chronological_period_sorting(db_session):
    from app.api.routes.fi import fi_history

    # Seed across multiple teams and out-of-order KHMT months (T10, T1, T8, T3) + unassigned records
    _make_sk(db_session, team="TBHTĐK", title="HTDK T10", reg_month=6, khmt_month=10, khmt_year=2026)
    _make_sk(db_session, team="TBHTĐK", title="HTDK T1", reg_month=1, khmt_month=1, khmt_year=2026)
    for idx in range(3):
        _make_sk(db_session, team="TBHTĐK", title=f"HTDK T8-{idx}", reg_month=7, khmt_month=8, khmt_year=2026)
    _make_sk(db_session, team="TBHTĐK", title="HTDK T3", reg_month=3, khmt_month=3, khmt_year=2026)
    _make_sk(db_session, team="TBHTĐK", title="HTDK Unassigned", reg_month=7, approve=True)
    # Other teams also have items in T8/2026 (workshop total in T8 = 6, TBHTĐK only = 3)
    _make_sk(db_session, team="TBCH", title="TBCH T8", reg_month=7, khmt_month=8, khmt_year=2026)
    _make_sk(db_session, team="TBĐL", title="TBDL T8-1", reg_month=7, khmt_month=8, khmt_year=2026)
    _make_sk(db_session, team="TBĐL", title="TBDL T8-2", reg_month=7, khmt_month=8, khmt_year=2026)

    res = fi_history(
        teams="TBHTĐK",
        registration_month=None,
        registration_year=None,
        khmt="in",
        khmt_periods="2026-8",
        page=1,
        page_size=25,
        principal={"user_id": "admin", "role": "Admin"},
        db=db_session,
    )
    assert res["total"] == 3
    # Period facets reflect ONLY TBHTĐK (not workshop 6) and are strictly chronological T1 -> T3 -> T8 -> T10
    assert res["facets"]["periods"] == [
        {"month": 1, "year": 2026, "count": 1},
        {"month": 3, "year": 2026, "count": 1},
        {"month": 8, "year": 2026, "count": 3},
        {"month": 10, "year": 2026, "count": 1},
    ]
    # KHMT facet shows TBHTĐK's full in/out breakdown (6 in KHMT, 1 not in KHMT) instead of collapsing out -> 0
    assert res["facets"]["khmt"] == {"in": 6, "out": 1}
    # Team facet excludes teams filter so user sees all teams matching T8/2026
    team_counts = {row["value"]: row["count"] for row in res["facets"]["teams"]}
    assert team_counts == {"TBCH": 1, "TBĐL": 2, "TBHTĐK": 3}
