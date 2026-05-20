import re
import unicodedata

from app.services.okr.constants import TEAMS


TEAM_LABEL_ALIASES = {
    "htdk": "TBHTĐK",
    "htđk": "TBHTĐK",
    "tbhtdk": "TBHTĐK",
    "tbhtđk": "TBHTĐK",
    "doi thiet bi he thong dieu khien": "TBHTĐK",
    "đội thiết bị hệ thống điều khiển": "TBHTĐK",
    "doi thiet bi htdk": "TBHTĐK",
    "tbch": "TBCH",
    "doi thiet bi chap hanh": "TBCH",
    "đội thiết bị chấp hành": "TBCH",
    "doi thiet bi co cau chap hanh": "TBCH",
    "đội thiết bị cơ cấu chấp hành": "TBCH",
    "tbdl": "TBĐL",
    "tbđl": "TBĐL",
    "tbd": "TBĐL",
    "tbđ": "TBĐL",
    "doi thiet bi do": "TBĐL",
    "đội thiết bị đo": "TBĐL",
    "doi thiet bi do luong": "TBĐL",
    "đội thiết bị đo lường": "TBĐL",
    "tcdk": "TCĐK",
    "tcđk": "TCĐK",
    "to truc ca": "TCĐK",
    "tổ trực ca": "TCĐK",
    "to truc ca dieu khien": "TCĐK",
    "tổ trực ca điều khiển": "TCĐK",
}


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return stripped.replace("đ", "d").replace("Đ", "D")


def _key(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value or "").strip().lower()
    normalized = re.sub(r"[\s._/\-]+", " ", normalized)
    return normalized.strip()


def _ascii_key(value: str) -> str:
    return _key(_strip_accents(value))


def normalize_team_label(value: str) -> tuple[str | None, str]:
    original_label = str(value or "").strip()
    if not original_label:
        return None, original_label
    if original_label in TEAMS:
        return original_label, original_label
    direct_key = _key(original_label)
    ascii_key = _ascii_key(original_label)
    return TEAM_LABEL_ALIASES.get(direct_key) or TEAM_LABEL_ALIASES.get(ascii_key), original_label
