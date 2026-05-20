from __future__ import annotations

import json
import logging
from typing import Any

from app.services.llm.client import SYSTEM_PROMPT_CHATBOT, get_llm_client

logger = logging.getLogger(__name__)

CONTEXT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_team_report",
            "description": "Get the current OKR report data for a specific team.",
            "parameters": {
                "type": "object",
                "properties": {
                    "team": {"type": "string", "description": "Team name"},
                },
                "required": ["team"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_summary",
            "description": "Get the OKR dashboard summary for a given month/year.",
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {"type": "integer", "description": "Month (1-12)"},
                    "year": {"type": "integer", "description": "Year"},
                },
                "required": ["month", "year"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_teams",
            "description": "List all teams in the system.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _build_context_prompt(context_data: dict[str, Any] | None) -> str:
    if not context_data:
        return ""
    parts = []
    if "reports" in context_data:
        parts.append(f"Available team reports: {json.dumps(context_data['reports'], ensure_ascii=False)}")
    if "dashboard" in context_data:
        parts.append(f"Dashboard data: {json.dumps(context_data['dashboard'], ensure_ascii=False)}")
    if "teams" in context_data:
        parts.append(f"Teams: {', '.join(context_data['teams'])}")
    return "\n\n".join(parts) if parts else ""


class ChatSession:
    def __init__(
        self,
        session_id: str,
        context_data: dict[str, Any] | None = None,
        system_prompt: str = SYSTEM_PROMPT_CHATBOT,
    ) -> None:
        self.session_id = session_id
        self.messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ]
        context_prompt = _build_context_prompt(context_data)
        if context_prompt:
            self.messages.append({
                "role": "system",
                "content": f"Current system context:\n{context_prompt}",
            })

    def send(self, user_message: str) -> dict[str, Any]:
        client = get_llm_client()
        self.messages.append({"role": "user", "content": user_message})
        response = client.chat(self.messages, max_tokens=4096)
        self.messages.append({"role": "assistant", "content": response.content})
        return {
            "reply": response.content,
            "session_id": self.session_id,
            "model": response.model,
            "usage": response.usage,
            "latency_ms": response.latency_ms,
        }

    def send_with_tools(
        self,
        user_message: str,
        tool_executors: dict[str, Any],
    ) -> dict[str, Any]:
        client = get_llm_client()
        self.messages.append({"role": "user", "content": user_message})
        response = client.tool_call(
            self.messages,
            tools=CONTEXT_TOOLS,
            tool_executor=tool_executors,
        )
        self.messages.append({"role": "assistant", "content": response.content})
        return {
            "reply": response.content,
            "session_id": self.session_id,
            "model": response.model,
            "usage": response.usage,
            "latency_ms": response.latency_ms,
        }

    def get_history(self) -> list[dict[str, Any]]:
        return [m for m in self.messages if m["role"] != "system"]


_sessions: dict[str, ChatSession] = {}


def get_or_create_session(
    session_id: str,
    context_data: dict[str, Any] | None = None,
    system_prompt: str = SYSTEM_PROMPT_CHATBOT,
) -> ChatSession:
    if session_id not in _sessions:
        _sessions[session_id] = ChatSession(session_id, context_data, system_prompt)
    return _sessions[session_id]


def get_session(session_id: str) -> ChatSession | None:
    return _sessions.get(session_id)


def clear_session(session_id: str) -> bool:
    return _sessions.pop(session_id, None) is not None
