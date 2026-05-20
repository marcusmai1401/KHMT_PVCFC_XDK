from types import SimpleNamespace

from app.api.routes import llm as llm_routes
from app.services.llm import mimo_client
from app.services.llm.chatbot import clear_session
from app.services.llm.client import LLMClient, LLMResponse, _loads_model_json


class FakeLLMClient:
    def chat(self, messages, **kwargs):
        return LLMResponse(
            content="fake reply",
            model="fake-llm",
            usage={"total_tokens": 1},
            latency_ms=1.0,
        )

    def tool_call(self, messages, tools, tool_executor, **kwargs):
        return LLMResponse(
            content="fake tool reply",
            model="fake-llm",
            usage={"total_tokens": 2},
            latency_ms=2.0,
        )

    def list_models(self):
        return [{"id": "deepseek-v4-pro", "object": "model"}]


def test_llm_chat_session_and_history(client, admin_headers, monkeypatch):
    clear_session("test-session")
    monkeypatch.setattr(llm_routes.settings, "llm_enabled", True)
    monkeypatch.setattr(llm_routes.settings, "llm_api_key", "test-key")
    monkeypatch.setattr(mimo_client, "_client_instance", FakeLLMClient())

    response = client.post(
        "/api/v1/llm/chat",
        headers=admin_headers,
        json={"message": "Xin chào", "session_id": "test-session"},
    )

    assert response.status_code == 200
    assert response.json()["reply"] == "fake reply"
    assert response.json()["session_id"] == "test-session"

    history = client.get("/api/v1/llm/chat/test-session/history", headers=admin_headers)
    assert history.status_code == 200
    assert [message["role"] for message in history.json()["messages"]] == ["user", "assistant"]


def test_hybrid_extract_falls_back_to_regex_when_llm_disabled(client, admin_headers, monkeypatch):
    monkeypatch.setattr(llm_routes.settings, "llm_enabled", False)
    monkeypatch.setattr(llm_routes.settings, "llm_api_key", "")

    response = client.post(
        "/api/v1/llm/extract",
        headers=admin_headers,
        json={
            "text": "Có 2 sáng kiến CTKT được công nhận",
            "kr_code": "O5.KR13",
            "use_hybrid": True,
        },
    )

    assert response.status_code == 200
    results = response.json()["results"]
    assert results["llm_available"] is False
    assert results["regex_results"][0]["kind"] == "ctkt_fi"
    assert results["regex_results"][0]["actual"] == 2


def test_list_models_uses_configured_provider(client, admin_headers, monkeypatch):
    monkeypatch.setattr(llm_routes.settings, "llm_enabled", True)
    monkeypatch.setattr(llm_routes.settings, "llm_api_key", "test-key")
    monkeypatch.setattr(llm_routes.settings, "llm_base_url", "https://danglamgiau.com/v1")
    monkeypatch.setattr(llm_routes.settings, "llm_model", "deepseek-v4-pro")
    monkeypatch.setattr(mimo_client, "_client_instance", FakeLLMClient())

    response = client.get("/api/v1/llm/models", headers=admin_headers)

    assert response.status_code == 200
    assert response.json()["base_url"] == "https://danglamgiau.com/v1"
    assert response.json()["models"][0]["id"] == "deepseek-v4-pro"


def test_loads_model_json_strips_fences_and_extra_text():
    assert _loads_model_json("```json\n[{\"actual\": 2}]\n```") == [{"actual": 2}]
    assert _loads_model_json('Result:\n{"ok": true}\nDone') == {"ok": True}


def test_llm_client_sends_non_streaming_request(monkeypatch):
    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                model="deepseek-v4-pro",
                choices=[SimpleNamespace(message=SimpleNamespace(content="OK"))],
                usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
            )

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=FakeCompletions())
            self.models = SimpleNamespace(list=lambda: SimpleNamespace(data=[]))

    monkeypatch.setattr(mimo_client, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(mimo_client.settings, "llm_api_key", "test-key")
    monkeypatch.setattr(mimo_client.settings, "llm_base_url", "https://danglamgiau.com/v1")
    monkeypatch.setattr(mimo_client.settings, "llm_model", "deepseek-v4-pro")

    response = LLMClient().chat([{"role": "user", "content": "hello"}], temperature=0)

    assert response.content == "OK"
    assert captured["stream"] is False
    assert captured["temperature"] == 0
