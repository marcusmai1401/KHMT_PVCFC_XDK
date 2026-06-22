"""Unit tests for Dashboard sheet narrative extraction.

The Dashboard sheet keeps its free text (objective Mục tiêu/Kết quả lines, per-KR
progress notes, VHDN "Số lần tổ chức" counts and the discipline-violation note) inside
drawing text boxes rather than cells. ``extract_dashboard_narratives`` recovers them so
the web dashboard can reproduce the Excel content. These tests feed a synthetic
drawing-only workbook so they do not depend on any source file.
"""

from io import BytesIO
from zipfile import ZipFile

from app.services.okr.historical_snapshot import extract_dashboard_narratives


def _anchor(col: int, row: int, lines: list[str]) -> str:
    paragraphs = "".join(
        f"<a:p><a:r><a:t>{line}</a:t></a:r></a:p>" for line in lines
    )
    return (
        "<xdr:twoCellAnchor>"
        f"<xdr:from><xdr:col>{col}</xdr:col><xdr:colOff>0</xdr:colOff>"
        f"<xdr:row>{row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>"
        f"<xdr:sp><xdr:txBody>{paragraphs}</xdr:txBody></xdr:sp>"
        "</xdr:twoCellAnchor>"
    )


def _workbook_with_boxes(anchors: list[str]) -> bytes:
    drawing = (
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"'
        ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        + "".join(anchors)
        + "</xdr:wsDr>"
    )
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("xl/drawings/drawing2.xml", drawing)
    return buffer.getvalue()


def test_extract_dashboard_narratives_full():
    workbook = _workbook_with_boxes(
        [
            _anchor(0, 31, ["O1: Không có sự cố - Mục tiêu: 0 vụ - Kết quả: 0 vụ"]),
            _anchor(0, 25, ["VI PHẠM QUY ĐỊNH CỦA NHÀ MÁY/ CÔNG TY"]),
            _anchor(0, 27, ["Không ghi nhận vi phạm quy định của Nhà máy/Công ty trong tháng 5."]),
            _anchor(2, 179, ["KR 02 Cải tiến hệ thống robot NPK"]),
            _anchor(2, 183, ["- Hoàn thành lập trình tọa độ cho loại bao 25kg."]),
            _anchor(27, 101, ["KR 8. Rà soát ống tubing", "- TBCH: Đang thực hiện theo kế hoạch."]),
            _anchor(30, 195, ["5", "Lũy kế", "Mục tiêu", "20"]),
            _anchor(39, 195, ["1", "Lũy kế", "Mục tiêu", "4"]),
            _anchor(29, 42, ["8 vị trí chức danh"]),
            _anchor(35, 63, ["33 CBCNV (KTV)"]),
        ]
    )

    result = extract_dashboard_narratives(workbook)

    assert result["objectives"]["O1"]["target"] == "0 vụ"
    assert result["objectives"]["O1"]["result"] == "0 vụ"
    assert result["violations"], "violation note should be captured"

    assert "O4.KR2" in result["kr_details"]
    assert any("lập trình" in line for line in result["kr_details"]["O4.KR2"])
    assert any("TBCH" in line for line in result["kr_details"]["O5.KR8"])

    assert result["o6_counts"]["running"] == {"actual": "5", "target": "20"}
    assert result["o6_counts"]["sports"] == {"actual": "1", "target": "4"}

    assert result["extras"]["competency_positions"] == "8 vị trí chức danh"
    assert result["extras"]["cbcnv"] == "33 CBCNV (KTV)"


def test_extract_dashboard_narratives_handles_missing_drawings():
    """A workbook without any drawing parts must yield empty (not raise)."""
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("xl/workbook.xml", "<workbook/>")
    result = extract_dashboard_narratives(buffer.getvalue())
    assert result == {
        "objectives": {},
        "kr_details": {},
        "violations": [],
        "o6_counts": {},
        "extras": {},
    }
