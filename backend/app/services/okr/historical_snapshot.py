from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO
import hashlib
import re
import unicodedata
from typing import Any
from zipfile import ZipFile
import xml.etree.ElementTree as ET

from openpyxl import load_workbook
from openpyxl.utils.cell import range_boundaries
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.domain import HistoricalSnapshotModel
from app.services.okr.team_normalizer import normalize_team_label
from app.services.repositories import make_id, model_to_dict


DATA_BLOCK_RANGES = {
    "o2_bddk": ("data", "A3:E18"),
    "o2_scdx": ("data", "A21:E35"),
    "stop_by_team": ("data", "A67:E70"),
    "stop_by_month": ("data", "A72:D84"),
    "training": ("data", "A98:N107"),
    "competency": ("data", "A135:B142"),
    "vhdn_running": ("data", "A86:E89"),
    "vhdn_sports": ("data", "A91:E94"),
    "sk_initiatives": ("data", "A110:B114"),
}

UNCONFIRMED_BLOCKS = [
    {
        "source_range": "data!A117:D127",
        "observed_label": "Tuần 14-22 backlog",
        "candidate_kr_codes": ["O2.KR3"],
        "mapping_status": "needs_confirmation",
        "reason": "Weekly backlog block needs business confirmation before UI aggregation.",
    },
]

UNCONFIRMED_WARNING_BLOCKS = [
    {
        "source_range": "data!A43:E62",
        "observed_label": "BDĐK NPK",
        "candidate_kr_codes": ["O2.KR2"],
        "mapping_status": "needs_confirmation",
        "reason": "BDĐK NPK block is preserved as an import warning until business mapping is confirmed.",
    },
]

DRAWING_NAMESPACES = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}


@dataclass
class HistoricalSnapshotImportResult:
    imported_count: int = 0
    updated_count: int = 0
    skipped_duplicates: int = 0
    months_covered: set[int] = field(default_factory=set)
    source_file_hash: str = ""
    warnings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "imported_count": self.imported_count,
            "updated_count": self.updated_count,
            "skipped_duplicates": self.skipped_duplicates,
            "months_covered": sorted(self.months_covered),
            "source_file_hash": self.source_file_hash,
            "warnings": self.warnings,
        }


def _warning(reason: str, source_range: str | None = None, severity: str = "MEDIUM") -> dict[str, Any]:
    return {
        "warning_type": "HISTORICAL_SNAPSHOT_PARSE_WARNING",
        "severity": severity,
        "source_cell": {"source_range": source_range} if source_range else None,
        "reason": reason,
        "admin_action": "PENDING",
    }


def _source_year(workbook: Any) -> int:
    for sheet_name, coordinate in [("Dashboard", "A20"), ("Dashboard", "A1")]:
        if sheet_name not in workbook.sheetnames:
            continue
        value = str(workbook[sheet_name][coordinate].value or "")
        match = re.search(r"(20\d{2})", value)
        if match:
            return int(match.group(1))
    return 2026


def _source_month(workbook: Any) -> int | None:
    for sheet_name, coordinate in [("Dashboard", "A1"), ("Dashboard", "A20")]:
        if sheet_name not in workbook.sheetnames:
            continue
        value = str(workbook[sheet_name][coordinate].value or "")
        match = re.search(r"(?:THÁNG|T)[\s._-]*(1[0-2]|0?[1-9])", value.upper())
        if match:
            return int(match.group(1))
    return None


def _dashboard_month_columns() -> list[tuple[int, int]]:
    return [(month, 6 + ((month - 1) * 2)) for month in range(1, 13)]


def _upsert_snapshot(
    db: Session,
    result: HistoricalSnapshotImportResult,
    *,
    source_file_name: str,
    source_sheet: str,
    source_range: str,
    source_label: str | None,
    team: str,
    month: int,
    year: int,
    monthly_assessment: str | None = None,
    chart_payload: dict[str, Any] | None = None,
    warnings: list[dict[str, Any]] | None = None,
    imported_by: str,
) -> None:
    existing = db.execute(
        select(HistoricalSnapshotModel).where(
            HistoricalSnapshotModel.source_file_hash == result.source_file_hash,
            HistoricalSnapshotModel.team == team,
            HistoricalSnapshotModel.month == month,
            HistoricalSnapshotModel.year == year,
            HistoricalSnapshotModel.source_range == source_range,
        )
    ).scalar_one_or_none()
    if existing is not None:
        next_payload = chart_payload or {}
        next_warnings = warnings or []
        changed = False
        if existing.monthly_assessment != monthly_assessment:
            existing.monthly_assessment = monthly_assessment
            changed = True
        if existing.chart_payload != next_payload:
            existing.chart_payload = next_payload
            changed = True
        if existing.warnings != next_warnings:
            existing.warnings = next_warnings
            changed = True
        if changed:
            result.updated_count += 1
        else:
            result.skipped_duplicates += 1
        return
    db.add(
        HistoricalSnapshotModel(
            id=make_id("snap"),
            source_file_name=source_file_name,
            source_file_hash=result.source_file_hash,
            source_sheet=source_sheet,
            source_range=source_range,
            source_label=source_label,
            team=team,
            month=month,
            year=year,
            monthly_assessment=monthly_assessment,
            kr_statuses={},
            chart_payload=chart_payload or {},
            warnings=warnings or [],
            imported_by=imported_by,
            is_historical_snapshot=True,
        )
    )
    result.imported_count += 1
    if month:
        result.months_covered.add(month)


def find_dashboard_header_row(sheet: Any) -> int | None:
    for row in range(1, sheet.max_row + 1):
        first_cell = str(sheet.cell(row, 1).value or "").strip().lower()
        if first_cell == "đội/tổ" or first_cell == "doi/to":
            return row
    return None


def find_dashboard_team_rows(sheet: Any) -> list[tuple[int, str]]:
    header_row = find_dashboard_header_row(sheet)
    if header_row is None:
        rows: list[tuple[int, str]] = []
        for row in range(1, sheet.max_row + 1):
            source_label = str(sheet.cell(row, 1).value or "").strip()
            team, _original_label = normalize_team_label(source_label)
            if team:
                rows.append((row, team))
        return rows
    rows: list[tuple[int, str]] = []
    for row in range(header_row + 1, sheet.max_row + 1):
        source_label = str(sheet.cell(row, 1).value or "").strip()
        if not source_label:
            if rows:
                break
            continue
        team, _original_label = normalize_team_label(source_label)
        if team:
            rows.append((row, team))
            continue
        if rows:
            break
    return rows


def _parse_dashboard_history(db: Session, workbook: Any, result: HistoricalSnapshotImportResult, *, source_file_name: str, imported_by: str) -> None:
    if "Dashboard" not in workbook.sheetnames:
        raise ValueError("Workbook is missing required sheet: Dashboard")
    sheet = workbook["Dashboard"]
    year = _source_year(workbook)
    header_row = find_dashboard_header_row(sheet)
    team_rows = find_dashboard_team_rows(sheet)
    if not team_rows:
        result.warnings.append(_warning("No dashboard team rows found below Đội/Tổ header", "Dashboard"))
    for row, team in team_rows:
        source_label = str(sheet.cell(row, 1).value or "").strip()
        _team, original_label = normalize_team_label(source_label)
        for month, col in _dashboard_month_columns():
            assessment = str(sheet.cell(row, col).value or "").strip()
            if not assessment:
                continue
            _upsert_snapshot(
                db,
                result,
                source_file_name=source_file_name,
                source_sheet="Dashboard",
                source_range=f"Dashboard!{sheet.cell(row, col).coordinate}",
                source_label=original_label,
                team=team,
                month=month,
                year=year,
                monthly_assessment=assessment,
                imported_by=imported_by,
            )


def _range_rows(sheet: Any, range_text: str) -> list[dict[str, Any]]:
    min_col, min_row, max_col, max_row = range_boundaries(range_text)
    rows = []
    for row_idx in range(min_row, max_row + 1):
        values = [sheet.cell(row_idx, col_idx).value for col_idx in range(min_col, max_col + 1)]
        if not any(value is not None and str(value).strip() for value in values):
            continue
        rows.append(
            {
                "source_row": row_idx,
                "label": values[0],
                "value": values[1] if len(values) > 1 else None,
                "values": values,
            }
        )
    return rows


def _plain_text(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    normalized = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return normalized.replace("đ", "d").replace("Đ", "D").lower()


def _extract_dashboard_note_blocks(workbook_bytes: bytes) -> dict[str, list[str]]:
    notes: dict[str, list[str]] = {}
    try:
        with ZipFile(BytesIO(workbook_bytes)) as archive:
            drawing_names = [
                name
                for name in archive.namelist()
                if name.startswith("xl/drawings/") and name.endswith(".xml")
            ]
            for drawing_name in drawing_names:
                root = ET.fromstring(archive.read(drawing_name))
                for anchor in root:
                    paragraphs = []
                    for paragraph in anchor.findall(".//a:p", DRAWING_NAMESPACES):
                        text = "".join(node.text or "" for node in paragraph.findall(".//a:t", DRAWING_NAMESPACES)).strip()
                        if text:
                            paragraphs.append(text)
                    if not paragraphs:
                        continue
                    heading = _plain_text(paragraphs[0])
                    if "kr02" in heading and "bao cao cong tac bddk" in heading:
                        notes["o2_bddk"] = paragraphs[1:]
                    elif "kr03" in heading and "bao cao cong tac sua chua dot xuat" in heading:
                        notes["o2_scdx"] = paragraphs[1:]
    except Exception:
        return {}
    return notes


def _parse_data_blocks(
    db: Session,
    workbook: Any,
    result: HistoricalSnapshotImportResult,
    *,
    source_file_name: str,
    imported_by: str,
    note_blocks: dict[str, list[str]] | None = None,
) -> None:
    if "data" not in workbook.sheetnames:
        result.warnings.append(_warning("Workbook is missing optional sheet: data", "data"))
        return
    sheet = workbook["data"]
    year = _source_year(workbook)
    source_month = _source_month(workbook)
    for block_type, (sheet_name, range_text) in DATA_BLOCK_RANGES.items():
        source_range = f"{sheet_name}!{range_text}"
        try:
            rows = _range_rows(sheet, range_text)
            warnings: list[dict[str, Any]] = []
            if block_type == "competency" and not rows and source_month in {1, 2}:
                warnings.append(
                    _warning(
                        "Competency data is expected to be absent before T3",
                        source_range,
                        "LOW",
                    )
                )
            _upsert_snapshot(
                db,
                result,
                source_file_name=source_file_name,
                source_sheet=sheet_name,
                source_range=source_range,
                source_label=block_type,
                team="__CHARTS__",
                month=0,
                year=year,
                chart_payload={
                    "block_type": block_type,
                    "rows": rows,
                    "notes": list((note_blocks or {}).get(block_type, [])),
                },
                warnings=warnings,
                imported_by=imported_by,
            )
        except Exception as exc:
            result.warnings.append(_warning(f"Cannot parse {source_range}: {exc}", source_range))

    _upsert_snapshot(
        db,
        result,
        source_file_name=source_file_name,
        source_sheet="data",
        source_range="data!unconfirmed_blocks",
        source_label="unconfirmed_blocks",
        team="__SOURCE_REFERENCES__",
        month=0,
        year=year,
        chart_payload={"block_type": "unconfirmed_blocks", "items": UNCONFIRMED_BLOCKS},
        warnings=[],
        imported_by=imported_by,
    )
    for item in UNCONFIRMED_WARNING_BLOCKS:
        result.warnings.append(
            _warning(
                f"{item['observed_label']} is not imported as authoritative dashboard data: {item['reason']}",
                item["source_range"],
                "LOW",
            )
        )


def import_historical_snapshot(
    db: Session,
    workbook_bytes: bytes,
    *,
    source_file_name: str,
    imported_by: str,
) -> dict[str, Any]:
    result = HistoricalSnapshotImportResult(source_file_hash=hashlib.sha256(workbook_bytes).hexdigest())
    try:
        workbook = load_workbook(BytesIO(workbook_bytes), read_only=False, data_only=True, keep_links=False)
    except Exception as exc:
        raise ValueError(f"Invalid Excel workbook: {exc}") from exc

    try:
        _parse_dashboard_history(db, workbook, result, source_file_name=source_file_name, imported_by=imported_by)
    except ValueError as exc:
        result.warnings.append(_warning(str(exc), "Dashboard", "HIGH"))
    _parse_data_blocks(
        db,
        workbook,
        result,
        source_file_name=source_file_name,
        imported_by=imported_by,
        note_blocks=_extract_dashboard_note_blocks(workbook_bytes),
    )
    db.flush()
    return result.to_dict()


def snapshots_to_dicts(records: list[HistoricalSnapshotModel]) -> list[dict[str, Any]]:
    return [model_to_dict(record) for record in records]
