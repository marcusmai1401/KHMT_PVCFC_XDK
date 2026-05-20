from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import Role, require_role
from app.db.session import get_db
from app.models.domain import KRMappingModel, TeamReportModel
from app.services.okr.dashboard import build_dashboard_matrix
from app.services.repositories import model_to_dict

router = APIRouter(prefix="/llm", tags=["llm"])


def _llm_available() -> bool:
    return settings.llm_enabled and bool(settings.llm_api_key)


def _check_llm_enabled() -> None:
    if not settings.llm_enabled:
        raise HTTPException(status_code=503, detail="LLM service is disabled")
    if not settings.llm_api_key:
        raise HTTPException(status_code=503, detail="DLG_API_KEY is not configured")


def _raise_llm_http_error(exc: Exception) -> None:
    status_code = getattr(exc, "status_code", 502)
    if not isinstance(status_code, int) or status_code < 400:
        status_code = 502
    raise HTTPException(status_code=status_code, detail=str(exc)) from exc


def _dashboard_for(db: Session, month: int, year: int) -> dict[str, Any]:
    reports = db.execute(
        select(TeamReportModel).where(
            TeamReportModel.is_current_version.is_(True),
            or_(TeamReportModel.report_month == month, TeamReportModel.report_month.is_(None)),
            or_(TeamReportModel.report_year == year, TeamReportModel.report_year.is_(None)),
        )
    ).scalars().all()
    report_dicts = [model_to_dict(r) for r in reports]
    mappings = [model_to_dict(m) for m in db.execute(select(KRMappingModel)).scalars()]
    return build_dashboard_matrix(report_dicts, mappings)


def _tool_executors(db: Session) -> dict[str, Any]:
    from app.services.okr.constants import TEAMS

    def list_teams() -> list[str]:
        return list(TEAMS)

    def get_team_report(team: str) -> dict[str, Any] | None:
        report = db.execute(
            select(TeamReportModel)
            .where(
                TeamReportModel.team == team,
                TeamReportModel.is_current_version.is_(True),
            )
            .order_by(TeamReportModel.uploaded_at.desc())
        ).scalars().first()
        return model_to_dict(report) if report else None

    def get_dashboard_summary(month: int, year: int) -> dict[str, Any]:
        return _dashboard_for(db, month, year)

    return {
        "list_teams": list_teams,
        "get_team_report": get_team_report,
        "get_dashboard_summary": get_dashboard_summary,
    }


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    system_prompt: str | None = None
    session_id: str | None = None
    use_tools: bool = False


class ChatResponse(BaseModel):
    reply: str
    model: str
    usage: dict[str, Any] = Field(default_factory=dict)
    latency_ms: float = 0.0
    session_id: str | None = None


class AnalysisRequest(BaseModel):
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2020, le=2100)


class AnalysisResponse(BaseModel):
    analysis: str
    month: int
    year: int
    model: str
    usage: dict[str, Any] = Field(default_factory=dict)
    latency_ms: float = 0.0


class TeamAnalysisRequest(BaseModel):
    report_id: str


class ExtractionRequest(BaseModel):
    text: str = Field(..., min_length=1)
    kr_code: str = "generic"
    use_hybrid: bool = True


class ExtractionResponse(BaseModel):
    results: dict[str, Any]


class CompareRequest(BaseModel):
    current_report_id: str
    previous_report_id: str | None = None


class ChatHistoryResponse(BaseModel):
    session_id: str
    messages: list[dict[str, Any]]


@router.post("/chat", response_model=ChatResponse)
def llm_chat(
    req: ChatRequest,
    _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    _check_llm_enabled()
    try:
        from app.services.llm.chatbot import get_or_create_session
        from app.services.llm.client import SYSTEM_PROMPT_OKR, get_llm_client

        system = req.system_prompt or SYSTEM_PROMPT_OKR
        if req.session_id or req.use_tools:
            session_id = req.session_id or f"chat-{uuid4().hex[:12]}"
            session = get_or_create_session(session_id, system_prompt=system)
            result = (
                session.send_with_tools(req.message, _tool_executors(db))
                if req.use_tools
                else session.send(req.message)
            )
            return ChatResponse(
                reply=result["reply"],
                model=result["model"],
                usage=result["usage"],
                latency_ms=result["latency_ms"],
                session_id=session_id,
            )

        client = get_llm_client()
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": req.message},
        ]
        response = client.chat(messages)
        return ChatResponse(
            reply=response.content,
            model=response.model,
            usage=response.usage,
            latency_ms=response.latency_ms,
        )
    except Exception as exc:
        _raise_llm_http_error(exc)


@router.get("/chat/{session_id}/history", response_model=ChatHistoryResponse)
def chat_history(
    session_id: str,
    _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.TEAM_ACCOUNT)),
):
    from app.services.llm.chatbot import get_session

    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return ChatHistoryResponse(session_id=session_id, messages=session.get_history())


@router.delete("/chat/{session_id}")
def clear_chat_session(
    session_id: str,
    _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.TEAM_ACCOUNT)),
):
    from app.services.llm.chatbot import clear_session

    return {"cleared": clear_session(session_id), "session_id": session_id}


@router.post("/analyze/dashboard", response_model=AnalysisResponse)
def analyze_dashboard(
    req: AnalysisRequest,
    _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    _check_llm_enabled()
    from app.services.llm.okr_analyzer import analyze_dashboard
    try:
        result = analyze_dashboard(_dashboard_for(db, req.month, req.year), req.month, req.year)
        return AnalysisResponse(**result)
    except Exception as exc:
        _raise_llm_http_error(exc)


@router.post("/analyze/team")
def analyze_team(
    req: TeamAnalysisRequest,
    _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    _check_llm_enabled()
    from app.services.llm.okr_analyzer import analyze_team_report

    report = db.get(TeamReportModel, req.report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    try:
        return analyze_team_report(model_to_dict(report))
    except Exception as exc:
        _raise_llm_http_error(exc)


@router.post("/analyze/compare")
def compare_reports(
    req: CompareRequest,
    _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    _check_llm_enabled()
    from app.services.llm.okr_analyzer import compare_reports as do_compare

    current = db.get(TeamReportModel, req.current_report_id)
    if current is None:
        raise HTTPException(status_code=404, detail="Current report not found")
    previous = None
    if req.previous_report_id:
        previous = db.get(TeamReportModel, req.previous_report_id)
        if previous is None:
            raise HTTPException(status_code=404, detail="Previous report not found")
    try:
        return do_compare(model_to_dict(current), model_to_dict(previous) if previous else None)
    except Exception as exc:
        _raise_llm_http_error(exc)


@router.post("/extract", response_model=ExtractionResponse)
def extract_metrics(
    req: ExtractionRequest,
    _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
):
    if req.use_hybrid:
        from app.services.llm.extractor import hybrid_extract

        results = hybrid_extract(req.text, req.kr_code, use_llm=_llm_available())
    else:
        _check_llm_enabled()
        from app.services.llm.extractor import extract_with_llm
        try:
            results = {"llm_results": extract_with_llm(req.text, req.kr_code)}
        except Exception as exc:
            _raise_llm_http_error(exc)
    return ExtractionResponse(results=results)


@router.post("/test-connection")
def test_connection(_: dict = Depends(require_role(Role.ADMIN))):
    _check_llm_enabled()
    from app.services.llm.client import get_llm_client

    try:
        client = get_llm_client()
        response = client.chat_simple("Hello, respond with 'OK' if you can hear me.")
        return {
            "status": "connected",
            "model": settings.llm_model,
            "base_url": settings.llm_base_url,
            "response": response,
        }
    except Exception as exc:
        _raise_llm_http_error(exc)


@router.get("/models")
def list_models(_: dict = Depends(require_role(Role.ADMIN))):
    _check_llm_enabled()
    from app.services.llm.client import get_llm_client

    try:
        return {
            "provider": "danglamgiau.com",
            "base_url": settings.llm_base_url,
            "configured_model": settings.llm_model,
            "models": get_llm_client().list_models(),
        }
    except Exception as exc:
        _raise_llm_http_error(exc)
