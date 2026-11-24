# Requirements — Nâng cấp Luồng Cập nhật Tình hình Thực hiện & Trạng thái Hoàn thành Phân hệ FI (SK-CTKT)

Ngày lập: 24/11/2026. Trạng thái: **Đã chốt toàn bộ quyết định nghiệp vụ tại Mục 5 (24/11/2026) — Sẵn sàng triển khai**.

---

## 1. Bối cảnh, bằng chứng thực tế và mục tiêu

### 1.1. Phản hồi trực tiếp từ người dùng hiện trường

Sau khi triển khai bảng Ma trận KHMT trên `https://xdk-pvcfc.com/`, người dùng hiện trường — trực tiếp là **Đội trưởng TBHTĐK (`minhvq` — Võ Quang Minh)** — phản ánh trải nghiệm phân hệ **FI (Sáng kiến – Cải tiến Kỹ thuật)** còn rất tệ ở khâu theo dõi triển khai:

- **Không có chỗ để cập nhật tình hình thực hiện / trạng thái hoàn thành của SK-CTKT** khi mở **Xem chi tiết** các sáng kiến của anh em trong đội (ví dụ `FI/07/2026-TBHTĐK-03`, `FI/07/2026-TBHTĐK-04`, `FI/07/2026-TBHTĐK-02`).
- Trích phản hồi gốc của Đội trưởng TBHTĐK: *"em link sao khi nhấn vào xem chi tiết sẽ có nút cập nhật tình hình thực hiện á"*.

### 1.2. Bằng chứng xác minh đa chiều (Mã nguồn + Production VPS + Trải nghiệm trình duyệt trực tiếp ngày 24/11/2026)

Qua kiểm tra song song mã nguồn (`main` @ `48e22c1`), cơ sở dữ liệu PostgreSQL trên VPS `103.200.20.225` *(chỉ đọc)* và trải nghiệm trực tiếp trình duyệt trên `https://xdk-pvcfc.com/` với cả tài khoản cá nhân (`baomt`) lẫn tài khoản quản trị (`admin`, cả 2 chế độ Xem & Chỉnh sửa, desktop `1440×900` và mobile `390×844`), phát hiện **7 nguyên nhân gốc** khiến luồng cập nhật hoàn thành gần như bị tê liệt:

#### Bằng chứng dữ liệu thực tế trên Production (24/11/2026)

| Chỉ số thực tế (`sk_ctkt` & `audit_logs`) | Giá trị | Ý nghĩa nghiệp vụ |
|---|---:|---|
| Tổng SK-CTKT đã duyệt (`Approved`) **chưa hoàn thành** | **43** | TBCH: `4`, TBHTĐK: `11`, TBĐL: `5`, TCĐK: `23` |
| Số SK `Approved` chưa hoàn thành do **nhân viên/import đứng tên** (không phải Đội trưởng) | **41 / 43 (95%)** | TBHTĐK `11/11`, TBCH `4/4`, TBĐL `5/5`, TCĐK `21/23` — Đội trưởng **không thấy nút cập nhật** trên 95% phiếu của đội mình |
| Số SK `Approved` chưa hoàn thành **đã gán vào kỳ KHMT quá khứ (`T1–T10/2026`)** | **23 / 43 (53%)** | Nếu Admin chốt các kỳ KHMT này, khóa `PERIOD_LOCKED` hiện tại sẽ **chặn vĩnh viễn** việc cập nhật hoàn thành và thêm ảnh kết quả |
| Tổng số lần người dùng chủ động cập nhật tiến độ (`update_completion_plan`) từ trước đến nay | **4 lần** | Lần cuối từ `31/10/2026` — tính năng gần như không được dùng |
| Tổng số SK từng chuyển sang `status = 'Completed'` (`Hoàn tất`) | **0 / 188** | Endpoint `/complete` bị bỏ hoang, UI không gọi |
| Tổng số lần hệ thống **tự tick "Đã hoàn thành"** (`completion_auto_done`) | **58 lần** | Trong đó **20 phiếu chưa hề được duyệt** (`16 Deferred`, `4 Submitted`) vẫn đang mang `completed_at`! Ngoài ra còn `2 Draft` và `3 Rejected` lịch sử vẫn còn `completed_at` |

#### 7 nhóm vấn đề nghiêm trọng đã xác minh

1. **Lỗi phân quyền cập nhật tiến độ (Nguyên nhân trực tiếp phản hồi của Anh Minh `minhvq`):**
   - `backend/app/services/fi/service.py:427-429` và `frontend/src/features/fi/FIWorkspace.tsx:1042` chỉ cho phép `author`/`submitter` hoặc `Admin` (bật `Chỉnh sửa`) cập nhật kế hoạch hoàn thành.
   - **Đội/Tổ trưởng (`Team_Account`)** — dù được phân bổ KHMT cho cả đội — lại bị chặn hoàn toàn quyền cập nhật tiến độ cho sáng kiến của nhân viên cùng đội. Khi mở `Xem chi tiết`, vùng `Tiến độ thực hiện` chỉ hiện badge tĩnh (`Dự kiến 31/12/2026`), không có nút bấm và không có dòng giải thích nào.
   - **Đầu mối FI (`FI_Coordinator`)** cũng không có quyền cập nhật tiến độ dù là người phụ trách theo dõi FI toàn xưởng.

2. **Lỗi Z-index chí mạng che khuất hoàn toàn hộp thoại cập nhật tiến độ khi mở từ `FiDetailDrawer` (Phát hiện trực tiếp trên trình duyệt):**
   - Trong `frontend/src/styles.css`: `.fi-detail-drawer-backdrop` có `z-index: 160` (dòng 18370), trong khi `.fi-edit-modal-backdrop` (dùng cho cả `CompletionPlanDialog` lẫn `EditModal`) chỉ có `z-index: 120` (dòng 1345) và `.image-viewer-backdrop` (Lightbox phóng to ảnh) chỉ có `z-index: 150` (dòng 7056).
   - Khi người dùng (kể cả chính tác giả `baomt` hoặc `Admin`) mở `FiDetailDrawer` ở tab `Đăng ký`, `Xét duyệt`, `FI Dashboard → Ma trận KHMT`, hoặc từ chuông thông báo rồi bấm **`Cập nhật tiến độ`** (hoặc `Chỉnh sửa`, hoặc bấm xem ảnh), hộp thoại mở **ở phía sau Drawer** (`ELEMENT_OCCLUDED`), hoàn toàn không nhìn thấy và không tương tác được.

3. **Khóa quyền tải "Ảnh bằng chứng hoàn thành" ngay sau khi SK được `Đồng ý` (`Approved`):**
   - `POST /fi/sk-ctkt/{id}/images` (`fi.py:756-758`) và `canUploadImages` (`FIWorkspace.tsx:1066-1073`) chỉ cho phép tải ảnh khi `status IN AUTHOR_CONTENT_EDITABLE_STATUSES` (loại trừ `Approved`).
   - Tại tab `Lịch sử FI`, ngay cả `Admin` (bật `Chỉnh sửa`) và chính tác giả đều **không có nút `Thêm ảnh`** trong phần `Ảnh bằng chứng`.
   - Ngược quy trình thực tế nhà máy: SK chỉ có ảnh nghiệm thu/hiện trường **sau khi** được duyệt và thi công xong.

4. **Khóa kỳ KHMT (`PERIOD_LOCKED`) chặn nhầm việc cập nhật tình hình thực hiện & ảnh bằng chứng:**
   - `_lock_record_context` (`service.py:135-142`) và `_lock_record_for_attachment_mutation` (`fi.py:97-100`) từ chối mọi cập nhật trên SK đã gán vào kỳ KHMT bị chốt (`409 PERIOD_LOCKED`), dù việc ghi nhận tiến độ/hoàn thành và ảnh kết quả **không hề làm thay đổi phân bổ KHMT hay chỉ số `O5.KR13`** của kỳ đã chốt.

5. **Cơ chế tự động đánh dấu hoàn thành (`auto_completion.py`) sai lệch dữ liệu & thiếu trạng thái `Quá hạn` / `Tạm dừng` / ghi chú:**
   - Job nền tự chuyển SK sang `"Đã hoàn thành"` ngay khi tới ngày dự kiến cho cả phiếu `Submitted` và `Deferred`, đồng thời làm mất khả năng phân biệt giữa *"thực sự đã hoàn thành"* và *"quá hạn dự kiến chưa làm"*.
   - Form & hộp thoại ép ngày dự kiến phải `> hôm nay` (`tomorrowIsoDate()`), không cho đặt hạn là hôm nay và không cho lưu trạng thái đang thực hiện/tạm dừng khi hạn cũ đã trôi qua.
   - Hộp thoại `CompletionPlanDialog` chỉ có 2 radio + ô chọn ngày: **không có ghi chú tình hình thực hiện** (vướng mắc, chờ dừng máy BDTT, kết quả áp dụng) và **không cho tải ảnh bằng chứng hoàn thành ngay trong hộp thoại**.

6. **Trải nghiệm phân mảnh & số liệu tiến độ gây hiểu nhầm trên cả 4 tab FI:**
   - **`FI Dashboard`**: Thẻ KPI `Tiến độ thực hiện` (`115 / 185 = 62%`) lấy mẫu số là **tổng tất cả SK** (bao gồm cả `Chờ duyệt`, `Xem xét sau`, `Không đồng ý`) thay vì chỉ tính trên **SK đã duyệt (`Approved`/`Completed`)**. Khi lọc `Không đồng ý` ở `Lịch sử FI` vẫn báo `Hoàn thành 3 · 7 chưa xong`.
   - **`Đăng ký SK-CTKT`**: Mục `Đã duyệt – đang thực hiện` và `Phiếu gửi hộ đã duyệt – đang thực hiện` hiển thị lẫn cả các SK **đã hoàn thành** từ lâu (vì `ownershipBucketForItem` chỉ kiểm tra `status === "Approved"`), và không hiển thị `CompletionPill` ngay trên dòng.
   - **`Lịch sử FI`**: Thiếu nút cập nhật nhanh tiến độ trực tiếp trên dòng/header; vùng `Xem chi tiết` lặp 2 lần `Xét vào KHMT` và `Đã xem xét vào KHMT`; tiêu đề tháng sticky che mất phần đầu thẻ đang mở khi cuộn; bấm thẻ thống kê trạng thái làm các thẻ trạng thái anh em nhảy về `0` khiến khó chuyển nhanh; thiếu lối tắt 1 chạm *"SK đang thực hiện của đội tôi"* cho Đội trưởng.
   - **`FI Dashboard → Ma trận KHMT → Cell Drawer`**: Không có nút cập nhật tiến độ nhanh; dòng mô tả đầu bảng hứa *"gán/bỏ trực tiếp"* cho cả user không có quyền (`Staff`).

7. **Điểm trừ hiển thị trên Mobile (`390×844`) & Quản trị (`/Admin`):**
   - Trên mobile: tiêu đề topbar và thanh tab FI bị cắt cụt (`Sáng kiến FI (SK-C...`, `Lịch...`), ô chọn `Năm` bị lệch trục dọc.
   - Trên `/Admin → Chốt KHMT & FI` (`1440×900`): cột `THAO TÁC` ở mép phải bị cắt nhẹ (`Nhập b...`).

### 1.3. Cách đọc bộ spec

Bộ spec theo chuẩn **Kiro** gồm đúng 3 tệp trong `specs/fi-implementation-tracking/`:

- `requirements.md` *(tài liệu này)*: bối cảnh, bằng chứng, ma trận phân quyền đề xuất, yêu cầu chi tiết theo mẫu **EARS** (`KHI / NẾU / TRONG KHI … HỆ THỐNG PHẢI …`) và **5 câu hỏi cần Chủ sản phẩm chốt**.
- [design.md](design.md): thiết kế mô hình dữ liệu & migration, API backend, quy tắc concurrency/khóa kỳ, thang `z-index`, thiết kế giao diện (wireframe desktop + mobile) và kế hoạch kiểm thử.
- [tasks.md](tasks.md): danh sách công việc theo đợt triển khai, sơ đồ phụ thuộc, tệp tác động và tiêu chí hoàn thành ánh xạ ngược từng mã yêu cầu (`R01.x–R08.x`).

---

## 2. Phạm vi, mức ưu tiên và giới hạn

### 2.1. Phân mức ưu tiên

- **P0 (Bắt buộc — sửa dứt điểm phản hồi user & lỗi chặn thao tác):**
  - Mở rộng quyền cập nhật tình hình thực hiện và đính kèm ảnh bằng chứng hoàn thành cho **Đội/Tổ trưởng (`Team_Account` đúng đội)** và **Đầu mối FI (`FI_Coordinator` toàn xưởng)** *(đã chốt tại Mục 5)*, bên cạnh Tác giả/Người gửi hộ và Admin (khi bật `Chỉnh sửa`).
  - Sửa triệt để lỗi **z-index** để `FiExecutionUpdateModal`, `EditModal` và `SkImageViewer` luôn hiển thị nổi trên `FiDetailDrawer` và `FiMatrixCellDrawer`.
  - Mở quyền **tải/xóa ảnh bằng chứng hoàn thành** cho SK ở trạng thái `Approved` (gắn nhãn rõ *"Ảnh đăng ký"* vs *"Ảnh hoàn thành"*) ngay trong hộp thoại cập nhật tiến độ và trong khung `Xem chi tiết` ở mọi tab (gồm cả `Lịch sử FI`).
  - Cho phép cập nhật tình hình thực hiện & ảnh bằng chứng ngay cả khi kỳ KHMT của SK đã chốt (`PERIOD_LOCKED`), trong khi giữ nguyên khóa cứng cho phân bổ KHMT và nội dung đã duyệt.
  - Siết phạm vi cơ chế tự động hoàn thành (`auto_completion`) **CHỈ áp dụng cho SK `Approved` (và không ở trạng thái `Tạm dừng`)** — cấm tuyệt đối trên `Draft`/`Submitted`/`NeedMoreInfo`/`Reviewed`/`Deferred`/`Rejected`/`Cancelled`, kèm nhãn *"Tự ghi nhận · cần xác nhận"* và nút 1 chạm xác nhận hoặc gia hạn.
- **P1 (Đại tu trải nghiệm cập nhật & theo dõi tình hình thực hiện):**
  - Nâng cấp `CompletionPlanDialog` thành **`FiExecutionUpdateModal`** hiện đại: chọn trạng thái (`Đang thực hiện` / `Tạm dừng – chờ dừng máy` / `Đã hoàn thành`), nút chọn nhanh ngày (`Hôm nay`, `+30 ngày`), ghi chú tình hình thực hiện / kết quả *(tùy chọn)*, tải ảnh bằng chứng hoàn thành (kéo-thả / `Ctrl+V` / camera mobile, *tùy chọn*), xem lịch sử cập nhật.
  - Gắn nút **`Cập nhật tình hình thực hiện`** nhất quán, dễ thấy ở mọi điểm chạm: trong `Xem chi tiết` của `Lịch sử FI`, trong `FiDetailDrawer`, thao tác 1 chạm ngay trên dòng `Lịch sử FI` (bấm pill tiến độ hoặc nút nhanh), và trong `FiMatrixCellDrawer`.
  - Thêm chế độ lọc nhanh 1 chạm **"Đang thực hiện đội tôi"** (lọc sẵn `Đội của bạn` + `Đồng ý` + `Chưa hoàn thành`) và bộ lọc **`Tự ghi nhận · cần xác nhận`**, đồng thời làm sạch `Lịch sử FI` (bỏ dòng KHMT lặp, sửa sticky overlap, sửa thẻ summary không bị nhảy về 0 khi chuyển trạng thái).
  - Tách bạch hoàn toàn SK `Đã duyệt – chưa hoàn thành` vs `Đã hoàn thành` trên tab `Đăng ký SK-CTKT`, và chuẩn hóa mẫu số KPI `Tiến độ thực hiện` trên `FI Dashboard` theo đúng tập **SK đã duyệt (`Approved`/`Completed`)**.
- **P2 (Hoàn thiện Mobile, Admin & Vệ sinh dữ liệu cũ):**
  - Tối ưu hiển thị mobile (`390×844`) cho header/tab FI, select Năm và hộp thoại cập nhật tiến độ (hỗ trợ chụp ảnh hiện trường bằng điện thoại).
  - Sửa cắt ngang cột `THAO TÁC` trên `/Admin → Chốt KHMT & FI` (`1440×900`) và cập nhật cột tiến độ/ghi chú thực hiện vào file Excel xuất báo cáo.
  - Mở rộng script dry-run `backend/scripts/revert_fi_auto_done.py` để rà soát và báo cáo các bản ghi `Submitted`/`Deferred`/`Draft`/`Rejected` đang dính `completed_at` sai trên production (chỉ chạy `--apply` khi có lệnh riêng).

### 2.2. Nguyên tắc bất biến & giới hạn (Non-goals)

- **Không thay đổi công thức chấm điểm OKR (`O5.KR13`):** `count_for_okr()` và `monthly_allocation.py` tiếp tục đếm theo `status IN ('Approved', 'Completed') AND consider_for_khmt = true AND is_counted_for_okr = true`. Cập nhật tiến độ thực hiện **không được** làm thay đổi `approved_at`, `khmt_month`, `khmt_year`, `consider_for_khmt`, hay `is_counted_for_okr`.
- **Không cho sửa nội dung gốc sau khi đã duyệt (`Approved`):** `title` và `content_description` của SK đã `Approved` tiếp tục bị khóa để bảo toàn tính pháp lý của quyết định xét duyệt.
- **Giữ nguyên kiểm soát phiên bản lạc quan (`expected_revision` / `409 VERSION_CONFLICT`)** và chế độ `Admin editMode = false` mặc định khi mở trang.
- **Giữ tương thích ngược 100% API cũ:** `PUT /fi/sk-ctkt/{id}`, `GET /fi/dashboard`, `GET /fi/history`, `GET /fi/sk-ctkt/{id}` giữ nguyên các trường cũ để không phá module OKR và bộ test hồi quy hiện có.
- **Không chạy migration/mutation trực tiếp lên Production VPS từ bộ spec này**; chỉ triển khai trên nhánh tính năng riêng và kiểm thử trên môi trường cô lập trước khi trình merge.

---

## 3. Vai trò, Ma trận Phân quyền & Thuật ngữ

### 3.1. Ma trận phân quyền cập nhật tình hình thực hiện (Trước vs Đề xuất)

| Vai trò | Phạm vi SK áp dụng | Cập nhật tiến độ hiện tại | **Cập nhật tiến độ đề xuất** | **Tải/xóa ảnh bằng chứng hoàn thành (SK `Approved`)** | Gán KHMT (giữ nguyên) |
|---|---|---|---|---|---|
| `Staff` (Tác giả / Người gửi hộ) | SK do mình đứng tên hoặc đăng ký hộ | Có (`Approved`, `Submitted`...) | **Có** (cả `Approved` đã chốt kỳ KHMT) | **Có** (tải ảnh hoàn thành; chỉ xóa được ảnh do chính mình tải) | Không |
| `Staff` (Khác) | SK của đồng nghiệp khác | Không | Không (hiện gợi ý ai có quyền cập nhật) | Không | Không |
| `Team_Account` (Đội/Tổ trưởng) | **Toàn bộ SK thuộc đúng đội/tổ mình** *(vd. `minhvq` → `TBHTĐK`)* | **Không** *(trừ phiếu tự tạo)* | **Có (cho mọi SK `Approved` thuộc đội mình, kể cả legacy `HIST-*`)** | **Có (ảnh hoàn thành cho SK `Approved` thuộc đội mình)** | Có (đúng đội, kỳ chưa chốt) |
| `FI_Coordinator` (Đầu mối FI) | Toàn xưởng *(đã chốt tại Mục 5)* | **Không** *(trừ phiếu tự tạo)* | **Có (mọi SK `Approved` toàn xưởng)** | **Có (ảnh hoàn thành cho SK `Approved`)** | Không |
| `Admin` (`Chỉnh sửa: Bật`) | Toàn xưởng | Có (`Approved`) | **Có (mọi SK `Approved` & legacy)** | **Có** | Có (kỳ chưa chốt) |
| `Admin` (`Chỉnh sửa: Tắt`) | Toàn xưởng | Chỉ xem (có hint) | Chỉ xem (có nút/hint bật `Chỉnh sửa` rõ ràng) | Chỉ xem | Chỉ xem |
| `Workshop_Leader` (LĐX) | Toàn xưởng | Chỉ xem | Chỉ xem (thấy đầy đủ tiến độ, ghi chú, ảnh trước/sau) | Chỉ xem | Chỉ xem |

### 3.2. Thuật ngữ chuẩn hóa

- **Kết luận xét duyệt (`status`):** chiều phê duyệt hồ sơ — `Chờ xét duyệt` (`Submitted`/`NeedMoreInfo`/`Reviewed`), `Đồng ý` (`Approved`), `Xem xét sau` (`Deferred`), `Không đồng ý` (`Rejected`), `Đã hủy` (`Cancelled`).
- **Tình hình thực hiện (`execution_status`):** chiều triển khai thực tế ngoài hiện trường (tách biệt hoàn toàn với chiều `status = Approved` kết luận xét duyệt):
  - `in_progress` (**Đang thực hiện**): đang triển khai theo ngày dự kiến `planned_due_date > factory_today` (hoặc chưa đặt ngày cụ thể).
  - `paused` (**Tạm dừng / Chờ dừng máy**): tạm hoãn triển khai vì phụ thuộc dừng máy BDTT, chờ vật tư, v.v. — có ghi chú lý do rõ ràng và **KHÔNG bị job tự động đánh dấu hoàn thành**.
  - `completed` (**Đã hoàn thành**): đã áp dụng xong thực tế vào ngày `completed_at` (`<= factory_today`), phân biệt rõ 2 tiểu trạng thái hiển thị:
    - **Đã xác nhận** (`auto = false`): do tác giả, Đội trưởng, Đầu mối FI hoặc Admin chủ động cập nhật/xác nhận.
    - **Tự ghi nhận · cần xác nhận** (`auto = true`): do job `auto_completion` tự ghi nhận khi SK `Approved` (không `paused`) đến ngày dự kiến; hiển thị nút nhanh **Xác nhận đã xong** hoặc **Gia hạn / Tạm dừng**.
- **Ảnh hiện trạng / đăng ký (`stage = "registration"`):** ảnh đính kèm lúc đề xuất/chỉnh sửa ý tưởng trước khi duyệt.
- **Ảnh bằng chứng hoàn thành (`stage = "completion"`):** ảnh chụp hiện trường/nghiệm thu sau khi triển khai SK đã được duyệt.
- **Ngày hiện tại của nhà máy (`factory_today`):** ngày theo múi giờ `Asia/Ho_Chi_Minh` (`UTC+7`).

---

## 4. Requirements và Acceptance Criteria (EARS)

### R01 — Phân quyền Cập nhật Tình hình Thực hiện & Bảo vệ Khóa kỳ [P0]

*User story:* Là Đội/Tổ trưởng (như Anh Minh đội TBHTĐK) hoặc tác giả/Đầu mối FI, tôi muốn cập nhật được tình hình thực hiện cho các SK đã được duyệt của đội mình — kể cả phiếu do nhân viên tự đăng ký, phiếu import lịch sử `HIST-*`, hay phiếu đã gắn vào kỳ KHMT các tháng trước — mà không bị hệ thống ẩn nút hoặc báo lỗi khóa kỳ.

- **R01.1** KHI người dùng thuộc một trong các nhóm sau mở SK-CTKT ở trạng thái `Approved` *(hoặc `Completed`)*:
  - Tác giả (`effective_author_user_id == current_user_id`), HOẶC
  - Người đăng ký hộ (`effective_submitter_user_id == current_user_id`), HOẶC
  - `Team_Account` có `principal.team == record.team` *(đúng đội/tổ của SK)*, HOẶC
  - `FI_Coordinator` *(đầu mối FI toàn xưởng)*, HOẶC
  - `Admin` đang bật chế độ `Chỉnh sửa`,
  hệ thống PHẢI cho phép cập nhật tình hình thực hiện (`execution_status`, ngày hoàn thành/dự kiến, ghi chú thực hiện) và hiển thị rõ nút **`Cập nhật tình hình thực hiện`** trên giao diện.
- **R01.2** NẾU người dùng là `Team_Account` truy cập SK của **đội khác** (`principal.team != record.team`), HOẶC là `Staff` không phải tác giả/người gửi hộ, HOẶC là `Workshop_Leader`, hệ thống PHẢI từ chối cập nhật ở cả Backend (`403 Forbidden`) lẫn ẩn nút cập nhật ở Frontend, ĐỒNG THỜI trong vùng `Tiến độ thực hiện` ở chế độ xem chi tiết PHẢI hiển thị ghi chú nhỏ giải thích ngắn gọn (ví dụ: *"Tác giả hoặc Đội trưởng {team} có thể cập nhật tình hình thực hiện"* — tránh vùng trống khó hiểu).
- **R01.3** NẾU người dùng là `Admin` đang ở chế độ `Chỉnh sửa: Tắt`, vùng `Tiến độ thực hiện` PHẢI hiển thị gợi ý rõ ràng kèm hành động nhắc bật `Chỉnh sửa` ở góc trên.
- **R01.4** KHI cập nhật **chỉ các trường tình hình thực hiện** (`execution_status`, `completion_done`, `completion_date`, `completion_plan`, `execution_note`) hoặc **tải/xóa ảnh bằng chứng hoàn thành** cho một SK đã `Approved`, hệ thống PHẢI cho phép lưu thành công **ngay cả khi kỳ `khmt_month/khmt_year` của SK đó đã được Admin chốt (`is_locked = true`)**, và PHẢI đảm bảo tuyệt đối không sửa đổi `khmt_month`, `khmt_year`, `consider_for_khmt`, `is_counted_for_okr`, `approved_at`, `title`, `content_description` hay `status` xét duyệt.
- **R01.5** KHI bất kỳ ai cập nhật tình hình thực hiện, Backend PHẢI kiểm tra `expected_revision` (trả `409 VERSION_CONFLICT` kèm `current_revision` nếu bản ghi đã cũ), tăng `revision += 1`, ghi đầy đủ bản ghi lịch sử vào `status_history` (`reason = "execution_update"`) và `audit_logs` (`action = "update_execution"`), bao gồm người cập nhật, trạng thái cũ → mới, ngày cũ → mới và ghi chú thực hiện.
- **R01.6** KHI `Team_Account`, `FI_Coordinator` hoặc `Admin` cập nhật tình hình thực hiện hộ cho SK của một tác giả khác, hệ thống PHẢI gửi thông báo nhẹ (`SK_EXECUTION_UPDATED`) tới tác giả (và người gửi hộ nếu khác người thao tác, bỏ qua `historical-import`/`deploy-import`) để đảm bảo phản hồi 2 chiều minh bạch.

### R02 — Sửa lỗi Z-Index & Đảm bảo Mọi Điểm chạm Mở Hộp thoại Hoạt động Hoàn hảo [P0]

*User story:* Là người dùng bấm vào một sáng kiến ở bất kỳ tab nào (Đăng ký, Xét duyệt, FI Dashboard, Lịch sử FI, hay Chuông thông báo), khi tôi bấm `Cập nhật tình hình thực hiện`, `Chỉnh sửa` hoặc bấm xem ảnh, hộp thoại PHẢI hiện rõ ngay trước mặt chứ không bao giờ bị che phía sau Drawer.

- **R02.1** KHI người dùng mở `FiExecutionUpdateModal` (cập nhật tiến độ), `EditModal` (chỉnh sửa SK) hoặc `SkImageViewer` (phóng to ảnh) từ bên trong `FiDetailDrawer` (hoặc `FiMatrixCellDrawer`), hộp thoại mở ra PHẢI luôn nằm trên lớp cao hơn Drawer (không bị che khuất, không bị chặn click, focus trap hoạt động đúng).
- **R02.2** HỆ THỐNG PHẢI áp dụng một thang `z-index` chuẩn hóa, nhất quán trên toàn phân hệ FI:
  `Header/Sticky (≤ 50)` < `Filter/Month Popovers (80)` < `FiMatrixCellDrawer (140)` < `FiDetailDrawer (160)` < `Action/Edit/Execution Modals (200)` < `Image Lightbox (220)` < `Critical System Dialogs (300)`.
- **R02.3** KHI người dùng nhấn phím `Escape` lúc đang mở `FiExecutionUpdateModal` hoặc `SkImageViewer` phía trên `FiDetailDrawer`, hệ thống PHẢI chỉ đóng lớp trên cùng (Modal/Lightbox) và giữ nguyên `FiDetailDrawer` bên dưới.

### R03 — Hộp thoại Cập nhật Tình hình Thực hiện (`FiExecutionUpdateModal`) Toàn diện & Thân thiện Hiện trường [P0/P1]

*User story:* Là kỹ thuật viên hoặc Đội trưởng đang theo dõi sáng kiến ngoài nhà máy, khi bấm `Cập nhật tình hình thực hiện`, tôi muốn chọn ngay trạng thái thực tế (`Đang thực hiện`, `Tạm dừng / Chờ dừng máy`, `Đã hoàn thành`), ghi ngắn tình hình/kết quả và tải luôn ảnh chụp hiện trường (hoặc dán `Ctrl+V` từ Zalo) trong đúng 1 hộp thoại.

- **R03.1** KHI mở `FiExecutionUpdateModal`, giao diện PHẢI hiển thị rõ: mã SK + tiêu đề + tên tác giả + trạng thái hiện tại, và **3 lựa chọn trạng thái thực hiện rõ ràng**:
  1. **`Đang thực hiện`** (`in_progress`): chọn **Ngày dự kiến hoàn thành** (`> hôm nay` đối với SK `Approved` để khớp quy tắc tự ghi nhận khi tới hạn; `>= hôm nay` đối với SK chưa duyệt; hỗ trợ nút chọn nhanh `+15 ngày`, `+1 tháng`, `Cuối năm`).
  2. **`Tạm dừng / Chờ dừng máy`** (`paused`): ngày dự kiến là **tùy chọn** (phù hợp sáng kiến phải chờ dừng máy/BDTT hoặc chờ vật tư — và **không bị tự động đánh dấu hoàn thành**), có gợi ý nhập lý do tạm dừng/điều kiện thực hiện.
  3. **`Đã hoàn thành`** (`completed`): bắt buộc chọn **Ngày hoàn thành thực tế** (mặc định là **hôm nay**, không được sau hôm nay `> factory_today`, có nút nhanh `Hôm nay` / `Hôm qua`); ghi chú kết quả và ảnh bằng chứng là tùy chọn (khuyến nghị).
- **R03.2** TRONG KHI `FiExecutionUpdateModal` đang mở, người dùng PHẢI có ô nhập **Ghi chú tình hình thực hiện / Kết quả áp dụng** (tùy chọn, tối đa 1.000 ký tự, có gợi ý mẫu nhanh như *"Đã lắp đặt & vận hành ổn định"*, *"Đang chờ vật tư"*, *"Chờ dừng máy BDTT"*).
- **R03.3** TRONG KHI `FiExecutionUpdateModal` đang mở đối với SK đã `Approved`, người dùng có quyền PHẢI có thể **đính kèm ảnh bằng chứng hoàn thành ngay trong hộp thoại** bằng cả 3 cách: bấm chọn file (trên mobile mở được Camera/Thư viện ảnh), kéo-thả file, hoặc dán trực tiếp từ clipboard (`Ctrl+V` từ Zalo/Snipping Tool).
- **R03.4** KHI người dùng bấm **`Lưu tình hình thực hiện`** có kèm ảnh mới, hệ thống PHẢI cập nhật tiến độ và tải ảnh tuần tự an toàn với `expected_revision` cập nhật liên tục và `Idempotency-Key` (tái sử dụng `uploadWithRetry`). NẾU cập nhật trạng thái thành công nhưng 1 ảnh bị lỗi mạng, hệ thống PHẢI thông báo rõ ràng trạng thái đã lưu thành công và cho phép thử tải lại đúng ảnh lỗi mà không mất dữ liệu vừa nhập.
- **R03.5** KHI lưu thành công, hộp thoại PHẢI đóng mượt mà, hiển thị toast xác nhận rõ trạng thái mới, và đồng bộ tức thời dữ liệu trên mọi vùng đang mở (`Lịch sử FI`, `FiDetailDrawer`, `FiMatrixCellDrawer`, `FI Dashboard`, `Đăng ký SK-CTKT`) mà không làm mất vị trí cuộn hay bộ lọc đang chọn.
- **R03.6** KHI một SK đang ở trạng thái `Đã hoàn thành` (`completed`), người có quyền PHẢI vẫn có thể mở lại `FiExecutionUpdateModal` để sửa ngày hoàn thành, bổ sung ghi chú/ảnh bằng chứng, hoặc chuyển lại về `Đang thực hiện` / `Tạm dừng` nếu trước đó ghi nhận nhầm (ghi đầy đủ dấu vết vào lịch sử).

### R04 — Quản lý Ảnh Bằng chứng Hoàn thành (`Before / After`) cho SK Đã duyệt [P0]

*User story:* Là tác giả hoặc Đội trưởng sau khi thi công xong sáng kiến đã được duyệt, tôi muốn chụp ảnh hiện trường và tải lên mục `Ảnh bằng chứng` ngay trong màn hình `Xem chi tiết` (kể cả ở tab `Lịch sử FI`), tách biệt rõ ảnh minh họa lúc đăng ký và ảnh bằng chứng hoàn thành.

- **R04.1** KHI gọi `POST /fi/sk-ctkt/{id}/images` với tham số tùy chọn `stage=completion` *(mặc định `registration` cho các caller cũ)*:
  - Với `status == 'Approved'` (hoặc `'Completed'`): hệ thống PHẢI cho phép `author`, `submitter`, `Team_Account` cùng đội, `FI_Coordinator` và `Admin` tải ảnh với `stage = "completion"`, ngay cả khi kỳ KHMT đã chốt.
  - Với ảnh đã có của SK `Approved`: người dùng không phải Admin **chỉ được xóa ảnh `stage = "completion"`** do chính mình tải (hoặc Đội trưởng/Admin xóa ảnh `completion` của đội mình); **không được xóa ảnh `stage = "registration"`** gốc của hồ sơ đã duyệt để bảo toàn bằng chứng xét duyệt ban đầu.
- **R04.2** KHI hiển thị phần `Ảnh bằng chứng` trong `Xem chi tiết` ở **tất cả các tab** (`Lịch sử FI`, `FiDetailDrawer` ở `Đăng ký`, `Xét duyệt`, `FI Dashboard`), giao diện PHẢI:
  - Phân nhóm hoặc gắn nhãn rõ **`Ảnh đăng ký`** vs **`Ảnh hoàn thành`** (khi có cả hai hoặc có ảnh hoàn thành).
  - Hiển thị nút **`+ Thêm ảnh hoàn thành`** (và hỗ trợ dán `Ctrl+V`) ngay tại khối `Ảnh bằng chứng` cho mọi vai trò có quyền cập nhật tiến độ trên SK `Approved` (khắc phục việc tab `Lịch sử FI` hoàn toàn không có nút thêm ảnh).

### R05 — Gắn Điểm chạm Cập nhật Tình hình Thực hiện Nhất quán Trên Toàn Phân hệ FI [P1]

*User story:* Là Đội trưởng mở `Lịch sử FI`, `FI Dashboard` hay `Đăng ký SK-CTKT`, tôi muốn nhìn thấy ngay nút **`Cập nhật tình hình thực hiện`** khi bấm `Xem chi tiết` (đúng như góp ý gửi qua Zalo) và có thể lọc ngay danh sách SK đang thực hiện của đội mình trong 1 cú bấm.

- **R05.1** KHI người dùng bấm **`Xem chi tiết`** một SK trên tab **`Lịch sử FI`**:
  - Vùng `Tiến độ thực hiện` (nằm ngay đầu khung chi tiết) PHẢI hiển thị: badge trạng thái (`Đang thực hiện` / `Tạm dừng` / `Đã hoàn thành` / `Đã hoàn thành · Tự ghi nhận`), ngày mục tiêu/hoàn thành, ghi chú tình hình thực hiện mới nhất (nếu có), và nút nổi bật **`Cập nhật tình hình thực hiện`** (kèm nút nhanh **Xác nhận đã xong** / **Gia hạn** nếu là phiếu tự ghi nhận) cho mọi vai trò có quyền theo `R01.1`.
  - Bỏ khối hiển thị lặp thừa `Đã xem xét vào KHMT` bên dưới `Nội dung đăng ký` (vì đã hiển thị ở lưới metadata phía trên và trên hàng chính).
  - Sửa lỗi chồng lớp `sticky` để tiêu đề nhóm tháng (`T7/2026 · Tháng đăng ký`) không che khuất đầu dòng/khung chi tiết đang mở khi cuộn.
- **R05.2** KHI hiển thị từng dòng trong **`Lịch sử FI`**, nếu người dùng có quyền cập nhật tiến độ của SK đó, badge tiến độ (`CompletionPill`) hoặc nút thao tác nhanh trên dòng PHẢI cho phép bấm trực tiếp để mở `FiExecutionUpdateModal` (với `tooltip`: *"Bấm để cập nhật tình hình thực hiện"*), giúp Đội trưởng cập nhật nhanh nhiều SK liên tiếp mà không bắt buộc phải mở rộng từng dòng.
- **R05.3** KHI người dùng mở tab **`Lịch sử FI`**:
  - NẾU thuộc một đội (`Team_Account` hoặc `Staff` có `currentTeam ∈ OKR_TEAMS`), thanh công cụ PHẢI có nút lọc nhanh 1 chạm **`Đang thực hiện đội tôi ({n})`** (tự động áp bộ lọc `Đội = currentTeam`, `Kết luận = Đồng ý`, `Hoàn thành = Chưa hoàn thành`).
  - NẾU là `FI_Coordinator` hoặc `Admin`, thanh công cụ PHẢI có nút lọc nhanh 1 chạm **`SK duyệt chưa hoàn thành ({n})`** (lọc `Kết luận = Đồng ý`, `Hoàn thành = Chưa hoàn thành`).
- **R05.4** KHI người dùng bấm vào thẻ thống kê kết luận trên `Lịch sử FI` (`Đã xét đồng ý`, `Không đồng ý`, `Xem xét sau`, `Chưa duyệt`), hệ thống PHẢI tính số đếm trên 4 thẻ kết luận theo **disjunctive facets** (bỏ lọc `decisions` khi đếm 4 thẻ này) để 3 thẻ còn lại không bị tụt về `0`, cho phép bấm chuyển trực tiếp giữa các nhóm trạng thái trong 1 cú bấm.
- **R05.5** KHI người dùng mở **`FiMatrixCellDrawer`** từ Ma trận KHMT trên `FI Dashboard`:
  - Mỗi thẻ SK trong ô PHẢI hiển thị đúng `CompletionPill` đầy đủ (bao gồm `Đã hoàn thành`, `Tự ghi nhận`, `Đang thực hiện`, `Tạm dừng`), và nếu người dùng có quyền theo `R01.1` thì PHẢI có nút nhanh **`Cập nhật tiến độ`** ngay cạnh `Xem chi tiết`.
  - Tiêu đề phụ của `FiKhmtMatrix` PHẢI điều chỉnh theo vai trò: chỉ nhắc *"gán/bỏ trực tiếp"* cho `Team_Account` và `Admin`; với `Staff`/`Workshop_Leader`/`FI_Coordinator` hiển thị *"Bấm vào bất kỳ ô nào để xem danh sách và tình hình thực hiện các SK trong tháng."*
- **R05.6** KHI người dùng mở tab **`Đăng ký SK-CTKT`**:
  - Mục **`Đã duyệt – đang thực hiện`** và **`Phiếu gửi hộ đã duyệt – đang thực hiện`** PHẢI **chỉ hiển thị các SK `Approved` chưa hoàn thành** (`execution_status != 'completed'`); các SK đã hoàn thành PHẢI được chuyển sang đếm trong liên kết lịch sử (`{n} hồ sơ đã hoàn thành / có kết quả`) hoặc mục thu gọn riêng, không còn gây mâu thuẫn hiển thị phiếu *"Đã hoàn thành 25/07/2026"* dưới tiêu đề *"đang thực hiện"*.
  - Mỗi dòng trong `Sáng kiến của tôi` / `Phiếu tôi đã gửi` PHẢI hiển thị `CompletionPill` gọn (ngày dự kiến / tạm dừng) ngay cạnh trạng thái xét duyệt.

### R06 — Siết chặt Phạm vi Tự động Hoàn thành & Dọn Dữ liệu Lịch sử Sai phạm vi [P0]

*User story:* Là Lãnh đạo Xưởng và Đội trưởng, tôi muốn cơ chế tự động ghi nhận hoàn thành khi tới ngày dự kiến **chỉ áp dụng cho sáng kiến đã được Đồng ý (và không đang tạm dừng)**, phân biệt rõ phiếu tự ghi nhận với phiếu đã có người xác nhận thực tế, đồng thời rà soát khôi phục các phiếu chưa duyệt bị tick nhầm trước đây.

- **R06.1** HỆ THỐNG PHẢI giới hạn cơ chế tự động đánh dấu `"Đã hoàn thành"` (`apply_completion_schedule`) **DUY NHẤT** cho SK có `status == 'Approved'` VÀ `execution_status != 'paused'`. Cấm tuyệt đối tự động đánh dấu hoàn thành cho `Draft`, `Submitted`, `NeedMoreInfo`, `Reviewed`, `Deferred`, `Rejected`, `Cancelled` (kể cả khi `due_date <= factory_today`).
- **R06.2** KHI một SK `Approved` được hệ thống tự ghi nhận hoàn thành do tới ngày dự kiến (`last_plan_reason == 'completion_auto_done'`), giao diện PHẢI gắn nhãn phụ rõ ràng **`Tự ghi nhận · cần xác nhận`** trong `FiExecutionBand` kèm 2 thao tác nhanh cho người có quyền:
  - **`Xác nhận đã xong`** (ghi nhận xác nhận thủ công, mở nhanh hộp thoại để bổ sung ghi chú/ảnh nếu muốn).
  - **`Chưa xong / Gia hạn`** (mở hộp thoại ở trạng thái `Đang thực hiện` hoặc `Tạm dừng` để đặt ngày dự kiến mới hoặc tạm dừng chờ dừng máy).
  Bộ lọc `Hoàn thành` trên `Lịch sử FI` PHẢI cho phép lọc riêng mục **`Tự ghi nhận · cần xác nhận`** (`auto_done`) và **`Tạm dừng`** (`paused`) bên cạnh `Đã hoàn thành` và `Chưa hoàn thành`.
- **R06.3** KHI người dùng tạo mới/sửa SK ở trạng thái **chưa duyệt** (`Draft`/`Submitted`/`NeedMoreInfo`/`Deferred`/`Rejected`) và chọn `Đang thực hiện`, hệ thống PHẢI cho phép ngày dự kiến `>= factory_today` và KHÔNG khóa cứng nút Lưu khi chỉnh sửa nội dung phiếu cũ có ngày dự kiến đã qua; khi cập nhật tiến độ cho SK `Approved` sang `Đang thực hiện`, yêu cầu ngày dự kiến mới `> factory_today` (từ ngày mai trở đi để khớp quy tắc tự ghi nhận khi tới hạn), còn chọn `Tạm dừng / Chờ dừng máy` thì ngày dự kiến là tùy chọn và không bị tự tick hoàn thành.
- **R06.4** HỆ THỐNG PHẢI mở rộng script `backend/scripts/revert_fi_auto_done.py` để phát hiện (ở chế độ `--dry-run` mặc định) toàn bộ **25 bản ghi chưa duyệt/nháp/từ chối/hoãn** (`Submitted`, `Deferred`, `Draft`, `Rejected`, `NeedMoreInfo`, `Reviewed`, `Cancelled`) đang còn `completed_at` từ job `completion_auto_done` cũ, xuất báo cáo JSON đầy đủ để Chủ sản phẩm duyệt trước khi chạy `--apply`.

### R07 — Chuẩn hóa Số liệu Tiến độ trên `FI Dashboard` & Xuất Excel [P1]

*User story:* Là Lãnh đạo Xưởng và Đầu mối FI, tôi muốn số liệu `% hoàn thành` trên `FI Dashboard`, `Lịch sử FI` và file Excel phản ánh đúng tỉ lệ hoàn thành của các SK **đã được duyệt**, không bị nhiễu bởi phiếu chờ duyệt hay bị từ chối.

- **R07.1** KHI tính thẻ KPI **`Tiến độ thực hiện`** trên `FI Dashboard` và thanh tiến độ trong 4 thẻ chi tiết đội/tổ, hệ thống PHẢI tính trên tập **SK đã được duyệt (`Approved`/`Completed`)**:
  - Số chính: `{approved_completed_count}/{approved_total}` (`{approved_completion_rate}% đã hoàn thành`).
  - Dòng phụ: `{approved_in_progress} đang thực hiện` *(kèm `· {approved_paused} tạm dừng` nếu `> 0`, và `· {approved_auto_done} tự ghi nhận` nếu `> 0`)*.
  - Bấm vào thẻ KPI `Tiến độ thực hiện` PHẢI mở `Lịch sử FI` lọc sẵn `Kết luận = Đồng ý` + `Hoàn thành = Chưa hoàn thành`.
- **R07.2** TRONG `GET /fi/dashboard` và `GET /fi/history`, hệ thống PHẢI giữ nguyên các key cũ (`completed_count`, `not_completed`) để tương thích ngược, ĐỒNG THỜI bổ sung các trường tường minh: `approved_completed_count`, `approved_confirmed_completed_count`, `approved_auto_done_count`, `approved_in_progress_count`, `approved_paused_count`.
- **R07.3** KHI người dùng bấm **`Xuất Excel`** từ `FI Dashboard` hoặc `Lịch sử FI`, sheet `Du lieu FI` PHẢI bổ sung cột **`Tình hình thực hiện`** (`Đã hoàn thành` / `Đã hoàn thành (tự ghi nhận)` / `Đang thực hiện` / `Tạm dừng` / `Chưa áp dụng` đối với phiếu chưa duyệt/từ chối), **`Ghi chú thực hiện`**, và **`Số ảnh hoàn thành`**.

### R08 — Tinh chỉnh Trải nghiệm Mobile (`390×844`) & Bảng `/Admin → Chốt KHMT & FI` [P2]

*User story:* Là kỹ thuật viên dùng điện thoại tại nhà máy để cập nhật hoàn thành & chụp ảnh hiện trường, hoặc Admin mở màn hình Chốt KHMT trên laptop, tôi muốn giao diện gọn, không bị cắt chữ, không bị cắt cột thao tác.

- **R08.1** KHI mở `/FI` trên màn hình mobile (`≤ 430px`):
  - Tiêu đề topbar rút gọn sạch sẽ (`FI · SK-CTKT`), thanh tab FI hiển thị gọn không cắt ngang dở dang chữ cuối và có cuộn ngang mượt.
  - `FiExecutionUpdateModal` hiển thị dạng bottom-sheet / full-height modal dễ thao tác 1 tay, các nút chọn trạng thái và nút `Chụp / Chọn ảnh` có vùng bấm tối thiểu `44×44px`.
  - Ô chọn `Năm` trên `FI Dashboard` được căn giữa chuẩn theo trục dọc.
- **R08.2** KHI Admin mở `/Admin → Chốt KHMT & FI` trên màn hình `1280–1440px`, bảng 4 đội PHẢI hiển thị đủ toàn bộ cột `THAO TÁC` bên phải mà không bị cắt chữ (`Nhập báo cáo trước` hiển thị trọn vẹn).

---

## 5. Quyết định đã được Chủ sản phẩm Chốt (24/11/2026)

Toàn bộ 4 nhóm quyết định nghiệp vụ cốt lõi đã được Chủ sản phẩm xác nhận trực tiếp:

1. **Phân quyền cập nhật tình hình thực hiện & ảnh bằng chứng hoàn thành (Q1 — ĐÃ CHỐT):**
   - Cấp đầy đủ cho: **Tác giả / Người đăng ký hộ** + **Đội/Tổ trưởng (`Team_Account`, đúng đội/tổ của mình)** + **Đầu mối FI (`FI_Coordinator`, toàn xưởng)** + **Admin (khi bật `Chỉnh sửa`)**. `Workshop_Leader` giữ chỉ xem.
2. **Chính sách tự động đánh dấu "Đã hoàn thành" khi tới ngày dự kiến (Q2 — ĐÃ CHỐT):**
   - **Giữ cơ chế tự động hoàn thành NHƯNG CHỈ áp dụng cho SK đã `Đồng ý` (`Approved`)** và **không ở trạng thái `Tạm dừng`**; cấm tuyệt đối trên `Draft`, `Submitted`, `NeedMoreInfo`, `Reviewed`, `Deferred`, `Rejected`, `Cancelled`. Gắn nhãn rõ **`Tự ghi nhận · cần xác nhận`** kèm nút nhanh **Xác nhận đã xong** / **Gia hạn hoặc Tạm dừng**.
3. **Thông tin yêu cầu khi đánh dấu "Đã hoàn thành" (Q3 — ĐÃ CHỐT):**
   - Bắt buộc **Ngày hoàn thành** (mặc định hôm nay, `<= hôm nay`); **Ghi chú kết quả** và **Ảnh bằng chứng hoàn thành** là **tùy chọn (khuyến nghị)**.
4. **Mô hình trạng thái & Vệ sinh dữ liệu cũ trên VPS (Q4 & Q5 — ĐÃ CHỐT):**
   - Giữ nguyên `status = 'Approved'` cho chiều xét duyệt và tách riêng chiều **`execution_status`** (`in_progress` / `paused` / `completed`) + `execution_note` + `sk_images.stage`.
   - Chuẩn bị script `revert_fi_auto_done.py` chạy **`--dry-run`** rà soát toàn bộ ~25 phiếu chưa duyệt (`Submitted`, `Deferred`, `Draft`, `Rejected`) đang dính `completed_at` cũ trên VPS để Chủ sản phẩm kiểm tra trước khi chạy `--apply`.
