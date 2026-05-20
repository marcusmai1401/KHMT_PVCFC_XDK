from typing import Any


EVALUATION_RULE_REFERENCES = {
    "good": ["Dashboard!M15:P15", "Dashboard!M16:P16", "Dashboard!H17:P17", "Dashboard!L18:P18"],
    "completed": ["Dashboard!W15:Z15", "Dashboard!W16:Z16", "Dashboard!AD15:AF16"],
    "failed": ["Dashboard!AG15:AJ15", "Dashboard!AG16:AJ16", "Dashboard!AN15:AQ16"],
}

GOOD_BONUS_CODES = {"O6.KR1", "O6.KR2", "O5.KR13"}


def has_discipline_violation(discipline_status: str | None) -> bool:
    return str(discipline_status or "").strip().upper() in {"NOK", "NG", "VI PHẠM", "VI PHAM"}


def classify_dashboard_assessment(
    kr_statuses: dict[str, str],
    discipline_status: str | None = "OK",
) -> str:
    """Classify one team using the visible Excel dashboard rule text."""
    if has_discipline_violation(discipline_status):
        return "Không HT"
    has_o1_o5_ng = any(
        code.startswith(("O1.", "O2.", "O3.", "O4.", "O5.")) and status == "NG"
        for code, status in kr_statuses.items()
    )
    if has_o1_o5_ng:
        return "Không HT"
    if any(kr_statuses.get(code) == "GOOD" for code in GOOD_BONUS_CODES):
        return "HT tốt"
    return "HT"


def source_references() -> dict[str, list[str]]:
    return EVALUATION_RULE_REFERENCES


def evaluation_metadata() -> dict[str, Any]:
    return {
        "source_references": EVALUATION_RULE_REFERENCES,
        "good_bonus_codes": sorted(GOOD_BONUS_CODES),
    }
