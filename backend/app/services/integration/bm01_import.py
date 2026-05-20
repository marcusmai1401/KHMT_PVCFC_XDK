from dataclasses import asdict, dataclass
from pathlib import Path
import re
from typing import Any

from openpyxl import load_workbook


SHEET_TEAM = {"TBCH": "TBCH", "TBĐ": "TBĐL", "TBHTĐK": "TBHTĐK", "TC- ĐK": "TCĐK"}
STATUS_MAP = {
    "đồng ý": "Approved",
    "dong y": "Approved",
    "xem xét sau": "Deferred",
    "xem xet sau": "Deferred",
    "không đồng ý": "Rejected",
    "khong dong y": "Rejected",
    "không đạt": "Rejected",
    "khong dat": "Rejected",
    "cancel": "Cancelled",
}


@dataclass
class BM01PreviewRow:
    source_sheet: str
    source_row: int
    team: str
    author_name: str
    title: str
    content_description: str
    completion_plan: str
    raw_conclusion: str
    status: str
    registration_month: int | None
    registration_year: int | None
    khmt_month: int | None
    khmt_year: int | None
    warnings: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _strip(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower().strip())


def _header_indices(sheet) -> dict[str, int]:
    aliases = {
        "month": ["tháng", "month"],
        "author_name": ["họ và tên", "người đăng ký", "tác giả", "author"],
        "title": ["tên sáng kiến", "tên đề tài", "title"],
        "content_description": ["nội dung", "mô tả", "description"],
        "completion_plan": ["kế hoạch", "completion"],
        "raw_conclusion": ["kết luận", "đánh giá", "conclusion"],
    }
    result: dict[str, int] = {}
    for col in range(1, sheet.max_column + 1):
        header = _strip(_clean(sheet.cell(1, col).value))
        for field, names in aliases.items():
            if field not in result and any(name in header for name in names):
                result[field] = col - 1
    return result


def _value(values: list[str], headers: dict[str, int], field: str, fallback: int) -> str:
    index = headers.get(field, fallback)
    return values[index] if index < len(values) else ""


def _parse_month_year(value: str) -> tuple[int | None, int | None]:
    text = value.strip()
    if not text:
        return None, None
    match = re.search(r"(?:tháng\s*)?(1[0-2]|0?[1-9])\s*[/-]\s*(20\d{2})", text, re.IGNORECASE)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r"(?:tháng|t)\s*(1[0-2]|0?[1-9])", text, re.IGNORECASE)
    if match:
        return int(match.group(1)), None
    return None, None


def _status_from_conclusion(value: str) -> tuple[str, str | None]:
    lowered = value.lower().strip()
    for key, status in STATUS_MAP.items():
        if key in lowered:
            return status, None
    return "Deferred", "Unclear approval status"


def preview_bm01(path: Path) -> dict[str, Any]:
    workbook = load_workbook(path, read_only=False, data_only=True)
    rows: list[BM01PreviewRow] = []
    workbook_warnings: list[str] = []
    for sheet_name, team in SHEET_TEAM.items():
        if sheet_name not in workbook.sheetnames:
            workbook_warnings.append(f"Missing sheet {sheet_name}")
            continue
        sheet = workbook[sheet_name]
        headers = _header_indices(sheet)
        if not headers:
            workbook_warnings.append(f"Using fallback column indices for {sheet_name}")
        for row in range(2, sheet.max_row + 1):
            values = [_clean(sheet.cell(row, col).value) for col in range(1, sheet.max_column + 1)]
            if not any(values):
                continue
            title = _value(values, headers, "title", 3)
            author = _value(values, headers, "author_name", 2)
            if not title and not author:
                continue
            registration_month, registration_year = _parse_month_year(_value(values, headers, "month", 0))
            conclusion_index = headers.get("raw_conclusion")
            conclusion_candidates = [values[conclusion_index]] if conclusion_index is not None and conclusion_index < len(values) else []
            conclusion_candidates.extend(values[i] for i in [13, 12, 14, 15] if i < len(values))
            raw_conclusion = next((candidate for candidate in conclusion_candidates if candidate), "")
            status, status_warning = _status_from_conclusion(raw_conclusion)
            khmt_text = " ".join(values[13:16])
            khmt_month, khmt_year = _parse_month_year(khmt_text)
            warnings = []
            if registration_month is None:
                warnings.append("Missing or ambiguous registration month")
            if not title:
                warnings.append("Missing title")
            if status_warning:
                warnings.append(status_warning)
            if sheet.row_dimensions[row].hidden:
                warnings.append("Source row is hidden")
            rows.append(
                BM01PreviewRow(
                    source_sheet=sheet_name,
                    source_row=row,
                    team=team,
                    author_name=author,
                    title=title,
                    content_description=_value(values, headers, "content_description", 4),
                    completion_plan=_value(values, headers, "completion_plan", 5),
                    raw_conclusion=raw_conclusion,
                    status=status,
                    registration_month=registration_month,
                    registration_year=registration_year,
                    khmt_month=khmt_month,
                    khmt_year=khmt_year,
                    warnings=warnings,
                )
            )
    return {
        "source_file": str(path),
        "rows": [row.to_dict() for row in rows],
        "warnings": workbook_warnings,
        "row_count": len(rows),
    }
