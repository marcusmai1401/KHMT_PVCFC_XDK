from __future__ import annotations

import json
import logging
from typing import Any

from app.services.llm.client import SYSTEM_PROMPT_OKR, get_llm_client

logger = logging.getLogger(__name__)

ANALYSIS_SYSTEM_PROMPT = (
    f"{SYSTEM_PROMPT_OKR}\n\n"
    "When analyzing OKR data, provide:\n"
    "1. Overall performance summary\n"
    "2. Key strengths (objectives with high completion rates)\n"
    "3. Areas needing improvement (objectives below target)\n"
    "4. Specific actionable recommendations\n"
    "5. Risk alerts if any metric shows concerning trends\n\n"
    "Format your response in clear sections with bullet points."
)


def analyze_dashboard(dashboard_data: dict[str, Any], month: int, year: int) -> dict[str, Any]:
    client = get_llm_client()
    prompt = (
        f"Analyze the following OKR dashboard data for month {month}/{year}.\n\n"
        f"Dashboard data:\n{json.dumps(dashboard_data, ensure_ascii=False, indent=2)}\n\n"
        "Provide a comprehensive analysis with strengths, weaknesses, and recommendations."
    )
    messages = [
        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    response = client.chat(messages, max_tokens=4096)
    return {
        "analysis": response.content,
        "month": month,
        "year": year,
        "model": response.model,
        "usage": response.usage,
        "latency_ms": response.latency_ms,
    }


def analyze_team_report(report_data: dict[str, Any]) -> dict[str, Any]:
    client = get_llm_client()
    assessments = report_data.get("assessments", [])
    team = report_data.get("team", "Unknown")
    prompt = (
        f"Analyze the team report for team '{team}'.\n\n"
        f"Assessments:\n{json.dumps(assessments, ensure_ascii=False, indent=2)}\n\n"
        "Identify:\n"
        "1. Which KRs are on track vs behind\n"
        "2. Data quality issues or inconsistencies\n"
        "3. Recommendations for the team"
    )
    messages = [
        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    response = client.chat(messages, max_tokens=4096)
    return {
        "analysis": response.content,
        "team": team,
        "model": response.model,
        "usage": response.usage,
        "latency_ms": response.latency_ms,
    }


def compare_reports(
    current_report: dict[str, Any],
    previous_report: dict[str, Any] | None,
) -> dict[str, Any]:
    client = get_llm_client()
    team = current_report.get("team", "Unknown")
    if previous_report is None:
        prompt = (
            f"This is the first report for team '{team}'. "
            "Provide a baseline analysis and set expectations for next month."
        )
    else:
        prompt = (
            f"Compare these two consecutive reports for team '{team}'.\n\n"
            f"Current report:\n{json.dumps(current_report.get('assessments', []), ensure_ascii=False, indent=2)}\n\n"
            f"Previous report:\n{json.dumps(previous_report.get('assessments', []), ensure_ascii=False, indent=2)}\n\n"
            "Identify trends, improvements, and regressions."
        )
    messages = [
        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    response = client.chat(messages, max_tokens=4096)
    return {
        "analysis": response.content,
        "team": team,
        "model": response.model,
        "usage": response.usage,
        "latency_ms": response.latency_ms,
    }
