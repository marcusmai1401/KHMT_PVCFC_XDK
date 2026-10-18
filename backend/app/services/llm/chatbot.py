from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.llm.client import SYSTEM_PROMPT_CHATBOT, get_llm_client

logger = logging.getLogger(__name__)
SESSION_TTL = timedelta(hours=24)
MAX_SESSIONS_PER_OWNER = 20
MAX_MESSAGES_PER_SESSION = 60
MAX_SESSION_BYTES = 512 * 1024

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
        owner_user_id: str,
        namespace: str,
        context_data: dict[str, Any] | None = None,
        system_prompt: str = SYSTEM_PROMPT_CHATBOT,
    ) -> None:
        self.session_id = session_id
        self.owner_user_id = owner_user_id
        self.namespace = namespace
        self.last_accessed_at = datetime.now(timezone.utc)
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
        self._touch()
        self._check_capacity()
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
        self._touch()
        self._check_capacity()
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
        self._touch()
        return [m for m in self.messages if m["role"] != "system"]

    def _touch(self) -> None:
        self.last_accessed_at = datetime.now(timezone.utc)

    def _check_capacity(self) -> None:
        if len(self.messages) >= MAX_MESSAGES_PER_SESSION:
            raise RuntimeError("Phiên hội thoại đã đạt giới hạn tin nhắn; hãy tạo phiên mới")
        encoded_size = sum(len(str(message.get("content") or "").encode("utf-8")) for message in self.messages)
        if encoded_size >= MAX_SESSION_BYTES:
            raise RuntimeError("Phiên hội thoại đã đạt giới hạn dung lượng; hãy tạo phiên mới")


_sessions: dict[str, ChatSession] = {}


def _expired(session: ChatSession) -> bool:
    return datetime.now(timezone.utc) - session.last_accessed_at > SESSION_TTL


def get_or_create_session(
    session_id: str,
    *,
    owner_user_id: str,
    namespace: str,
    context_data: dict[str, Any] | None = None,
    system_prompt: str = SYSTEM_PROMPT_CHATBOT,
) -> ChatSession:
    existing = _sessions.get(session_id)
    if existing is not None:
        if _expired(existing):
            _sessions.pop(session_id, None)
            existing = None
        elif existing.owner_user_id != owner_user_id or existing.namespace != namespace:
            raise KeyError("Chat session not found")
    if existing is None:
        owned = [session for session in _sessions.values() if session.owner_user_id == owner_user_id and session.namespace == namespace]
        for stale in owned:
            if _expired(stale):
                _sessions.pop(stale.session_id, None)
        owned = [session for session in _sessions.values() if session.owner_user_id == owner_user_id and session.namespace == namespace]
        if len(owned) >= MAX_SESSIONS_PER_OWNER:
            oldest = min(owned, key=lambda session: session.last_accessed_at)
            _sessions.pop(oldest.session_id, None)
        existing = ChatSession(session_id, owner_user_id, namespace, context_data, system_prompt)
        _sessions[session_id] = existing
    return existing


def get_session(session_id: str, *, owner_user_id: str, namespace: str) -> ChatSession | None:
    session = _sessions.get(session_id)
    if session is None or _expired(session):
        _sessions.pop(session_id, None)
        return None
    if session.owner_user_id != owner_user_id or session.namespace != namespace:
        return None
    return session


def clear_session(session_id: str, *, owner_user_id: str, namespace: str) -> bool:
    session = get_session(session_id, owner_user_id=owner_user_id, namespace=namespace)
    if session is None:
        return False
    _sessions.pop(session_id, None)
    return True
