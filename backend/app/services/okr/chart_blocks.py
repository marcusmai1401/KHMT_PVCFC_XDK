from dataclasses import dataclass
import re
from typing import Any, Literal
import unicodedata

from app.services.okr.constants import BASELINE_HEADCOUNT, TEAM_DISPLAY_NAMES, TEAMS
from app.services.okr.team_normalizer import normalize_team_label


ChartBlockType = Literal[
    "stop_by_team",
    "stop_by_month",
    "training",
    "competency",
    "vhdn_running",
    "vhdn_sports",
    "sk_initiatives",
    "ctkt_fi",
]


@dataclass(frozen=True)
class ChartBlockConfig:
    block_type: ChartBlockType
    title: str
    chart_type: Literal["bar", "line", "cards", "progress_grid"]
    kr_code: str
    source_reference: str
    master_target: float | str | None = None
    participation_target: float | None = None


CHART_CONFIGS: dict[str, ChartBlockConfig] = {
    "stop_by_team": ChartBlockConfig("stop_by_team", "STOP theo đội/tổ", "bar", "O3.KR2", "data!A67:E70", 200),
    "stop_by_month": ChartBlockConfig("stop_by_month", "STOP theo tháng", "line", "O3.KR2", "data!A72:D84", 200),
    "training": ChartBlockConfig("training", "Đào tạo nội bộ", "bar", "O5.KR3", "data!A98:N107"),
    "competency": ChartBlockConfig("competency", "ET/Khung năng lực", "progress_grid", "O5.KR1", "data!A135:B142", 8),
    "vhdn_running": ChartBlockConfig("vhdn_running", "VHDN/rèn luyện chạy bộ", "cards", "O6.KR1", "data!A86:E89", 2, 0.5),
    "vhdn_sports": ChartBlockConfig("vhdn_sports", "Hội thao/chương trình chung", "cards", "O6.KR2", "data!A91:E94", 1, 0.5),
    "sk_initiatives": ChartBlockConfig("sk_initiatives", "Sáng kiến được công nhận", "bar", "O5.KR12", "data!A110:B114", 8),
    "ctkt_fi": ChartBlockConfig("ctkt_fi", "Ý tưởng/CTKT cấp Xưởng", "bar", "O5.KR13", "FI module", 1),
}

COMPETENCY_POSITION_LABELS = [
    "KNL KTV BDSC TBHTĐK",
    "KNL KTV BDSC TBCH",
    "KNL KTV BDSC TBĐL",
    "KNL KTV BDSC TCĐK",
    "KNL KS TBHTĐK",
    "KNL KS TBCH",
    "KNL KS TBĐL",
    "KNL KS TCĐK",
]

SOURCE_WORKBOOK_PATTERN = re.compile(r"OKR tháng (\d{2})-(\d{4})", re.IGNORECASE)


def _metric_maps(reports: list[dict[str, Any]]) -> tuple[dict[tuple[int, str, str], dict[str, Any]], set[tuple[int, str, str]]]:
    values: dict[tuple[int, str, str], dict[str, Any]] = {}
    seen: set[tuple[int, str, str]] = set()
    for report in reports:
        team = report.get("team")
        month = report.get("report_month")
        if team not in TEAMS or not month:
            continue
        for assessment in report.get("assessments", []):
            code = assessment.get("workshop_kr_code")
            metrics = assessment.get("metrics") or []
            if not code:
                continue
            seen.add((int(month), team, code))
            if metrics:
                values[(int(month), team, code)] = metrics[0]
    return values, seen


def _sum_metric(
    metric_by_key: dict[tuple[int, str, str], dict[str, Any]],
    seen_keys: set[tuple[int, str, str]],
    *,
    months: list[int],
    teams: list[str],
    code: str,
    field: str,
) -> float | None:
    total = 0.0
    has_value = False
    for month in months:
        for team in teams:
            key = (month, team, code)
            metric = metric_by_key.get(key)
            if metric and metric.get(field) is not None:
                total += float(metric[field])
                has_value = True
    if has_value:
        return total
    return None


def _block(config: ChartBlockConfig, labels: list[str], datasets: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {
        "block_type": config.block_type,
        "title": config.title,
        "chart_type": config.chart_type,
        "kr_code": config.kr_code,
        "labels": labels,
        "datasets": datasets,
        "master_target": config.master_target,
        "participation_target": config.participation_target,
        "source_reference": config.source_reference,
        "mapping_status": "confirmed",
        "warnings": [],
        **extra,
    }


def _plain_text(value: Any) -> str:
    normalized = unicodedata.normalize("NFD", str(value or "").strip().lower())
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").replace("đ", "d")


def _source_period(snapshot: dict[str, Any]) -> tuple[int, int] | None:
    match = SOURCE_WORKBOOK_PATTERN.search(str(snapshot.get("source_file_name") or ""))
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def select_chart_snapshots_for_period(
    historical_snapshots: list[dict[str, Any]] | None,
    *,
    month: int,
    year: int,
) -> list[dict[str, Any]]:
    chart_snapshots = [
        snapshot
        for snapshot in historical_snapshots or []
        if int(snapshot.get("month") or 0) == 0
        and int(snapshot.get("year") or 0) == year
        and (snapshot.get("chart_payload") or {}).get("block_type")
    ]
    exact_period = [snapshot for snapshot in chart_snapshots if _source_period(snapshot) == (month, year)]
    return exact_period or chart_snapshots


def _snapshot_payloads(historical_snapshots: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    payloads: dict[str, dict[str, Any]] = {}
    for snapshot in historical_snapshots or []:
        payload = snapshot.get("chart_payload") or {}
        block_type = payload.get("block_type")
        if block_type and block_type not in payloads:
            payloads[str(block_type)] = payload
    return payloads


def _row_values(row: dict[str, Any]) -> list[Any]:
    values = row.get("values")
    return list(values) if isinstance(values, list) else []


def _value_at(row: dict[str, Any], index: int) -> Any:
    values = _row_values(row)
    return values[index] if index < len(values) else None


def _snapshot_team_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_team: dict[str, dict[str, Any]] = {}
    for row in rows:
        team, _label = normalize_team_label(str(row.get("label") or ""))
        if team:
            by_team[team] = row
    return by_team


def _headcount(headcounts: dict[str, dict[str, Any]] | None, team: str, field: str = "total_headcount") -> int | None:
    if headcounts and team in headcounts and headcounts[team].get(field) is not None:
        return int(headcounts[team][field])
    if field == "total_headcount":
        return BASELINE_HEADCOUNT.get(team)
    return None


def _participation_items(
    config: ChartBlockConfig,
    metric_by_key: dict[tuple[int, str, str], dict[str, Any]],
    seen_keys: set[tuple[int, str, str]],
    visible_teams: list[str],
    month: int,
    headcounts: dict[str, dict[str, Any]] | None,
) -> dict[str, Any]:
    items = []
    data = []
    for team in visible_teams:
        key = (month, team, config.kr_code)
        metric = metric_by_key.get(key, {})
        actual = metric.get("actual") if key in seen_keys else None
        total = metric.get("total")
        if total is None and actual is not None:
            total = _headcount(headcounts, team, "vhdn_eligible_headcount")
        percentage = None
        if actual is not None and total:
            percentage = round(float(actual) / float(total), 4)
        data.append(percentage)
        items.append(
            {
                "team": team,
                "team_name": TEAM_DISPLAY_NAMES[team],
                "actual": actual,
                "total": total,
                "participation_rate": percentage,
                "participation_target": config.participation_target,
                "master_target": config.master_target,
            }
        )
    return _block(config, visible_teams, [{"label": "Tỷ lệ tham gia", "data": data}], items=items)


def _competency_positions(historical_snapshots: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    for snapshot in historical_snapshots or []:
        payload = snapshot.get("chart_payload") or {}
        if payload.get("block_type") == "competency":
            rows = payload.get("rows") or []
            return [{"label": str(row.get("label") or f"Vị trí {idx + 1}"), "value": row.get("value")} for idx, row in enumerate(rows)]
    return [{"label": label, "value": None} for label in COMPETENCY_POSITION_LABELS]


def _apply_snapshot_overrides(
    blocks: dict[str, Any],
    historical_snapshots: list[dict[str, Any]] | None,
    teams: list[str],
) -> dict[str, Any]:
    payloads = _snapshot_payloads(historical_snapshots)

    stop_rows = payloads.get("stop_by_team", {}).get("rows") or []
    if stop_rows:
        by_team = _snapshot_team_rows(stop_rows)
        config = CHART_CONFIGS["stop_by_team"]
        blocks["stop_by_team"] = _block(
            config,
            teams,
            [
                {"label": "Số thẻ ghi nhận", "data": [_value_at(by_team.get(team, {}), 1) for team in teams]},
                {"label": "Tổng nhân sự", "data": [_value_at(by_team.get(team, {}), 2) for team in teams]},
            ],
        )

    stop_month_rows = payloads.get("stop_by_month", {}).get("rows") or []
    if stop_month_rows:
        by_month: dict[int, Any] = {}
        for row in stop_month_rows:
            match = re.fullmatch(r"T(1[0-2]|[1-9])", str(row.get("label") or "").strip(), re.IGNORECASE)
            if match:
                by_month[int(match.group(1))] = _value_at(row, 1)
        config = CHART_CONFIGS["stop_by_month"]
        blocks["stop_by_month"] = _block(
            config,
            [f"T{period_month}" for period_month in range(1, 13)],
            [{"label": "Số thẻ ghi nhận", "data": [by_month.get(period_month) for period_month in range(1, 13)]}],
        )

    training_rows = payloads.get("training", {}).get("rows") or []
    if training_rows:
        plan_row = next((row for row in training_rows if "ke hoach" in _plain_text(row.get("label"))), None)
        actual_row = next((row for row in training_rows if "thuc hien" in _plain_text(row.get("label"))), None)
        if plan_row or actual_row:
            config = CHART_CONFIGS["training"]
            blocks["training"] = _block(
                config,
                [f"T{period_month}" for period_month in range(1, 12)],
                [
                    {"label": "Kế hoạch", "data": [_value_at(plan_row or {}, index) for index in range(1, 12)]},
                    {"label": "Thực hiện", "data": [_value_at(actual_row or {}, index) for index in range(1, 12)]},
                ],
            )

    for block_type in ("vhdn_running", "vhdn_sports"):
        rows = payloads.get(block_type, {}).get("rows") or []
        if not rows:
            continue
        by_team = _snapshot_team_rows(rows)
        config = CHART_CONFIGS[block_type]
        items = []
        rates = []
        for team in teams:
            row = by_team.get(team, {})
            actual = _value_at(row, 1)
            total = _value_at(row, 2)
            rate = _value_at(row, 3)
            target = _value_at(row, 4)
            rates.append(rate)
            items.append(
                {
                    "team": team,
                    "team_name": TEAM_DISPLAY_NAMES[team],
                    "actual": actual,
                    "total": total,
                    "participation_rate": rate,
                    "participation_target": target if target is not None else config.participation_target,
                    "master_target": config.master_target,
                }
            )
        blocks[block_type] = _block(config, teams, [{"label": "Tỷ lệ tham gia", "data": rates}], items=items)

    sk_rows = payloads.get("sk_initiatives", {}).get("rows") or []
    if sk_rows:
        by_team = _snapshot_team_rows(sk_rows)
        values = [_value_at(by_team.get(team, {}), 1) for team in teams]
        config = CHART_CONFIGS["sk_initiatives"]
        blocks["sk_initiatives"] = _block(
            config,
            teams,
            [{"label": "Số sáng kiến", "data": values}],
            total=sum(float(value or 0) for value in values),
        )

    return blocks


def build_chart_blocks(
    reports: list[dict[str, Any]],
    *,
    month: int,
    year: int,
    visible_teams: list[str] | None = None,
    historical_snapshots: list[dict[str, Any]] | None = None,
    headcounts: dict[str, dict[str, Any]] | None = None,
    fi_counts_by_team: dict[str, int] | None = None,
) -> dict[str, Any]:
    teams = [team for team in (visible_teams or list(TEAMS)) if team in TEAMS]
    metric_by_key, seen_keys = _metric_maps(reports)

    stop_team = CHART_CONFIGS["stop_by_team"]
    stop_actual = [
        _sum_metric(metric_by_key, seen_keys, months=[month], teams=[team], code=stop_team.kr_code, field="actual")
        for team in teams
    ]
    stop_headcount = [_headcount(headcounts, team) for team in teams]

    stop_month = CHART_CONFIGS["stop_by_month"]
    stop_month_data = [
        _sum_metric(metric_by_key, seen_keys, months=[m], teams=teams, code=stop_month.kr_code, field="actual")
        for m in range(1, 13)
    ]

    training = CHART_CONFIGS["training"]
    training_actual = [
        _sum_metric(metric_by_key, seen_keys, months=[m], teams=teams, code=training.kr_code, field="actual")
        for m in range(1, 12)
    ]
    training_plan = [
        _sum_metric(metric_by_key, seen_keys, months=[m], teams=teams, code=training.kr_code, field="total")
        or _sum_metric(metric_by_key, seen_keys, months=[m], teams=teams, code=training.kr_code, field="target")
        for m in range(1, 12)
    ]

    competency = CHART_CONFIGS["competency"]
    competency_positions = _competency_positions(historical_snapshots)
    competency_main = competency_positions[:8]
    competency_warnings = []
    if len(competency_positions) > 8:
        competency_warnings.append(
            {
                "warning_type": "COMPETENCY_EXCESS_POSITIONS",
                "severity": "LOW",
                "reason": "Source has more than 8 competency positions; extras are exposed in metadata.",
                "extra_positions": competency_positions[8:],
            }
        )

    sk_config = CHART_CONFIGS["sk_initiatives"]
    sk_values = [
        _sum_metric(metric_by_key, seen_keys, months=[month], teams=[team], code=sk_config.kr_code, field="actual")
        for team in teams
    ]

    fi_config = CHART_CONFIGS["ctkt_fi"]
    fi_counts = fi_counts_by_team or {}
    fi_values = [int(fi_counts.get(team, 0)) for team in teams]

    blocks = {
        "stop_by_team": _block(
            stop_team,
            teams,
            [
                {"label": "Số thẻ ghi nhận", "data": stop_actual},
                {"label": "Tổng nhân sự", "data": stop_headcount},
            ],
        ),
        "stop_by_month": _block(stop_month, [f"T{m}" for m in range(1, 13)], [{"label": "Số thẻ ghi nhận", "data": stop_month_data}]),
        "training": _block(
            training,
            [f"T{m}" for m in range(1, 12)],
            [
                {"label": "Kế hoạch", "data": training_plan},
                {"label": "Thực hiện", "data": training_actual},
            ],
        ),
        "competency": _block(
            competency,
            [item["label"] for item in competency_main],
            [{"label": "Tỷ lệ hoàn thành", "data": [item["value"] for item in competency_main]}],
            items=competency_main,
            extra_items=competency_positions[8:],
            warnings=competency_warnings,
        ),
        "vhdn_running": _participation_items(CHART_CONFIGS["vhdn_running"], metric_by_key, seen_keys, teams, month, headcounts),
        "vhdn_sports": _participation_items(CHART_CONFIGS["vhdn_sports"], metric_by_key, seen_keys, teams, month, headcounts),
        "sk_initiatives": _block(sk_config, teams, [{"label": "Số sáng kiến", "data": sk_values}], total=sum(value or 0 for value in sk_values)),
        "ctkt_fi": _block(fi_config, teams, [{"label": "Số CTKT", "data": fi_values}], total=sum(fi_values)),
    }
    return _apply_snapshot_overrides(blocks, historical_snapshots, teams)
