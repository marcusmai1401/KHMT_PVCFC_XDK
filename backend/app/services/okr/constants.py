from dataclasses import dataclass


TEAMS = ("TBHTĐK", "TBCH", "TBĐL", "TCĐK")
TEAM_DISPLAY_NAMES = {
    "TBHTĐK": "Đội thiết bị hệ thống điều khiển",
    "TBCH": "Đội thiết bị chấp hành",
    "TBĐL": "Đội thiết bị đo lường",
    "TCĐK": "Tổ trực ca",
}
WORKSHOP_STAFF_HEADCOUNT = 5
BASELINE_HEADCOUNT = {"TBHTĐK": 10, "TBCH": 14, "TBĐL": 12, "TCĐK": 14}
FIXED_VHDN_EXEMPTIONS = [
    {"personnel_name": "Phạm Văn Tuyên", "team": "TBCH", "exemption_reason": "Bệnh nặng"},
    {"personnel_name": "Lê Bá Tứ", "team": "TBHTĐK", "exemption_reason": "Bệnh nặng"},
]


@dataclass(frozen=True)
class DataSheetBlock:
    name: str
    start_row: int
    end_row: int


DATA_SHEET_BLOCKS = [
    DataSheetBlock("headers", 1, 2),
    DataSheetBlock("scdx_monthly", 3, 15),
    DataSheetBlock("scdx_by_team", 16, 18),
    DataSheetBlock("scdx_tcdk_shift", 21, 35),
    DataSheetBlock("bddk_npk", 43, 62),
    DataSheetBlock("stop_cards", 65, 84),
    DataSheetBlock("vhdn_running", 86, 89),
    DataSheetBlock("vhdn_sports", 91, 94),
    DataSheetBlock("training_hours", 98, 107),
    DataSheetBlock("sk_initiatives", 110, 114),
    DataSheetBlock("weekly_scdx", 117, 127),
    DataSheetBlock("competency", 130, 142),
]


DASHBOARD_COLUMNS = [
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "U",
    "V",
    "W",
    "X",
    "Y",
    "Z",
    "AA",
    "AB",
    "AC",
    "AD",
    "AE",
    "AF",
    "AG",
    "AH",
    "AI",
    "AJ",
    "AK",
    "AL",
    "AM",
    "AN",
    "AO",
    "AP",
    "AQ",
    "AR",
    "AS",
    "AT",
    "AU",
    "AV",
]
