from app.core.config import settings
from app.services.integration.bm01_import import preview_bm01


def test_bm01_preview_reads_four_sheets_when_workbook_exists():
    preview = preview_bm01(settings.source_bm01_workbook)
    assert preview["row_count"] == 85
    assert preview["warnings"] == []
    teams = {row["team"] for row in preview["rows"]}
    assert {"TBCH", "TBĐL", "TBHTĐK", "TCĐK"}.issubset(teams)

    tbd_first = next(row for row in preview["rows"] if row["source_sheet"] == "TBĐ" and row["source_row"] == 6)
    assert tbd_first["status"] == "Approved"
    tbd_khmt = next(row for row in preview["rows"] if row["source_sheet"] == "TBĐ" and row["source_row"] == 7)
    assert tbd_khmt["khmt_month"] == 1
    assert tbd_khmt["consider_for_khmt"] is True

    expected_rows = {
        ("TBCH", 7): {"status": "Deferred", "khmt_month": None, "consider_for_khmt": False},
        ("TBCH", 11): {"status": "Approved", "khmt_month": 1, "consider_for_khmt": True},
        ("TBCH", 12): {"status": "Rejected", "khmt_month": None, "consider_for_khmt": False},
        ("TBĐ", 7): {"status": "Approved", "khmt_month": 1, "consider_for_khmt": True},
        ("TBHTĐK", 13): {"status": "Approved", "khmt_month": 4, "consider_for_khmt": True},
        ("TC- ĐK", 26): {"status": "Approved", "khmt_month": 5, "consider_for_khmt": True},
        ("TC- ĐK", 27): {"status": "Submitted", "khmt_month": None, "consider_for_khmt": False},
    }
    rows_by_source = {(row["source_sheet"], row["source_row"]): row for row in preview["rows"]}
    for source, expected in expected_rows.items():
        row = rows_by_source[source]
        for field, value in expected.items():
            assert row[field] == value

    khmt_rows = [row for row in preview["rows"] if row["consider_for_khmt"]]
    assert khmt_rows
    assert {row["status"] for row in khmt_rows} == {"Approved"}
