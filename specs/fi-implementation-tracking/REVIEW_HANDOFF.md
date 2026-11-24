# Spec & Architecture Peer-Review Handoff — Nâng cấp Luồng Cập nhật Tình hình Thực hiện & Trạng thái Hoàn thành Phân hệ FI (SK-CTKT)

> **Mục đích tài liệu:** Cung cấp bức tranh đầy đủ, trung thực và có thể kiểm chứng độc lập về **toàn bộ vấn đề thực tế** và **phương án thiết kế xử lý đề xuất** cho phân hệ FI (`SK-CTKT`) để một AI Agent khác (hoặc kỹ sư review) **phản biện sâu về nghiệp vụ, kiến trúc, concurrency, hiệu năng PostgreSQL/SQLite và UX trước khi bắt đầu viết mã**.
>
> **Baseline mã nguồn đang đánh giá:** nhánh `main` tại commit `48e22c1` (`Fix FI matrix review findings before release`). **Chưa sửa bất kỳ dòng mã nguồn ứng dụng nào** — hiện mới chỉ lập bộ spec Kiro tại `specs/fi-implementation-tracking/`.

---

## 1. Tài liệu liên quan cần đọc song song

Bộ đặc tả Kiro đầy đủ nằm cùng thư mục:
1. `specs/fi-implementation-tracking/requirements.md` — Mục tiêu, bằng chứng, ma trận phân quyền, yêu cầu `R01–R08` theo mẫu EARS, và Mục 5 chốt quyết định.
2. `specs/fi-implementation-tracking/design.md` — Thiết kế migration `0019`, dịch vụ `execution.py`, endpoint API, khóa đồng thời, thang `z-index`, wireframe UI và kế hoạch kiểm thử `V01–V07`.
3. `specs/fi-implementation-tracking/tasks.md` — Lộ trình triển khai 5 đợt (`T01–T14`) và sơ đồ phụ thuộc.

Tham chiếu ngữ cảnh lịch sử của phân hệ FI trong repo:
- `specs/fi-khmt-dashboard-ux/` (đợt nâng cấp vừa triển khai trước đó: Ma trận KHMT `4 đội × T1–T12`, `FiDetailDrawer`, `FiMatrixCellDrawer`, `FiKhmtMonthPicker`).
- `specs/audit-remediation-ux/` (các invariant về `expected_revision`, khóa kỳ `PERIOD_LOCKED`, thứ tự khóa `team -> period -> fi`, contract hiệu năng `< 12` SQL queries cho `GET /fi/history`).

---

## 2. Bối cảnh & Phản hồi Thực tế từ Người dùng

### 2.1. Phản hồi hiện trường
Ngay sau đợt cập nhật Ma trận KHMT lên production (`https://xdk-pvcfc.com/`), người dùng phản ánh trải nghiệm phân hệ FI vẫn rất tệ ở khâu **theo dõi và cập nhật tình hình thực hiện / trạng thái hoàn thành** của sáng kiến.

Cụ thể, **Đội trưởng TBHTĐK (`minhvq` — Võ Quang Minh, vai trò `Team_Account`)** đã chụp màn hình tab **Lịch sử FI** trên các sáng kiến đã duyệt của anh em trong đội (`FI/07/2026-TBHTĐK-02`, `FI/07/2026-TBHTĐK-03`, `FI/07/2026-TBHTĐK-04`, trạng thái `Đồng ý`, tiến độ `Dự kiến 31/12/2026`, ảnh bằng chứng trống) và phản hồi trực tiếp:
> *"em link sao khi nhấn vào xem chi tiết sẽ có nút cập nhật tình hình thực hiện á"*

### 2.2. Bằng chứng xác minh đa chiều (Code + DB Production chỉ đọc + Trình duyệt live ngày 24/11/2026)

#### Số liệu thực tế từ PostgreSQL Production (`sk_ctkt`, `sk_images`, `audit_logs`, `fi_period_write_guards`)

| Chỉ số | Số lượng thực tế | Hệ quả trực tiếp |
|---|---:|---|
| Tổng SK-CTKT đã duyệt (`Approved`) **chưa hoàn thành** (`completed_at IS NULL`) | **43** | TBCH: `4`, TBHTĐK: `11`, TBĐL: `5`, TCĐK: `23` |
| Số SK `Approved` chưa hoàn thành do **nhân viên hoặc import lịch sử (`HIST-*`) đứng tên** | **41 / 43 (95%)** | TBHTĐK `11/11`, TBCH `4/4`, TBĐL `5/5`, TCĐK `21/23` → Đội trưởng **không thể cập nhật** tiến độ cho 95% phiếu đang triển khai của chính đội mình |
| Số SK `Approved` chưa hoàn thành **đã gán vào kỳ KHMT quá khứ (`T1–T10/2026`)** | **23 / 43 (53%)** | Ngay khi Admin chốt các kỳ KHMT quá khứ, khóa `PERIOD_LOCKED` hiện tại sẽ **chặn vĩnh viễn** việc cập nhật hoàn thành và thêm ảnh nghiệm thu cho 23 phiếu này |
| Số lần người dùng chủ động cập nhật tiến độ (`audit_logs: update_completion_plan`) | **4 lần** *(cuối: 31/10/2026)* | Gần như không ai sử dụng được tính năng cập nhật tiến độ |
| Số SK từng có `status = 'Completed'` (`Hoàn tất`) | **0 / 188** | Endpoint `POST /fi/sk-ctkt/{id}/complete` hoàn toàn bị bỏ hoang |
| Số lần hệ thống **tự động đánh dấu hoàn thành** (`completion_auto_done`) | **58 lần** | Trong đó **20 phiếu chưa hề được duyệt** (`16 Deferred`, `4 Submitted`) bị tự tick `completed_at`; cộng thêm `2 Draft` và `3 Rejected` lịch sử vẫn còn `completed_at` (~25 phiếu sai phạm vi) |
| Kỳ KHMT đã khóa hiện tại (`fi_period_write_guards.is_locked = true`) | **0** | Chưa chốt kỳ nào nên lỗi `PERIOD_LOCKED` chưa bùng nổ, nhưng sẽ chặn hàng loạt ngay khi Admin bắt đầu chốt tháng |

---

## 3. Phân tích Chi tiết 7 Nhóm Vấn đề Hiện tại (Kèm Vị trí Mã nguồn Chính xác)

### Vấn đề 1 [P0] — Lỗi phân quyền cốt lõi: Đội/Tổ trưởng & Đầu mối FI bị chặn cập nhật tiến độ SK của đội
- **Vị trí mã nguồn:**
  - Backend: `backend/app/services/fi/service.py:424-429` (`update_sk_ctkt`) chỉ cho `is_author_or_submitter(record, actor, db)` hoặc `role == Role.ADMIN.value` cập nhật `COMPLETION_PLAN_FIELDS` khi `record.status == "Approved"`.
  - Frontend: `frontend/src/features/fi/FIWorkspace.tsx:1042` (`visibleActionsForSk`):
    ```ts
    const canUpdatePlan = (isPlanOnlyEdit(item) && (canManageAsOwner || role === ADMIN_ROLE)) || (canEdit && item.status !== "Draft");
    ```
  - Frontend hiển thị: `frontend/src/features/fi/FIWorkspace.tsx:462-487` (`CompletionBand`) & `4489-4494`: khi `canUpdate === false` và không phải `Admin`, không render bất kỳ nút bấm hay dòng giải thích nào — tạo ra dải `Tiến độ thực hiện | Dự kiến 31/12/2026` tĩnh, trống trơn đúng như ảnh Zalo của Anh Minh.
- **Tác động:** Đội/Tổ trưởng (`Team_Account`: `minhvq`, `linhln`, `haint`, `thanhdq`, `chienpq`, `doint`, `loitt`) có quyền gán KHMT cho cả đội (`canSelectKhmtMonth` kiểm tra `item.team === ownerTeam`), nhưng lại **không có quyền cập nhật tình hình thực hiện** cho 41/43 phiếu chưa hoàn thành của đội mình. Tương tự, Đầu mối FI (`FI_Coordinator`: `quyenpt`) cũng không cập nhật được tiến độ cho các SK đã duyệt toàn xưởng.

### Vấn đề 2 [P0] — Lỗi `z-index` chí mạng: Mở hộp thoại từ `FiDetailDrawer` bị che khuất hoàn toàn phía sau Drawer
- **Bằng chứng xác minh trực tiếp trên trình duyệt live (`https://xdk-pvcfc.com/`) & CSS:**
  - `frontend/src/styles.css:18369-18371`: `.fi-detail-drawer-backdrop` có **`z-index: 160`**.
  - `frontend/src/styles.css:1337-1346`: `.fi-edit-modal-backdrop` (dùng chung cho **cả `CompletionPlanDialog` lẫn `EditModal`**) chỉ có **`z-index: 120`**!
  - `frontend/src/styles.css:7048-7057`: `.image-viewer-backdrop` (`SkImageViewer` Lightbox) chỉ có **`z-index: 150`**!
- **Hệ quả nghiêm trọng:** Lỗi này mới phát sinh khi `FiDetailDrawer` (`z-index: 160`) được giới thiệu ở đợt trước (`347e7c9`). Khi người dùng (kể cả chính tác giả `baomt` hay `Admin` bật `Chỉnh sửa`) mở `FiDetailDrawer` ở tab `Đăng ký`, `Xét duyệt`, `FI Dashboard → Ma trận KHMT` hay từ **Chuông thông báo**, rồi bấm **`Cập nhật tiến độ`**, **`Chỉnh sửa`**, hoặc **bấm ảnh để phóng to**, modal mở **ẩn phía sau `FiDetailDrawer`** (`div.fi-drawer-body` che toàn bộ click — `ELEMENT_OCCLUDED`). Người dùng thấy bấm nút mà không có gì xảy ra.

### Vấn đề 3 [P0] — Đóng băng hoàn toàn việc tải "Ảnh bằng chứng hoàn thành" sau khi SK được `Đồng ý`
- **Vị trí mã nguồn:**
  - Backend: `backend/app/api/routes/fi.py:756-758` (`upload_image`) & `903-905` (`delete_image`): kiểm tra `record.status not in AUTHOR_CONTENT_EDITABLE_STATUSES` (tập này **loại trừ `Approved`**).
  - Frontend: `frontend/src/features/fi/FIWorkspace.tsx:1066-1073` (`canUploadImages`) chỉ cho non-Admin khi `AUTHOR_EDITABLE_STATUSES.includes(item.status)` (không có `Approved`). Ngoài ra trong phần `Ảnh bằng chứng` của tab `Lịch sử FI` (`FIWorkspace.tsx:4539-4577`), **hoàn toàn không render nút `Thêm ảnh`** cho bất kỳ vai trò nào (kể cả Admin bật Chỉnh sửa).
  - Model `SKImageModel` (`backend/app/models/domain.py:264-275`) chưa có cột phân biệt **ảnh đăng ký / hiện trạng** vs **ảnh bằng chứng hoàn thành**.
- **Tác động:** Quy trình thực tế tại xưởng là đăng ký ý tưởng trước → duyệt `Đồng ý` → triển khai lắp đặt ngoài hiện trường → chụp ảnh nghiệm thu/kết quả để chứng minh đã hoàn thành. Hiện tại sau khi duyệt `Đồng ý`, không ai có thể bổ sung ảnh bằng chứng hoàn thành trên giao diện.

### Vấn đề 4 [P0] — Khóa kỳ KHMT (`PERIOD_LOCKED`) chặn luôn việc cập nhật tiến độ & ảnh bằng chứng
- **Vị trí mã nguồn:**
  - `backend/app/services/fi/service.py:420` (`update_sk_ctkt`) gọi `_lock_record_context(db, record_id)` (`service.py:118-153`), hàm này gọi `assert_period_state_mutable` và `assert_period_mutable` trên `(record.team, record.khmt_month, record.khmt_year)`.
  - `backend/app/api/routes/fi.py:755` (`upload_image`) gọi `_lock_record_for_attachment_mutation` (`fi.py:89-103`), cũng gọi `assert_period_mutable` trên kỳ KHMT.
- **Mâu thuẫn nghiệp vụ:** Chính comment trong `service.py:68-69` ghi rõ: *"KHMT xét theo approved_at nên đổi kế hoạch không ảnh hưởng phân bổ"*. Trên thực tế có **23/43 SK đã duyệt chưa xong** đang gắn vào KHMT `T1–T10/2026` với ngày dự kiến cuối 2026–2027 (chờ dừng máy/BDTT). Khi Admin chốt báo cáo các tháng đó, toàn bộ 23 SK này sẽ bị kẹt `409 PERIOD_LOCKED` không thể báo cáo hoàn thành hay bổ sung ảnh nghiệm thu.

### Vấn đề 5 [P0] — Job `auto_completion.py` tự động đánh dấu hoàn thành sai phạm vi & thiếu trạng thái `Tạm dừng` / ghi chú
- **Vị trí mã nguồn:**
  - `backend/app/services/fi/auto_completion.py:29-32, 71-85`: chỉ loại trừ `SKIPPED_STATUSES = {Cancelled, Completed}` và `NOT_AUTO_DONE_STATUSES = {Draft, Rejected}`. Do đó mọi phiếu `Submitted`, `NeedMoreInfo`, `Reviewed`, `Deferred` khi `due <= today` đều bị job nền (chạy mỗi 15 phút trong `main.py:28-36`) tự động ghi đè thành `"Đã hoàn thành dd/mm/yyyy"` + set `completed_at`!
  - `backend/scripts/revert_fi_auto_done.py:65-67`: mới chỉ quét `NOT_AUTO_DONE_STATUSES = {Draft, Rejected}`, chưa quét `Submitted`/`Deferred`/`NeedMoreInfo`/`Reviewed`.
  - `frontend/src/features/fi/FIWorkspace.tsx:553-676` (`CompletionPlanDialog`): chỉ có 2 radio (`Đã hoàn thành` / `Đang thực hiện`) + 1 ô ngày; không có trạng thái `Tạm dừng / Chờ dừng máy` (dù nhiều SK thực tế nhà máy phải chờ dừng máy BDTT hoặc vật tư), không có ô ghi chú tình hình thực hiện, không có chỗ tải ảnh hoàn thành, và ép `min = tomorrowIsoDate()` kể cả khi đang sửa nội dung phiếu chưa duyệt.

### Vấn đề 6 [P1] — Phân mảnh điểm chạm & sai lệch ngữ nghĩa số liệu trên 4 tab FI
- **`FI Dashboard` (`FiDashboardView.tsx:399-412`, `466-470`, `515-527`):** Thẻ KPI `Tiến độ thực hiện` (`115 / 185 = 62%`) và thanh tiến độ 4 đội đang lấy mẫu số là **tổng tất cả SK** (bao gồm cả `Chờ duyệt`, `Xem xét sau`, `Không đồng ý`) thay vì chỉ tính trên tập **SK đã được duyệt (`Approved`/`Completed`)**. Khi lọc `Không đồng ý (10)` ở `Lịch sử FI` vẫn báo `Hoàn thành 3 · 7 chưa xong`.
- **`Đăng ký SK-CTKT` (`FIWorkspace.tsx:302-306`, `3644-3712`):** `ownershipBucketForItem` xếp mọi bản ghi có `status === "Approved"` vào mục **`Đã duyệt – đang thực hiện`** / **`Phiếu gửi hộ đã duyệt – đang thực hiện`** — không kiểm tra xem SK đã hoàn thành chưa! Trên live browser, `baomt` thấy phiếu đã `Đã hoàn thành 25/07/2026` nằm ngay trong mục *"đang thực hiện"*, và từng dòng lại không hiện `CompletionPill`.
- **`Lịch sử FI` (`FIWorkspace.tsx:4267-4582`):**
  - Chưa cho bấm trực tiếp vào `CompletionPill` trên dòng để cập nhật nhanh; chưa có nút lọc 1 chạm *"Đang thực hiện đội tôi"* cho Đội trưởng.
  - Khung `Xem chi tiết` lặp 2 lần thông tin KHMT (`Xét vào KHMT` ở dòng 4484 và `Đã xem xét vào KHMT` ở dòng 4518).
  - Tiêu đề nhóm tháng sticky (`.legacy-month-sticky-head`) đè lên đầu thẻ mở rộng khi cuộn.
  - Bấm 1 trong 4 thẻ thống kê kết luận (`Đồng ý`, `Không đồng ý`, `Xem xét sau`, `Chưa duyệt`) khiến 3 thẻ kia nhảy về `0` (vì `summary` tính sau khi đã áp filter `decisions`, khác với dropdown đã dùng disjunctive faceting).
- **`FI Dashboard → Ma trận KHMT` (`FiKhmtMatrix.tsx:166`, `FiMatrixCellDrawer.tsx:392-433`):**
  - Dòng mô tả dưới tiêu đề ma trận nói với tất cả người dùng *"bấm vào bất kỳ ô nào để gán/bỏ trực tiếp"* kể cả `Staff`/`Workshop_Leader`/`FI_Coordinator` không có quyền gán KHMT.
  - Trong `FiMatrixCellDrawer`, mỗi thẻ SK chỉ hiện badge tĩnh, không có nút cập nhật tiến độ trực tiếp.

### Vấn đề 7 [P2] — Hiển thị Mobile (`390×844`) & Bảng `/Admin → Chốt KHMT & FI` (`1440×900`)
- Mobile `390×844`: tiêu đề topbar bị cắt (`Sáng kiến FI (SK-C...`), thanh tab FI tràn cắt chữ cuối (`Lịch...`), select `Năm` trên Dashboard hơi lệch trục dọc.
- Desktop `1440×900` tại `/Admin → Chốt KHMT & FI`: cột `THAO TÁC` ở mép phải bị cắt nhẹ (`Nhập b...`).

---

## 4. Các Quyết định Nghiệp vụ Đã được Chủ sản phẩm Chốt (24/11/2026)

AI Agent review cần tôn trọng **4 quyết định đã khóa** dưới đây (không đề xuất đảo ngược trừ khi phát hiện lỗi kỹ thuật/bảo mật nghiêm trọng):

1. **Phân quyền cập nhật tình hình thực hiện & ảnh bằng chứng hoàn thành cho SK `Approved`:**
   - **Tác giả / Người đăng ký hộ** + **Đội/Tổ trưởng (`Team_Account`, đúng đội của mình)** + **Đầu mối FI (`FI_Coordinator`, toàn xưởng)** + **Admin (khi bật `Chỉnh sửa`)**.
   - `Workshop_Leader` giữ chỉ xem; `Staff` khác và `Team_Account` đội khác không có quyền.
2. **Chính sách tự động đánh dấu hoàn thành (`auto_completion.py`):**
   - **GIỮ cơ chế tự động hoàn thành khi tới ngày dự kiến, NHƯNG CHỈ áp dụng cho SK `Approved` (và không ở trạng thái `Tạm dừng`)**.
   - Cấm tuyệt đối tự động đánh dấu hoàn thành cho `Draft`, `Submitted`, `NeedMoreInfo`, `Reviewed`, `Deferred`, `Rejected`, `Cancelled`.
   - Phân biệt rõ trên UI giữa *"Đã hoàn thành (đã xác nhận)"* và **`Tự ghi nhận · cần xác nhận`** (kèm nút nhanh **Xác nhận đã xong** / **Gia hạn hoặc Tạm dừng**).
3. **Trường bắt buộc khi bấm "Đã hoàn thành":**
   - Bắt buộc **Ngày hoàn thành** (mặc định hôm nay, `<= hôm nay`).
   - **Ghi chú kết quả** và **Ảnh bằng chứng hoàn thành** là **tùy chọn (khuyến nghị)** — không khóa cứng bắt buộc.
4. **Mô hình dữ liệu & Làm sạch dữ liệu cũ trên VPS:**
   - Giữ `status = 'Approved'` cho chiều xét duyệt, tách riêng chiều **`execution_status`** (`in_progress` | `paused` | `completed`) + `execution_note` + `sk_images.stage` (`registration` | `completion`).
   - Mở rộng `revert_fi_auto_done.py` chạy `--dry-run` để rà soát toàn bộ ~25 phiếu chưa duyệt (`Submitted`, `Deferred`, `Draft`, `Rejected`) đang dính `completed_at` cũ trên VPS để Chủ sản phẩm duyệt trước khi `--apply`.

---

## 5. Phương án Xử lý Kỹ thuật Đề xuất (Tóm tắt Kiến trúc)

### 5.1. Database & Migration (`backend/alembic/versions/0019_fi_execution_tracking.py`)
- Thêm 4 cột nullable trên `sk_ctkt` (không cần backfill cưỡng bức, tương thích 100% dữ liệu cũ):
  - `execution_status: String(32), nullable=True, index=True` (`None` | `"in_progress"` | `"paused"` | `"completed"`)
  - `execution_note: Text, nullable=True`
  - `execution_updated_at: DateTime(timezone=True), nullable=True`
  - `execution_updated_by: String, nullable=True`
- Thêm 1 cột trên `sk_images`:
  - `stage: String(32), nullable=False, default="registration", server_default="registration"` (`"registration"` | `"completion"`)
- Cập nhật `bootstrap.py` thêm `_ensure_sk_ctkt_execution_columns()` cho SQLite test harness.

### 5.2. Backend Services, API & Khóa đồng thời (`backend/app/services/fi/execution.py`)
- **Single Source of Truth `resolve_execution_state(record, today)`:**
  - Với `status not in ('Approved', 'Completed')` → `applicable = False`, `status = "not_applicable"`.
  - Với `status in ('Approved', 'Completed')`:
    - `execution_status == "paused"` → `status = "paused"`, `is_auto_done = False`.
    - `execution_status == "completed"` OR `status == "Completed"` OR `completed_at IS NOT NULL` OR `completion_plan_indicates_done(completion_plan)` → `status = "completed"`, `is_auto_done = (last_plan_reason == "completion_auto_done")`.
    - Ngược lại (`in_progress`/`None`): nếu `due_date <= today` → `status = "completed"`, `is_auto_done = True` (đồng bộ trước khi chu kỳ nền chạy); ngược lại → `status = "in_progress"`.
- **Endpoint mới `PUT /api/v1/fi/sk-ctkt/{record_id}/execution`:**
  - Payload `SKExecutionUpdate`: `execution_status` (`in_progress` | `paused` | `completed`), `completion_date` (optional), `execution_note` (max 1000), `expected_revision` (required `>= 0`).
  - Quy tắc ngày:
    - `completed`: `completion_date` mặc định hôm nay, PHẢI `<= factory_today()`.
    - `in_progress`: SK `Approved` yêu cầu `> factory_today()` (khớp rule auto-done khi tới hạn); SK chưa duyệt cho `>= factory_today()`.
    - `paused`: `completion_date` tùy chọn (nếu nhập thì `>= factory_today()`), và **không bao giờ bị `auto_completion` tick xong**.
  - **Khóa đồng thời có chủ đích (Bypass `PERIOD_LOCKED` an toàn):**
    - Dùng `_lock_record_for_execution_update(db, record_id)`: giữ thứ tự khóa `lock_fi_teams(db, {team})` → `SELECT sk_ctkt FOR UPDATE` + `_assert_revision(record, expected_revision)`.
    - **KHÔNG gọi `assert_period_mutable(khmt_month, khmt_year)`** vì endpoint này tuyệt đối không sửa `team`, `status`, `approved_at`, `khmt_month`, `khmt_year`, `consider_for_khmt`, `is_counted_for_okr`.
    - Ghi `status_history` (`reason = "execution_update"`), ghi `audit_logs` (`action = "update_execution"`), gửi thông báo `SK_EXECUTION_UPDATED` cho owner thật khác `actor` (bỏ qua `historical-import`/`deploy-import`).
  - Giữ `PUT /api/v1/fi/sk-ctkt/{record_id}` tương thích ngược và đồng bộ quy tắc phân quyền khi payload chỉ chứa `COMPLETION_PLAN_FIELDS`.
- **Mở rộng ảnh bằng chứng (`POST/DELETE /api/v1/fi/sk-ctkt/{record_id}/images`):**
  - Thêm query param `stage: Literal["registration", "completion"] = "registration"`.
  - Khi `record.status in {'Approved', 'Completed'}`: cho phép upload ảnh với `stage = "completion"` theo `can_update_execution` và khóa `_lock_record_for_execution_update` (không bị chặn bởi khóa kỳ KHMT).
  - Khi xóa ảnh trên SK `Approved`: cho phép `Admin`, người upload (`uploaded_by == actor`), `Team_Account` cùng đội hoặc `FI_Coordinator` xóa ảnh `stage == "completion"`; **cấm non-Admin xóa ảnh `stage == "registration"`** để bảo toàn bằng chứng xét duyệt ban đầu.
- **Siết `auto_completion.py` & mở rộng `revert_fi_auto_done.py`:**
  - Dùng allowlist `AUTO_DONE_ELIGIBLE_STATUSES = {SKStatus.APPROVED.value}` + bỏ qua `execution_status == "paused"`; khi tự tick, set cả `execution_status = "completed"`.
  - Mở rộng `revert_fi_auto_done.py` quét mọi trạng thái khác `{Approved, Completed}` (`--dry-run` mặc định).
- **Mở rộng `GET /fi/history`, `GET /fi/dashboard` & Excel Export:**
  - `GET /fi/history`: thêm `completion=auto_done|paused` bên cạnh `done|pending`; thêm `facets.decisions` (disjunctive, `exclude={"decisions"}`) để 4 thẻ trạng thái không nhảy về `0`; thêm `approved_*` counts vào `summary`.
  - `GET /fi/dashboard`: giữ nguyên key cũ, bổ sung `approved_completed_count`, `approved_confirmed_completed_count`, `approved_auto_done_count`, `approved_in_progress_count`, `approved_paused_count`.
  - Excel Export (`Du lieu FI`): thêm cột `Tình hình thực hiện`, `Ghi chú thực hiện`, `Số ảnh hoàn thành`.

### 5.3. Frontend Architecture, Z-Index & UX Flows
- **Chuẩn hóa thang `z-index` (`frontend/src/styles.css`):**
  - Sticky month header `15` < Sticky filter bar `25` < Topbar `40` < Popovers `80` < `FiMatrixCellDrawer` `140` < `FiDetailDrawer` `160` < **Modals (`.fi-edit-modal-backdrop`) `200`** < **Lightbox (`.image-viewer-backdrop`) `220`** < System Dialog `300`.
- **Tách mô-đun sạch (không phình `FIWorkspace.tsx`):**
  - `frontend/src/features/fi/utils/fiExecution.ts`: hàm thuần suy diễn trạng thái & phân quyền khớp 1-1 với backend.
  - `frontend/src/features/fi/components/FiExecutionBand.tsx`: dải hiển thị tình hình thực hiện dùng chung cho cả `Lịch sử FI → Xem chi tiết` và `FiDetailDrawer` (hiển thị pill trạng thái, ghi chú mới nhất, nút **`Cập nhật tình hình thực hiện`**, cặp nút nhanh **`Xác nhận đã xong` / `Gia hạn`** khi là phiếu tự ghi nhận, hoặc hint giải thích rõ khi user không đủ quyền).
  - `frontend/src/features/fi/components/FiExecutionUpdateModal.tsx`: thay thế `CompletionPlanDialog` — 3 trạng thái (`Đang thực hiện` / `Tạm dừng – chờ dừng máy` / `Đã hoàn thành`), nút chọn nhanh ngày (`Hôm nay`, `Hôm qua`, `+15 ngày`, `+1 tháng`, `Cuối năm`), ô ghi chú kèm chip gợi ý nhanh, vùng tải ảnh hoàn thành hỗ trợ **Chọn/Chụp ảnh mobile + Kéo thả + Dán `Ctrl+V` từ Zalo**, tải tuần tự với `expected_revision` + `Idempotency-Key`, xử lý `409 VERSION_CONFLICT` có nút `Tải lại bản mới nhất`, `Escape` chỉ đóng modal không đóng Drawer dưới.
- **Tích hợp đồng bộ trên 4 tab FI + Mobile + Admin:**
  - `Lịch sử FI`: nút cập nhật nổi bật trong `Xem chi tiết`, bấm trực tiếp `CompletionPill` trên dòng để mở nhanh, nút lọc 1 chạm **`Đang thực hiện đội tôi ({n})`** / **`SK duyệt chưa xong ({n})`**, phân nhóm `Ảnh đăng ký` vs `Ảnh hoàn thành` kèm nút `+ Thêm ảnh hoàn thành`, bỏ dòng KHMT lặp, sửa sticky overlap, 4 thẻ summary đọc `facets.decisions`.
  - `FI Dashboard` & Drawers: thẻ KPI và 4 thẻ đội tính tiến độ trên mẫu số **SK đã duyệt**, `FiMatrixCellDrawer` có nút nhanh `Cập nhật tiến độ`, tiêu đề phụ ma trận khớp quyền vai trò, `FiDetailDrawer` phân nhóm ảnh và cho thêm ảnh hoàn thành.
  - `Đăng ký SK-CTKT`: `ownershipBucketForItem` chỉ giữ SK `Approved` **chưa hoàn thành** trong mục `Đã duyệt – đang thực hiện`, hiện `CompletionPill compact` ngay trên từng thẻ.
  - Mobile `390×844` & Admin `1440×900`: rút gọn topbar/tab FI không cắt chữ, bottom-sheet modal nút `≥ 44px`, sửa bảng `/Admin → Chốt KHMT & FI` hiển thị đủ cột `THAO TÁC`.

---

## 6. Checklist Phản biện Chuyên sâu Đề xuất cho AI Agent Review

Để buổi review mang lại giá trị tối đa trước khi bắt tay code `T01–T14`, đề nghị AI Agent review tập trung phản biện **10 điểm rủi ro / câu hỏi kiến trúc** sau:

1. **An toàn khóa đồng thời khi miễn `PERIOD_LOCKED` cho cập nhật tiến độ & ảnh hoàn thành (`design.md` D03.2–D03.3):**
   - Kiểm tra xem việc bỏ qua `assert_period_mutable` trong `_lock_record_for_execution_update` (chỉ giữ `lock_fi_teams` → `FOR UPDATE` trên `sk_ctkt`) có phá vỡ bất kỳ test nào trong `backend/tests/integration/test_audit_remediation_contracts.py` hoặc `test_fi_monthly_allocation.py` không?
   - Có rủi ro deadlock nào nếu 1 transaction khác đang giữ `lock_fi_teams -> lock_period_state -> sk_ctkt FOR UPDATE` (ví dụ `finalize_monthly_fi_allocation`) chạy song song với `update_sk_execution` (`lock_fi_teams -> sk_ctkt FOR UPDATE`)? *(Phân tích thứ tự khóa: cả hai đều lấy `lock_fi_teams` đầu tiên, nhưng cần xác minh kỹ trên PostgreSQL 16.)*
2. **Hiệu năng & Số lượng câu SQL của `GET /api/v1/fi/history` dưới PostgreSQL 16 và SQLite (`history_query.py` + `fi.py`):**
   - Hợp đồng kiểm thử hiện tại (`test_audit_remediation_contracts.py` / `test_history_performance_lab.py`) yêu cầu `< 12` câu SQL trên 5.000 dòng. Thêm `facets.decisions` (+1 query `GROUP BY`) có đẩy tổng số câu SQL vượt ngưỡng `12` không? Có nên gộp `facets.decisions` vào cùng câu SQL với `facets.khmt` hoặc đếm trên query hiện có không?
   - Lọc `completion=auto_done` ở tầng SQL trên cả **SQLite** lẫn **PostgreSQL 16**: cách kiểm tra phần tử cuối cùng thuộc `PLAN_HISTORY_REASONS` trong cột JSON `status_history` bằng SQL thuần là khá phức tạp và có thể chậm (full scan + JSON parse). **Gợi ý để Reviewer cân nhắc:** có nên bổ sung một cột boolean tường minh trên `sk_ctkt` như `completion_is_auto: Boolean` (hoặc lưu giá trị `"auto_completed"` trong `execution_status`!) để query SQL `WHERE execution_status = 'auto_completed'` vừa đơn giản, vừa dùng được index trên cả SQLite và PostgreSQL 16 mà không cần parse JSON mảng `status_history` trong SQL?
3. **Edge case tương tác giữa `execution_status` mới và quy ước `auto_completion` cũ:**
   - Khi một bản ghi `Approved` cũ (chưa có `execution_status`, tức `NULL`) có `completion_plan = "Dự kiến hoàn thành 31/12/2026"` và sang ngày `01/01/2027` job `auto_completion` chạy: cần đảm bảo đồng bộ cả `execution_status`, `completed_at`, `completion_plan`, `execution_updated_at`, `execution_updated_by = "system"`.
   - Khi người dùng bấm **"Xác nhận đã xong"** trên một phiếu `auto_done` mà giữ nguyên ngày hoàn thành cũ (chỉ muốn chuyển từ `Tự ghi nhận` → `Đã xác nhận`), API `PUT /execution` có được coi là thay đổi hợp lệ (không no-op), tăng `revision`, ghi `status_history` với `reason = "execution_update"` để `is_auto_done` chuyển thành `false` không?
   - Với các bản ghi lịch sử `HIST-*` (`is_historical_import = true`) có `completion_plan` dạng tự do (`"Thực hiện khi dừng máy (trong năm 2026)"`, `"Chưa thực hiện"`, `""`): khi Đội trưởng mở `FiExecutionUpdateModal`, trạng thái mặc định và cách giữ/hiển thị chuỗi `completion_plan` gốc trong lịch sử nên xử lý ra sao để không làm mất ngữ cảnh gốc?
4. **Quyền `FI_Coordinator` trên SK do chính mình đăng ký vs SK của đội khác:**
   - Theo thiết kế hiện tại, `FI_Coordinator` (`quyenpt`) không được **xét duyệt** SK do chính mình đứng tên (tránh xung đột lợi ích — Admin duyệt hộ). Sau khi Admin đã duyệt `Approved`, `FI_Coordinator` hiển nhiên vẫn được cập nhật tình hình thực hiện (vừa là tác giả vừa là Đầu mối FI). Xác nhận không có điều kiện chặn nhầm kiểu `conflict-of-interest` áp sang `can_update_execution`.
   - Về quyền **xóa ảnh `stage = "completion"`**: nên cho `FI_Coordinator` xóa ảnh `completion` do bất kỳ ai tải, hay chỉ ảnh do chính mình tải (còn Đội trưởng/Admin mới xóa được ảnh của thành viên trong đội)?
5. **Tương thích giữa `PUT /fi/sk-ctkt/{id}` (cũ) và `PUT /fi/sk-ctkt/{id}/execution` (mới):**
   - Hiện `EditModal` vẫn dùng `PUT /fi/sk-ctkt/{id}` cho các SK chưa duyệt (`Draft`, `Submitted`, `NeedMoreInfo`, `Deferred`, `Rejected`), còn `FiExecutionUpdateModal` sẽ gọi `PUT /fi/sk-ctkt/{id}/execution`.
   - Kiểm tra xem với SK `Submitted` mà tác giả mở `FiExecutionUpdateModal` để chỉ sửa ngày dự kiến: nên gọi `PUT /execution` hay `PUT /sk-ctkt/{id}`? Nếu gọi `PUT /execution`, cần đảm bảo không cho tác giả chuyển SK `Submitted` sang `paused` nếu không hợp lý, hoặc định nghĩa rõ hành vi trên SK chưa duyệt (`Submitted`/`NeedMoreInfo`/`Deferred`).
6. **Phản hồi lỗi từng phần khi lưu tiến độ + tải nhiều ảnh trong `FiExecutionUpdateModal`:**
   - Nếu user đổi trạng thái sang `Đã hoàn thành` + đính kèm 3 ảnh, request `PUT /execution` thành công (`revision` tăng `r → r+1`), ảnh 1 thành công (`r+1 → r+2`), ảnh 2 lỗi mạng → UI phải cập nhật `expected_revision` hiện hành trong state của modal thành `r+2` và đánh dấu trạng thái tiến độ đã lưu để bấm "Thử lại" chỉ upload tiếp ảnh 2 & 3, không gọi lại `PUT /execution` gây lỗi `409 VERSION_CONFLICT`!
7. **Mẫu số KPI `Tiến độ thực hiện` trên `FI Dashboard` khi bật phạm vi `Năm {year}` vs `Tất cả`:**
   - Kiểm tra cách lọc năm của `selected_year_totals` trong `dashboard_matrix.py:346`: hiện tính những bản ghi có `registered_selected_year OR in_khmt_selected_year`. Khi bấm vào thẻ KPI `Tiến độ thực hiện` nhảy sang `Lịch sử FI`, bộ lọc `Lịch sử FI` (`decisions=["approved"], completion=["pending"]`) có khớp con số với thẻ KPI không (nếu đang xem `Năm 2026` vs `Tất cả`)?
8. **Tương thích `test_fi_service.py` và `FIWorkspace.test.ts` hiện có:**
   - Rà soát các test cũ đang assert hành vi cũ cần cập nhật có chủ đích:
     - `test_fi_service.py:631-633` (test non-author bị chặn cập nhật plan — lưu ý `linhln` trong test dùng role `"Staff"` chứ không phải `"Team_Account"` nên vẫn pass, nhưng cần kiểm tra thêm tất cả test khác).
     - `test_fi_service.py:1113, 1213, 1224-1227` (đang assert `Submitted` và `Deferred` bị `auto_completion` tick done — cần sửa lại theo quyết định mới cấm `Submitted`/`Deferred`).
     - `FIWorkspace.test.ts:169-182, 249-251` (cần cập nhật test `Team_Account` nay có thêm `updatePlan` trên SK cùng đội, và `ownershipBucketForItem` tách SK đã hoàn thành).
9. **Hành vi `Lịch sử FI` khi mở rộng dòng (`Xem chi tiết`) vs `FiDetailDrawer`:**
   - Đánh giá xem tab `Lịch sử FI` nên **giữ kiểu mở rộng inline** (đã quen với Anh Minh trong ảnh Zalo, bổ sung nút `Cập nhật tình hình thực hiện` + `+ Thêm ảnh hoàn thành` + sửa sticky overlap) hay chuyển hẳn `Lịch sử FI` sang mở `FiDetailDrawer` trượt bên phải như 3 tab kia? Spec hiện tại giữ inline expand ở `Lịch sử FI` để bám sát thói quen người dùng trong phản hồi Zalo — mong Reviewer đánh giá ưu/nhược điểm.
10. **Kiểm tra dữ liệu thực tế `revert_fi_auto_done.py` trên VPS:**
    - Lưu ý trong 25 phiếu chưa duyệt đang dính `completed_at` trên VPS, có cả phiếu **import lịch sử** (`HIST-*`, trong đó 5 `Deferred`, 3 `Rejected`, 2 `Submitted` có thể không có entry `completion_auto_done` trong `status_history` mà do script migration `0006/0007` backfill từ chuỗi Excel cũ!). Cần xác minh `revert_fi_auto_done.py` xử lý rành mạch giữa bản ghi do `completion_auto_done` ghi đè vs bản ghi import lịch sử vốn đã ghi "Đã hoàn thành" từ file Excel ban đầu.

---

## 7. Khung Đầu ra Đề nghị cho AI Agent Review

Đề nghị AI Agent review trả lời theo cấu trúc ngắn gọn, hành động được ngay:
1. **Phát hiện nghiêm trọng (`Blocker / High`)** — lỗi thiết kế, lỗ hổng phân quyền, rủi ro deadlock/migration/PostgreSQL 16, hoặc mâu thuẫn giữa `requirements.md` ↔ `design.md` ↔ `tasks.md`.
2. **Đề xuất cải tiến kỹ thuật (`Medium / Low`)** — đặc biệt với các điểm ở Mục 6 (ví dụ: có nên dùng `execution_status = 'auto_completed'` thay vì parse JSON `status_history` trong SQL không, inline vs Drawer trên `Lịch sử FI`, v.v.).
3. **Bản sửa đề xuất cụ thể** cho từng mục trong `requirements.md`, `design.md`, `tasks.md` trước khi chốt triển khai `T01–T14`.
