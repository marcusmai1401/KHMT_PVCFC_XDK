from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings

try:
    from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI, RateLimitError
except ModuleNotFoundError:  # pragma: no cover - exercised only in incomplete installs.
    OpenAI = None  # type: ignore[assignment]

    class APIConnectionError(Exception):
        pass

    class APIStatusError(Exception):
        status_code = 500

    class APITimeoutError(Exception):
        pass

    class RateLimitError(Exception):
        pass


logger = logging.getLogger(__name__)
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

SYSTEM_PROMPT_OKR = (
    "You are a precise technical assistant for an OKR (Objectives and Key Results) "
    "automation system in a Vietnamese manufacturing/engineering context. "
    "You understand KPIs like SCĐX, STOP cards, SK-CTKT, VHDN, training hours. "
    "Answer clearly, use Vietnamese when the user writes in Vietnamese, "
    "and avoid unsupported claims."
)

SYSTEM_PROMPT_EXTRACTION = (
    "You are a data extraction engine for Vietnamese OKR reports. "
    "Given raw report text, extract structured metrics as JSON. "
    "Only return valid JSON. No markdown. No extra text."
)

SYSTEM_PROMPT_CHATBOT = (
    "You are a helpful assistant for the OKR Automation System. "
    "You can help users understand their OKR data, explain metrics, "
    "and provide guidance on the reporting workflow. "
    "Use Vietnamese when the user writes in Vietnamese."
)


@dataclass
class LLMResponse:
    content: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)
    latency_ms: float = 0.0
    raw: Any = None

    def to_dict(self) -> dict:
        return {
            "content": self.content,
            "model": self.model,
            "usage": self.usage,
            "latency_ms": self.latency_ms,
        }


class LLMClientError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def _loads_model_json(text: str) -> dict[str, Any] | list[Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()

    candidates = [stripped]
    for opener, closer in [("[", "]"), ("{", "}")]:
        start = stripped.find(opener)
        end = stripped.rfind(closer)
        if start != -1 and end != -1 and end > start:
            candidates.append(stripped[start : end + 1])

    last_error: json.JSONDecodeError | None = None
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError as exc:
            last_error = exc
    raise ValueError(f"Model did not return valid JSON: {text[:500]}") from last_error


class LLMClient:
    def __init__(self) -> None:
        if not settings.llm_api_key:
            raise ValueError("DLG_API_KEY is not configured")
        if OpenAI is None:
            raise LLMClientError("openai package is not installed. Run `pip install -e .` in backend.", 503)
        self._client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=settings.effective_llm_timeout_seconds,
            max_retries=0,
        )
        self._model = settings.llm_model

    def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float | None = None,
        top_p: float | None = None,
        max_tokens: int | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | None = None,
    ) -> LLMResponse:
        start = time.monotonic()
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "temperature": settings.llm_temperature if temperature is None else temperature,
            "top_p": settings.llm_top_p if top_p is None else top_p,
            "max_tokens": settings.llm_max_tokens if max_tokens is None else max_tokens,
            "stream": False,
        }
        if tools:
            kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice

        max_retries = max(0, settings.llm_max_retries)
        response = None
        for attempt in range(max_retries + 1):
            try:
                response = self._client.chat.completions.create(**kwargs)
                break
            except RateLimitError as exc:
                if attempt >= max_retries:
                    logger.warning("LLM API rate limited after retries: %s", exc)
                    raise LLMClientError("LLM API rate limit exceeded", 429) from exc
                self._sleep_before_retry(attempt, exc)
            except APIStatusError as exc:
                status_code = getattr(exc, "status_code", 502)
                if status_code not in RETRYABLE_STATUS_CODES or attempt >= max_retries:
                    logger.error("LLM API status error %s: %s", status_code, exc)
                    raise LLMClientError(f"LLM API returned status {status_code}", status_code) from exc
                self._sleep_before_retry(attempt, exc)
            except APITimeoutError as exc:
                if attempt >= max_retries:
                    logger.error("LLM API timed out after retries: %s", exc)
                    raise LLMClientError("LLM API request timed out", 504) from exc
                self._sleep_before_retry(attempt, exc)
            except APIConnectionError as exc:
                if attempt >= max_retries:
                    logger.error("LLM API connection error after retries: %s", exc)
                    raise LLMClientError("Could not connect to LLM API", 502) from exc
                self._sleep_before_retry(attempt, exc)

        if response is None or not response.choices:
            raise LLMClientError("LLM API returned an empty response", 502)

        elapsed = (time.monotonic() - start) * 1000
        choice = response.choices[0]
        usage = {}
        if response.usage:
            usage = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens,
            }

        return LLMResponse(
            content=choice.message.content or "",
            model=response.model,
            usage=usage,
            latency_ms=round(elapsed, 2),
            raw=response,
        )

    def _sleep_before_retry(self, attempt: int, exc: Exception) -> None:
        delay_seconds = min(2**attempt, 8)
        logger.info("Retrying LLM API call in %s seconds after error: %s", delay_seconds, exc)
        time.sleep(delay_seconds)

    def list_models(self) -> list[dict[str, Any]]:
        try:
            response = self._client.models.list()
        except APIStatusError as exc:
            status_code = getattr(exc, "status_code", 502)
            raise LLMClientError(f"LLM API returned status {status_code}", status_code) from exc
        except APITimeoutError as exc:
            raise LLMClientError("LLM API request timed out", 504) from exc
        except APIConnectionError as exc:
            raise LLMClientError("Could not connect to LLM API", 502) from exc

        data = getattr(response, "data", [])
        models = []
        for item in data:
            if hasattr(item, "model_dump"):
                models.append(item.model_dump())
            elif isinstance(item, dict):
                models.append(item)
            else:
                models.append({"id": getattr(item, "id", str(item))})
        return models

    def chat_simple(self, user_prompt: str, system_prompt: str = SYSTEM_PROMPT_OKR) -> str:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        return self.chat(messages).content

    def extract_json(self, user_prompt: str) -> dict | list:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT_EXTRACTION},
            {"role": "user", "content": user_prompt},
        ]
        response = self.chat(messages, temperature=0.1, max_tokens=4096)
        text = response.content.strip()
        return _loads_model_json(text)

    def tool_call(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict],
        tool_executor: dict[str, Any],
        *,
        max_rounds: int = 5,
    ) -> LLMResponse:
        current_messages = list(messages)
        for _ in range(max_rounds):
            response = self.chat(current_messages, tools=tools, tool_choice="auto")
            raw_msg = response.raw.choices[0].message if response.raw else None
            if not raw_msg or not raw_msg.tool_calls:
                return response
            current_messages.append({
                "role": "assistant",
                "content": raw_msg.content,
                "tool_calls": [
                    tool_call.model_dump(exclude_none=True)
                    if hasattr(tool_call, "model_dump")
                    else tool_call
                    for tool_call in raw_msg.tool_calls
                ],
            })
            for tool_call in raw_msg.tool_calls:
                name = tool_call.function.name
                try:
                    args = json.loads(tool_call.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                    result = json.dumps({"error": "Invalid tool arguments JSON"})
                    current_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": result,
                    })
                    continue
                executor = tool_executor.get(name)
                if executor is None:
                    result = json.dumps({"error": f"Unknown tool: {name}"}, ensure_ascii=False)
                else:
                    try:
                        result = json.dumps(executor(**args), ensure_ascii=False, default=str)
                    except Exception as exc:
                        result = json.dumps({"error": str(exc)}, ensure_ascii=False)
                current_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })
        return response


_client_instance: LLMClient | None = None


def get_llm_client() -> LLMClient:
    global _client_instance
    if _client_instance is None:
        _client_instance = LLMClient()
    return _client_instance


MiMoClient = LLMClient
MiMoClientError = LLMClientError
get_mimo_client = get_llm_client
