from app.core.config import settings
from app.services.okr.kr_mapping import extract_workshop_kr_code, load_master_kr_mapping


def test_extract_workshop_kr_code_from_real_code():
    assert extract_workshop_kr_code("ĐCM.O1.KR2.ĐK.O2.KR3") == "O2.KR3"
    assert extract_workshop_kr_code("ĐK.O6.KR4") == "O6.KR4"


def test_master_mapping_has_37_columns_from_workbook_when_available():
    mapping = load_master_kr_mapping(settings.source_okr_workbook)
    assert len(mapping) == 37
    assert mapping[0].dashboard_column == "L"
    assert mapping[-1].dashboard_column == "AV"
    by_code = {row.workshop_kr_code: row for row in mapping}
    assert "BDĐK" in by_code["O2.KR2"].kr_name or "BD định kỳ" in by_code["O2.KR2"].kr_name
    assert "SCĐX" in by_code["O2.KR3"].measurement_type or "sửa chữa đột xuất" in by_code["O2.KR3"].kr_name.lower()

