"""Exercise the same SQL expressions on SQLite and PostgreSQL."""
import unicodedata
from datetime import datetime, timezone

import pytest
from sqlalchemy import literal, select

from app.db.session import create_session
from app.models.domain import SKCTKTModel, User
from app.services.fi.history_query import expressions, fold


@pytest.mark.parametrize("value,expected", [
    ("  ĐIỆN – Sáng kiến cải tiến kỹ thuật  ", "dien – sang kien cai tien ky thuat"),
    (unicodedata.normalize("NFD", "Đường ống cấp nước"), "duong ong cap nuoc"),
    ("ÂĂÊÔƠƯ àảãáạ ằẳẵắặ ầẩẫấậ", "aaeoou aaaaa aaaaa aaaaa"),
    ("100%_\\ FI/2026", "100%_\\ fi/2026"),
    (None, ""),
])
def test_sql_vietnamese_fold(value, expected):
    with create_session() as db:
        assert db.scalar(select(fold(literal(value)))) == expected


@pytest.mark.parametrize("plan,status,expected", [
    ("T10/2026", "Approved", False),
    ("Đã hoàn thành", "Approved", True),
    ("ĐÃ TRIỂN KHAI", "Approved", True),
    ("Dự kiến đã hoàn thành vào T10", "Approved", False),
    ("Chưa thực hiện; sẽ thực hiện", "Approved", False),
    ("Chưa hoàn thành", "Completed", True),
    ("Hoàn thành lắp đặt", "Approved", True),
])
def test_sql_completion_classification(db_session, plan, status, expected):
    with create_session() as db:
        record = SKCTKTModel(id="normalization-fi", sk_code="FI/test", team="TBCH", title="Synthetic", author_name="Test", author_user_id="admin", content_description="Test", completion_plan=plan, status=status, status_history=[])
        db.add(record)
        db.flush()
        expr, _ = expressions(db)
        assert db.scalar(select(expr["done"]).where(SKCTKTModel.id == record.id)) is expected
        db.rollback()


def test_legacy_author_lookup_keeps_team_and_ambiguity(db_session):
    db = db_session
    for user_id, name, team in [("person-a", "Đặng An", "TEST-A"), ("person-b", "Đặng An", "TEST-B"), ("dup-a", "Trùng Tên", "TEST-A"), ("dup-b", "Trùng Tên", "TEST-A")]:
        db.add(User(id=user_id, full_name=name, display_name=name, team=team, role="Staff", password_hash="synthetic-invalid-hash"))
    for record_id, name, team in [("a", "dang an", "TEST-A"), ("b", "ĐẶNG AN", "TEST-B"), ("c", "trung ten", "TEST-A")]:
        db.add(SKCTKTModel(id=record_id, sk_code=f"FI/{record_id}", title="Test", author_name=name, author_user_id="historical-import", team=team, content_description="Test", completion_plan="T10", status="Approved", status_history=[], is_historical_import=True))
    db.flush()
    expr, _ = expressions(db)
    actual = dict(db.execute(select(SKCTKTModel.id, expr["author_id"]).where(SKCTKTModel.id.in_(["a", "b", "c"]))).all())
    assert actual == {"a": "person-a", "b": "person-b", "c": None}


def test_history_json_paths_preserve_registration_and_submitter_priority(db_session):
    db = db_session
    cases = [
        ([{"comments": {"registration_month": 3, "registration_year": 2025, "submitted_by": "first", "created_by": "second"}, "changed_by": "third"}], 3, 2025, "first"),
        ([{"comments": {"registration_month": "12", "registration_year": "2024", "submitted_by": "", "created_by": "second"}, "changed_by": "third"}], 12, 2024, "second"),
        ([{"comments": {"registration_month": "000000003", "registration_year": "2024"}}], 3, 2024, None),
        ([{"comments": {"registration_month": "invalid"}, "changed_by": "third"}], 9, 2026, "third"),
        ([{"comments": {"registration_month": "999999999999999999999999"}, "changed_by": "third"}], 9, 2026, "third"),
        ([{"comments": {"registration_month": 3, "registration_year": "999999999999999999999999"}}], 3, 2026, None),
        ([], 9, 2026, None),
    ]
    for index, (history, month, year, submitter) in enumerate(cases):
        record_id = f"json-fi-{index}"
        db.add(SKCTKTModel(id=record_id, sk_code=f"FI/json/{index}", title="Test", author_name="Test", author_user_id="admin", team="TBCH", content_description="Test", completion_plan="T10", status="Approved", status_history=history, created_at=datetime(2026, 9, 1, tzinfo=timezone.utc)))
        db.flush()
        expr, _ = expressions(db)
        row = db.execute(select(expr["month"], expr["year"], expr["submitter_id"]).where(SKCTKTModel.id == record_id)).one()
        assert tuple(row) == (month, year, submitter)
