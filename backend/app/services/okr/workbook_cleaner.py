from typing import Any


def strip_workbook_external_state(workbook: Any) -> None:
    """Remove source-workbook state that makes exported XLSX files slow to open."""
    if hasattr(workbook, "_external_links"):
        workbook._external_links = []
    if hasattr(workbook, "defined_names"):
        workbook.defined_names.clear()
    for sheet in getattr(workbook, "worksheets", []):
        if hasattr(sheet, "defined_names"):
            sheet.defined_names.clear()

    calculation = getattr(workbook, "calculation", None)
    if calculation is not None:
        calculation.fullCalcOnLoad = False
        calculation.forceFullCalc = False
        calculation.calcOnSave = False
        calculation.calcMode = "auto"
