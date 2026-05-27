from collections import defaultdict
from typing import Any

from app.services.okr.constants import TEAM_DISPLAY_NAMES, TEAMS
from app.services.okr.team_normalizer import normalize_team_label
from app.services.okr.objective_types import DataState, ObjectiveCode, ObjectiveSection, ObjectiveStatus, VisualBlock, VisualKind


OBJECTIVE_TITLES: dict[ObjectiveCode, str] = {
    "O1": "Không có sự cố gây dừng máy, mất sản lượng, lỗi chủ quan",
    "O2": "Đảm bảo tính ổn định thiết bị điều khiển",
    "O3": "Không có tai nạn và sự cố an toàn, sức khỏe, môi trường",
    "O4": "Triển khai các hạng mục cải tiến thuộc chuyên môn",
    "O5": "Triển khai các trụ cột TPM thuộc chuyên môn",
    "O6": "Văn hóa doanh nghiệp",
}

OBJECTIVE_CODES: tuple[ObjectiveCode, ...] = ("O1", "O2", "O3", "O4", "O5", "O6")
NO_DATA_MESSAGE = "Chưa có dữ liệu"
NO_PLAN_MESSAGE = "Không có KH trong tháng"


def resolve_indicator_value(
    locked_value: Any,
    normalized_value: Any,
    snapshot_value: Any,
    has_plan: bool,
) -> tuple[Any, str | None, DataState]:
    if locked_value is not None:
        return locked_value, "db_locked", "ready"
    if normalized_value is not None:
        return normalized_value, "normalized", "ready"
    if snapshot_value is not None:
        return snapshot_value, "dashboard_snapshot", "ready"
    return None, None, "no_data" if has_plan else "no_plan"


def _objective_from_code(code: str | None) -> ObjectiveCode | None:
    prefix = str(code or "").split(".KR", 1)[0]
    return prefix if prefix in OBJECTIVE_CODES else None  # type: ignore[return-value]


def _status_values_for_objective(matrix: dict[str, Any], objective_code: ObjectiveCode) -> list[str]:
    values: list[str] = []
    for team in matrix.get("teams", []):
        for code, status in (team.get("kr_statuses") or {}).items():
            if _objective_from_code(code) == objective_code and status and status != "#N/A":
                values.append(str(status).upper())
    return values


def _objective_status(matrix: dict[str, Any], objective_code: ObjectiveCode, has_period_data: bool) -> ObjectiveStatus:
    statuses = _status_values_for_objective(matrix, objective_code)
    if not statuses:
        return "no_data" if not has_period_data else "no_plan"
    failed = [status for status in statuses if status in {"NG", "NOK", "KHÔNG HT", "KHONG HT"}]
    passed = [status for status in statuses if status in {"OK", "GOOD", "HT", "HT TỐT", "HOÀN THÀNH", "HOAN THANH"}]
    if failed and not passed:
        return "failed"
    if failed:
        return "at_risk"
    return "completed"


def _snapshot_blocks(historical_snapshots: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    blocks: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for snapshot in historical_snapshots:
        payload = snapshot.get("chart_payload") or {}
        block_type = payload.get("block_type")
        if block_type:
            blocks[str(block_type)].append(payload)
    return dict(blocks)


def _period_has_snapshot(month: int, year: int, historical_snapshots: list[dict[str, Any]]) -> bool:
    return any(
        int(snapshot.get("month") or 0) == month and int(snapshot.get("year") or 0) == year
        for snapshot in historical_snapshots
    )


def _snapshots_for_year(year: int, historical_snapshots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        snapshot
        for snapshot in historical_snapshots
        if int(snapshot.get("year") or 0) == year
    ]


def _dataset_has_business_values(block: dict[str, Any] | None) -> bool:
    if not block:
        return False
    for dataset in block.get("datasets") or []:
        label = str(dataset.get("label") or "").lower()
        if "nhân sự" in label or "headcount" in label:
            continue
        for value in dataset.get("data") or []:
            if value is not None:
                return True
    for item in block.get("items") or []:
        for key in ("actual", "value", "participation_rate"):
            if item.get(key) is not None:
                return True
    return False


def _snapshot_has_rows(snapshot_blocks: dict[str, list[dict[str, Any]]], block_type: str) -> bool:
    for payload in snapshot_blocks.get(block_type, []):
        if payload.get("rows") or payload.get("items"):
            return True
    return False


def _rows_for_block(snapshot_blocks: dict[str, list[dict[str, Any]]], block_type: str) -> list[dict[str, Any]]:
    for payload in snapshot_blocks.get(block_type, []):
        rows = payload.get("rows") or []
        if rows:
            return rows
    return []


def _row_values(row: dict[str, Any]) -> list[Any]:
    values = row.get("values")
    return list(values) if isinstance(values, list) else []


def _value_at(row: dict[str, Any], index: int) -> Any:
    values = _row_values(row)
    return values[index] if index < len(values) else None


def _monthly_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_month: dict[int, dict[str, Any]] = {}
    for row in rows:
        label = str(row.get("label") or "").strip().upper()
        if label.startswith("T") and label[1:].isdigit():
            month = int(label[1:])
            if 1 <= month <= 12:
                by_month[month] = row
    return [by_month.get(month, {"label": f"T{month}", "values": [f"T{month}", None, None, None, None]}) for month in range(1, 13)]


def _summary_row(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    for row in rows:
        label = str(row.get("label") or "").strip().lower()
        if "lũy kế" in label or "luy ke" in label:
            return row
    for row in rows:
        if str(row.get("label") or "").strip():
            continue
        if any(_value_at(row, index) is not None for index in range(1, 5)):
            return row
    return None


def _month_row(rows: list[dict[str, Any]], month: int) -> dict[str, Any] | None:
    for row in rows:
        if str(row.get("label") or "").strip().upper() == f"T{month}":
            return row
    return None


def _team_rows(rows: list[dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    result: list[tuple[str, dict[str, Any]]] = []
    for row in rows:
        team, _label = normalize_team_label(str(row.get("label") or ""))
        if team:
            result.append((team, row))
    return result


def _notes_for_block(snapshot_blocks: dict[str, list[dict[str, Any]]], block_type: str) -> list[str]:
    for payload in snapshot_blocks.get(block_type, []):
        notes = payload.get("notes")
        if isinstance(notes, list):
            return [str(note) for note in notes if str(note).strip()]
    return []


def _metric_table_payload(
    *,
    rows: list[tuple[str, dict[str, Any]]],
    source_reference: str,
    actual_label: str,
    planned_label: str,
    rate_label: str,
    target_label: str,
    notes: list[str],
    summary_items: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "columns": [
            {"key": "team_name", "label": "Đội/Tổ"},
            {"key": "actual", "label": actual_label},
            {"key": "planned", "label": planned_label},
            {"key": "remaining", "label": "Còn lại"},
            {"key": "rate", "label": rate_label, "format": "percent"},
            {"key": "target", "label": target_label, "format": "percent"},
        ],
        "rows": [
            {
                "team": team,
                "team_name": TEAM_DISPLAY_NAMES.get(team, team),
                "actual": _value_at(row, 1),
                "planned": _value_at(row, 2),
                "remaining": (
                    _value_at(row, 2) - _value_at(row, 1)
                    if isinstance(_value_at(row, 1), (int, float)) and isinstance(_value_at(row, 2), (int, float))
                    else None
                ),
                "rate": _value_at(row, 3),
                "target": _value_at(row, 4),
            }
            for team, row in rows
        ],
        "summary_items": summary_items or [],
        "notes": notes,
        "source_reference": source_reference,
    }


def _combo_payload(
    *,
    labels: list[str],
    actual: list[Any],
    planned: list[Any],
    rate: list[Any],
    target: list[Any],
    source_reference: str,
    actual_label: str,
    planned_label: str,
    rate_label: str = "Tỷ lệ thực hiện",
    target_label: str = "Mục tiêu",
    summary_items: list[dict[str, Any]] | None = None,
    x_axis_label: str = "Danh mục",
    left_y_axis_label: str = "Giá trị",
    right_y_axis_label: str = "Tỷ lệ (%)",
) -> dict[str, Any]:
    return {
        "labels": labels,
        "datasets": [
            {"label": actual_label, "data": actual, "chart_type": "bar", "axis": "left", "color": "#4f75c2"},
            {"label": planned_label, "data": planned, "chart_type": "bar", "axis": "left", "color": "#e98336"},
            {"label": rate_label, "data": rate, "chart_type": "line", "axis": "right", "value_format": "percent", "color": "#ef4444"},
            {"label": target_label, "data": target, "chart_type": "line", "axis": "right", "value_format": "percent", "color": "#facc15"},
        ],
        "summary_items": summary_items or [],
        "axis_labels": {
            "x": x_axis_label,
            "left_y": left_y_axis_label,
            "right_y": right_y_axis_label,
        },
        "source_reference": source_reference,
    }


def _o2_snapshot_visuals(
    snapshot_blocks: dict[str, list[dict[str, Any]]],
    month: int,
    has_locked_data: bool,
    has_period_data: bool,
) -> list[VisualBlock]:
    bddk_rows = _rows_for_block(snapshot_blocks, "o2_bddk")
    scdx_rows = _rows_for_block(snapshot_blocks, "o2_scdx")
    if not (bddk_rows and scdx_rows):
        return []

    bddk_team_rows = _team_rows(bddk_rows)
    bddk_month_rows = _monthly_rows(bddk_rows)
    bddk_current_month = _month_row(bddk_month_rows, month)
    bddk_summary = _summary_row(bddk_rows)
    scdx_team_rows = _team_rows(scdx_rows)[:1]
    scdx_month_rows = _monthly_rows(scdx_rows)
    scdx_current_month = _month_row(scdx_month_rows, month)
    scdx_summary = _summary_row(scdx_rows)
    bddk_notes = _notes_for_block(snapshot_blocks, "o2_bddk")
    scdx_notes = _notes_for_block(snapshot_blocks, "o2_scdx")

    return [
        _visual(
            visual_id="o2_bddk_by_team",
            kind="metric_table",
            title="KR2 - Công tác bảo dưỡng định kỳ theo đội",
            data_state="ready",
            source=_source(has_locked_data, True),
            payload=_metric_table_payload(
                rows=bddk_team_rows,
                source_reference="data!A3:E18",
                actual_label="HM hoàn thành",
                planned_label="HM theo KH",
                rate_label="HM đạt tiến độ (%)",
                target_label="Mục tiêu (%)",
                notes=bddk_notes,
                summary_items=[
                    {"label": f"T{month} thực hiện", "value": _value_at(bddk_current_month or {}, 1)},
                    {"label": f"T{month} kế hoạch", "value": _value_at(bddk_current_month or {}, 2)},
                    {"label": f"T{month} tỷ lệ", "value": _value_at(bddk_current_month or {}, 3), "format": "percent"},
                ],
            ),
        ),
        _visual(
            visual_id="o2_bddk_by_month",
            kind="bar_line_chart",
            title="KR2 - Lũy kế bảo dưỡng định kỳ",
            data_state="ready",
            source=_source(has_locked_data, True),
            payload=_combo_payload(
                labels=[str(row.get("label")) for row in bddk_month_rows],
                actual=[_value_at(row, 1) for row in bddk_month_rows],
                planned=[_value_at(row, 2) for row in bddk_month_rows],
                rate=[_value_at(row, 3) for row in bddk_month_rows],
                target=[_value_at(row, 4) for row in bddk_month_rows],
                source_reference="data!A3:E18",
                actual_label="Thực hiện",
                planned_label="Kế hoạch",
                rate_label="Tỷ lệ thực hiện",
                target_label="Mục tiêu (%)",
                summary_items=[
                    {"label": f"Lũy kế đến T{month} thực hiện", "value": _value_at(bddk_summary or {}, 1)},
                    {"label": f"Lũy kế đến T{month} kế hoạch", "value": _value_at(bddk_summary or {}, 2)},
                    {"label": f"Lũy kế đến T{month} tỷ lệ", "value": _value_at(bddk_summary or {}, 3), "format": "percent"},
                ],
                x_axis_label="Tháng",
                left_y_axis_label="Số hạng mục",
                right_y_axis_label="Tỷ lệ (%)",
            ),
        ),
        _visual(
            visual_id="o2_scdx_by_team",
            kind="metric_table",
            title="KR3 - Công tác sửa chữa đột xuất",
            data_state="ready",
            source=_source(has_locked_data, True),
            payload=_metric_table_payload(
                rows=scdx_team_rows,
                source_reference="data!A21:E35",
                actual_label="Hoàn thành",
                planned_label="Tổng HM",
                rate_label="Hoàn thành (%)",
                target_label="Mục tiêu (%)",
                notes=scdx_notes,
                summary_items=[
                    {"label": f"T{month} thực hiện", "value": _value_at(scdx_current_month or {}, 1)},
                    {"label": f"T{month} kế hoạch", "value": _value_at(scdx_current_month or {}, 2)},
                    {"label": f"T{month} tỷ lệ", "value": _value_at(scdx_current_month or {}, 3), "format": "percent"},
                ],
            ),
        ),
        _visual(
            visual_id="o2_scdx_by_month",
            kind="bar_line_chart",
            title="KR3 - Lũy kế sửa chữa đột xuất",
            data_state="ready",
            source=_source(has_locked_data, True),
            payload=_combo_payload(
                labels=[str(row.get("label")) for row in scdx_month_rows],
                actual=[_value_at(row, 1) for row in scdx_month_rows],
                planned=[_value_at(row, 2) for row in scdx_month_rows],
                rate=[_value_at(row, 3) for row in scdx_month_rows],
                target=[_value_at(row, 4) for row in scdx_month_rows],
                source_reference="data!A21:E35",
                actual_label="Thực hiện",
                planned_label="Kế hoạch",
                rate_label="Tỷ lệ thực hiện",
                target_label="Mục tiêu (%)",
                summary_items=[
                    {"label": f"Lũy kế đến T{month} thực hiện", "value": _value_at(scdx_summary or {}, 1)},
                    {"label": f"Lũy kế đến T{month} kế hoạch", "value": _value_at(scdx_summary or {}, 2)},
                    {"label": f"Lũy kế đến T{month} tỷ lệ", "value": _value_at(scdx_summary or {}, 3), "format": "percent"},
                ],
                x_axis_label="Tháng",
                left_y_axis_label="Số hạng mục",
                right_y_axis_label="Tỷ lệ (%)",
            ),
        ),
    ]


def _o3_visuals_from_snapshot(
    snapshot_blocks: dict[str, list[dict[str, Any]]],
    chart_blocks: dict[str, Any],
    has_locked_data: bool,
    has_period_data: bool,
) -> list[VisualBlock]:
    team_rows = _team_rows(_rows_for_block(snapshot_blocks, "stop_by_team"))
    month_rows = _monthly_rows(_rows_for_block(snapshot_blocks, "stop_by_month"))
    summary = _summary_row(_rows_for_block(snapshot_blocks, "stop_by_month"))
    if team_rows and month_rows:
        return [
            _visual(
                visual_id="o3_stop_by_team",
                kind="bar_line_chart",
                title="KR2 - Chương trình STOP trong tháng",
                data_state="ready",
                source=_source(has_locked_data, True),
                payload=_combo_payload(
                    labels=[team for team, _row in team_rows],
                    actual=[_value_at(row, 1) for _team, row in team_rows],
                    planned=[_value_at(row, 2) for _team, row in team_rows],
                    rate=[_value_at(row, 3) for _team, row in team_rows],
                    target=[_value_at(row, 4) for _team, row in team_rows],
                    source_reference="data!A67:E70",
                    actual_label="Số thẻ ghi nhận",
                    planned_label="Tổng nhân sự",
                    rate_label="Ghi nhận (%)",
                    target_label="Chỉ tiêu (%)",
                    x_axis_label="Đội/Tổ",
                    left_y_axis_label="Số lượng",
                    right_y_axis_label="Tỷ lệ (%)",
                ),
            ),
            _visual(
                visual_id="o3_stop_by_month",
                kind="line_chart",
                title="KR2 - Lũy kế chương trình STOP",
                data_state="ready",
                source=_source(has_locked_data, True),
                payload={
                    "labels": [str(row.get("label")) for row in month_rows],
                    "datasets": [{"label": "Số thẻ ghi nhận", "data": [_value_at(row, 1) for row in month_rows]}],
                    "summary_items": [
                        {"label": "Thực hiện", "value": _value_at(summary or {}, 1)},
                        {"label": "Kế hoạch", "value": _value_at(summary or {}, 2)},
                        {"label": "Tỷ lệ", "value": _value_at(summary or {}, 3), "format": "percent"},
                    ],
                    "axis_labels": {
                        "x": "Tháng",
                        "left_y": "Số thẻ ghi nhận",
                    },
                    "source_reference": "data!A72:D84",
                },
            ),
        ]
    return [
        _visual_from_chart_block(
            visual_id="o3_stop_by_team",
            kind="bar_line_chart",
            title="STOP theo đội/tổ",
            block_type="stop_by_team",
            chart_blocks=chart_blocks,
            snapshot_blocks=snapshot_blocks,
            has_locked_data=has_locked_data,
            has_period_data=has_period_data,
        ),
        _visual_from_chart_block(
            visual_id="o3_stop_by_month",
            kind="line_chart",
            title="STOP lũy kế theo tháng",
            block_type="stop_by_month",
            chart_blocks=chart_blocks,
            snapshot_blocks=snapshot_blocks,
            has_locked_data=has_locked_data,
            has_period_data=has_period_data,
        ),
    ]


def _source(has_locked_data: bool, has_snapshot_data: bool, fallback: str | None = None) -> str | None:
    if has_locked_data:
        return "db_locked"
    if has_snapshot_data:
        return "dashboard_snapshot"
    return fallback


def _empty_state(has_plan: bool) -> tuple[DataState, str]:
    return ("no_data", NO_DATA_MESSAGE) if has_plan else ("no_plan", NO_PLAN_MESSAGE)


def _visual(
    *,
    visual_id: str,
    kind: VisualKind,
    title: str,
    data_state: DataState,
    source: str | None,
    payload: dict[str, Any] | None = None,
    empty_message: str | None = None,
) -> VisualBlock:
    return {
        "id": visual_id,
        "kind": kind,
        "title": title,
        "data_state": data_state,
        "empty_message": empty_message,
        "source": source,
        "payload": payload or {},
    }


def _with_participation_headcounts(
    visual: VisualBlock,
    headcounts: dict[str, dict[str, Any]] | None,
) -> VisualBlock:
    if not headcounts:
        return visual
    items = visual.get("payload", {}).get("items")
    if not isinstance(items, list):
        return visual
    enriched_items = []
    changed = False
    for item in items:
        if not isinstance(item, dict):
            enriched_items.append(item)
            continue
        team = item.get("team")
        total = item.get("total")
        if total is None and team in headcounts:
            total = headcounts[team].get("vhdn_eligible_headcount") or headcounts[team].get("total_headcount")
            changed = True
        rate = item.get("participation_rate")
        if rate is None and item.get("actual") is not None and total:
            rate = round(float(item["actual"]) / float(total), 4)
            changed = True
        enriched_items.append({**item, "total": total, "participation_rate": rate})
    if not changed:
        return visual
    payload = {**visual.get("payload", {}), "items": enriched_items}
    return {**visual, "payload": payload}


def _with_fi_counts(
    visual: VisualBlock,
    fi_counts_by_team: dict[str, int] | None,
) -> VisualBlock:
    if not fi_counts_by_team:
        return visual
    visual = _with_fi_context(visual, fi_counts_by_team=fi_counts_by_team)
    payload = dict(visual.get("payload") or {})
    if not payload.get("labels") or not payload.get("datasets"):
        teams = [team for team in TEAMS if team in fi_counts_by_team]
        payload["labels"] = teams
        payload["datasets"] = [{"label": "Số CTKT", "data": [int(fi_counts_by_team.get(team, 0)) for team in teams]}]
        payload["total"] = sum(int(fi_counts_by_team.get(team, 0)) for team in teams)
    if any(int(value or 0) > 0 for value in fi_counts_by_team.values()):
        return {**visual, "data_state": "ready", "empty_message": None, "source": "fi_module", "payload": payload}
    return {**visual, "payload": payload}


def _with_fi_context(
    visual: VisualBlock,
    *,
    fi_counts_by_team: dict[str, int] | None = None,
    fi_dashboard_summary: dict[str, Any] | None = None,
) -> VisualBlock:
    if not fi_counts_by_team and not fi_dashboard_summary:
        return visual
    payload = dict(visual.get("payload") or {})
    if fi_counts_by_team:
        payload["fi_counts_by_team"] = dict(fi_counts_by_team)
    if fi_dashboard_summary:
        payload["fi_dashboard_summary"] = fi_dashboard_summary
    return {**visual, "payload": payload}


def _visual_from_chart_block(
    *,
    visual_id: str,
    kind: VisualKind,
    title: str,
    block_type: str,
    chart_blocks: dict[str, Any],
    snapshot_blocks: dict[str, list[dict[str, Any]]],
    has_locked_data: bool,
    has_period_data: bool,
    has_plan: bool = True,
    source_fallback: str | None = None,
) -> VisualBlock:
    block = chart_blocks.get(block_type) or {}
    snapshot_payloads = snapshot_blocks.get(block_type, [])
    has_snapshot_data = has_period_data and _snapshot_has_rows(snapshot_blocks, block_type)
    has_chart_data = has_period_data and (_dataset_has_business_values(block) or has_snapshot_data)
    payload = dict(block)
    if snapshot_payloads:
        payload["snapshot_rows"] = snapshot_payloads[0].get("rows") or snapshot_payloads[0].get("items") or []
    if has_chart_data:
        return _visual(
            visual_id=visual_id,
            kind=kind,
            title=title,
            data_state="ready" if _dataset_has_business_values(block) else "partial",
            source=_source(has_locked_data, has_snapshot_data, source_fallback),
            payload=payload,
        )
    data_state, empty_message = _empty_state(has_plan)
    return _visual(
        visual_id=visual_id,
        kind=kind,
        title=title,
        data_state=data_state,
        empty_message=empty_message,
        source=None,
        payload=payload,
    )


def _kr_items_for_objective(
    summaries: list[dict[str, Any]],
    matrix: dict[str, Any],
    objective_code: ObjectiveCode,
) -> list[dict[str, Any]]:
    rows = [row for row in summaries if _objective_from_code(row.get("workshop_kr_code")) == objective_code]
    if rows:
        return rows
    columns = [column for column in matrix.get("columns", []) if _objective_from_code(column.get("workshop_kr_code")) == objective_code]
    return [
        {
            "workshop_kr_code": column.get("workshop_kr_code"),
            "kr_name": column.get("kr_name") or column.get("workshop_kr_code"),
            "target_value": column.get("target_value"),
            "dashboard_column": column.get("dashboard_column"),
            "team_statuses": {
                team.get("team"): (team.get("kr_statuses") or {}).get(column.get("workshop_kr_code"), "#N/A")
                for team in matrix.get("teams", [])
            },
        }
        for column in columns
    ]


def _has_actionable_kr_data(items: list[dict[str, Any]]) -> bool:
    for item in items:
        for status in (item.get("team_statuses") or {}).values():
            if status and status != "#N/A":
                return True
        metric = item.get("numeric_metric") or {}
        if metric.get("actual") is not None:
            return True
    return False


def _status_grid(
    objective_code: ObjectiveCode,
    title: str,
    summaries: list[dict[str, Any]],
    matrix: dict[str, Any],
    has_locked_data: bool,
    has_period_data: bool,
) -> VisualBlock:
    items = _kr_items_for_objective(summaries, matrix, objective_code)
    has_data = has_period_data and _has_actionable_kr_data(items)
    if has_data:
        return _visual(
            visual_id=f"{objective_code.lower()}_status_grid",
            kind="status_grid",
            title=title,
            data_state="ready",
            source=_source(has_locked_data, False),
            payload={"items": items},
        )
    data_state, empty_message = _empty_state(bool(items))
    return _visual(
        visual_id=f"{objective_code.lower()}_status_grid",
        kind="status_grid",
        title=title,
        data_state=data_state,
        empty_message=empty_message,
        source=None,
        payload={"items": items},
    )


def _monthly_kr_payload(history_reports: list[dict[str, Any]], code: str, month: int) -> dict[str, Any]:
    actual_by_month = {idx: 0.0 for idx in range(1, 13)}
    target_by_month: dict[int, Any] = {}
    seen: set[int] = set()
    for report in history_reports:
        report_month = report.get("report_month")
        if not report_month:
            continue
        for assessment in report.get("assessments") or []:
            if assessment.get("workshop_kr_code") != code:
                continue
            for metric in assessment.get("metrics") or []:
                if metric.get("actual") is not None:
                    actual_by_month[int(report_month)] += float(metric["actual"])
                    seen.add(int(report_month))
                if metric.get("target") is not None:
                    target_by_month[int(report_month)] = metric.get("target")
    labels = [f"T{idx}" for idx in range(1, 13)]
    actual = [actual_by_month[idx] if idx in seen else None for idx in range(1, 13)]
    target = [target_by_month.get(idx) for idx in range(1, 13)]
    current = actual[month - 1] if 1 <= month <= 12 else None
    cumulative = sum(value for value in actual[:month] if value is not None) if 1 <= month <= 12 else None
    return {
        "labels": labels,
        "datasets": [
            {"label": "Kết quả", "data": actual},
            {"label": "Mục tiêu", "data": target},
        ],
        "current_result": current,
        "cumulative": cumulative,
        "target": target[month - 1] if 1 <= month <= 12 else None,
    }


def _o2_visuals(
    history_reports: list[dict[str, Any]],
    snapshot_blocks: dict[str, list[dict[str, Any]]],
    month: int,
    has_locked_data: bool,
    has_period_data: bool,
) -> list[VisualBlock]:
    snapshot_visuals = _o2_snapshot_visuals(snapshot_blocks, month, has_locked_data, has_period_data)
    if snapshot_visuals:
        return snapshot_visuals
    monthly = _monthly_kr_payload(history_reports, "O2.KR1", month)
    has_data = has_period_data and any(value is not None for value in monthly["datasets"][0]["data"])
    if has_data:
        return [
            _visual(
                visual_id="o2_stability_table",
                kind="metric_table",
                title="Số liệu theo đội",
                data_state="ready",
                source=_source(has_locked_data, False),
                payload={"columns": [], "rows": [], "summary_items": []},
            ),
            _visual(
                visual_id="o2_stability_monthly",
                kind="bar_line_chart",
                title="Bảo dưỡng định kỳ và sửa chữa đột xuất theo tháng",
                data_state="ready",
                source=_source(has_locked_data, False),
                payload=monthly,
            ),
            _visual(
                visual_id="o2_stability_badges",
                kind="kpi_badges",
                title="Mục tiêu/Kết quả/Lũy kế",
                data_state="ready",
                source=_source(has_locked_data, False),
                payload={
                    "items": [
                        {"label": "Mục tiêu", "value": monthly.get("target")},
                        {"label": "Kết quả", "value": monthly.get("current_result")},
                        {"label": "Lũy kế", "value": monthly.get("cumulative")},
                    ]
                },
            ),
        ]
    data_state, empty_message = _empty_state(True)
    return [
        _visual(
            visual_id="o2_stability_table",
            kind="metric_table",
            title="Số liệu theo đội",
            data_state=data_state,
            empty_message=empty_message,
            source=None,
            payload={"columns": [], "rows": [], "summary_items": []},
        ),
        _visual(
            visual_id="o2_stability_monthly",
            kind="bar_line_chart",
            title="Bảo dưỡng định kỳ và sửa chữa đột xuất theo tháng",
            data_state=data_state,
            empty_message=empty_message,
            source=None,
            payload=monthly,
        )
    ]


def _narrative_from_objective(
    objective_code: ObjectiveCode,
    title: str,
    summaries: list[dict[str, Any]],
    matrix: dict[str, Any],
    has_locked_data: bool,
    has_period_data: bool,
    visual_id: str | None = None,
) -> VisualBlock:
    items = _kr_items_for_objective(summaries, matrix, objective_code)
    has_data = has_period_data and _has_actionable_kr_data(items)
    if has_data:
        return _visual(
            visual_id=visual_id or f"{objective_code.lower()}_narrative",
            kind="narrative_card",
            title=title,
            data_state="ready",
            source=_source(has_locked_data, False),
            payload={"items": items},
        )
    data_state, empty_message = _empty_state(bool(items))
    return _visual(
        visual_id=visual_id or f"{objective_code.lower()}_narrative",
        kind="narrative_card",
        title=title,
        data_state=data_state,
        empty_message=empty_message,
        source=None,
        payload={"items": items},
    )


def _section(
    objective_code: ObjectiveCode,
    *,
    status: ObjectiveStatus,
    visuals: list[VisualBlock],
    conclusion: str | None = None,
) -> ObjectiveSection:
    return {
        "objective_code": objective_code,
        "title": OBJECTIVE_TITLES[objective_code],
        "status": status,
        "conclusion": conclusion,
        "visuals": visuals,
        "notes": [],
        "source_references": [
            str(visual.get("payload", {}).get("source_reference"))
            for visual in visuals
            if visual.get("payload", {}).get("source_reference")
        ],
    }


def build_objective_sections(
    *,
    month: int,
    year: int,
    team_reports: list[dict[str, Any]],
    historical_snapshots: list[dict[str, Any]],
    chart_snapshots: list[dict[str, Any]] | None = None,
    headcounts: dict[str, dict[str, Any]] | None,
    fi_counts_by_team: dict[str, int] | None,
    fi_dashboard_summary: dict[str, Any] | None = None,
    chart_blocks: dict[str, Any],
    matrix: dict[str, Any],
    minor_okr_summary: list[dict[str, Any]],
    history_reports: list[dict[str, Any]] | None = None,
) -> list[ObjectiveSection]:
    period_snapshots = _snapshots_for_year(year, historical_snapshots)
    snapshot_blocks = _snapshot_blocks(chart_snapshots or period_snapshots)
    has_locked_data = bool(team_reports)
    has_period_data = has_locked_data or _period_has_snapshot(month, year, period_snapshots)

    sections: list[ObjectiveSection] = []
    sections.append(
        _section(
            "O1",
            status=_objective_status(matrix, "O1", has_period_data),
            visuals=[
                _status_grid(
                    "O1",
                    "Tình trạng sự cố dừng máy, mất sản lượng và lỗi chủ quan",
                    minor_okr_summary,
                    matrix,
                    has_locked_data,
                    has_period_data,
                )
            ],
            conclusion="Theo dõi các KR trọng yếu về sự cố và kỷ luật vận hành.",
        )
    )
    sections.append(
        _section(
            "O2",
            status=_objective_status(matrix, "O2", has_period_data),
            visuals=_o2_visuals(history_reports or team_reports, snapshot_blocks, month, has_locked_data, has_period_data),
            conclusion="Tập trung kiểm soát tiến độ bảo dưỡng, sửa chữa và độ tin cậy thiết bị.",
        )
    )
    sections.append(
        _section(
            "O3",
            status=_objective_status(matrix, "O3", has_period_data),
            visuals=_o3_visuals_from_snapshot(snapshot_blocks, chart_blocks, has_locked_data, has_period_data),
            conclusion="Duy trì theo dõi an toàn, sức khỏe và môi trường qua STOP card.",
        )
    )
    sections.append(
        _section(
            "O4",
            status=_objective_status(matrix, "O4", has_period_data),
            visuals=[
                _narrative_from_objective(
                    "O4",
                    "Tiến độ các hạng mục cải tiến chuyên môn",
                    minor_okr_summary,
                    matrix,
                    has_locked_data,
                    has_period_data,
                )
            ],
            conclusion="Tổng hợp tiến độ các KR cải tiến chuyên môn theo đội/tổ trong kỳ.",
        )
    )
    fi_visual = _with_fi_context(
        _with_fi_counts(
            _visual_from_chart_block(
                visual_id="o5_fi",
                kind="narrative_card",
                title="FI/CTKT cấp Xưởng",
                block_type="ctkt_fi",
                chart_blocks=chart_blocks,
                snapshot_blocks=snapshot_blocks,
                has_locked_data=has_locked_data,
                has_period_data=has_period_data,
                source_fallback="fi_module",
            ),
            fi_counts_by_team,
        ),
        fi_dashboard_summary=fi_dashboard_summary,
    )
    competency_visual = _with_fi_context(
        _visual_from_chart_block(
            visual_id="o5_competency",
            kind="radar_chart",
            title="ET/Khung năng lực",
            block_type="competency",
            chart_blocks=chart_blocks,
            snapshot_blocks=snapshot_blocks,
            has_locked_data=has_locked_data,
            has_period_data=has_period_data,
        ),
        fi_counts_by_team=fi_counts_by_team,
        fi_dashboard_summary=fi_dashboard_summary,
    )
    sections.append(
        _section(
            "O5",
            status=_objective_status(matrix, "O5", has_period_data),
            visuals=[
                competency_visual,
                _narrative_from_objective(
                    "O5",
                    "AM/PM/CTKT và các trụ cột TPM khác",
                    minor_okr_summary,
                    matrix,
                    has_locked_data,
                    has_period_data,
                    visual_id="o5_tpm_narrative",
                ),
                _visual_from_chart_block(
                    visual_id="o5_training",
                    kind="training_bar_chart",
                    title="Đào tạo nội bộ",
                    block_type="training",
                    chart_blocks=chart_blocks,
                    snapshot_blocks=snapshot_blocks,
                    has_locked_data=has_locked_data,
                    has_period_data=has_period_data,
                ),
                _visual_from_chart_block(
                    visual_id="o5_initiatives",
                    kind="kpi_badges",
                    title="Sáng kiến được công nhận",
                    block_type="sk_initiatives",
                    chart_blocks=chart_blocks,
                    snapshot_blocks=snapshot_blocks,
                    has_locked_data=has_locked_data,
                    has_period_data=has_period_data,
                ),
                fi_visual,
            ],
            conclusion="Tách riêng FI/CTKT với sáng kiến để dễ kiểm tra từng nguồn dữ liệu.",
        )
    )
    running_visual = _with_participation_headcounts(
        _visual_from_chart_block(
            visual_id="o6_running",
            kind="progress_card",
            title="Tiến độ rèn luyện chạy bộ",
            block_type="vhdn_running",
            chart_blocks=chart_blocks,
            snapshot_blocks=snapshot_blocks,
            has_locked_data=has_locked_data,
            has_period_data=has_period_data,
        ),
        headcounts,
    )
    sports_visual = _with_participation_headcounts(
        _visual_from_chart_block(
            visual_id="o6_sports",
            kind="bar_chart",
            title="Mức độ tham gia hội thao/chương trình chung",
            block_type="vhdn_sports",
            chart_blocks=chart_blocks,
            snapshot_blocks=snapshot_blocks,
            has_locked_data=has_locked_data,
            has_period_data=has_period_data,
        ),
        headcounts,
    )
    sections.append(
        _section(
            "O6",
            status=_objective_status(matrix, "O6", has_period_data),
            visuals=[
                running_visual,
                sports_visual,
                _narrative_from_objective(
                    "O6",
                    "Chia sẻ văn hóa và hoạt động chung",
                    minor_okr_summary,
                    matrix,
                    has_locked_data,
                    has_period_data,
                    visual_id="o6_culture",
                ),
            ],
            conclusion="Theo dõi mức độ tham gia hoạt động VHDN, chạy bộ và hội thao trong kỳ.",
        )
    )
    return sections
