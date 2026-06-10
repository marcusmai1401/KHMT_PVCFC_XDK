import mimetypes
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import Role, require_role
from app.db.session import get_db
from app.models.domain import SKCTKTModel, SKImageModel, User
from app.schemas.common import KHMTAssignRequest, SKCreate, SKUpdate, TransitionRequest
from app.services.cache import cache_delete_prefix, cache_get, cache_set
from app.services.fi.service import (
    AUTHOR_CONTENT_EDITABLE_STATUSES,
    AUTHOR_ROLES as FI_AUTHOR_ROLES,
    assign_khmt,
    can_view_sk,
    count_for_okr,
    create_sk_ctkt,
    delete_sk_ctkt,
    fi_dashboard,
    is_author_or_submitter,
    require_visible,
    transition_sk_ctkt,
    update_sk_ctkt,
)
from app.services.fi.completion import completion_plan_completed_at
from app.services.fi.workflow import SKStatus
from app.services.integration.bm01_import import build_bm01_status_history, preview_bm01
from app.services.repositories import audit, make_id, model_to_dict, sk_image_to_dict

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
LENIENT_IMAGE_CONTENT_TYPES = {"", "application/octet-stream", "binary/octet-stream"}


def _record_or_404(db: Session, record_id: str) -> SKCTKTModel:
    record = db.get(SKCTKTModel, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="SK-CTKT not found")
    return record


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
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    _apply_selected_author(data, principal, db)
    if not data.get("author_name") or not data.get("team"):
        raise HTTPException(status_code=400, detail="Thiếu tác giả hoặc đội/tổ")
    result = model_to_dict(create_sk_ctkt(db, data, principal["user_id"], submit_immediately=True))
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
        filtered.append(model_to_dict(record))
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
    namespace = "sandbox" if principal.get("sandbox") else "prod"
    cache_key = f"fi:public_sk:v5:{namespace}:{team or ''}:{author or ''}:{khmt_month or ''}:{khmt_year or ''}:{q or ''}:{historical if historical is not None else ''}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
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
    data = [model_to_dict(record) for record in filtered]
    cache_set(cache_key, data, 5 * 60)
    return data


@router.get("/sk-ctkt/{record_id}")
def get_sk(
    record_id: str,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    record = _record_or_404(db, record_id)
    require_visible(record, principal)
    data = model_to_dict(record)
    data["supporting_images"] = [
        sk_image_to_dict(image)
        for image in db.execute(select(SKImageModel).where(SKImageModel.sk_ctkt_id == record_id)).scalars()
    ]
    return data


@router.put("/sk-ctkt/{record_id}")
def update(
    record_id: str,
    payload: SKUpdate,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        result = model_to_dict(update_sk_ctkt(db, record_id, payload.model_dump(exclude_none=True), principal["user_id"], principal["role"]))
        cache_delete_prefix("fi:public_sk")
        return result
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/sk-ctkt/{record_id}")
def delete(
    record_id: str,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        delete_sk_ctkt(db, record_id, principal["user_id"], principal["role"])
        cache_delete_prefix("fi:public_sk")
        cache_delete_prefix("okr:dashboard")
        return {"deleted": True}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _transition(record_id: str, action: str, payload: TransitionRequest, principal: dict, db: Session):
    try:
        result = model_to_dict(
            transition_sk_ctkt(
                db,
                record_id,
                action,
                principal["user_id"],
                principal["role"],
                note=payload.note,
                comments=payload.comments,
            )
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
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    try:
        result = model_to_dict(
            assign_khmt(
                db,
                record_id,
                payload.month,
                payload.year,
                principal["user_id"],
                principal["role"],
                principal_team=principal.get("team"),
            )
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
async def upload_image(record_id: str, file: UploadFile = File(...), principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.ADMIN)), db: Session = Depends(get_db)):
    record = _record_or_404(db, record_id)
    if principal["role"] in {Role.TEAM_ACCOUNT.value, Role.STAFF.value, Role.FI_COORDINATOR.value}:
        if not is_author_or_submitter(record, principal["user_id"]) or record.status not in AUTHOR_CONTENT_EDITABLE_STATUSES:
            raise HTTPException(status_code=403, detail="Only owner can upload images for editable entries")
    safe_name = _safe_filename(file.filename)
    content_type = _validate_image_upload(safe_name, file.content_type)
    data = await file.read()
    if len(data) > settings.max_image_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image file is too large")
    image_dir = settings.storage_dir / "uploads" / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    image_id = make_id("img")
    path = image_dir / f"{image_id}-{safe_name}"
    path.write_bytes(data)
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
    audit(db, principal["user_id"], "SK_CTKT", record_id, "upload_image", sk_image_to_dict(image))
    db.commit()
    return sk_image_to_dict(image)


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
def delete_image(record_id: str, image_id: str, principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.ADMIN)), db: Session = Depends(get_db)):
    record = _record_or_404(db, record_id)
    image = db.get(SKImageModel, image_id)
    if image is None or image.sk_ctkt_id != record_id:
        raise HTTPException(status_code=404, detail="Image not found")
    if principal["role"] in {Role.TEAM_ACCOUNT.value, Role.STAFF.value, Role.FI_COORDINATOR.value}:
        if not is_author_or_submitter(record, principal["user_id"]) or record.status not in AUTHOR_CONTENT_EDITABLE_STATUSES:
            raise HTTPException(status_code=403, detail="Only owner can delete images for editable entries")
    try:
        Path(image.file_path).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(image)
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


@router.post("/import/bm01/preview")
def bm01_preview(_: dict = Depends(require_role(Role.ADMIN))):
    return preview_bm01(settings.source_bm01_workbook)


def _legacy_created_at(row: dict, fallback: datetime) -> datetime:
    month = row.get("registration_month")
    year = row.get("registration_year") or row.get("khmt_year")
    if isinstance(month, int) and isinstance(year, int):
        return datetime(year, month, 1, tzinfo=timezone.utc)
    return fallback


@router.post("/import/bm01/commit")
def bm01_commit(principal: dict = Depends(require_role(Role.ADMIN)), db: Session = Depends(get_db)):
    preview = preview_bm01(settings.source_bm01_workbook)
    imported = []
    updated = []
    imported_at = datetime.now(timezone.utc)
    existing_records = list(db.execute(select(SKCTKTModel).where(SKCTKTModel.is_historical_import.is_(True))).scalars())
    existing_sources = {
        (record.bm01_source_file, record.bm01_source_sheet, record.bm01_source_row): record
        for record in existing_records
    }
    existing_codes = {record.sk_code: record for record in existing_records}
    for row in preview["rows"]:
        source_key = (preview["source_file"], row["source_sheet"], row["source_row"])
        created_at = _legacy_created_at(row, imported_at)
        completed_at = completion_plan_completed_at(row["completion_plan"], fallback=created_at)
        values = {
            "sk_code": f"HIST-{row['team']}-{row['source_sheet']}-{row['source_row']}",
            "title": row["title"] or "(Missing title)",
            "author_name": row["author_name"] or "Unknown",
            "author_user_id": "historical-import",
            "team": row["team"],
            "content_description": row["content_description"],
            "completion_plan": row["completion_plan"],
            "status": row["status"],
            "status_history": build_bm01_status_history(
                row,
                imported_by=principal["user_id"],
                imported_at=imported_at,
            ),
            "fi_coordinator_comments": row["raw_conclusion"] or None,
            "workshop_leader_conclusion": row.get("workshop_leader_conclusion") or None,
            "is_public": row["status"] in {"Approved", "Completed"},
            "consider_for_khmt": row["consider_for_khmt"],
            "khmt_month": row["khmt_month"] if row["consider_for_khmt"] else None,
            "khmt_year": row["khmt_year"] if row["consider_for_khmt"] else None,
            "is_counted_for_okr": row["consider_for_khmt"],
            "is_historical_import": True,
            "bm01_source_file": preview["source_file"],
            "bm01_source_sheet": row["source_sheet"],
            "bm01_source_row": row["source_row"],
            "bm01_raw_conclusion": row["raw_conclusion"],
            "created_at": created_at,
            "updated_at": imported_at,
            "submitted_at": created_at,
            "reviewed_at": imported_at if row["status"] in {"Approved", "Rejected", "Deferred"} else None,
            "approved_at": imported_at if row["status"] == "Approved" else None,
            "completed_at": completed_at,
        }
        record = existing_sources.get(source_key) or existing_codes.get(values["sk_code"])
        if record is None:
            record = SKCTKTModel(id=make_id("sk"), **values)
            db.add(record)
            imported.append(record)
        else:
            for key, value in values.items():
                setattr(record, key, value)
            updated.append(record)
    audit(db, principal["user_id"], "BM01", "import", "commit", {"inserted": len(imported), "updated": len(updated)})
    db.commit()
    cache_delete_prefix("fi:public_sk")
    cache_delete_prefix("okr:dashboard")
    return {
        "imported_count": len(imported),
        "updated_count": len(updated),
        "records": [model_to_dict(record) for record in [*imported, *updated]],
        "warnings": preview["warnings"],
    }
