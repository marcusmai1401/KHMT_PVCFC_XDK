from __future__ import annotations

import json
import logging
from typing import Any

from app.services.llm.client import get_llm_client

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT_TEMPLATE = (
    "Extract structured OKR metrics from the following Vietnamese report text.\n\n"
    "Report text:\n```\n{source_text}\n```\n\n"
    "KR code hint: {kr_code}\n\n"
    "Return a JSON array of metrics. Each metric object must have:\n"
    '- "kind": metric type (e.g. "scdx", "stop_cards", "sk_ctkt", "vhdn", "training_hours")\n'
    '- "actual": actual value (number or null)\n'
    '- "total": total/target value (number or null)\n'
    '- "percentage": percentage value (number or null)\n'
    '- "target": target value (number or null)\n'
    '- "confidence": your confidence in extraction (0.0 to 1.0)\n'
    '- "reasoning": brief explanation of how you extracted this\n\n'
    "Rules:\n"
    "- Only extract numeric data that is explicitly stated or clearly implied.\n"
    "- If a ratio like '15/20' is found, actual=15, total=20, percentage=75.0.\n"
    "- If only a percentage is found, set percentage and leave actual/total as null.\n"
    "- If only a count is found, set actual and leave total/percentage as null.\n"
    "- Be conservative: if unsure, set confidence below 0.5.\n"
    "- Return ONLY valid JSON array, no markdown, no extra text."
)


def extract_with_llm(source_text: str, kr_code: str = "generic") -> list[dict[str, Any]]:
    client = get_llm_client()
    prompt = EXTRACTION_PROMPT_TEMPLATE.format(source_text=source_text, kr_code=kr_code)
    result = client.extract_json(prompt)
    if isinstance(result, dict):
        result = [result]
    validated = []
    for item in result:
        if not isinstance(item, dict):
            continue
        validated.append({
            "kind": item.get("kind", kr_code),
            "actual": item.get("actual"),
            "total": item.get("total"),
            "percentage": item.get("percentage"),
            "target": item.get("target"),
            "confidence": min(1.0, max(0.0, float(item.get("confidence", 0.5)))),
            "reasoning": item.get("reasoning", ""),
            "source": "llm",
        })
    return validated


def hybrid_extract(source_text: str, kr_code: str = "generic", *, use_llm: bool = True) -> dict[str, Any]:
    from app.services.okr.extraction import extract_metrics

    regex_metrics = extract_metrics(source_text, kr_code)
    regex_results = [m.to_dict() for m in regex_metrics]

    low_confidence = [m for m in regex_metrics if m.confidence < 0.7]

    llm_results = []
    if use_llm and (low_confidence or not regex_results):
        try:
            llm_results = extract_with_llm(source_text, kr_code)
        except Exception as exc:
            logger.warning("LLM extraction failed, falling back to regex only: %s", exc)

    return {
        "regex_results": regex_results,
        "llm_results": llm_results,
        "llm_used": bool(llm_results),
        "llm_available": use_llm,
        "source_text": source_text,
        "kr_code": kr_code,
    }
