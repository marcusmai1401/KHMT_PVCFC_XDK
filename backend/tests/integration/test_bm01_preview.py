from app.core.config import settings
from app.services.integration.bm01_import import preview_bm01


def test_bm01_preview_reads_four_sheets_when_workbook_exists():
    preview = preview_bm01(settings.source_bm01_workbook)
    assert preview["row_count"] > 0
    teams = {row["team"] for row in preview["rows"]}
    assert {"TBCH", "TBĐL", "TBHTĐK", "TCĐK"}.issubset(teams)

