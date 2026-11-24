# Design — Nâng cấp Luồng Cập nhật Tình hình Thực hiện & Trạng thái Hoàn thành Phân hệ FI (SK-CTKT)

Tài liệu thiết kế kỹ thuật cho [requirements.md](requirements.md). Trạng thái: **Đã đồng bộ toàn bộ quyết định Chủ sản phẩm chốt ngày 24/11/2026 — Sẵn sàng triển khai**.

---

## D01. Kiến trúc tổng thể & Phạm vi tệp tác động

Giữ nguyên stack hiện tại: **FastAPI + SQLAlchemy 2 (PostgreSQL 16 production / SQLite isolated tests) + Alembic** ở backend; **React 18 + TypeScript + Vite + Lucide** ở frontend. Không thêm thư viện UI mới.

### Cấu trúc mô-đun hóa (không phình thêm `FIWorkspace.tsx`)

`frontend/src/features/fi/FIWorkspace.tsx` hiện dài `4.664` dòng. Toàn bộ trải nghiệm cập nhật tình hình thực hiện mới sẽ được tách thành các thành phần và dịch vụ độc lập, có thể unit test trực tiếp:

| Vùng | Tệp sửa đổi | Tệp mới tạo |
|---|---|---|
| Database & Migration | `backend/app/models/domain.py`<br>`backend/app/services/bootstrap.py` | `backend/alembic/versions/0019_fi_execution_tracking.py` |
| Backend FI Execution & Permissions | `backend/app/schemas/common.py`<br>`backend/app/api/routes/fi.py`<br>`backend/app/services/fi/service.py`<br>`backend/app/services/fi/auto_completion.py`<br>`backend/app/services/fi/dashboard_matrix.py`<br>`backend/app/services/fi/history_query.py`<br>`backend/scripts/revert_fi_auto_done.py` | `backend/app/services/fi/execution.py` *(quy tắc phân quyền, trạng thái thực hiện, phân biệt `confirmed` vs `auto_done`, format plan & history)* |
| Frontend API Client & Types | `frontend/src/api/client.ts`<br>`frontend/src/features/fi/types/fiDashboard.ts`<br>`frontend/src/features/fi/utils/fiMetrics.ts` | `frontend/src/features/fi/utils/fiExecution.ts` *(hàm thuần suy diễn trạng thái `completed`/`auto_done`/`in_progress`/`paused`, phân quyền `canUpdateExecution`, `canUploadCompletionImages`)* |
| Frontend FI UI Components | `frontend/src/features/fi/FIWorkspace.tsx`<br>`frontend/src/features/fi/components/FiDetailDrawer.tsx`<br>`frontend/src/features/fi/components/FiMatrixCellDrawer.tsx`<br>`frontend/src/features/fi/components/FiDashboardView.tsx`<br>`frontend/src/features/fi/components/FiKhmtMatrix.tsx` | `frontend/src/features/fi/components/FiExecutionUpdateModal.tsx` *(hộp thoại cập nhật tiến độ + ghi chú + tải ảnh hoàn thành)*<br>`frontend/src/features/fi/components/FiExecutionBand.tsx` *(dải hiển thị tình hình thực hiện + nút cập nhật dùng chung cho cả `FiDetailDrawer` và `Lịch sử FI`)* |
| Styling & Admin Polish | `frontend/src/styles.css`<br>`frontend/src/features/admin/AdminPanel.tsx` | — |
| Tests | `backend/tests/unit/test_fi_service.py`<br>`backend/tests/unit/test_fi_dashboard_matrix.py`<br>`backend/tests/unit/test_revert_fi_auto_done.py`<br>`frontend/src/features/fi/FIWorkspace.test.ts` | `backend/tests/unit/test_fi_execution_tracking.py`<br>`frontend/src/features/fi/FiExecution.test.ts` |

---

## D02. Mô hình Dữ liệu & Migration (`0019_fi_execution_tracking.py`)

Thiết kế **bổ sung tối thiểu, hoàn toàn nullable / có giá trị mặc định an toàn** để không làm hỏng bất kỳ bản ghi hay query cũ nào.

### D02.1. Bảng `sk_ctkt` — Thêm 3 cột tùy chọn

```python
execution_status: Mapped[str | None] = mapped_column(String(32), index=True)
# Giá trị chuẩn: None | "in_progress" | "paused" | "completed"

execution_note: Mapped[str | None] = mapped_column(Text)
# Ghi chú tình hình thực hiện / kết quả / lý do tạm dừng mới nhất (tối đa 1000 ký tự)

execution_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
execution_updated_by: Mapped[str | None] = mapped_column(String)
```

> **Tương thích dữ liệu cũ (`execution_status IS NULL`):**
> Không cần backfill cưỡng bức khi chạy migration. Hàm suy diễn thuần `resolve_execution_state(record, today)` trong `backend/app/services/fi/execution.py` xử lý nhất quán cho cả bản ghi cũ lẫn mới:
> 1. Nếu `record.status not in ('Approved', 'Completed')`:
>    - Trả về `applicable = False`, `state = "not_applicable"` *(trừ trường hợp bản ghi tạo trên web đã ghi sẵn "Đã hoàn thành" khi đăng ký → vẫn hiển thị kế hoạch gốc trong form đăng ký/sửa, nhưng không cộng vào mẫu số tiến độ triển khai của SK đã duyệt)*.
> 2. Nếu `record.status in ('Approved', 'Completed')`:
>    - Nếu `record.execution_status == "paused"` → `state = "paused"`, `is_auto_done = False` *(tạm dừng, không bị job tự động tick hoàn thành)*.
>    - Ngược lại nếu `record.execution_status == "completed"` OR `record.status == "Completed"` OR `record.completed_at is not None` OR `completion_plan_indicates_done(record.completion_plan)`:
>      - `state = "completed"`, và `is_auto_done = (last_plan_history_reason(record) == "completion_auto_done")` *(phân biệt rõ phiếu tự ghi nhận cần xác nhận vs phiếu đã có người xác nhận)*.
>    - Ngược lại (`in_progress` hoặc `None`):
>      - Parse `due_date = completion_plan_due_date(record.completion_plan)`.
>      - Nếu `due_date is not None and due_date <= today` → `state = "completed"`, `is_auto_done = True` *(khớp đúng quy ước tự ghi nhận khi tới hạn cho SK `Approved`, đồng bộ trước khi chu kỳ nền 15 phút kịp chạy)*.
>      - Ngược lại → `state = "in_progress"`, `is_auto_done = False`.

### D02.2. Bảng `sk_images` — Thêm 1 cột phân loại giai đoạn ảnh

```python
stage: Mapped[str] = mapped_column(
    String(32),
    default="registration",
    server_default="registration",
    nullable=False,
)
# Giá trị hợp lệ: "registration" (Ảnh đăng ký/hiện trạng) | "completion" (Ảnh bằng chứng hoàn thành)
```

- Toàn bộ `87` ảnh hiện có trên production tự động nhận `stage = "registration"` nhờ `server_default`.
- Migration `0019_fi_execution_tracking.py` là idempotent (kiểm tra cột tồn tại trước khi `add_column` khi chạy trên môi trường dev) và đồng bộ bổ sung hàm `_ensure_sk_ctkt_execution_columns()` trong `bootstrap.py` cho SQLite test harness.

---

## D03. Thiết kế Backend API, Phân quyền & Khóa đồng thời

### D03.1. Ma trận hàm kiểm tra quyền trong `backend/app/services/fi/execution.py`

```python
EXECUTION_EDITABLE_STATUSES = {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}
OWNER_PRE_APPROVAL_PLAN_STATUSES = {
    SKStatus.SUBMITTED.value,
    SKStatus.NEED_MORE_INFO.value,
    SKStatus.REVIEWED.value,
    SKStatus.DEFERRED.value,
    SKStatus.REJECTED.value,
}

def can_update_execution(
    record: SKCTKTModel,
    principal: dict[str, Any],
    db: Session,
) -> tuple[bool, str | None]:
    role = principal["role"]
    actor = principal["user_id"]
    principal_team = principal.get("team") or actor

    if record.status == SKStatus.CANCELLED.value:
        return False, "SK đã hủy, không thể cập nhật tình hình thực hiện."

    if record.status in EXECUTION_EDITABLE_STATUSES:
        if role == Role.ADMIN.value:
            return True, None
        if role == Role.FI_COORDINATOR.value:
            return True, None
        if role == Role.TEAM_ACCOUNT.value and principal_team == record.team:
            return True, None
        if is_author_or_submitter(record, actor, db):
            return True, None
        return (
            False,
            f"Chỉ tác giả, người gửi hộ, Đội/Tổ trưởng {record.team}, Đầu mối FI hoặc Quản trị mới được cập nhật tình hình thực hiện.",
        )

    # Trước khi duyệt: chỉ tác giả/người gửi hộ được cập nhật kế hoạch dự kiến của chính phiếu mình.
    if record.status in OWNER_PRE_APPROVAL_PLAN_STATUSES and is_author_or_submitter(record, actor, db):
        return True, None
    return False, "Chỉ cập nhật tình hình thực hiện sau khi SK được Đồng ý."
```

### D03.2. Endpoint cập nhật tình hình thực hiện

Bổ sung endpoint chuyên biệt rõ ngữ nghĩa, **đồng thời** giữ `PUT /api/v1/fi/sk-ctkt/{record_id}` tương thích ngược:

#### `PUT /api/v1/fi/sk-ctkt/{record_id}/execution`

- **Quyền route:** `TEAM_ACCOUNT`, `STAFF`, `FI_COORDINATOR`, `ADMIN` (kiểm tra chi tiết bằng `can_update_execution`).
- **Request schema (`SKExecutionUpdate` trong `schemas/common.py`):**

```python
class SKExecutionUpdate(BaseModel):
    execution_status: Literal["in_progress", "paused", "completed"]
    completion_date: date | None = None
    execution_note: str | None = Field(default=None, max_length=1000)
    expected_revision: int = Field(..., ge=0)
```

- **Quy tắc validation (`backend/app/services/fi/execution.py`):**
  1. `execution_status == "completed"`:
     - `completion_date` mặc định là `factory_today()` nếu không truyền; nếu truyền thì PHẢI `<= factory_today()` (`400`: *"Ngày hoàn thành không được sau ngày hôm nay"*).
     - `record.completed_at = completion_date_to_datetime(completion_date)`
     - `record.completion_plan = format_plan(True, completion_date)` (vd. `"Đã hoàn thành 24/11/2026"`).
  2. `execution_status == "in_progress"`:
     - `completion_date` bắt buộc: đối với SK `Approved` PHẢI `> factory_today()` (từ ngày mai trở đi để khớp quy tắc tự ghi nhận khi tới hạn; nếu chưa xong và chưa có ngày cụ thể thì dùng `paused`); đối với SK chưa duyệt cho phép `>= factory_today()`.
     - `record.completed_at = None`
     - `record.completion_plan = format_plan(False, completion_date)` (vd. `"Dự kiến hoàn thành 31/12/2026"`).
  3. `execution_status == "paused"`:
     - `completion_date` tùy chọn (nếu có thì `>= factory_today()`).
     - `record.completed_at = None`
     - `record.completion_plan = f"Tạm dừng · Dự kiến {completion_date.strftime('%d/%m/%Y')}"` nếu có ngày, ngược lại `"Tạm dừng / Chờ điều kiện triển khai"`.
     - **Quan trọng:** `auto_completion.py` bỏ qua hoàn toàn mọi bản ghi `execution_status == "paused"`.
  4. `record.execution_status = payload.execution_status`
  5. `record.execution_note = (payload.execution_note or "").strip() or None`
  6. `record.execution_updated_at = now`, `record.execution_updated_by = actor`
  7. Giữ nguyên `record.status`, `record.approved_at`, `record.consider_for_khmt`, `record.khmt_month`, `record.khmt_year`, `record.is_counted_for_okr`!

#### Quy tắc khóa đồng thời (Lock Ordering & Period Lock Exemption)

**Điểm thiết kế cực kỳ quan trọng (R01.4):**
- Hàm `_lock_record_for_execution_update(db, record_id)` khóa theo thứ tự bất biến:
  `lock_fi_teams(db, {team})` → `SELECT sk_ctkt WHERE id = record_id FOR UPDATE`
- **KHÔNG gọi `assert_period_mutable(khmt_month, khmt_year)`** khi chỉ cập nhật tiến độ thực hiện hoặc tải/xóa ảnh `stage = "completion"`!
  - **Lý do an toàn:** Các mutation này tuyệt đối không chạm vào `team`, `status`, `approved_at`, `khmt_month`, `khmt_year`, `consider_for_khmt`, `is_counted_for_okr` — nên **không thể vi phạm bất kỳ invariant nào của `monthly_allocation` / `O5.KR13` / khóa kỳ tháng đã chốt**.
  - Vẫn giữ `lock_fi_teams` + `FOR UPDATE` + `_assert_revision(record, expected_revision)` để ngăn lost update và giữ thứ tự khóa chống deadlock.
- Ngược lại, mọi thao tác thay đổi nội dung trước duyệt (`update`), đổi trạng thái xét duyệt (`transition`), gán/bỏ KHMT (`assign_khmt`/`clear_khmt`), xóa SK (`delete`), hoặc thêm/xóa ảnh `stage = "registration"` **vẫn giữ nguyên** `_lock_record_context` + `assert_period_mutable` như cũ.

#### Ghi nhận lịch sử, Audit & Thông báo

- Append vào `record.status_history`:
  ```json
  {
    "from_status": "Approved",
    "to_status": "Approved",
    "changed_by": "minhvq",
    "changed_at": "2026-11-24T10:30:00+00:00",
    "reason": "execution_update",
    "comments": {
      "previous_execution_status": "in_progress",
      "execution_status": "completed",
      "previous_completion_plan": "Dự kiến hoàn thành 31/12/2026",
      "completion_plan": "Đã hoàn thành 24/11/2026",
      "previous_completed_at": null,
      "completed_at": "2026-11-24T00:00:00+00:00",
      "execution_note": "Đã lắp cover nhựa nút E-Stop F08101 và kiểm tra thực tế."
    }
  }
  ```
- Ghi `audit(db, actor, "SK_CTKT", record_id, "update_execution", {...})`.
- Thông báo `SK_EXECUTION_UPDATED` gửi tới các owner thật (`_owner_recipient_ids(db, record)`) khác với `actor` (bỏ qua `historical-import`/`deploy-import`).
- Xóa cache `fi:public_sk` và `okr:dashboard`.

### D03.3. Mở rộng Endpoint ảnh `POST/DELETE /api/v1/fi/sk-ctkt/{record_id}/images`

- **`POST /fi/sk-ctkt/{record_id}/images?expected_revision={int}&stage=registration|completion`**:
  - Mặc định `stage = "registration"` (tương thích ngược 100%).
  - Khi `record.status in {'Approved', 'Completed'}`:
    - Tự động chuẩn hóa hoặc yêu cầu `stage = "completion"`.
    - Kiểm tra quyền bằng `can_update_execution(record, principal, db)` (cho phép `author`, `submitter`, `Team_Account` cùng đội, `FI_Coordinator` theo Q1, `Admin`).
    - Dùng khóa `_lock_record_for_execution_update` (không bị chặn bởi khóa kỳ KHMT).
  - Khi `record.status in AUTHOR_CONTENT_EDITABLE_STATUSES`: giữ nguyên quyền cũ (`author`/`submitter` hoặc `Admin`, kèm khóa kỳ).
- **`DELETE /fi/sk-ctkt/{record_id}/images/{image_id}?expected_revision={int}`**:
  - Nếu `image.stage == "completion"` và `record.status in {'Approved', 'Completed'}`:
    - Cho phép `Admin`, người đã tải ảnh (`image.uploaded_by == actor`), hoặc `Team_Account` cùng đội (`principal_team == record.team`) xóa ảnh hoàn thành.
    - **Cấm xóa ảnh `stage == "registration"`** trên SK đã `Approved` (trừ `Admin`) để bảo toàn hồ sơ gốc đã duyệt.
- Response `sk_image_to_dict(image)` trả thêm `"stage": image.stage`.

### D03.4. Mở rộng Serialization `_sk_to_dict` & Bộ lọc `GET /fi/history`, `GET /fi/dashboard`

1. **`_sk_to_dict(record, db)`** trả thêm khối tính toán thống nhất (để Backend là Single Source of Truth, không lặp regex phức tạp giữa SQL / Python / TypeScript):
   ```json
   "execution_state": {
     "status": "completed",
     "raw_status": "completed",
     "is_auto_done": true,
     "applicable": true,
     "due_date": "2026-11-10",
     "completed_date": "2026-11-10",
     "note": "Đang chờ xác nhận thực tế",
     "updated_at": "2026-11-10T00:00:00+00:00",
     "updated_by": "system",
     "updated_by_name": "Hệ thống",
     "can_update": true,
     "update_blocked_reason": null,
     "can_upload_completion_image": true
   }
   ```
   *(Lưu ý: trường `can_update` và `can_upload_completion_image` được tính nhẹ theo `principal` trong `_sk_to_dict` khi truyền `principal`, hoặc frontend dùng đồng thời hàm thuần `canUpdateExecution` khớp 100%.)*
2. **`GET /fi/history`:**
   - Mở rộng query param `completion` hỗ trợ 4 giá trị: `done`, `pending` *(giữ nguyên tương thích)*, `auto_done` *(tự ghi nhận · cần xác nhận)*, `paused` *(tạm dừng)*.
   - Sửa `summary` + `facets`: bổ sung `facets.decisions` tính theo **disjunctive faceting** (`exclude={"decisions"}`) để 4 thẻ trạng thái (`Đồng ý`, `Không đồng ý`, `Xem xét sau`, `Chưa duyệt`) không nhảy về `0` khi bấm chọn 1 thẻ!
   - Bổ sung vào `summary`: `approved_completed_count`, `approved_confirmed_completed_count`, `approved_auto_done_count`, `approved_in_progress_count`, `approved_paused_count`.
3. **`GET /fi/dashboard`:**
   - Giữ nguyên tất cả key cũ (`completed_count`, `not_completed`, ...) cho tương thích ngược.
   - Bổ sung `approved_completed_count`, `approved_confirmed_completed_count`, `approved_auto_done_count`, `approved_in_progress_count`, `approved_paused_count` trong `totals`, `selected_year_totals`, `teams[]`, `selected_year_teams[]` — chỉ đếm trên `status IN ('Approved', 'Completed')`.
4. **`backend/app/services/fi/auto_completion.py` (Đã chốt Q2):**
   - Đổi `NOT_AUTO_DONE_STATUSES` thành allowlist tường minh: **`AUTO_DONE_ELIGIBLE_STATUSES = {SKStatus.APPROVED.value}`**.
   - Trong `_plan_transition(record, today)`:
     - Vẫn sửa lỗi nhập nhầm `"Đã hoàn thành"` với ngày trong tương lai (`completed_on > today`) về `"Dự kiến hoàn thành"` (`AUTO_PLANNED_REASON`).
     - Với chiều tự ghi nhận hoàn thành (`due <= today`): **CHỈ kích hoạt** khi `record.status in AUTO_DONE_ELIGIBLE_STATUSES` VÀ `record.execution_status != "paused"`. Đồng thời gán `record.execution_status = "completed"`.
     - Cấm tuyệt đối tự động đánh dấu hoàn thành cho `Draft`, `Submitted`, `NeedMoreInfo`, `Reviewed`, `Deferred`, `Rejected`, `Cancelled`.
   - Mở rộng `backend/scripts/revert_fi_auto_done.py` bổ sung `REVERTABLE_STATUSES = {Draft, Submitted, NeedMoreInfo, Reviewed, Deferred, Rejected, Cancelled}` (giữ `--dry-run` làm mặc định để báo cáo chính xác ~25 phiếu chưa duyệt đang dính `completed_at` trên VPS trước khi chạy `--apply`).

---

## D04. Thiết kế Frontend UI/UX & Kiến trúc Z-Index

### D04.1. Thang Z-Index Chuẩn hóa (Sửa triệt để lỗi che khuất `FiDetailDrawer`)

| Lớp (`frontend/src/styles.css`) | Selector | `z-index` cũ | **`z-index` mới** | Ghi chú |
|---|---|---:|---:|---|
| Sticky controls / Month header | `.legacy-sticky-controls`, `.legacy-month-sticky-head` | `30`, `20` | **`25`**, **`15`** | Đảm bảo không che thẻ chi tiết mở rộng (`scroll-margin-top` khớp chiều cao sticky stack) |
| Topbar | `.topbar` | `40` | **`40`** | Giữ nguyên |
| Popover bộ lọc & chọn tháng KHMT | `.fi-filter-popover`, `.fi-khmt-picker-popover` | `50–80` | **`80`** | Nổi trên bảng/sticky |
| Matrix Cell Drawer | `.fi-drawer-backdrop` | `140` | **`140`** | Trượt phải mức 1 |
| Unified Detail Drawer | `.fi-detail-drawer-backdrop` | `160` | **`160`** | Trượt phải mức 2 (trên Cell Drawer) |
| **Modals (`FiExecutionUpdateModal`, `EditModal`)** | **`.fi-edit-modal-backdrop`** | **`120` (BUG!)** | **`200`** | **Luôn nổi trên `FiDetailDrawer`** |
| **Image Lightbox (`SkImageViewer`)** | **`.image-viewer-backdrop`** | **`150` (BUG!)** | **`220`** | **Luôn nổi trên cả Modal & Drawer** |
| System Confirm / Reauth Dialog | `.editing-dialog-backdrop` | `300` | **`300`** | Lớp cao nhất |

### D04.2. Thiết kế `FiExecutionUpdateModal.tsx`

Wireframe hộp thoại (Desktop `560px` centered modal · Mobile `390px` full-width bottom sheet):

```text
┌─────────────────────────────────────────────────────────────┐
│ Cập nhật tình hình thực hiện                            [×] │
│ FI/07/2026-TBHTĐK-03 · Sử dụng nguồn khí Plant air...       │
│ Tác giả: Nguyễn Mạnh Quỳnh · TBHTĐK · Đồng ý                │
├─────────────────────────────────────────────────────────────┤
│ Hiện tại: [⏱ Dự kiến 31/12/2026]  (hoặc [✓ Tự ghi nhận · cần XN])│
│                                                             │
│ Tình trạng triển khai *                                     │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│ │ ⏱ Đang thực hiện│ │ ⏸ Tạm dừng /    │ │ ✓ Đã hoàn thành │ │
│ │ Theo ngày dự kiến│ │ Chờ dừng máy    │ │ Đã áp dụng xong │ │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘ │
│                                                             │
│ [Khi chọn "Đã hoàn thành"]:                                 │
│ Ngày hoàn thành *      [ 2026-11-24 📅 ]  [Hôm nay] [Hôm qua]│
│                                                             │
│ [Khi chọn "Đang thực hiện"]:                                │
│ Ngày dự kiến *         [ 2026-12-31 📅 ]  [+15 ngày] [+1 th]│
│                                                             │
│ Ghi chú tình hình / kết quả (tùy chọn)                      │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Vd: Đã lắp cover nhựa nút Emergency Stop F08101...      │ │
│ └─────────────────────────────────────────────────────────┘ │
│ Gợi ý nhanh: [+ Đã lắp đặt & chạy ổn định] [+ Chờ vật tư]  │
│              [+ Chờ dừng máy BDTT]                          │
│                                                             │
│ Ảnh bằng chứng hoàn thành (tùy chọn · hỗ trợ Ctrl+V Zalo)   │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [📷 Chọn / Chụp ảnh] hoặc kéo thả / nhấn Ctrl+V vào đây │ │
│ │ (Hiển thị thumbnail ảnh hoàn thành đã có + ảnh mới chọn)│ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ℹ Không làm thay đổi kết luận Đồng ý hay kỳ KHMT đã phân bổ.│
├─────────────────────────────────────────────────────────────┤
│                                  [ Hủy ]  [ Lưu cập nhật ]  │
└─────────────────────────────────────────────────────────────┘
```

**Hành vi UX tinh tế:**
- Khi mở hộp thoại cho SK `Approved` chưa hoàn thành: mặc định highlight sẵn trạng thái hiện tại hoặc gợi ý trực quan (nếu user bấm nút **"Đánh dấu hoàn thành"** thì pre-select `completed` với ngày hôm nay; nếu bấm **"Cập nhật tình hình thực hiện"** thì giữ trạng thái hiện tại, 1 click chuyển sang `Đã hoàn thành` hoặc `Tạm dừng`).
- Hỗ trợ lắng nghe `onPaste` toàn hộp thoại để dán thẳng ảnh chụp màn hình / ảnh từ Zalo PC (`Ctrl+V`).
- Trên mobile, `<input type="file" accept="image/*,.heic,.heif" multiple />` cho phép người dùng chọn chụp trực tiếp từ camera điện thoại tại hiện trường.
- Hiển thị tiến trình lưu rõ ràng: `Đang lưu tiến độ...` → `Đang tải ảnh bằng chứng (1/2)...`.

### D04.3. Trải nghiệm Nhất quán tại `Lịch sử FI`, `FiDetailDrawer`, `FiMatrixCellDrawer` & `Đăng ký SK-CTKT`

1. **Dải `FiExecutionBand.tsx` dùng chung (cả `Lịch sử FI → Xem chi tiết` lẫn `FiDetailDrawer`):**
   - Hiển thị 1 hàng gọn gàng có viền màu ngữ nghĩa bên trái:
     - Xanh lá (`completed`), Xanh ngọc/vàng nhẹ (`completed` + `is_auto_done`), Xanh dương (`in_progress`), Xám tím (`paused`).
   - Trái: nhãn `Tình hình thực hiện` + `CompletionPill` (có nhãn phụ `Tự ghi nhận · cần xác nhận` nếu `is_auto_done`) + dòng phụ `Ghi chú mới nhất` + `Cập nhật bởi {tên} lúc {ngày}` nếu có.
   - Phải:
     - Nếu `canUpdateExecution === true`: nút nổi bật **`Cập nhật tình hình thực hiện`** (`primary` outline/solid rõ ràng); riêng với phiếu `is_auto_done === true` hiển thị thêm cặp nút nhanh **`Xác nhận đã xong`** / **`Gia hạn`** để xác nhận 1 chạm hoặc dời hạn.
     - Nếu `Admin` đang `Chỉnh sửa: Tắt`: hint ngắn `"Bật “Chỉnh sửa” ở góc trên để cập nhật"`.
     - Nếu user khác không có quyền (chỉ với SK `Approved`): hint mờ ngắn `"Tác giả, Đội trưởng {team} hoặc Đầu mối FI cập nhật tiến độ"`.
2. **Tối ưu `Lịch sử FI`:**
   - **Bấm trực tiếp `CompletionPill` trên mỗi dòng** (khi `canUpdateExecution === true`): có biểu tượng bút nhỏ + cursor pointer → mở thẳng `FiExecutionUpdateModal`!
   - **Nút lọc nhanh 1 chạm ngay hàng đầu toolbar:**
     - Với `Team_Account` / `Staff` thuộc 4 đội OKR: chip nút **`Đang thực hiện đội tôi ({n})`** (highlight khi active; bấm 1 lần lọc `Đội = currentTeam`, `Kết luận = Đồng ý`, `Hoàn thành = Chưa hoàn thành`; bấm lại để tắt).
     - Với `FI_Coordinator` / `Admin`: chip nút **`SK duyệt chưa xong ({n})`**.
   - **Khối `Xem chi tiết` mở rộng trên `Lịch sử FI`:**
     - Loại bỏ section `Đã xem xét vào KHMT` bị lặp.
     - Phần `Ảnh bằng chứng` tách nhóm/badge **`Ảnh đăng ký`** và **`Ảnh hoàn thành`**, có ngay nút **`+ Thêm ảnh hoàn thành`** cho user đủ quyền (tác giả, Đội trưởng cùng đội, FI_Coordinator, Admin bật Chỉnh sửa).
     - Phần `Lịch sử cập nhật tình hình thực hiện` hiển thị đầy đủ cả `execution_note` của từng mốc cập nhật.
     - Thêm `scroll-margin-top` cho `.legacy-record` và tự cuộn êm nhẹ khi mở rộng dòng để không bị sticky month header che khuất.
   - **Thẻ summary 4 kết luận (`Đã xét đồng ý`, `Không đồng ý`, `Xem xét sau`, `Chưa duyệt`)**: lấy số đếm từ `historyMeta.facets.decisions` (disjunctive) thay vì `historyMeta.summary` sau filter, nên luôn bấm chuyển trực tiếp qua lại được.
3. **Tối ưu `FiMatrixCellDrawer` (`FI Dashboard → Ma trận KHMT`):**
   - Trên mỗi thẻ SK trong ô, hiển thị `CompletionPill` chuẩn (đủ các trạng thái `Đã hoàn thành`, `Tự ghi nhận`, `Đang thực hiện`, `Tạm dừng`).
   - Nếu `canUpdateExecution === true`, hiện nút nhỏ **`Cập nhật tiến độ`** ngay bên cạnh `Xem chi tiết` → mở `FiExecutionUpdateModal` trực tiếp trên lớp `z-index: 200`, lưu xong tự tăng `refreshNonce` đồng bộ lại cả ô ma trận lẫn Dashboard.
4. **Tối ưu `FI Dashboard`:**
   - Thẻ KPI thứ 4 **`Tiến độ thực hiện (SK đã duyệt)`**:
     - Số chính: `{approved_completed_count}/{approved_total}` (`{rate}%`).
     - Dòng phụ: `{approved_in_progress} đang làm` *(kèm `· {approved_paused} tạm dừng` và `· {approved_auto_done} tự ghi nhận` nếu `> 0`)*.
     - Bấm vào thẻ nhảy sang `Lịch sử FI` lọc sẵn `decisions=["approved"]`, `completion=["pending"]`.
   - 4 thẻ chi tiết đội OKR phía dưới: thanh `Tiến độ thực hiện` cũng dùng đúng `approved_completed_count / approved_total` (khớp tuyệt đối với thẻ KPI tổng).
5. **Tối ưu `Đăng ký SK-CTKT` (`Sáng kiến của tôi` & `Phiếu tôi đã gửi`):**
   - Sửa `ownershipBucketForItem(item)`:
     - `Draft`, `Submitted`, `NeedMoreInfo` → `"pending"`
     - `Approved` **VÀ chưa hoàn thành** (`!isExecutionCompleted(item)`) → `"implementation"` (`Đã duyệt – đang thực hiện`)
     - `Approved` **đã hoàn thành**, `Completed`, `Rejected`, `Deferred`, `Cancelled` → `"history"` (liên kết xem toàn bộ trong `Lịch sử FI`)
   - Trên mỗi dòng của `Sáng kiến của tôi` / `Phiếu tôi đã gửi`, hiển thị `CompletionPill compact` ngay cạnh trạng thái để tác giả/người gửi hộ nhìn ra ngay hạn dự kiến hoặc trạng thái tạm dừng và bấm 1 chạm `Cập nhật tiến độ`.

---

## D05. Concurrency, Bảo mật & Hiệu năng

- **Optimistic Concurrency:** Mọi call `PUT /fi/sk-ctkt/{id}/execution`, `POST /fi/sk-ctkt/{id}/images`, `DELETE /fi/sk-ctkt/{id}/images/{imgId}` đều bắt buộc truyền `expected_revision`. Nếu trả `409 VERSION_CONFLICT`, modal hiển thị cảnh báo tiếng Việt rõ ràng kèm nút **`Tải lại bản mới nhất`** để không ghi đè dữ liệu đồng đội vừa cập nhật.
- **Upload ảnh an toàn:** Giữ nguyên pipeline kiểm tra magic bytes + pixel decode bằng Pillow + chặn SVG + chặn decompression bomb + giới hạn `max_image_upload_mb` + `Idempotency-Key` chống upload lặp.
- **Hiệu năng `GET /fi/history`:** Tính `facets.decisions` bằng 1 query group-by `exclude={"decisions"}` (tổng số SQL vẫn giữ `<= 12` để pass contract test hiệu năng trên 5.000 bản ghi trong `test_audit_remediation_contracts.py` và `test_history_performance_lab.py`).
- **Tương thích ngược test cũ:** Cập nhật các test trong `test_fi_service.py` và `FIWorkspace.test.ts` phản ánh chính xác quy tắc mới: chỉ `Approved` (không `paused`) mới tự động hoàn thành khi tới hạn, còn `Submitted`/`Deferred`/`Draft`/`Rejected` giữ nguyên kế hoạch dự kiến; giữ nguyên tất cả test về phân bổ KHMT, khóa kỳ, revision và OKR dashboard.

---

## D06. Kế hoạch Kiểm thử & Xác minh (`V01–V07`)

| Mã | Phạm vi kiểm thử | Công cụ / Lệnh | Tiêu chí đạt |
|---|---|---|---|
| **V01** | Unit test `execution.py` & `auto_completion.py`: phân quyền 5 vai trò (`Staff` owner vs non-owner, `Team_Account` cùng đội vs khác đội, `FI_Coordinator`, `Workshop_Leader`, `Admin`), validation ngày, `auto_completion` chỉ tick `Approved` không `paused` (bỏ qua `Submitted`/`Deferred`/`Draft`/`Rejected`/`paused`), bypass `PERIOD_LOCKED` chỉ cho execution/completion images | `pytest tests/unit/test_fi_execution_tracking.py` (SQLite cô lập) | 100% pass; xác minh kỳ đã chốt vẫn cập nhật tiến độ + ảnh hoàn thành được nhưng **vẫn chặn `409 PERIOD_LOCKED`** nếu thử đổi `khmt_month` hay `title` |
| **V02** | Unit test ảnh `stage=registration|completion`: upload trên `Approved`, chặn xóa ảnh `registration` trên `Approved`, cho phép tác giả/Đội trưởng/FI_Coordinator xóa ảnh `completion` | `pytest tests/unit/test_fi_execution_tracking.py` | 100% pass |
| **V03** | Dashboard, History & Export Excel: mẫu số KPI `approved_*`, bộ lọc `completion=done|pending|auto_done|paused`, disjunctive `facets.decisions`, cột mới trong file Excel xuất ra, `<= 12` SQL queries trên 5.000 dòng | `pytest tests/unit/test_fi_dashboard_matrix.py tests/integration/test_audit_remediation_contracts.py` | 100% pass |
| **V04** | Dry-run `revert_fi_auto_done.py` trên dữ liệu giả lập gồm `Draft`/`Submitted`/`Deferred`/`Rejected`/`Approved` | `pytest tests/unit/test_revert_fi_auto_done.py` | Chỉ đề xuất hoàn tác các bản ghi chưa duyệt/từ chối/hoãn/nháp do `completion_auto_done` tạo ra (giữ nguyên `Approved`) |
| **V05** | Frontend unit test `fiExecution.ts` & `FIWorkspace.test.ts`: phân quyền UI 5 vai trò, `ownershipBucketForItem` tách SK đã hoàn thành khỏi mục đang thực hiện, phân biệt `auto_done` vs `confirmed` vs `paused` | `cd frontend && npm test` (Vitest) | 100% pass, 0 cảnh báo |
| **V06** | TypeScript build & Playwright E2E đa viewport/role (dùng local isolated preview + mock/sandbox): mở `FiDetailDrawer` → bấm `Cập nhật tình hình thực hiện` xác nhận modal **không bị che khuất** (`isVisible` + clickable), bấm xem ảnh Lightbox nổi trên Drawer, test `Team_Account` (`minhvq`) cập nhật SK của `quynhnm` trên `Lịch sử FI` + upload ảnh hoàn thành + kiểm tra mobile `390×844` & Admin `1440×900` | `npm run build` + Playwright E2E | 0 lỗi TS, 0 lỗi console, 0px tràn ngang, `CompletionPlanDialog`/`FiExecutionUpdateModal` tương tác thành công 100% từ mọi điểm chạm |
| **V07** | Full backend regression suite (kèm Postgres CI nếu chạy trên GitHub Actions) | `run_isolated_checks.py` + `test_isolation_guard.py` | Toàn bộ suite pass, `production_db_untouched: true` |
