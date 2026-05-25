"""reparse FI completed_at dates from completion_plan

Revision ID: 0007_fi_completed_at_dates
Revises: 0006_backfill_fi_completed_at
Create Date: 2026-05-25
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op


revision = "0007_fi_completed_at_dates"
down_revision = "0006_backfill_fi_completed_at"
branch_labels = None
depends_on = None


def _normalize(value) -> str:
    text = str(value or "").strip().lower().replace("đ", "d")
    normalized = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


_NOT_DONE_MARKERS = (
    "chua thuc hien",
    "chua hoan thanh",
    "du kien",
    "co the thuc hien",
    "se thuc hien",
)
_DONE_PATTERNS = (
    re.compile(r"\bda\s+hoan\s+thanh\b"),
    re.compile(r"\bda\s+thuc\s+hien\b"),
    re.compile(r"\bda\s+trien\s+khai\b"),
    re.compile(r"\bda\s+lap\b"),
    re.compile(r"^hoan\s+thanh\b"),
)
_DATE_RE = re.compile(r"\b(0?[1-9]|[12]\d|3[01])\s*[./-]\s*(0?[1-9]|1[0-2])\s*[./-]\s*(20\d{2})\b")
_MONTH_RE = re.compile(r"(?:\bt|thang)?\s*(1[0-2]|0?[1-9])\s*[./-]\s*(20\d{2})\b")
_YEAR_RE = re.compile(r"\b(20\d{2})\b")


def _indicates_done(text: str) -> bool:
    if not text:
        return False
    if any(marker in text for marker in _NOT_DONE_MARKERS):
        return False
    return any(pattern.search(text) for pattern in _DONE_PATTERNS)


def _parse_explicit_completed_at(plan) -> datetime | None:
    text = _normalize(plan)
    if not _indicates_done(text):
        return None
    match = _DATE_RE.search(text)
    if match:
        day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
        try:
            return datetime(year, month, day, tzinfo=timezone.utc)
        except ValueError:
            return None
    match = _MONTH_RE.search(text)
    if match:
        return datetime(int(match.group(2)), int(match.group(1)), 1, tzinfo=timezone.utc)
    match = _YEAR_RE.search(text)
    if match:
        return datetime(int(match.group(1)), 1, 1, tzinfo=timezone.utc)
    return None


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT id, completion_plan FROM sk_ctkt "
            "WHERE is_historical_import = :is_historical"
        ),
        {"is_historical": True},
    ).fetchall()
    update_stmt = sa.text("UPDATE sk_ctkt SET completed_at = :completed_at WHERE id = :id")
    for row in rows:
        completed_at = _parse_explicit_completed_at(row[1])
        if completed_at is None:
            continue
        connection.execute(update_stmt, {"completed_at": completed_at, "id": row[0]})


def downgrade() -> None:
    # Data correction only. Do not erase completed_at on downgrade.
    pass
