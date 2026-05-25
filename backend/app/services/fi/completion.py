from __future__ import annotations

from datetime import date, datetime, time, timezone
import re
import unicodedata


def _normalize(value: str | None) -> str:
    text = str(value or "").strip().lower().replace("đ", "d")
    normalized = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def completion_plan_indicates_done(value: str | None) -> bool:
    text = _normalize(value)
    if not text:
        return False
    not_done_markers = (
        "chua thuc hien",
        "chua hoan thanh",
        "du kien",
        "co the thuc hien",
        "se thuc hien",
    )
    if any(marker in text for marker in not_done_markers):
        return False
    done_patterns = (
        r"\bda\s+hoan\s+thanh\b",
        r"\bda\s+thuc\s+hien\b",
        r"\bda\s+trien\s+khai\b",
        r"\bda\s+lap\b",
        r"^hoan\s+thanh\b",
    )
    return any(re.search(pattern, text) for pattern in done_patterns)


def completion_date_to_datetime(value: date | datetime | str | None) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    text = str(value).strip()
    try:
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def completion_plan_completed_at(
    value: str | None,
    *,
    fallback: datetime | None = None,
) -> datetime | None:
    if not completion_plan_indicates_done(value):
        return None
    text = _normalize(value)
    date_match = re.search(r"\b(0?[1-9]|[12]\d|3[01])\s*[./-]\s*(0?[1-9]|1[0-2])\s*[./-]\s*(20\d{2})\b", text)
    if date_match:
        day, month, year = (int(date_match.group(1)), int(date_match.group(2)), int(date_match.group(3)))
        try:
            return datetime(year, month, day, tzinfo=timezone.utc)
        except ValueError:
            pass
    month_match = re.search(r"(?:\bt|thang)?\s*(1[0-2]|0?[1-9])\s*[./-]\s*(20\d{2})\b", text)
    if month_match:
        return datetime(int(month_match.group(2)), int(month_match.group(1)), 1, tzinfo=timezone.utc)
    year_match = re.search(r"\b(20\d{2})\b", text)
    if year_match:
        return datetime(int(year_match.group(1)), 1, 1, tzinfo=timezone.utc)
    if fallback is not None:
        return fallback if fallback.tzinfo else fallback.replace(tzinfo=timezone.utc)
    return None
