import re
import unicodedata

from app.services.okr.constants import BASELINE_HEADCOUNT, FIXED_VHDN_EXEMPTIONS


def _compact(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value or "")
    normalized = normalized.lower().strip()
    normalized = re.sub(r"[\s\.\-_/]+", " ", normalized)
    return normalized


def normalize_assessment(value: str | None) -> str:
    text = _compact(value or "")
    if not text:
        return ""
    if "n/a" in text or "khong co ke hoach" in _strip_accents(text) or "không có kế hoạch" in text:
        return "N/A"
    if "xuat sac" in _strip_accents(text) or "xuất sắc" in text:
        return "Hoàn thành xuất sắc"
    if "tot" in _strip_accents(text) or "tốt" in text:
        return "Hoàn thành tốt"
    if "khong ht" in _strip_accents(text) or "khong hoan" in _strip_accents(text) or "không ht" in text:
        return "Không hoàn thành"
    if "hoan thanh" in _strip_accents(text) or "hoàn thành" in text or text == "ht":
        return "Hoàn thành"
    return value.strip() if value else ""


def _strip_accents(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in value if unicodedata.category(ch) != "Mn").replace("đ", "d")


def map_to_dashboard_status(assessment: str | None, has_plan: bool = True) -> str:
    normalized = normalize_assessment(assessment)
    if normalized in {"Hoàn thành tốt", "Hoàn thành xuất sắc"}:
        return "GOOD"
    if normalized == "Hoàn thành":
        return "OK"
    if normalized == "Không hoàn thành":
        return "NG"
    if normalized == "N/A":
        return "#N/A"
    return "OK" if has_plan else "#N/A"


def calculate_vhdn_eligible(team: str, reported_eligible: int | None = None) -> tuple[int, dict | None]:
    if reported_eligible and reported_eligible > 0:
        return reported_eligible, None
    baseline = BASELINE_HEADCOUNT[team]
    exemptions = [e for e in FIXED_VHDN_EXEMPTIONS if e["team"] == team]
    eligible = baseline - len(exemptions)
    warning = {
        "warning_type": "VHDN_ELIGIBLE_CALCULATED",
        "severity": "LOW",
        "reason": f"Using baseline headcount {baseline} minus {len(exemptions)} fixed exemptions",
        "extracted_value": eligible,
    }
    return eligible, warning


def expected_status_for_count(actual: int, target: int) -> str:
    if target <= 0:
        return "#N/A"
    if actual >= target * 1.5:
        return "GOOD"
    if actual >= target:
        return "OK"
    return "NG"


def calculate_scdx(completed: float | None, total: float | None, target: float = 99, reasons: str = "") -> str:
    if not total:
        return "#N/A"
    percentage = ((completed or 0) / total) * 100
    if percentage >= target:
        return "OK"
    if reasons and reasons.strip():
        return "OK"
    return "NG"


def calculate_stop(actual: float | None, target: float | None) -> str:
    if not target or target <= 0:
        return "#N/A"
    return expected_status_for_count(int(actual or 0), int(target))


def calculate_vhdn_status(participants: float | None, eligible: float | None) -> str:
    if not eligible or eligible <= 0:
        return "#N/A"
    percentage = ((participants or 0) / eligible) * 100
    if percentage > 50:
        return "GOOD"
    if participants and participants > 0:
        return "OK"
    return "NG"


def calculate_skctkt(count: float | None, target: int = 1) -> str:
    actual = int(count or 0)
    if actual >= max(target * 3, target + 2):
        return "GOOD"
    if actual >= target:
        return "OK"
    return "NG"


def expected_status_for_kr(workshop_kr_code: str, metrics: list[dict], notes: str = "") -> str | None:
    if not metrics:
        return None
    metric = metrics[0]
    actual = metric.get("actual")
    total = metric.get("total")
    percentage = metric.get("percentage")
    target = metric.get("target")
    if workshop_kr_code in {"O2.KR1", "O2.KR2", "O2.KR3"}:
        if actual is not None and total is not None:
            return calculate_scdx(actual, total, target or 98, notes)
        if percentage is not None:
            if percentage >= (target or 98):
                return "OK"
            return "OK" if notes.strip() else "NG"
    if workshop_kr_code == "O3.KR2":
        return calculate_stop(actual, total or target)
    if workshop_kr_code in {"O6.KR1", "O6.KR2", "O6.KR4"}:
        return calculate_vhdn_status(actual, total)
    if workshop_kr_code == "O5.KR12":
        return calculate_skctkt(actual, int(target or 8))
    if workshop_kr_code == "O5.KR13":
        return calculate_skctkt(actual, int(target or 1))
    if workshop_kr_code == "O5.KR3" and actual is not None:
        return "OK"
    return None
