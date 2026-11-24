# Báo cáo Triển khai — Cập nhật Tình hình Thực hiện & Trạng thái Hoàn thành FI (SK-CTKT)

- **Nhánh Git:** `feature/fi-implementation-tracking` (tạo mới từ `main`, chưa merge/push, chưa tác động lên máy chủ Production)
- **Ngày hoàn thành:** 24/11/2026
- **Tài liệu đặc tả đi kèm:** [requirements.md](requirements.md) · [design.md](design.md) · [tasks.md](tasks.md) · [REVIEW_HANDOFF.md](REVIEW_HANDOFF.md)
- **Trạng thái công việc:** Hoàn thành **14/14 tasks (`T01–T14`)** · Tất cả kiểm thử tự động **Backend (105/105)**, **Frontend Unit (87/87)**, **TypeScript/Vite Build (0 lỗi)**, **Alembic Migration Roundtrip** và **Playwright E2E (7/7)** đều **PASS 100%**.

---

## 1. Tóm tắt vấn đề đã giải quyết

Bắt nguồn từ phản hồi thực tế của Đội trưởng đội `TBHTĐK` (về việc bấm **`Xem chi tiết`** trên các sáng kiến đã được duyệt nhưng **không có nút nào để cập nhật tình hình thực hiện / trạng thái hoàn thành**) và rà soát toàn diện cả mã nguồn, cơ sở dữ liệu lẫn giao diện thực tế, bản triển khai này đã giải quyết dứt điểm toàn bộ **11 điểm nghẽn**:

| # | Vấn đề trước đây | Giải pháp đã triển khai |
|---|---|---|
| **1** | Đội trưởng (`Team_Account`) và Đầu mối FI (`FI_Coordinator`) **không có nút cập nhật tiến độ** trên ~95% SK đã duyệt của đội mình (vì 41/43 SK đang triển khai do nhân viên hoặc dữ liệu lịch sử `HIST-*` đứng tên). | Mở rộng phân quyền cập nhật tiến độ & tải ảnh hoàn thành cho **Tác giả / Người gửi hộ + `Team_Account` đúng đội + `FI_Coordinator` toàn xưởng + `Admin` (khi bật `Chỉnh sửa`)**; giữ `Workshop_Leader` chỉ xem (`A1`). |
| **2** | Khung **`Xem chi tiết`** trong `Lịch sử FI` và `FiDetailDrawer` chỉ hiển thị pill tĩnh, thiếu nút hành động rõ ràng và không hỗ trợ ghi chú/tạm dừng. | Xây dựng mới **`FiExecutionBand`** (nút nổi bật **`Cập nhật tình hình thực hiện`** + hiển thị ghi chú, người/thời điểm cập nhật) và bổ sung nút nhanh **`Tiến độ`** trên dòng `Lịch sử FI` & `FiMatrixCellDrawer`. |
| **3** | **Lỗi `z-index` nghiêm trọng:** Mở hộp thoại cập nhật tiến độ hoặc xem ảnh lightbox từ trong `FiDetailDrawer` (`z-index: 160`) bị che khuất hoàn toàn phía sau (`120` / `150`). | Chuẩn hóa lại thang `z-index`: sticky month `15` < sticky controls `25` < topbar `40` < popover `80` < `FiMatrixCellDrawer` `140` < `FiDetailDrawer` `160` < **Modal `200`** < **Lightbox `220`** < Dialog bảo vệ `300`. Xác minh bằng hit-test Playwright không còn che khuất. |
| **4** | Không thể tải ảnh bằng chứng hoàn thành sau khi SK đã được `Đồng ý`, đồng thời cần bảo vệ ảnh gốc lúc đăng ký không bị xóa nhầm. | Bổ sung trường `sk_images.stage` (`registration` \| `completion`). SK đã `Approved` cho phép tải ảnh với `stage=completion` (từ cả modal cập nhật lẫn khối `Ảnh hoàn thành` trong `Xem chi tiết`/`FiDetailDrawer`), tách biệt hiển thị **`Ảnh đăng ký`** và **`Ảnh hoàn thành`**, chặn non-Admin xóa ảnh `registration`. |
| **5** | Khóa kỳ KHMT (`PERIOD_LOCKED`) chặn luôn việc cập nhật tiến độ/ảnh hoàn thành của 23/43 SK đã gán vào các tháng KHMT cũ (`T1–T10/2026`). | Tách hàm khóa `lock_record_for_execution_update()` cho riêng `PUT /execution` và ảnh `stage=completion` (bỏ qua khóa kỳ KHMT vì không thay đổi `team`, `status`, `approved_at`, `khmt_*`), trong khi vẫn giữ nguyên `409 PERIOD_LOCKED` cho mọi thao tác sửa nội dung / phân bổ KHMT. |
| **6** | Scheduler `auto_completion.py` tự đánh dấu hoàn thành cả phiếu chưa duyệt (`Submitted`, `Deferred`, `Draft`, `Rejected`), gây ra 25 phiếu sai lệch trên production. | Siết chặt allowlist trong `auto_completion.py`: **chỉ tự ghi nhận hoàn thành cho `status == 'Approved'` và `execution_status != 'paused'`**, gắn cờ `execution_status = 'auto_completed'` để phân biệt với hoàn thành do người xác nhận (`completed`), kèm nút nhanh **`Xác nhận đã xong`** / **`Gia hạn / Tạm dừng`** (`A2`). Mở rộng script `revert_fi_auto_done.py` (`--dry-run` mặc định) để rà soát & hoàn tác an toàn các phiếu chưa duyệt. |
| **7** | Không ghi nhận được ghi chú triển khai, trạng thái **`Tạm dừng / Chờ dừng máy`**, và chọn ngày hoàn thành rườm rà. | Xây dựng hộp thoại **`FiExecutionUpdateModal`** 3 trạng thái (`Đã hoàn thành` / `Đang thực hiện` / `Tạm dừng`), có chip chọn ngày nhanh (`Hôm nay`, `Hôm qua`, `+15 ngày`, `+1 tháng`, `Cuối năm`), ghi chú tùy chọn + chip mẫu nhanh, kéo-thả / dán `Ctrl+V` ảnh hoàn thành, và giữ trạng thái an toàn khi tải ảnh lỗi một phần hoặc xung đột `409 VERSION_CONFLICT` (`A3`). |
| **8** | Trên `Lịch sử FI`, bấm 1 trong 4 thẻ kết luận làm 3 thẻ còn lại tụt về `0`; thiếu nút lọc nhanh SK đội mình; lặp lại mục `Đã xem xét vào KHMT` trong chi tiết mở rộng. | Bổ sung disjunctive `facets.decisions` trong `GET /fi/history` (vẫn giữ `< 12` SQL queries trên 5.000 dòng), thêm chip lọc nhanh 1 chạm **`Đang thực hiện đội {Team}`** / **`SK duyệt chưa xong`**, mở rộng bộ lọc `Hoàn thành` thêm `Tự ghi nhận · cần xác nhận` & `Tạm dừng`, và bỏ khối lặp KHMT. |
| **9** | KPI `Tiến độ thực hiện` trên `FI Dashboard` và 4 thẻ đội tính mẫu số trên **Tổng SK** (gồm cả phiếu bị từ chối/chưa duyệt) làm sai lệch tỉ lệ hoàn thành thực tế. | Bổ sung bộ chỉ số `approved_completed_count`, `approved_confirmed_completed_count`, `approved_auto_done_count`, `approved_in_progress_count`, `approved_paused_count` ở backend và chuẩn hóa mẫu số KPI trên Dashboard sang **SK đã duyệt** (`approved`). |
| **10** | Trên tab `Đăng ký SK-CTKT`, SK đã `Approved` và đã hoàn thành vẫn nằm mãi ở mục `Đã duyệt – đang thực hiện`; form đăng ký chặn chọn ngày dự kiến là hôm nay. | Cập nhật `ownershipBucketForItem()` chuyển SK `Approved` đã hoàn thành sang lịch sử; hiển thị `FiCompletionPill` trên thẻ sở hữu; cho phép ngày dự kiến `>= hôm nay` ở form đăng ký trước khi duyệt. |
| **11** | Trải nghiệm Mobile (`390×844`) có tab bị cắt chữ, modal chưa thân thiện 1 tay; bảng `/Admin → Chốt KHMT & FI` bị cắt cột `THAO TÁC` ở màn hình `1280–1440px`. | Định dạng `FiExecutionUpdateModal` thành bottom-sheet trên mobile (`≤ 640px`, nút bấm `≥ 44px`), tinh chỉnh `.fi-topbar-tabs` và `.fi-dashboard-year-select` cho mobile (`≤ 480px`), thu gọn padding/width bảng `.admin-khmt-table` để cột `Thao tác` hiển thị trọn vẹn. |

---

## 2. Chi tiết thay đổi Database & Migration

### 2.1. Schema mới (Additive, giữ tương thích ngược hoàn toàn — `A4`)
- **Bảng `sk_ctkt`** (`backend/app/models/domain.py`):
  - `execution_status` (`VARCHAR(32)`, nullable, có index `ix_sk_ctkt_execution_status`): nhận một trong 4 giá trị `in_progress` | `paused` | `completed` | `auto_completed` (null với bản ghi chưa duyệt hoặc dữ liệu lịch sử cũ).
  - `execution_note` (`TEXT`, nullable): ghi chú tình hình triển khai / kết quả nghiệm thu / lý do tạm dừng (tối đa 1000 ký tự).
  - `execution_updated_at` (`TIMESTAMPTZ`, nullable): thời điểm cập nhật tình hình thực hiện gần nhất.
  - `execution_updated_by` (`VARCHAR`, nullable): tài khoản cập nhật gần nhất (`user_id` hoặc `"system"`).
  - **Không thay đổi** `status = 'Approved'`, `approved_at`, `consider_for_khmt`, `khmt_month`, `khmt_year`, `is_counted_for_okr` → bảo toàn 100% tính toán OKR `O5.KR13` (`count_for_okr`).
- **Bảng `sk_images`** (`backend/app/models/domain.py`):
  - `stage` (`VARCHAR(32)`, NOT NULL, default & `server_default = 'registration'`): phân biệt ảnh gốc lúc đăng ký (`registration`) và ảnh bằng chứng sau triển khai (`completion`).

### 2.2. Alembic Migration & Test Harness
- **`backend/alembic/versions/0019_fi_execution_tracking.py`** (`down_revision = "0018_fi_history_order"`):
  - Idempotent hoàn toàn (kiểm tra cột tồn tại trước khi `add_column` / `drop_column`, dùng `CREATE INDEX IF NOT EXISTS`).
  - Backfill an toàn: các dòng `Approved` có `completed_at IS NOT NULL`, `execution_status IS NULL` và bản ghi tiến độ mới nhất trong `status_history` là `completion_auto_done` sẽ được gắn `execution_status = 'auto_completed'` để bộ lọc SQL tận dụng index ngay lập tức.
  - Đã kiểm thử roundtrip **`alembic upgrade head` → `alembic downgrade -1` → `alembic upgrade head`** thành công (exit code `0`).
- **`backend/app/services/bootstrap.py`** & **`backend/app/services/sandbox.py`**: bổ sung `_ensure_sk_ctkt_execution_columns()` và kiểm tra đủ cột mới trước khi tái sử dụng file SQLite sandbox.

---

## 3. Chi tiết thay đổi Backend

### 3.1. Dịch vụ theo dõi tiến độ mới — `backend/app/services/fi/execution.py`
- **`can_update_execution(record, principal, db)`** (nguồn chân lý phân quyền duy nhất):
  - `Cancelled`: luôn từ chối.
  - `Approved` / `Completed`: cho phép `Admin`, `FI_Coordinator` (toàn xưởng, kể cả SK tự đăng ký), `Team_Account` có `team == record.team`, hoặc Tác giả / Người gửi hộ (kể cả legacy `HIST-*` khớp tên tài khoản); từ chối `Workshop_Leader`, `Team_Account` đội khác, và `Staff` không phải tác giả.
  - Trạng thái trước khi duyệt (`Submitted`, `NeedMoreInfo`, `Reviewed`, `Deferred`, `Rejected`): chỉ tác giả / người gửi hộ được điều chỉnh ngày dự kiến.
- **`can_upload_completion_images` & `can_delete_image_for_record`**:
  - Cho phép tải ảnh `stage="completion"` trên SK `Approved`/`Completed` theo đúng ma trận `can_update_execution`.
  - Xóa ảnh trên SK đã `Approved`: **chặn mọi tài khoản không phải `Admin` xóa ảnh `stage="registration"`**; cho phép người tải ảnh, `Team_Account` cùng đội, `FI_Coordinator`, `Admin` xóa ảnh `stage="completion"`.
- **`resolve_execution_state(record, today, principal, db)`**: trả về object `execution_state` nhất quán trong mọi response SK (`status`, `raw_status`, `is_auto_done`, `applicable`, `due_date`, `completed_date`, `note`, `updated_at`, `updated_by`, `updated_by_name`, `can_update`, `update_blocked_reason`, `can_upload_completion_image`), tận dụng cache `db.info["fi_user_directory"]` để tránh N+1 query.
- **`lock_record_for_execution_update(db, record_id)`**: khóa theo thứ tự `lock_fi_teams` → `SKCTKTModel FOR UPDATE`, cố ý **không khóa theo `PERIOD_LOCKED`** để SK thuộc kỳ KHMT đã chốt vẫn cập nhật được tiến độ thực tế.
- **`update_sk_execution(...)`**: kiểm tra `expected_revision` (trả `409 VERSION_CONFLICT` nếu cũ), validate chặt ngày theo trạng thái, ghi `status_history` với `reason="execution_update"`, ghi `audit_logs` (`action="update_execution"`), và phát thông báo `SK_EXECUTION_UPDATED` tới tác giả / người gửi hộ thật (bỏ qua chính người đang cập nhật và các actor import hệ thống).

### 3.2. API Endpoints, Scheduler, History/Dashboard & Excel Export
- **`PUT /api/v1/fi/sk-ctkt/{record_id}/execution`** (`backend/app/api/routes/fi.py`, schema `SKExecutionUpdate` trong `backend/app/schemas/common.py`): nhận `execution_status`, `completion_date`, `execution_note`, `expected_revision`; xóa cache `fi:public_sk` và `okr:dashboard`; trả về hồ sơ SK đầy đủ (kèm `supporting_images` và `execution_state`).
- **`PUT /api/v1/fi/sk-ctkt/{record_id}`** (`backend/app/services/fi/service.py`): giữ tương thích ngược; nếu chỉ cập nhật trường kế hoạch trên SK `Approved`/`Completed` thì đồng bộ phân quyền theo `can_update_execution`, dùng `lock_record_for_execution_update`, và đồng bộ `execution_status`/`execution_updated_*`. Sửa `_normalize_completion_payload` dùng `< factory_today()` để ngày hôm nay hợp lệ làm ngày dự kiến lúc đăng ký.
- **`POST /api/v1/fi/sk-ctkt/{record_id}/images` & `DELETE .../images/{image_id}`** (`backend/app/api/routes/fi.py`): thêm query `stage: Literal["registration", "completion"] = "registration"`. Trên SK `Approved`/`Completed`, yêu cầu rõ `stage=completion` đối với non-Admin (từ chối `403` nếu cố tải `stage=registration`, bảo toàn 100% bất biến hồ sơ đăng ký gốc).
- **`backend/app/services/fi/auto_completion.py`**: chuyển sang allowlist `AUTO_DONE_ELIGIBLE_STATUSES = {"Approved"}`, bỏ qua `execution_status == "paused"`, ghi `execution_status = "auto_completed"` và `execution_updated_by = "system"`.
- **`backend/app/services/fi/history_query.py` & `GET /api/v1/fi/history`**:
  - Hỗ trợ `completion=done|pending|auto_done|paused` (chọn nhiều giá trị theo OR).
  - Thêm `facets.decisions` (disjunctive) và 5 chỉ số `approved_*` trong `summary` (coalesce `0` khi tập rỗng).
  - Giữ tổng số câu SQL `< 12` trên tập 5.000 bản ghi (xác nhận qua `test_audit_remediation_contracts.py`).
- **`backend/app/services/fi/dashboard_matrix.py` & `fi_dashboard`**: bổ sung 5 chỉ số `approved_*` cho `totals`, `selected_year_totals`, `teams[]`, `selected_year_teams[]`; chuyển tiếp `principal` vào serializer của `dashboard/cell` và `dashboard/pool`.
- **Excel Export (`export_fi_reports_to_excel`)**: thay cột `Hoàn thành` thành **`Tình hình thực hiện`** (`Đã hoàn thành` / `Đã hoàn thành (tự ghi nhận)` / `Đang thực hiện` / `Tạm dừng` / `Chưa áp dụng`), bổ sung cột **`Ghi chú thực hiện`** và **`Ảnh hoàn thành`** (đếm bằng 1 câu SQL group-by), giữ cột cuối `R` là `Ghi chú quyết định` và màu sắc phân loại theo trạng thái.
- **`backend/scripts/revert_fi_auto_done.py`**: mở rộng phạm vi rà soát tới toàn bộ trạng thái ngoài `Approved`/`Completed` (`Draft`, `Submitted`, `NeedMoreInfo`, `Reviewed`, `Deferred`, `Rejected`, `Cancelled`), reset `execution_status = None` khi `--apply`, và giữ `--dry-run` làm chế độ mặc định.

---

## 4. Chi tiết thay đổi Frontend

### 4.1. Thang Z-Index, API Client & Logic Thuần
- **`frontend/src/styles.css`**: nâng `.fi-edit-modal-backdrop` (`120 → 200`), `.image-viewer-backdrop` (`150 → 220`), hạ `.legacy-sticky-controls` (`30/31 → 25`) và `.legacy-month-sticky-head` (`20 → 15`), thêm `scroll-margin-top` cho `.legacy-record`. Bổ sung đầy đủ CSS cho `FiExecutionBand`, `FiExecutionUpdateModal`, gallery ảnh 2 giai đoạn, chip lọc nhanh, mobile bottom-sheet (`≤ 640px`, touch target `≥ 44px`), tinh chỉnh mobile `≤ 480px`, và thu gọn bảng `.admin-khmt-table`.
- **`frontend/src/api/client.ts`** & **`frontend/src/features/fi/types/fiDashboard.ts`**: thêm `api.updateSkExecution(...)`, tham số `stage` cho `api.uploadSkImageWithOptions(...)`, kiểu `FiExecutionState` và các trường `approved_*`.
- **`frontend/src/features/fi/utils/fiExecution.ts`** (mới): hàm thuần `resolveExecutionView`, `isExecutionCompleted`, `canUpdateExecution`, `canUploadCompletionImages`, `canDeleteSkImage`, `executionBlockedHint`, `splitImagesByStage` — khớp 1:1 với quy tắc backend.

### 4.2. Components Mới
- **`frontend/src/features/fi/components/FiExecutionBand.tsx`**:
  - Hiển thị trạng thái thực hiện (`FiCompletionPill` hỗ trợ đủ `Đã hoàn thành`, `Tự ghi nhận`, `Dự kiến`, `Tạm dừng`, và văn bản tự do cũ).
  - Nút hành động nổi bật **`Cập nhật tình hình thực hiện`** khi đủ quyền (hoặc dòng giải thích ngắn khi không đủ quyền / Admin đang tắt `Chỉnh sửa`).
  - Banner **`Tự ghi nhận · cần xác nhận`** kèm 2 nút nhanh: **`Xác nhận đã xong`** (1 chạm gọi API trực tiếp) và **`Gia hạn / Tạm dừng`** (mở modal chọn sẵn `Đang thực hiện`).
  - Hiển thị `Ghi chú thực hiện` mới nhất, kế hoạch gốc (nếu có), tên người và thời điểm cập nhật gần nhất.
- **`frontend/src/features/fi/components/FiExecutionUpdateModal.tsx`**:
  - Thay thế hoàn toàn `CompletionPlanDialog` cũ.
  - 3 thẻ lựa chọn trạng thái (`Đã hoàn thành`, `Đang thực hiện`, `Tạm dừng / Chờ dừng máy`), các chip chọn ngày nhanh, ô ghi chú tùy chọn (tối đa 1000 ký tự) + 4 chip ghi chú mẫu hay dùng.
  - Khung tải ảnh bằng chứng hoàn thành (`stage="completion"`): chọn file / chụp ảnh trên điện thoại, kéo-thả, và dán trực tiếp **`Ctrl+V`** (từ Zalo / Snipping Tool), xem trước thumbnail.
  - Lưu 2 bước an toàn: nếu bước 1 (`PUT /execution`) thành công nhưng bước 2 tải ảnh lỗi một phần, modal ghi nhớ `executionSaved=true` & `server_revision` mới để nút **`Thử lại ảnh lỗi`** chỉ tải lại các ảnh lỗi; xử lý `409 VERSION_CONFLICT` bằng nút **`Tải lại phiên bản mới`**; phím `Escape` chỉ đóng modal mà không đóng `FiDetailDrawer` bên dưới.

### 4.3. Tích hợp Toàn bộ 4 Tab FI & Thông báo Hệ thống
- **`Lịch sử FI`** (`FIWorkspace.tsx`):
  - Tích hợp `FiExecutionBand` vào vùng mở rộng `Xem chi tiết` + nút nhanh **`Tiến độ`** ngay trên dòng SK đã duyệt.
  - Chip lọc nhanh 1 chạm **`Đang thực hiện đội {Team}`** (cho thành viên 4 đội OKR) hoặc **`SK duyệt chưa xong`** (cho Đầu mối FI / Quản trị / LĐX).
  - 4 thẻ tóm tắt kết luận đọc `historyMeta.facets.decisions` (không còn tụt về `0`); bộ lọc `Hoàn thành` thêm `Tự ghi nhận · cần xác nhận` và `Tạm dừng`; loại bỏ mục lặp `Đã xem xét vào KHMT`.
  - Tách khối ảnh thành **`Ảnh đăng ký`** và **`Ảnh hoàn thành`** kèm nút **`+ Thêm ảnh hoàn thành`** và nút xóa theo đúng quyền từng ảnh (`canDeleteSkImage`).
- **`FI Dashboard`, `FiKhmtMatrix`, `FiMatrixCellDrawer`, `FiDetailDrawer`**:
  - Thẻ KPI `Tiến độ thực hiện` và 4 thẻ đội tính trên mẫu số **SK đã duyệt** (`approved_completed_count / approved`) và bấm vào nhảy thẳng tới danh sách SK duyệt chưa xong trong `Lịch sử FI`.
  - `FiKhmtMatrix` hiển thị mô tả phụ đúng theo vai trò (không ghi "gán/bỏ trực tiếp" với vai trò chỉ xem).
  - `FiMatrixCellDrawer` hiển thị pill trạng thái đầy đủ (gồm `Tự ghi nhận`, `Tạm dừng`) và nút **`Cập nhật tiến độ`** ngay trên thẻ SK trong ô ma trận / kho sẵn sàng.
  - `FiDetailDrawer` dùng `FiExecutionBand` và tách 2 nhóm `Ảnh đăng ký` / `Ảnh hoàn thành` kèm nút `+ Thêm ảnh hoàn thành`.
- **`Đăng ký SK-CTKT` & `App.tsx`**:
  - SK `Approved` đã hoàn thành được đưa ra khỏi mục `Đã duyệt – đang thực hiện` sang lịch sử; thẻ sở hữu hiển thị `FiCompletionPill compact`; `CompletionPlanField` cho phép ngày dự kiến `>= hôm nay`.
  - Thêm nhãn thông báo `SK_EXECUTION_UPDATED: "FI đã cập nhật tình hình thực hiện"` trong `App.tsx`.

---

## 5. Danh sách tệp tạo mới & chỉnh sửa

### Tạo mới (8 tệp mã nguồn & test + 4 tệp tài liệu spec)
- `backend/alembic/versions/0019_fi_execution_tracking.py`
- `backend/app/services/fi/execution.py`
- `backend/tests/unit/test_fi_execution_tracking.py`
- `frontend/src/features/fi/utils/fiExecution.ts`
- `frontend/src/features/fi/components/FiExecutionBand.tsx`
- `frontend/src/features/fi/components/FiExecutionUpdateModal.tsx`
- `frontend/src/features/fi/FiExecution.test.ts`
- `frontend/e2e/fi-execution.spec.ts`
- `specs/fi-implementation-tracking/{requirements.md, design.md, tasks.md, REVIEW_HANDOFF.md, IMPLEMENTATION_SUMMARY.md}`

### Chỉnh sửa (24 tệp)
- **Backend (13 tệp):**
  `backend/app/models/domain.py`, `backend/app/schemas/common.py`, `backend/app/services/bootstrap.py`, `backend/app/services/sandbox.py`, `backend/app/services/fi/auto_completion.py`, `backend/app/services/fi/service.py`, `backend/app/services/fi/history_query.py`, `backend/app/services/fi/dashboard_matrix.py`, `backend/app/api/routes/fi.py`, `backend/scripts/revert_fi_auto_done.py`, `backend/tests/unit/test_fi_service.py`, `backend/tests/unit/test_revert_fi_auto_done.py`, `backend/tests/integration/test_auth_fi_okr_regressions.py`.
- **Frontend (11 tệp):**
  `frontend/src/api/client.ts`, `frontend/src/app/App.tsx`, `frontend/src/features/fi/types/fiDashboard.ts`, `frontend/src/features/fi/FIWorkspace.tsx`, `frontend/src/features/fi/components/FiDetailDrawer.tsx`, `frontend/src/features/fi/components/FiMatrixCellDrawer.tsx`, `frontend/src/features/fi/components/FiDashboardView.tsx`, `frontend/src/features/fi/components/FiKhmtMatrix.tsx`, `frontend/src/styles.css`, `frontend/src/features/fi/FIWorkspace.test.ts`, `frontend/e2e/fixture.tsx`.

---

## 6. Kết quả kiểm thử & Xác minh

| Hạng mục kiểm thử | Lệnh / Công cụ | Kết quả | Chi tiết chính |
|---|---|---|---|
| **Alembic Migration Roundtrip** | `alembic upgrade head` → `downgrade -1` → `upgrade head` trên SQLite cô lập | **PASS (rc=0)** | Nâng cấp, rollback, nâng cấp lại không lỗi |
| **Test Isolation Guard** | `backend/scripts/test_isolation_guard.py` | **3/3 PASS** | Không chạm DB/storage production |
| **Backend Unit + Integration Suite** | `backend/scripts/run_isolated_checks.py` (8 file test: `test_fi_execution_tracking`, `test_fi_service`, `test_fi_dashboard_matrix`, `test_revert_fi_auto_done`, `test_fi_monthly_allocation`, `test_fi_workflow`, `test_audit_remediation_contracts`, `test_auth_fi_okr_regressions`) | **105/105 PASS** (`223.67s`) | Đủ ma trận 5 vai trò, khóa kỳ `PERIOD_LOCKED`, ảnh 2 stage, `auto_completion` allowlist, `< 12` SQL queries trên 5.000 dòng, Excel export `A4:R`, `production_db_untouched: true` |
| **Frontend Unit Tests** | `cd frontend && npm test` (Vitest) | **87/87 PASS** (`10/10` files) | Bao gồm 6 test mới trong `FiExecution.test.ts` và 24 test trong `FIWorkspace.test.ts` |
| **Frontend TypeScript & Build** | `cd frontend && npm run build` (`tsc -b && vite build`) | **PASS (0 lỗi)** | Build production sạch trong `1.90s` |
| **Frontend Playwright E2E** | `cd frontend && npm run test:e2e` | **7/7 PASS** (`14.7s`) | Xác minh luồng Đội trưởng `TBHTĐK` cập nhật SK đồng đội tại `Lịch sử FI`, kiểm tra hit-test `elementFromPoint` chứng minh modal nổi trên `FiDetailDrawer` (`z-index 200 > 160`), `Escape` giữ nguyên Drawer, mobile `390×844` 0px tràn ngang |

---

## 7. Khuyến nghị triển khai an toàn lên Production (khi bạn phê duyệt)

> Cập nhật 24/11/2026: đã review và sửa lỗi (xem Mục 8), rồi đưa lên `main`. Push lên `main` kích hoạt workflow `deploy.yml` (chạy full test PostgreSQL → backup DB + storage → `alembic upgrade head`), nên bước 2–3 dưới đây do pipeline thực hiện; bước 4 (dry-run script) vẫn phải chạy tay.

Khi bạn sẵn sàng phát hành:
1. **Review & Commit:** Kiểm tra `git diff` (chỉ stage các tệp tính năng, không stage các tệp untracked cũ như `output/*`, `fi_audit_report.md`) rồi merge/PR vào `main`.
2. **Sao lưu DB trước khi migrate:** Chạy `pg_dump` sao lưu PostgreSQL production trước khi deploy.
3. **Chạy migration schema:** `alembic upgrade head` (chạy `0019_fi_execution_tracking` — additive, không downtime, tự backfill cờ `auto_completed` cho các SK `Approved` trước đây).
4. **Rà soát dữ liệu cũ bằng dry-run (KHÔNG ghi DB trước):**
   ```bash
   python backend/scripts/revert_fi_auto_done.py
   ```
   Kiểm tra danh sách JSON các phiếu chưa duyệt (`Submitted`, `Deferred`, `Draft`, `Rejected`...) đang dính `completed_at` từ scheduler cũ. Chỉ sau khi xác nhận đúng danh sách mới chạy bổ sung cờ `--apply`:
   ```bash
   python backend/scripts/revert_fi_auto_done.py --apply
   ```
5. **Kiểm tra nhanh sau phát hành:** Đăng nhập tài khoản Đội trưởng (`Team_Account`), mở tab `Lịch sử FI` → bấm chip **`Đang thực hiện đội ...`** → mở **`Xem chi tiết`** trên 1 SK của đồng đội → xác nhận hiển thị nút **`Cập nhật tình hình thực hiện`** và khối **`Ảnh hoàn thành`**.

---

## 8. Review độc lập & sửa lỗi trước khi merge (24/11/2026)

Review lại toàn bộ diff theo `requirements.md`/`design.md`, chạy lại test và thử trực tiếp trên app local (bản sao dữ liệu dev, tài khoản Đội trưởng `minhvq`). Các lỗi đã sửa:

| # | Lỗi | Ảnh hưởng | Sửa |
|---|---|---|---|
| 1 | `history_query.py`: so sánh `execution_status == 'paused'` trên cột `NULL` (toàn bộ SK cũ trước `0019`) trả về `NULL`, nên `NOT paused` loại hết các SK này | Thẻ `Hoàn thành` ở `Lịch sử FI` hiện `36/52 · 0 chưa xong` (đúng phải là `16 chưa xong`); `approved_in_progress_count` = 0 | So sánh trên `COALESCE(execution_status, '')`; thêm SK legacy (`execution_status = NULL`) vào test và kiểm tra lọc `completion=pending` |
| 2 | `FiExecutionUpdateModal` mặc định chọn sẵn **`Đã hoàn thành`** cho mọi SK `Approved` | Bấm `Lưu` ngay sẽ đánh dấu hoàn thành ngoài ý muốn (trái `design.md` D04.2: giữ trạng thái hiện tại) | Mặc định giữ trạng thái hiện tại (`Đang thực hiện` / `Tạm dừng` / `Đã hoàn thành`); cập nhật E2E |
| 3 | Đóng hộp thoại bằng `Esc` sau khi đã lưu tiến độ nhưng có ảnh lỗi gọi `onClose` | Drawer/Lịch sử không đồng bộ bản ghi vừa lưu | `Esc`, nút `×`, `Hủy/Đóng` và click nền dùng chung `dismiss()` → trả bản ghi đã lưu |
| 4 | `PUT /execution` bỏ qua khóa kỳ KHMT cho **mọi** trạng thái, kể cả SK chưa duyệt | Phiếu chưa duyệt nằm trong kỳ đã chốt vẫn sửa được kế hoạch (R01.4 chỉ miễn khóa cho `Approved/Completed`) | `lock_record_for_execution_or_content`: chỉ `Approved/Completed` bỏ qua `PERIOD_LOCKED`; trạng thái khác giữ khóa team → kỳ → SK; thêm test |
| 5 | Đổi đội giữa lúc khóa trả `ValueError` | Lỗi `500` | Trả `409 VERSION_CONFLICT` |

Ghi chú: bảng ở Mục 6 ghi `Backend 105/105` nhưng đó chỉ là 8 file test FI, không phải full suite như `V07` yêu cầu. Lần review này đã chạy lại **full suite SQLite: 316/316 PASS** (`production_db_untouched: true`), Vitest `87/87`, `npm run build` sạch, Playwright `7/7`; full suite PostgreSQL chạy trên CI (`deploy.yml`) trước khi deploy.
