import hashlib
from io import BytesIO
import warnings
from PIL import Image, UnidentifiedImageError
from pillow_heif import register_heif_opener
import json
import mimetypes
import os
from pathlib import Path
import tempfile
import unicodedata

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import and_, case, cast, String, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.concurrency import require_expected_revision
from app.core.config import settings
from app.core.security import Role, require_role
from app.db.session import get_db
from app.models.domain import SKCTKTModel, SKImageModel, User
from app.schemas.common import KHMTAssignRequest, SKCreate, SKUpdate, TransitionRequest
from app.services.cache import cache_delete_prefix
from app.services.fi.service import (
    AUTHOR_CONTENT_EDITABLE_STATUSES,
    AUTHOR_ROLES as FI_AUTHOR_ROLES,
    assign_khmt,
    build_fi_report_export_filters,
    can_view_sk,
    clear_khmt,
    count_for_okr,
    create_sk_ctkt,
    delete_sk_ctkt,
    effective_author_user_id,
    effective_submitter_user_id,
    export_fi_reports_to_excel,
    fi_dashboard,
    is_import_actor,
    is_author_or_submitter,
    require_visible,
    submitter_user_id,
    transition_sk_ctkt,
    update_sk_ctkt,
    _fi_completion_filter,
    _fi_decision_filter,
    _fi_registration_period,
)
from app.services.fi.period_guard import assert_period_mutable, assert_period_state_mutable, lock_period_state
from app.services.fi.team_guard import lock_fi_team
from app.services.fi.workflow import SKStatus
from app.services.repositories import (
    audit,
    idempotency_replay,
    make_id,
    model_to_dict,
    remember_idempotency,
    sk_image_to_dict,
)
router = APIRouter(prefix="/fi", tags=["fi"])

ALLOWED_IMAGE_EXTENSIONS = {
    ".avif",
    ".bmp",
    ".gif",
    ".heic",
    ".heif",
    ".jfif",
    ".jpg",
    ".jpeg",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
}
register_heif_opener()

LENIENT_IMAGE_CONTENT_TYPES = {"", "application/octet-stream", "binary/octet-stream"}


def _record_or_404(db: Session, record_id: str) -> SKCTKTModel:
    record = db.get(SKCTKTModel, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="SK-CTKT not found")
    return record


def _lock_record_for_attachment_mutation(db: Session, record_id: str) -> SKCTKTModel:
    """Lock team/period before the FI row for image-only mutations."""
    preliminary = _record_or_404(db, record_id)
    team = preliminary.team
    lock_fi_team(db, team)
    db.refresh(preliminary)
    if preliminary.team != team:
        raise HTTPException(status_code=409, detail={"code": "VERSION_CONFLICT", "message": "Đội của FI vừa thay đổi. Vui lòng tải lại."})
    if preliminary.khmt_month is not None and preliminary.khmt_year is not None:
        guard = lock_period_state(db, preliminary.team, int(preliminary.khmt_month), int(preliminary.khmt_year))
        assert_period_state_mutable(guard, preliminary.team, int(preliminary.khmt_month), int(preliminary.khmt_year))
        assert_period_mutable(db, preliminary.team, int(preliminary.khmt_month), int(preliminary.khmt_year))
    return db.execute(
        select(SKCTKTModel).where(SKCTKTModel.id == record_id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one()


def _fold_search(value: object) -> str:
    text = str(value or "").strip().casefold().replace("đ", "d")
    return "".join(
        character
        for character in unicodedata.normalize("NFD", text)
        if unicodedata.category(character) != "Mn"
    )


def _safe_filename(filename: str | None) -> str:
    name = Path(filename or "attachment").name
    return "".join(ch for ch in name if ch.isalnum() or ch in {" ", ".", "_", "-"}) or "attachment"


def _validate_image_upload(safe_name: str, content_type: str | None) -> str:
    suffix = Path(safe_name).suffix.lower()
    normalized_content_type = (content_type or "").lower()
    if suffix and suffix not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only image files are supported")
    if normalized_content_type == "image/svg+xml":
        raise HTTPException(status_code=400, detail="SVG images are not supported")
    if normalized_content_type and not normalized_content_type.startswith("image/"):
        if normalized_content_type not in LENIENT_IMAGE_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail="Only image files are supported")
    guessed_content_type, _ = mimetypes.guess_type(safe_name)
    return normalized_content_type if normalized_content_type.startswith("image/") else guessed_content_type or "application/octet-stream"


def _principal_author_name(principal: dict) -> str:
    full_name = str(principal.get("full_name") or "").strip()
    if full_name:
        return full_name
    display_name = str(principal.get("display_name") or "").strip()
    if " - " in display_name:
        display_name = display_name.split(" - ", 1)[0].strip()
    return display_name or principal["user_id"]


def _user_display_name(user: User | None, user_id: str | None) -> str | None:
    if not user_id:
        return None
    if is_import_actor(user_id):
        return "Hệ thống"
    if user is None:
        return user_id
    return user.full_name or user.display_name or user.id


def _request_hash(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _sk_to_dict(record: SKCTKTModel, db: Session, *, include_images: bool = False) -> dict:
    data = model_to_dict(record)
    data["server_revision"] = record.revision
    raw_submitted_by = submitter_user_id(record)
    effective_author = effective_author_user_id(record, db)
    submitted_by = effective_submitter_user_id(record, db)
    submitter = db.get(User, submitted_by) if submitted_by else None
    data["submitted_by"] = submitted_by
    data["submitted_by_name"] = (
        record.author_name
        if record.is_historical_import and (not raw_submitted_by or is_import_actor(raw_submitted_by))
        else _user_display_name(submitter, submitted_by)
    )
    data["effective_author_user_id"] = effective_author or (None if is_import_actor(record.author_user_id) else record.author_user_id)
    if include_images:
        data["supporting_images"] = [
            sk_image_to_dict(image)
            for image in db.execute(select(SKImageModel).where(SKImageModel.sk_ctkt_id == record.id)).scalars()
        ]
    return data


def _author_user_or_400(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None or not user.is_active or user.role not in FI_AUTHOR_ROLES:
        raise HTTPException(status_code=400, detail="Tác giả được chọn không hợp lệ hoặc đã bị khóa")
    if not user.team:
        raise HTTPException(status_code=400, detail="Tài khoản tác giả chưa được gán đội/tổ")
    return user


def _apply_selected_author(data: dict, principal: dict, db: Session) -> None:
    selected_author_id = str(data.get("author_user_id") or "").strip()
    if principal["role"] in {Role.TEAM_ACCOUNT.value, Role.STAFF.value, Role.FI_COORDINATOR.value}:
        author = _author_user_or_400(db, selected_author_id or principal["user_id"])
        data["author_name"] = author.full_name or author.display_name or _principal_author_name(principal)
        data["team"] = author.team
        data["author_user_id"] = author.id
        return
    if selected_author_id:
        author = _author_user_or_400(db, selected_author_id)
        data["author_name"] = author.full_name or author.display_name
        data["team"] = author.team
        data["author_user_id"] = author.id


@router.post("/sk-ctkt")
def create(
    payload: SKCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    _apply_selected_author(data, principal, db)
    if not data.get("author_name") or not data.get("team"):
        raise HTTPException(status_code=400, detail="Thiếu tác giả hoặc đội/tổ")
    request_hash = _request_hash(data)
    if idempotency_key:
        replay = idempotency_replay(
            db,
            actor=principal["user_id"],
            scope="fi:create",
            key=idempotency_key,
            request_hash=request_hash,
        )
        if replay is not None:
            return replay
    try:
        result = _sk_to_dict(
            create_sk_ctkt(
                db,
                data,
                principal["user_id"],
                submit_immediately=True,
                commit=not bool(idempotency_key),
            ),
            db,
        )
        if idempotency_key:
            remember_idempotency(
                db,
                actor=principal["user_id"],
                scope="fi:create",
                key=idempotency_key,
                request_hash=request_hash,
                response=result,
            )
            db.commit()
    except IntegrityError:
        db.rollback()
        if idempotency_key:
            replay = idempotency_replay(
                db,
                actor=principal["user_id"],
                scope="fi:create",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replay is not None:
                return replay
        raise
    cache_delete_prefix("fi:public_sk")
    cache_delete_prefix("okr:dashboard")
    return result


@router.get("/sk-ctkt")
def list_sk(
    team: str | None = None,
    author: str | None = None,
    khmt_month: int | None = Query(default=None, ge=1, le=12),
    khmt_year: int | None = Query(default=None, ge=2020, le=2100),
    status: str | None = None,
    q: str | None = None,
    include_historical: bool = False,
    mine_only: bool = False,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    query = select(SKCTKTModel)
    if not include_historical:
        query = query.where(SKCTKTModel.is_historical_import.is_(False))
    if team:
        query = query.where(SKCTKTModel.team == team)
    if khmt_month:
        query = query.where(SKCTKTModel.khmt_month == khmt_month)
    if khmt_year:
        query = query.where(SKCTKTModel.khmt_year == khmt_year)
    if status:
        query = query.where(SKCTKTModel.status == status)
    if mine_only:
        actor = principal["user_id"]
        submitted_by = SKCTKTModel.status_history[0]["comments"]["submitted_by"].as_string()
        query = query.where(or_(SKCTKTModel.author_user_id == actor, submitted_by == actor))
    query = query.order_by(
        func.coalesce(SKCTKTModel.created_at, SKCTKTModel.submitted_at, SKCTKTModel.updated_at).desc(),
        SKCTKTModel.id.desc(),
    )
    records = db.execute(query).scalars().all()
    filtered = []
    for record in records:
        if not can_view_sk(record, principal):
            continue
        if author and author.lower() not in record.author_name.lower():
            continue
        if q:
            haystack = f"{record.title} {record.author_name} {record.content_description}".lower()
            if q.lower() not in haystack:
                continue
        filtered.append(_sk_to_dict(record, db))
    return filtered


@router.get("/sk-ctkt/public")
def public_sk(
    team: str | None = None,
    author: str | None = None,
    khmt_month: int | None = Query(default=None, ge=1, le=12),
    khmt_year: int | None = Query(default=None, ge=2020, le=2100),
    q: str | None = None,
    historical: bool | None = None,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    query = select(SKCTKTModel).where(SKCTKTModel.status != SKStatus.DRAFT.value)
    if historical is not None:
        query = query.where(SKCTKTModel.is_historical_import.is_(historical))
    if team:
        query = query.where(SKCTKTModel.team == team)
    if khmt_month:
        query = query.where(SKCTKTModel.khmt_month == khmt_month)
    if khmt_year:
        query = query.where(SKCTKTModel.khmt_year == khmt_year)
    records = db.execute(query).scalars().all()
    filtered = []
    for record in records:
        if author and author.lower() not in record.author_name.lower():
            continue
        if q:
            haystack = f"{record.title} {record.author_name} {record.content_description}".lower()
            if q.lower() not in haystack:
                continue
        filtered.append(record)
    filtered.sort(key=lambda record: record.created_at, reverse=True)
    return [_sk_to_dict(record, db) for record in filtered]


@router.get("/history")
def fi_history(
    team: str | None = None,
    teams: str | None = None,
    author: str | None = None,
    authors: str | None = None,
    q: str | None = None,
    registration_month: int | None = Query(default=None, ge=1, le=12),
    registration_months: str | None = None,
    registration_year: int | None = Query(default=None, ge=2020, le=2100),
    decisions: str | None = None,
    khmt: str | None = None,
    khmt_periods: str | None = None,
    completion: str | None = None,
    historical: bool | None = None,
    submitters: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    """Paginated, server-filtered FI history used by the mobile/desktop view."""
    query = select(SKCTKTModel).where(SKCTKTModel.status != SKStatus.DRAFT.value)
    if historical is not None:
        query = query.where(SKCTKTModel.is_historical_import.is_(historical))
    requested_teams = {item.strip() for item in (teams or "").split(",") if item.strip()}
    if team:
        requested_teams.add(team)
    if requested_teams:
        query = query.where(SKCTKTModel.team.in_(requested_teams))
    query = query.order_by(
        func.coalesce(SKCTKTModel.created_at, SKCTKTModel.submitted_at, SKCTKTModel.updated_at).desc(),
        SKCTKTModel.id.desc(),
    )
    selected_decisions = {item.strip().lower() for item in (decisions or "").split(",") if item.strip()}
    selected_khmt = {item.strip().lower() for item in (khmt or "").split(",") if item.strip()}
    selected_periods = {item.strip() for item in (khmt_periods or "").split(",") if item.strip()}
    selected_completion = {item.strip().lower() for item in (completion or "").split(",") if item.strip()}
    selected_authors = {item.strip() for item in (authors or "").split(",") if item.strip()}
    selected_submitters = {item.strip() for item in (submitters or "").split(",") if item.strip()}
    selected_registration_months = {
        int(item)
        for item in (registration_months or "").split(",")
        if item.strip().isdigit() and 1 <= int(item) <= 12
    }
    from app.services.fi.history_query import expressions, fold, person_filter
    expr, directory = expressions(db)
    # Facet choices describe the full visible history, never only the page.
    facet_base = select(SKCTKTModel).where(SKCTKTModel.status != SKStatus.DRAFT.value)
    if historical is not None:
        facet_base = facet_base.where(SKCTKTModel.is_historical_import.is_(historical))
    def facet_rows(*columns):
        return db.execute(facet_base.with_only_columns(*columns, func.count().label("count")).group_by(*columns)).all()
    facets = {
        "teams": [{"value": row[0], "count": row[1]} for row in facet_rows(SKCTKTModel.team)],
        "months": [{"value": int(row[0]), "count": row[1]} for row in facet_rows(expr["month"]) if row[0]],
        "periods": [{"month": row[0], "year": row[1], "count": row[2]} for row in facet_rows(SKCTKTModel.khmt_month, SKCTKTModel.khmt_year) if row[0] and row[1]],
    }
    directory_names = {user.id: user.full_name or user.display_name or "" for user in directory}
    submitter_fallback = case((SKCTKTModel.is_historical_import.is_(True), SKCTKTModel.author_name), else_="")
    for kind, identity, name in [("authors", expr["author_id"], SKCTKTModel.author_name), ("submitters", expr["submitter_id"], submitter_fallback)]:
        options = {}
        for account_id, label, team_value, count in facet_rows(identity, name, SKCTKTModel.team):
            if kind == "submitters" and account_id in directory_names:
                label = directory_names[account_id]
            label = label or account_id or "Hệ thống"
            key = f"id:{account_id.lower()}" if account_id else f"name:{_fold_search(label)}:team:{_fold_search(team_value or '')}"
            if key in options:
                options[key]["count"] += count
            else:
                options[key] = {"key": key, "label": label, "accountId": account_id, "team": team_value, "count": count}
        facets[kind] = sorted(options.values(), key=lambda row: (-row["count"], row["label"]))
    if registration_month is not None: query = query.where(expr["month"] == registration_month)
    if selected_registration_months: query = query.where(expr["month"].in_(selected_registration_months))
    if registration_year is not None: query = query.where(expr["year"] == registration_year)
    if selected_decisions: query = query.where(expr["decision"].in_(selected_decisions))
    if selected_khmt: query = query.where(case((SKCTKTModel.consider_for_khmt.is_(True), "in"), else_="out").in_(selected_khmt))
    if selected_periods:
        period = cast(SKCTKTModel.khmt_year, String) + "-" + cast(SKCTKTModel.khmt_month, String)
        period_match = and_(SKCTKTModel.consider_for_khmt.is_(True), period.in_(selected_periods))
        query = query.where(or_(period_match, SKCTKTModel.consider_for_khmt.is_(False)) if "out" in selected_khmt else period_match)
    if selected_completion: query = query.where(case((expr["done"], "done"), else_="pending").in_(selected_completion))
    if author: query = query.where(fold(SKCTKTModel.author_name).contains(_fold_search(author), autoescape=True))
    if q:
        haystack = func.coalesce(SKCTKTModel.sk_code, "") + " " + SKCTKTModel.title + " " + SKCTKTModel.author_name + " " + SKCTKTModel.content_description
        query = query.where(fold(haystack).contains(_fold_search(q), autoescape=True))
    if selected_authors: query = query.where(person_filter(selected_authors, expr["author_id"], SKCTKTModel.author_name))
    if selected_submitters: query = query.where(person_filter(selected_submitters, expr["submitter_id"], expr["submitter_name"]))
    aggregates = {
        "total": func.count(),
        **{key: func.sum(case((expr["decision"] == key, 1), else_=0)) for key in ("approved", "rejected", "deferred", "pending")},
        "completed_count": func.sum(case((expr["done"], 1), else_=0)),
        "khmt_considered": func.sum(case((SKCTKTModel.consider_for_khmt.is_(True), 1), else_=0)),
        "data_revision": func.max(SKCTKTModel.revision),
    }
    start = (page - 1) * page_size
    # Window aggregates share the filtered scan and database snapshot with the
    # page. Only the requested page is hydrated into ORM objects.
    rows = db.execute(query.add_columns(*[value.over().label(key) for key, value in aggregates.items()]).offset(start).limit(page_size)).all()
    items = [row[0] for row in rows]
    if rows:
        counts = dict(zip(aggregates, rows[0][1:]))
    else:
        # An out-of-range page has no row to carry its window totals.
        summary_query = query.order_by(None).with_only_columns(*[func.coalesce(value, 0).label(key) for key, value in aggregates.items()])
        counts = dict(db.execute(summary_query).mappings().one())
    total = counts["total"]
    total_pages = (total + page_size - 1) // page_size
    completed_count = counts["completed_count"]
    decision_counts = {key: counts[key] for key in ("approved", "rejected", "deferred", "pending")}
    applied_filters = {
        "teams": sorted(requested_teams),
        "registration_month": registration_month,
        "registration_months": sorted(selected_registration_months),
        "registration_year": registration_year,
        "author": author,
        "authors": sorted(selected_authors),
        "submitters": sorted(selected_submitters),
        "decisions": sorted(selected_decisions),
        "khmt": sorted(selected_khmt),
        "khmt_periods": sorted(selected_periods),
        "completion": sorted(selected_completion),
        "historical": historical,
        "q": q,
    }
    return {
        "items": [_sk_to_dict(record, db) for record in items],
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_next": start + page_size < total,
        "total_pages": total_pages,
        "summary": {
            "total": total,
            **decision_counts,
            "khmt_considered": counts["khmt_considered"],
            "khmt_missing": total - counts["khmt_considered"],
            "completed_count": completed_count,
            "not_completed": total - completed_count,
        },
        "applied_filters": applied_filters,
        "sort": "created_at.desc,id.desc",
        "data_revision": counts["data_revision"],
        "facets": facets,
    }


@router.get("/sk-ctkt/{record_id}")
def get_sk(
    record_id: str,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    record = _record_or_404(db, record_id)
    require_visible(record, principal)
    return _sk_to_dict(record, db, include_images=True)


@router.put("/sk-ctkt/{record_id}")
def update(
    record_id: str,
    payload: SKUpdate,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    require_expected_revision(payload.expected_revision, "SK-CTKT update")
    try:
        result = _sk_to_dict(
            update_sk_ctkt(db, record_id, payload.model_dump(exclude_none=True), principal["user_id"], principal["role"]),
            db,
        )
        cache_delete_prefix("fi:public_sk")
        return result
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/sk-ctkt/{record_id}")
def delete(
    record_id: str,
    expected_revision: int | None = Query(default=None, ge=0),
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    require_expected_revision(expected_revision, "SK-CTKT delete")
    try:
        delete_sk_ctkt(db, record_id, principal["user_id"], principal["role"], expected_revision)
        cache_delete_prefix("fi:public_sk")
        cache_delete_prefix("okr:dashboard")
        return {"deleted": True}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _transition(record_id: str, action: str, payload: TransitionRequest, principal: dict, db: Session):
    try:
        require_expected_revision(payload.expected_revision, "SK-CTKT transition")
        result = _sk_to_dict(
            transition_sk_ctkt(
                db,
                record_id,
                action,
                principal["user_id"],
                principal["role"],
                note=payload.note,
                comments=payload.comments,
                expected_revision=payload.expected_revision,
            ),
            db,
        )
        cache_delete_prefix("fi:public_sk")
        cache_delete_prefix("okr:dashboard")
        return result
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sk-ctkt/{record_id}/submit")
def submit(record_id: str, payload: TransitionRequest = TransitionRequest(), principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.ADMIN)), db: Session = Depends(get_db)):
    return _transition(record_id, "submit", payload, principal, db)


@router.post("/sk-ctkt/{record_id}/request-info")
def request_info(record_id: str, payload: TransitionRequest, principal: dict = Depends(require_role(Role.FI_COORDINATOR, Role.ADMIN)), db: Session = Depends(get_db)):
    return _transition(record_id, "request_info", payload, principal, db)


@router.post("/sk-ctkt/{record_id}/review")
def review(record_id: str, payload: TransitionRequest, principal: dict = Depends(require_role(Role.FI_COORDINATOR, Role.ADMIN)), db: Session = Depends(get_db)):
    return _transition(record_id, "review", payload, principal, db)


@router.post("/sk-ctkt/{record_id}/approve")
def approve(
    record_id: str,
    payload: TransitionRequest = TransitionRequest(),
    principal: dict = Depends(require_role(Role.FI_COORDINATOR, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    return _transition(record_id, "approve", payload, principal, db)


@router.post("/sk-ctkt/{record_id}/reject")
def reject(
    record_id: str,
    payload: TransitionRequest,
    principal: dict = Depends(require_role(Role.FI_COORDINATOR, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    return _transition(record_id, "reject", payload, principal, db)


@router.post("/sk-ctkt/{record_id}/defer")
def defer(
    record_id: str,
    payload: TransitionRequest,
    principal: dict = Depends(require_role(Role.FI_COORDINATOR, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    return _transition(record_id, "defer", payload, principal, db)


@router.post("/sk-ctkt/{record_id}/cancel")
def cancel(record_id: str, payload: TransitionRequest = TransitionRequest(), principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.ADMIN)), db: Session = Depends(get_db)):
    return _transition(record_id, "cancel", payload, principal, db)


@router.post("/sk-ctkt/{record_id}/complete")
def complete(record_id: str, payload: TransitionRequest = TransitionRequest(), principal: dict = Depends(require_role(Role.FI_COORDINATOR, Role.ADMIN)), db: Session = Depends(get_db)):
    return _transition(record_id, "complete", payload, principal, db)


@router.post("/sk-ctkt/{record_id}/assign-khmt")
def assign(
    record_id: str,
    payload: KHMTAssignRequest,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        require_expected_revision(payload.expected_revision, "KHMT assignment")
        result = _sk_to_dict(
            assign_khmt(
                db,
                record_id,
                payload.month,
                payload.year,
                principal["user_id"],
                principal["role"],
                principal_team=principal.get("team"),
                expected_revision=payload.expected_revision,
            ),
            db,
        )
        cache_delete_prefix("fi:public_sk")
        cache_delete_prefix("okr:dashboard")
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/sk-ctkt/{record_id}/assign-khmt")
def clear_assignment(
    record_id: str,
    expected_revision: int | None = Query(default=None, ge=0),
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        require_expected_revision(expected_revision, "KHMT unassignment")
        result = _sk_to_dict(
            clear_khmt(
                db,
                record_id,
                principal["user_id"],
                principal["role"],
                principal_team=principal.get("team"),
                expected_revision=expected_revision,
            ),
            db,
        )
        cache_delete_prefix("fi:public_sk")
        cache_delete_prefix("okr:dashboard")
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sk-ctkt/{record_id}/images")
def upload_image(
    record_id: str,
    file: UploadFile = File(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    expected_revision: int | None = Query(default=None, ge=0),
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    require_expected_revision(expected_revision, "SK image upload")
    record = _lock_record_for_attachment_mutation(db, record_id)
    if principal["role"] in {Role.TEAM_ACCOUNT.value, Role.STAFF.value, Role.FI_COORDINATOR.value}:
        if not is_author_or_submitter(record, principal["user_id"], db) or record.status not in AUTHOR_CONTENT_EDITABLE_STATUSES:
            raise HTTPException(status_code=403, detail="Only owner can upload images for editable entries")
    safe_name = _safe_filename(file.filename)
    content_type = _validate_image_upload(safe_name, file.content_type)
    data = file.file.read(settings.max_image_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_image_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image file is too large")
    request_hash = _request_hash({"record_id": record_id, "filename": safe_name, "content_sha256": hashlib.sha256(data).hexdigest()})
    if idempotency_key:
        replay = idempotency_replay(
            db,
            actor=principal["user_id"],
            scope=f"fi:image:{record_id}",
            key=idempotency_key,
            request_hash=request_hash,
        )
        if replay is not None:
            return replay
    if expected_revision is not None and record.revision != expected_revision:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "VERSION_CONFLICT",
                "error_code": "VERSION_CONFLICT",
                "message": "SK-CTKT đã được cập nhật ở nơi khác",
                "current_revision": record.revision,
            },
        )
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data), formats=["JPEG", "PNG", "GIF", "WEBP", "BMP", "TIFF", "AVIF", "HEIF"]) as decoded:
                detected = Image.MIME.get(decoded.format, "image/heif")
                declared = (file.content_type or "").lower()
                aliases = {"image/jpg": "image/jpeg", "image/heic": "image/heif", "image/x-ms-bmp": "image/bmp"}
                if declared not in LENIENT_IMAGE_CONTENT_TYPES and aliases.get(declared, declared) != aliases.get(detected, detected):
                    raise ValueError("MIME does not match image content")
                decoded.verify()
            # Decode pixels as well; a header alone is not a valid image.
            with Image.open(BytesIO(data)) as decoded:
                decoded.load()
            content_type = detected
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(status_code=400, detail="Ảnh bị hỏng hoặc nội dung không khớp định dạng khai báo") from exc
    image_dir = settings.storage_dir / "uploads" / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    image_id = make_id("img")
    path = image_dir / f"{image_id}-{safe_name}"
    from app.services.artifacts import register_artifact
    register_artifact(path, "fi-image")
    temp_fd, temp_name = tempfile.mkstemp(prefix=".upload-", suffix=".tmp", dir=image_dir)
    os.close(temp_fd)
    temp_path = Path(temp_name)
    try:
        temp_path.write_bytes(data)
        os.replace(temp_path, path)
    except OSError:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Could not stage image upload")
    image = SKImageModel(
        id=image_id,
        sk_ctkt_id=record_id,
        file_name=safe_name,
        file_path=str(path),
        file_size=len(data),
        content_type=content_type,
        uploaded_by=principal["user_id"],
    )
    db.add(image)
    record.revision += 1
    audit(db, principal["user_id"], "SK_CTKT", record_id, "upload_image", sk_image_to_dict(image))
    result = sk_image_to_dict(image) | {"server_revision": record.revision}
    if idempotency_key:
        remember_idempotency(
            db,
            actor=principal["user_id"],
            scope=f"fi:image:{record_id}",
            key=idempotency_key,
            request_hash=request_hash,
            response=result,
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        path.unlink(missing_ok=True)
        if idempotency_key:
            replay = idempotency_replay(
                db,
                actor=principal["user_id"],
                scope=f"fi:image:{record_id}",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replay is not None:
                return replay
        raise
    return result


@router.get("/sk-ctkt/{record_id}/images")
def list_images(record_id: str, principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)), db: Session = Depends(get_db)):
    record = _record_or_404(db, record_id)
    require_visible(record, principal)
    return [
        sk_image_to_dict(image)
        for image in db.execute(select(SKImageModel).where(SKImageModel.sk_ctkt_id == record_id)).scalars()
    ]


@router.get("/sk-ctkt/{record_id}/images/{image_id}/raw")
def get_image_raw(record_id: str, image_id: str, principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)), db: Session = Depends(get_db)):
    record = _record_or_404(db, record_id)
    require_visible(record, principal)
    image = db.get(SKImageModel, image_id)
    if image is None or image.sk_ctkt_id != record_id:
        raise HTTPException(status_code=404, detail="Image not found")
    file_path = Path(image.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Image file not found on disk")
    return FileResponse(file_path, media_type=image.content_type or "application/octet-stream", filename=image.file_name)


@router.delete("/sk-ctkt/{record_id}/images/{image_id}")
def delete_image(
    record_id: str,
    image_id: str,
    expected_revision: int | None = Query(default=None, ge=0),
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    require_expected_revision(expected_revision, "SK image delete")
    record = _lock_record_for_attachment_mutation(db, record_id)
    if expected_revision is not None and record.revision != expected_revision:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "VERSION_CONFLICT",
                "error_code": "VERSION_CONFLICT",
                "message": "SK-CTKT đã được cập nhật ở nơi khác",
                "current_revision": record.revision,
            },
        )
    image = db.get(SKImageModel, image_id)
    if image is None or image.sk_ctkt_id != record_id:
        raise HTTPException(status_code=404, detail="Image not found")
    if principal["role"] in {Role.TEAM_ACCOUNT.value, Role.STAFF.value, Role.FI_COORDINATOR.value}:
        if not is_author_or_submitter(record, principal["user_id"], db) or record.status not in AUTHOR_CONTENT_EDITABLE_STATUSES:
            raise HTTPException(status_code=403, detail="Only owner can delete images for editable entries")
    try:
        Path(image.file_path).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(image)
    record.revision += 1
    audit(db, principal["user_id"], "SK_CTKT", record_id, "delete_image", {"image_id": image_id})
    db.commit()
    return {"deleted": True}


@router.get("/okr-counts/{month}/{year}")
def okr_counts(month: int, year: int, _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)), db: Session = Depends(get_db)):
    return count_for_okr(db, month, year)


@router.get("/dashboard")
def dashboard(
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    return fi_dashboard(db, principal)


@router.get("/reports/export")
def export_reports(
    q: str | None = None,
    registration_year: int | None = Query(default=None, ge=2020, le=2100),
    teams: str | None = None,
    registration_months: str | None = None,
    decisions: str | None = None,
    khmt: str | None = None,
    khmt_periods: str | None = None,
    completion: str | None = None,
    authors: str | None = None,
    submitters: str | None = None,
    _: dict = Depends(
        require_role(
            Role.TEAM_ACCOUNT,
            Role.STAFF,
            Role.FI_COORDINATOR,
            Role.WORKSHOP_LEADER,
            Role.ADMIN,
        )
    ),
    db: Session = Depends(get_db),
):
    try:
        filters = build_fi_report_export_filters(
            q=q, registration_year=registration_year,
            teams=teams,
            registration_months=registration_months,
            decisions=decisions,
            khmt=khmt,
            khmt_periods=khmt_periods,
            completion=completion,
            authors=authors,
            submitters=submitters,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    path = export_fi_reports_to_excel(db, filters)
    return FileResponse(
        path,
        filename=Path(path).name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/reports")
def reports(
    team: str | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    include_drafts: bool = False,
    _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    query = select(SKCTKTModel)
    if not include_drafts:
        query = query.where(SKCTKTModel.status != SKStatus.DRAFT.value)
    if team:
        query = query.where(SKCTKTModel.team == team)
    if status:
        query = query.where(SKCTKTModel.status == status)
    records = [model_to_dict(record) for record in db.execute(query).scalars()]
    # Date filters are accepted for API compatibility; records use ISO strings after serialization.
    if date_from:
        records = [record for record in records if str(record.get("created_at")) >= date_from]
    if date_to:
        records = [record for record in records if str(record.get("created_at")) <= date_to]
    return records
