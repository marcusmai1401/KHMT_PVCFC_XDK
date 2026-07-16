import re
from dataclasses import asdict, dataclass
from typing import Iterable


@dataclass
class ExtractedMetric:
    kind: str
    actual: float | None = None
    total: float | None = None
    percentage: float | None = None
    target: float | None = None
    confidence: float = 0.0
    source_text: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


RATIO_RE = re.compile(r"(?P<actual>\d+(?:[.,]\d+)?)\s*(?:/|trên)\s*(?P<total>\d+(?:[.,]\d+)?)", re.IGNORECASE)
PERCENT_RE = re.compile(r"(?P<pct>\d+(?:[.,]\d+)?)\s*%")
COUNT_RE = re.compile(r"(?P<count>\d+)\s*(?:thẻ|sáng kiến|ý tưởng|ctkt|giờ|hạng mục|người|nhân sự)", re.IGNORECASE)
TARGET_RE = re.compile(r"(?:chỉ tiêu|target|kế hoạch|planned|mục tiêu)\D*(?P<target>\d+(?:[.,]\d+)?)", re.IGNORECASE)
STOP_COUNT_RE = re.compile(r"(?P<count>\d+(?:[.,]\d+)?)\s*(?:thẻ\s*)?(?:stop|thẻ)", re.IGNORECASE)
SK_COUNT_RE = re.compile(r"(?P<count>\d+(?:[.,]\d+)?)\s*(?:thẻ\s*)?(?:sáng kiến|ý tưởng|ctkt|sk(?:-ctkt)?)", re.IGNORECASE)
HOUR_COUNT_RE = re.compile(r"(?P<count>\d+(?:[.,]\d+)?)\s*(?:giờ|hours?)", re.IGNORECASE)
PERSON_COUNT_RE = re.compile(r"(?P<count>\d+(?:[.,]\d+)?)\s*(?:người|nhân sự)", re.IGNORECASE)


def _number(value: str) -> float:
    return float(value.replace(",", "."))


def _target(source: str) -> float | None:
    match = TARGET_RE.search(source)
    return _number(match.group("target")) if match else None


def _is_date_like_ratio(source: str, match: re.Match[str]) -> bool:
    actual_text = match.group("actual")
    total_text = match.group("total")
    if any(separator in actual_text or separator in total_text for separator in (".", ",")):
        return False
    actual = int(actual_text)
    total = int(total_text)
    if not (1 <= actual <= 31 and 1 <= total <= 12):
        return False
    before = source[max(0, match.start() - 24) : match.start()].lower()
    after = source[match.end() : match.end() + 20].lower()
    if re.match(r"\s*/\s*\d{2,4}", after):
        return True
    if re.match(r"\s*[:~]", after):
        return True
    return bool(
        re.search(
            r"(?:ngày|ngay|đến|den|từ|tu|tháng|chạy bộ|lần\s*\d+\s*:)\s*$",
            before,
            re.IGNORECASE,
        )
    )


def _ratio_metrics(source: str, kind: str, target: float | None, confidence: float = 0.9) -> list[ExtractedMetric]:
    metrics = []
    for match in RATIO_RE.finditer(source):
        if _is_date_like_ratio(source, match):
            continue
        actual = _number(match.group("actual"))
        total = _number(match.group("total"))
        percentage = round(actual / total * 100, 2) if total else None
        metrics.append(
            ExtractedMetric(
                kind=kind,
                actual=actual,
                total=total,
                percentage=percentage,
                target=target,
                confidence=confidence,
                source_text=source,
            )
        )
    return metrics


def _percentage_metric(source: str, kind: str, target: float | None) -> ExtractedMetric | None:
    match = PERCENT_RE.search(source)
    if not match:
        return None
    return ExtractedMetric(
        kind=kind,
        percentage=_number(match.group("pct")),
        target=target,
        confidence=0.75,
        source_text=source,
    )


def _first_count(source: str, pattern: re.Pattern[str]) -> float | None:
    match = pattern.search(source)
    return _number(match.group("count")) if match else None


def _domain_for_hint(kind_hint: str, source: str) -> str:
    hint = (kind_hint or "").upper()
    lowered = source.lower()
    if hint.startswith("O2.KR"):
        return "scdx"
    if hint == "O3.KR2":
        return "stop_cards"
    if hint == "O5.KR12":
        return "sk_initiatives"
    if hint == "O5.KR13":
        return "ctkt_fi"
    if hint in {"O6.KR1", "O6.KR2", "O6.KR4"}:
        return "vhdn"
    if hint == "O5.KR3":
        return "training_hours"
    if "stop" in lowered or "thẻ stop" in lowered:
        return "stop_cards"
    if "vhdn" in lowered or "hội thao" in lowered:
        return "vhdn"
    if "giờ" in lowered or "training" in lowered:
        return "training_hours"
    return "generic"


def _dedupe_metrics(metrics: Iterable[ExtractedMetric]) -> list[ExtractedMetric]:
    seen = set()
    unique = []
    for metric in metrics:
        key = (metric.kind, metric.actual, metric.total, metric.percentage, metric.target)
        if key in seen:
            continue
        seen.add(key)
        unique.append(metric)
    return unique


def _extract_scdx(source: str, target: float | None) -> list[ExtractedMetric]:
    metrics = _ratio_metrics(source, "scdx", target, 0.9)
    if metrics:
        return metrics
    percentage = _percentage_metric(source, "scdx", target)
    return [percentage] if percentage else []


def _extract_stop(source: str, target: float | None) -> list[ExtractedMetric]:
    ratio_metrics = _ratio_metrics(source, "stop_cards", target, 0.9)
    if ratio_metrics:
        return ratio_metrics
    actual = _first_count(source, STOP_COUNT_RE)
    if actual is None:
        actual = _first_count(source, COUNT_RE)
    if actual is None:
        return []
    return [
        ExtractedMetric(
            kind="stop_cards",
            actual=actual,
            target=target,
            confidence=0.85 if target is not None else 0.65,
            source_text=source,
        )
    ]


def _extract_sk_ctkt(source: str, target: float | None, kind: str) -> list[ExtractedMetric]:
    actual = _first_count(source, SK_COUNT_RE)
    if actual is None:
        return []
    return [
        ExtractedMetric(
            kind=kind,
            actual=actual,
            target=target,
            confidence=0.85,
            source_text=source,
        )
    ]


def _extract_vhdn(source: str, target: float | None) -> list[ExtractedMetric]:
    metrics = _ratio_metrics(source, "vhdn", target, 0.85)
    if metrics:
        return metrics
    counts = [_number(match.group("count")) for match in PERSON_COUNT_RE.finditer(source)]
    if not counts:
        return []
    return [
        ExtractedMetric(
            kind="vhdn",
            actual=counts[0],
            total=counts[1] if len(counts) > 1 else None,
            target=target,
            confidence=0.8 if len(counts) > 1 else 0.6,
            source_text=source,
        )
    ]


def _extract_training(source: str, target: float | None) -> list[ExtractedMetric]:
    metrics = _ratio_metrics(source, "training_hours", target, 0.85)
    if metrics:
        return metrics
    actual = _first_count(source, HOUR_COUNT_RE)
    if actual is None:
        return []
    return [
        ExtractedMetric(
            kind="training_hours",
            actual=actual,
            target=target,
            confidence=0.85 if target is not None else 0.65,
            source_text=source,
        )
    ]


def _extract_generic(source: str, kind_hint: str, target: float | None) -> list[ExtractedMetric]:
    metrics = _ratio_metrics(source, kind_hint, target, 0.75)
    if metrics:
        return metrics
    percentage = _percentage_metric(source, kind_hint, target)
    if percentage:
        return [percentage]
    generic = []
    for match in COUNT_RE.finditer(source):
        generic.append(
            ExtractedMetric(
                kind=kind_hint,
                actual=_number(match.group("count")),
                target=target,
                confidence=0.55,
                source_text=source,
            )
        )
    return generic


def extract_metrics(text: str, kind_hint: str = "generic") -> list[ExtractedMetric]:
    source = text or ""
    target = _target(source)
    domain = _domain_for_hint(kind_hint, source)
    if domain == "scdx":
        metrics = _extract_scdx(source, target)
    elif domain == "stop_cards":
        metrics = _extract_stop(source, target)
    elif domain == "sk_initiatives":
        metrics = _extract_sk_ctkt(source, target, "sk_initiatives")
    elif domain == "ctkt_fi":
        metrics = _extract_sk_ctkt(source, target, "ctkt_fi")
    elif domain == "vhdn":
        metrics = _extract_vhdn(source, target)
    elif domain == "training_hours":
        metrics = _extract_training(source, target)
    else:
        metrics = []
    return _dedupe_metrics(metrics or _extract_generic(source, kind_hint, target))


def warning_for_low_confidence(metric: ExtractedMetric, source_cell: dict | None = None) -> dict | None:
    if metric.confidence >= 0.7:
        return None
    return {
        "warning_type": "LOW_CONFIDENCE_EXTRACTION",
        "severity": "MEDIUM",
        "source_cell": source_cell,
        "extracted_value": metric.to_dict(),
        "reason": f"Extraction confidence {metric.confidence:.2f} is below threshold",
        "admin_action": "PENDING",
    }


def warnings_for_ambiguous_metrics(metrics: list[ExtractedMetric], source_cell: dict | None = None) -> list[dict]:
    if len(metrics) < 2:
        return []
    signatures = {
        (metric.kind, metric.actual, metric.total, metric.percentage, metric.target)
        for metric in metrics
    }
    if len(signatures) <= 1:
        return []
    return [
        {
            "warning_type": "AMBIGUOUS_DATA",
            "severity": "MEDIUM",
            "source_cell": source_cell,
            "extracted_value": [metric.to_dict() for metric in metrics],
            "reason": "Multiple conflicting numerical candidates were extracted from the same report text",
            "admin_action": "PENDING",
        }
    ]
