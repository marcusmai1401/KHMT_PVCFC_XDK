# Requirements — Nâng cấp Dashboard Ma trận KHMT & Đại tu Trải nghiệm Phân hệ FI (SK-CTKT)

Ngày lập: 23/11/2026. Trạng thái: **đã triển khai hoàn tất trên nhánh `feature/fi-khmt-dashboard-ux` (chờ review cuối & phê duyệt merge/deploy)**.

## 1. Bối cảnh, bằng chứng thực tế và mục tiêu

### 1.1. Phản hồi trực tiếp từ người dùng

Người dùng phản ánh trải nghiệm phân hệ **FI (Đăng ký Sáng kiến – Cải tiến Kỹ thuật)** hiện tại rất kém, trọng tâm là:

- **Chưa có bảng tổng quan (Dashboard) thể hiện trực quan theo từng đội/tổ × từng tháng (`T1 → T11/T12`) số lượng SK-CTKT đang được xét vào KHMT.**
- Muốn biết một đội/tổ trong năm đang xét bao nhiêu cái vào KHMT ở mỗi tháng (tháng nào đã đủ, tháng nào còn trống, còn bao nhiêu cái đã duyệt chưa phân bổ), người dùng phải mở tab `Lịch sử FI` rồi tự lọc từng đội × từng kỳ KHMT, hoặc Admin phải mở `/Admin → Chốt KHMT & FI` chọn từng tháng một.

### 1.2. Bằng chứng xác minh từ Production (`https://xdk-pvcfc.com`, chỉ đọc ngày 23/11/2026)

Dữ liệu PostgreSQL thực tế (`186` SK-CTKT không gồm nháp, `3` bản nháp; baseline commit `426cc6a`) cho thấy chính xác bức tranh mà người dùng đang không nhìn thấy được trên giao diện hiện tại:

| Đội/tổ | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | Tổng KHMT | Đạt chưa vào KHMT | Chờ duyệt |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **TBCH** | 1 | 3 | 1 | 1 | 3 | 3 | 3 | 1 | 0 | 0 | 0 | 0 | **16** | **7** | 7 |
| **TBĐL** | 3 | 1 | 3 | 1 | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **20** | **1** | 21 |
| **TBHTĐK** | 1 | 1 | 3 | 3 | 1 | 3 | 3 | 0 | 0 | 3 | 0 | 0 | **18** | **6** | 7 |
| **TCĐK** | 3 | 3 | 3 | 3 | 3 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | **19** | **8** | 25 |
| **Tổng 4 đội/tổ** | **8** | **8** | **10** | **8** | **10** | **12** | **10** | **4** | **0** | **3** | **0** | **0** | **73** | **22** | **60** |

*(Ngoài ra khối `Workshop_Staff` / `Xưởng quản lí` có `3` SK-CTKT đang `Submitted`, không nằm trong ma trận OKR/KHMT của 4 đội/tổ.)*

Từ bảng thực tế và kiểm tra trực quan giao diện live, phát hiện **6 nhóm vấn đề lớn** làm trải nghiệm FI bị đánh giá tệ:

1. **FI Dashboard không có Ma trận Đội/Tổ × Tháng (`T1 → T12`)**: API `GET /fi/dashboard` chỉ trả `khmt_by_month` cộng dồn cả xưởng (`T1: 8, ..., T8: 4, T10: 3`), bỏ qua hoàn toàn tháng có giá trị `0` (`T9`, `T11`), không có bộ lọc năm, và lặp lại cùng một số tổng cộng dồn ở 2 block khác nhau (`Xu hướng KHMT theo tháng` + `KHMT theo tháng`).
2. **Số liệu hiển thị mâu thuẫn gây mất niềm tin**:
   - Biểu đồ Donut *Phân bố trạng thái* ghi tâm `186 SK-CTKT`, nhưng tổng các lát cắt cộng ra **208** (`Hoàn tất 117 + Chờ xét duyệt 63 + Xem xét sau 20 + Không đạt/Hủy 8`) do trộn chiều *tiến độ thực hiện* (`completed_count = 117`) vào chiều *kết luận xét duyệt* (`status`), khiến lát `Đã xét đạt` bị trừ âm về `0`.
   - Tab `FI Dashboard` báo `22 SK đạt chưa vào KHMT`, trong khi tab `Lịch sử FI` báo `113 chưa vào` (vì cộng luôn cả SK chưa duyệt/từ chối/xem xét sau vào `khmt_missing`).
   - Thẻ KPI `Xem xét sau (20)` hiển thị dòng phụ `63 SK chưa duyệt` (sai ngữ cảnh); lưới 5 thẻ KPI xếp 3 + 2 bị khuyết 1 ô; mục `Tóm tắt trạng thái` ghi *"tổng hợp trên toàn bộ 4 đội/tổ"* dù đang cộng cả `Xưởng quản lí` (`186` thay vì `183`).
3. **Thao tác gán SK vào KHMT thiếu ngữ cảnh và dính lỗi phân quyền `Team_Account`**:
   - Trong `FIWorkspace.tsx`, `visibleActionsForSk` đang kiểm tra `item.team === currentUserId` thay vì `item.team === (currentTeam ?? currentUserId)`, khiến mọi tài khoản Đội/Tổ trưởng thật (`linhln`, `minhvq`, `haint`, `thanhdq`, `chienpq`, `doint`, `loitt`) không hiện nút gán KHMT ở luồng chung.
   - Ở `Lịch sử FI`, dropdown gán KHMT bị khóa cứng năm theo năm đăng ký (không gán chéo năm, ví dụ SK T12/2026 vào KHMT T1/2027), bắt bấm nút `Lưu` nhỏ riêng lẻ, và **không cho biết tháng đích hiện đang có bao nhiêu FI** — dẫn tới dễ gán thừa hoặc nhảy cóc tháng (như thực tế ngày 23/11/2026 `TBHTĐK` gán 3 FI vào T10 trong khi T8–T9 đang `0`).
4. **Tab `Lịch sử FI` thiếu ô tìm kiếm và thiếu thông tin nhận diện cơ bản trên từng dòng**:
   - Đã khai báo state `historyQuery` và API `q`, nhưng **không render thẻ `<input>` tìm kiếm** trên thanh công cụ.
   - Mỗi dòng SK trong `Lịch sử FI` **không hiển thị tên Đội/tổ và mã `sk_code`**; đổi bộ lọc `Đội/tổ` lại tự động xóa sạch tất cả bộ lọc khác (`KHMT`, `Tháng`, `Kết luận`, ...).
   - 7 thẻ thống kê nhanh bị rớt dòng thành `6 + 1`, nhãn `/ 69 chưa xong` dư dấu `/`, dropdown `Năm` bị lệch trục dọc.
5. **Tab `Xét duyệt SK-CTKT` và `Đăng ký SK-CTKT` gây mệt mỏi khi thao tác**:
   - `Xét duyệt SK-CTKT` đang có `60` phiếu chờ duyệt đổ thành 1 cột dài không có ô tìm kiếm, không lọc theo đội/tổ hay tháng đăng ký; bấm xem chi tiết nhảy xuống tận cuối trang (`.fi-detail-card`).
   - `Đăng ký SK-CTKT` rớt xuống 1 cột trên màn hình laptop phổ biến (`≤ 1200px`), danh sách bên phải bị bóp `max-height: 340px`, phiếu đăng ký hộ (`Phiếu tôi đã gửi`) sau khi duyệt bị đẩy ẩn vào lịch sử, chưa hỗ trợ dán ảnh `Ctrl+V` từ Zalo/Snipping Tool.
6. **Lỗi hiển thị Mobile & Quản trị**:
   - Trên mobile (`390×844`), thanh điều hướng đáy che mất nội dung thẻ cuối, tiêu đề topbar và tab `Lịch sử FI` bị cắt cụt.
   - Trên `/Admin → Chốt KHMT & FI`, bảng có `min-width: 1240px` gây cắt mất 3 cột cuối (`Đang gán kỳ này`, `Trạng thái`, `Thao tác`) ngay trên màn hình `1440×900`, có 2 nút `Tải lại` trùng nhau.
   - Trong `App.tsx`, khi user không phải Admin đăng nhập lại tại URL `/Admin`, `<LazyAdminPanel />` kịp mount 1 frame trước khi redirect và bắn 3 request HTTP `403` (`/fi/reports`, `/admin/users`, `/admin/audit-log`).

### 1.3. Cách đọc bộ spec

Bộ spec theo chuẩn [Kiro](https://kiro.dev/docs/specs/quick-spec/) gồm đúng 3 tài liệu:

- `requirements.md` (tài liệu này): mục tiêu, phạm vi, tiêu chí chấp nhận theo mẫu **EARS** (`KHI / NẾU / TRONG KHI … HỆ THỐNG PHẢI …`) và các câu hỏi cần chủ sản phẩm xác nhận.
- [design.md](design.md): kiến trúc API, mô hình dữ liệu, thiết kế thành phần UI, wireframe desktop/mobile, quy tắc màu sắc/trạng thái, concurrency và kế hoạch kiểm thử.
- [tasks.md](tasks.md): danh sách công việc theo đợt, sơ đồ phụ thuộc, file tác động và tiêu chí hoàn thành liên kết ngược tới từng mã yêu cầu (`Rxx.x`).

---

## 2. Phạm vi, ưu tiên và giới hạn

### 2.1. Phân mức ưu tiên

- **P0 (Trọng tâm bắt buộc — giải quyết trực tiếp feedback người dùng):**
  - Xây dựng **Bảng Ma trận FI xét vào KHMT theo Đội/Tổ × Tháng (`T1 → T12`)** làm khu vực trung tâm trên đầu `FI Dashboard`.
  - Hỗ trợ bấm trực tiếp vào từng ô `(Đội/tổ, Tháng)` hoặc cột `Kho sẵn sàng` / `Chờ duyệt` để mở Drawer xem danh sách SK chi tiết và gán/bỏ KHMT nhanh tại chỗ (theo đúng quyền và khóa kỳ).
  - Sửa triệt để các lỗi sai/mâu thuẫn số liệu (Donut 208/186, `khmt_missing` 113 vs 22, KPI 3+2, nhãn `4 đội/tổ`) và bổ sung bảng ma trận vào file xuất Excel.
- **P1 (Đại tu trải nghiệm sử dụng hằng ngày):**
  - Khôi phục ô tìm kiếm từ khóa, hiển thị mã SK & badge Đội/tổ, giữ nguyên bộ lọc chéo, nâng cấp bộ chọn tháng/năm KHMT có gợi ý số lượng hiện có trong `Lịch sử FI`, và sửa lỗi quyền `Team_Account` (`currentTeam`).
  - Thêm bộ lọc đội/tổ + tìm kiếm + tháng vào `Xét duyệt SK-CTKT`, thay `.fi-detail-card` cuối trang bằng **Unified Detail Drawer** thống nhất trên toàn phân hệ FI.
  - Cải thiện `Đăng ký SK-CTKT` (bố cục laptop, dán ảnh `Ctrl+V`, gợi ý cấu trúc nội dung, theo dõi phiếu gửi hộ đã duyệt).
- **P2 (Hoàn thiện đa thiết bị, Quản trị & Vệ sinh kỹ thuật):**
  - Tối ưu hiển thị Mobile (`320–430px`), sửa cắt bảng `/Admin → Chốt KHMT & FI`, liên kết chéo giữa Ma trận FI và màn hình Chốt tháng của Admin, chặn mount trái phép `AdminPanel` gây 403, và kiểm tra dry-run làm sạch dữ liệu `auto_done` cũ trên Draft/Rejected.

### 2.2. Nguyên tắc bất biến & giới hạn (Non-goals)

- **Giữ nguyên định mức nghiệp vụ OKR/KHMT (`O5.KR13`):** `0` FI = Không hoàn thành / Chưa đạt (`NG`), `1–2` FI = Hoàn thành (`OK`), `≥ 3` FI = Hoàn thành tốt / Xuất sắc (`GOOD`). Không thay đổi công thức chấm điểm OKR hoặc chiến lược phân bổ tự động `oldest_approved_first`.
- **Giữ nguyên các cơ chế an toàn dữ liệu đã triển khai:** khóa kỳ chốt (`409 PERIOD_LOCKED`), kiểm soát phiên bản lạc quan (`expected_revision` / `409 VERSION_CONFLICT`), chế độ `Admin editMode = false` mặc định khi đăng nhập/reload.
- **Giữ tương thích ngược API:** `GET /fi/dashboard` phải giữ nguyên các trường cũ (`generated_at`, `teams`, `totals`, `khmt_by_month`, `status_order`) để không phá các block OKR (`ObjectiveSection`, `VisualBlockRenderer`) và bộ test hiện có.
- **Không tự ý đổi ma trận phân quyền vai trò** (đặc biệt quyền của `Workshop_Leader`) khi chưa có xác nhận của chủ sản phẩm ở Mục 5.
- **Không thêm thư viện UI mới nặng hoặc đổi framework**; giữ nguyên stack React 18 + TypeScript + Vite, FastAPI + SQLAlchemy, Lucide icons và hệ nhận diện PVCFC (`#2C398E`, `#169045`).
- **Không chạy mutation/deploy lên production từ bộ spec này**; mọi thao tác kiểm thử phải dùng test harness cô lập của repo.

---

## 3. Vai trò và thuật ngữ sử dụng trong spec

| Vai trò trong mã | Tên hiển thị | Nhu cầu chính trên FI Dashboard & Ma trận KHMT |
|---|---|---|
| `Admin` | Quản trị | Xem toàn xưởng T1–T12, phát hiện tháng thiếu/lệch định mức, gán/điều chỉnh KHMT (khi bật Chỉnh sửa), đi thẳng sang `Quản trị → Chốt KHMT & FI` |
| `Workshop_Leader` | Lãnh đạo Xưởng | Xem nhanh ma trận 4 đội T1–T12, biết đội nào thiếu/đủ FI từng tháng, bấm xem chi tiết từng sáng kiến trong mỗi ô |
| `FI_Coordinator` | Đầu mối FI | Xem cột `Chờ duyệt` song song với các ô tháng `0` của từng đội để ưu tiên duyệt đúng đội đang thiếu nguồn FI |
| `Team_Account` | Đội/Tổ trưởng | Xem hàng đội mình được làm nổi bật, kiểm tra T1–T12 tháng nào đang có mấy cái, bấm thẳng vào ô tháng để gán/bỏ từ `Kho sẵn sàng` của đội mình |
| `Staff` | Nhân viên | Xem tiến độ toàn xưởng và đội mình, biết SK của mình đã được đưa vào KHMT tháng nào, đăng ký và theo dõi SK mượt mà |

- **4 đội/tổ tính KHMT (`OKR_TEAMS`):** `TBCH`, `TBĐL`, `TBHTĐK`, `TCĐK`.
- **Khối ngoài ma trận OKR:** `Workshop_Staff` (`Xưởng quản lí`) hoặc đội phụ không thuộc 4 đội trên.
- **SK tính vào KHMT tháng `(m, y)`:** bản ghi `sk_ctkt` có `status IN ('Approved', 'Completed')`, `consider_for_khmt = true`, `is_counted_for_okr = true`, `khmt_month = m`, `khmt_year = y` (khớp tuyệt đối với `count_for_okr()` dùng cho `O5.KR13`).
- **Kho sẵn sàng (Approved unassigned pool):** bản ghi `sk_ctkt` của đội đó có `status IN ('Approved', 'Completed')` và `consider_for_khmt = false` (sẵn sàng để đưa vào KHMT các tháng chưa chốt).
- **Ngày hiện tại của nhà máy (`factory_today`):** ngày theo múi giờ Việt Nam `Asia/Ho_Chi_Minh` (`UTC+7`).

---

## 4. Requirements và Acceptance Criteria (EARS)

### R01 — Bảng Ma trận FI xét vào KHMT theo Đội/Tổ × Tháng (`T1 → T12`) [P0]

*User story:* Là lãnh đạo xưởng, đội/tổ trưởng hoặc nhân sự, tôi muốn mở `FI Dashboard` là nhìn thấy ngay một bảng ma trận `4 đội/tổ × T1→T12` để biết ngay lập tức mỗi đội ở từng tháng đang xét bao nhiêu SK vào KHMT, tháng nào trống, tháng nào đủ và kho dự phòng còn bao nhiêu.

- **R01.1** KHI người dùng mở tab `FI Dashboard`, hệ thống PHẢI hiển thị **Bảng Ma trận FI theo Đội/Tổ × Tháng** ở vị trí trung tâm phía trên màn hình (ngay dưới thanh công cụ và dải KPI gọn), nhìn thấy ngay mà không cần cuộn sâu hoặc bấm thêm bộ lọc.
- **R01.2** KHI bảng ma trận ở chế độ mặc định (`Xét vào KHMT`), bảng PHẢI hiển thị đủ 4 hàng đội/tổ (`TBCH`, `TBĐL`, `TBHTĐK`, `TCĐK`), 1 hàng tổng hợp **`Tổng Xưởng`** ở cuối bảng, đủ các cột tháng theo thứ tự tăng dần (`T1` đến `T12`, không bỏ trống/nhảy cóc các tháng có giá trị `0`), và 3 cột tổng hợp bên phải: **`Tổng năm`**, **`Kho sẵn sàng`** *(SK đã duyệt chưa vào KHMT)* và **`Chờ duyệt`**.
- **R01.3** KHI người dùng chọn năm trên bộ lọc năm của Dashboard (mặc định là năm hiện tại theo `UTC+7`), hệ thống PHẢI tải lại ma trận và các chỉ số theo năm đã chọn; danh sách năm PHẢI bao gồm năm hiện tại và mọi năm có dữ liệu SK-CTKT/KHMT trong cơ sở dữ liệu.
- **R01.4** KHI người dùng chuyển đổi phạm vi cột tháng giữa **`Đến T{tháng hiện tại}`** *(vd. `T1 → T11` trong năm hiện tại)* và **`Cả năm (T1 → T12)`**, bảng PHẢI hiển thị đúng tập cột tháng đã chọn; ở chế độ mặc định `Cả năm (T1 → T12)` cột tháng hiện tại PHẢI được đánh dấu nổi bật và các tháng tương lai (`month > current_month` trong năm hiện tại) PHẢI được hiển thị trung tính (mờ / `—` nếu `0`), không tô cảnh báo thiếu.
- **R01.5** KHI hiển thị số lượng FI vào KHMT trong mỗi ô `(team, month)` của tháng đã qua hoặc tháng hiện tại, hệ thống PHẢI tô màu ngữ nghĩa và chú thích rõ ràng khớp quy tắc `O5.KR13`:
  - `≥ 3` FI: sắc xanh lá đậm *(Đạt mức Hoàn thành tốt / Xuất sắc)*.
  - `1–2` FI: sắc xanh dương/xanh nhạt *(Đạt mức Hoàn thành)*.
  - `0` FI: sắc cam/đỏ nhạt *(Chưa xét FI vào KHMT)* — NGOẠI TRỪ trường hợp kỳ đó đã có đánh giá OKR là `Không hoàn thành` (định mức `0`), khi đó ô `0` hiển thị trạng thái trung tính kèm nhãn/tooltip `Không HT (định mức 0)`.
  - Mọi trạng thái PHẢI kết hợp số lượng + ký hiệu/nhãn văn bản hoặc tooltip rõ nghĩa, không chỉ dựa vào màu sắc.
- **R01.6** NẾU kỳ `(team, month, year)` đã được Admin chốt (`fi_period_write_guards.is_locked = true` hoặc `team_reports.report_status = 'locked'`), ô tương ứng PHẢI hiển thị biểu tượng khóa (`🔒`); NẾU kỳ đó có đánh giá tháng OKR (`monthly_assessment`) có định mức `required_count` nhưng số FI thực gán vào KHMT khác `required_count` (ví dụ `HT tốt` cần `3` nhưng đang gán `1`, hoặc `Không HT` định mức `0` nhưng đang gán `1`), ô PHẢI hiển thị dấu cảnh báo lệch định mức (`!`) cùng tooltip nêu rõ `Đang gán X / Định mức Y ({assessment})`.
- **R01.7** KHI người dùng đăng nhập thuộc một trong 4 đội/tổ (`currentTeam ∈ {TBCH, TBĐL, TBHTĐK, TCĐK}`), hàng của đội đó trong bảng ma trận PHẢI được nhấn nhẹ và gắn nhãn `"Đội của bạn"` để nhận diện ngay trong 1 giây.
- **R01.8** NẾU tồn tại SK-CTKT của khối ngoài 4 đội OKR (như `Workshop_Staff` / `Xưởng quản lí`) trong phạm vi đang xem, hệ thống PHẢI tách riêng thành dòng chú thích/khối phụ rõ ràng ngay dưới bảng ma trận (ví dụ: *"Khối Xưởng quản lí — không tính vào ma trận KHMT OKR: 3 SK (3 chờ duyệt)"*) để người dùng không bị nhầm tổng xưởng và không hiển thị sai chữ *"trên toàn bộ 4 đội/tổ"*.
- **R01.9** KHI người dùng bấm chuyển chế độ xem trên đầu bảng ma trận giữa **`Xét vào KHMT`** *(mặc định)* và **`Đăng ký mới`**, bảng PHẢI chuyển đổi mượt mà sang ma trận số SK đăng ký mới theo `registration_month / registration_year` cho cùng 4 đội/tổ × `T1 → T12`, giúp so sánh trực tiếp nhịp độ tạo sáng kiến với nhịp độ ghi nhận KHMT.

### R02 — Tương tác Drill-down từ Ô Ma trận & Gán/Bỏ KHMT Trực tiếp [P0]

*User story:* Là đội/tổ trưởng hoặc quản trị, khi nhìn thấy một tháng của đội mình đang là `0` hoặc `1` cái trên bảng ma trận, tôi muốn bấm thẳng vào ô đó để xem cụ thể những sáng kiến nào đang nằm trong tháng đó và đưa thêm sáng kiến đã duyệt từ kho của đội vào tháng đó chỉ bằng 1 cú bấm.

- **R02.1** KHI người dùng bấm vào bất kỳ ô `(team, month)` nào trên bảng ma trận (hoặc bấm phím `Enter`/`Space` khi focus vào ô), hệ thống PHẢI mở **Drawer chi tiết ô ma trận** (trượt từ cạnh phải trên desktop, modal trên mobile) mà không rời khỏi tab `FI Dashboard`.
- **R02.2** TRONG KHI Drawer ô `(team, month)` đang mở ở chế độ `Xét vào KHMT`, Drawer PHẢI hiển thị: tiêu đề `Đội · KHMT T{m}/{y}`, tổng số FI hiện có kèm trạng thái mức OKR (`Chưa có` / `Mức HT` / `Mức HT tốt`), trạng thái khóa kỳ (`Đang mở` / `Đã chốt`), mức đánh giá OKR của kỳ (nếu có), và danh sách đầy đủ các SK-CTKT đang được ghi nhận trong kỳ đó (mã SK, tiêu đề, tác giả, tiến độ hoàn thành, tháng đăng ký, nút `Xem chi tiết`).
- **R02.3** KHI người dùng có quyền gán KHMT cho đội đó (`Team_Account` có `team == ô.team`, hoặc `Admin` đang bật `Chỉnh sửa`) VÀ kỳ `(team, month, year)` **chưa bị chốt**, Drawer PHẢI hiển thị:
  - Thao tác **`Bỏ khỏi T{m}/{y}`** và **`Chuyển tháng`** trên từng SK đang nằm trong ô đó.
  - Khối **`Kho SK đã duyệt chưa vào KHMT của {team}`** (sắp xếp ưu tiên duyệt cũ nhất trước — khớp chiến lược `oldest_approved_first`, có ô lọc nhanh theo từ khóa) kèm nút 1 chạm **`+ Đưa vào T{m}/{y}`** trên từng SK.
- **R02.4** KHI thao tác `+ Đưa vào T{m}/{y}` hoặc `Bỏ khỏi T{m}/{y}` thành công, hệ thống PHẢI gửi kèm `expected_revision`, cập nhật ngay danh sách trong Drawer, cập nhật lại ô ma trận, cột `Tổng năm`, cột `Kho sẵn sàng` và các thẻ KPI mà không làm mất vị trí cuộn hoặc reload toàn trang.
- **R02.5** NẾU kỳ `(team, month, year)` đã chốt (`is_locked = true`), Drawer PHẢI vô hiệu hóa các nút thêm/bỏ/chuyển và hiển thị rõ lý do bằng chữ (*"Kỳ T{m}/{y} đã chốt. Cần Admin mở chốt tại Quản trị → Chốt KHMT & FI trước khi điều chỉnh."*). NẾU thao tác cạnh tranh gặp `409 PERIOD_LOCKED` hoặc `409 VERSION_CONFLICT`, Drawer PHẢI báo lỗi tiếng Việt rõ ràng và tải lại trạng thái mới nhất của ô.
- **R02.6** KHI người dùng bấm vào ô **`Kho sẵn sàng`** hoặc **`Chờ duyệt`** trên một hàng đội/tổ, Drawer PHẢI mở danh sách tương ứng của đội đó (kho SK đã duyệt chưa gán KHMT — có nút chọn tháng gán nhanh nếu đủ quyền; hoặc danh sách SK chờ duyệt — có nút mở thẳng tab `Xét duyệt SK-CTKT` lọc sẵn đội đó nếu là người duyệt).
- **R02.7** TRONG KHI Drawer đang mở, hệ thống PHẢI cung cấp nút **`Mở trong Lịch sử FI`** để chuyển sang tab `Lịch sử FI` với bộ lọc được điền sẵn đúng `(team, khmt=in, khmt_periods=YYYY-M)` (hoặc `registration_month/year` ở chế độ Đăng ký).

### R03 — Tính Nhất quán Số liệu, Biểu đồ & Xuất Excel trên FI Dashboard [P0]

*User story:* Là người xem báo cáo và quản lý xưởng, tôi muốn mọi con số trên `FI Dashboard`, `Lịch sử FI` và file Excel khớp tuyệt đối với nhau, không có biểu đồ cộng vượt 100% hay 2 tab báo 2 số khác nhau.

- **R03.1** KHI hiển thị biểu đồ Donut *Phân bố trạng thái xét duyệt* trên `FI Dashboard`, các lát cắt PHẢI là tập trạng thái loại trừ nhau hoàn toàn (`Đồng ý`, `Chờ xét duyệt`, `Xem xét sau`, `Không đồng ý / Đã hủy`) sao cho tổng giá trị các lát cắt LUÔN BẰNG đúng tổng SK ở tâm biểu đồ (`100%`). Hệ thống PHẢI KHÔNG trộn `completed_count` (tiến độ thực hiện) vào các lát cắt trạng thái xét duyệt.
- **R03.2** KHI hiển thị dải KPI tóm tắt trên `FI Dashboard`, giao diện PHẢI hiển thị đúng **4 thẻ cân đối** (4 cột trên desktop, 2×2 trên tablet, 1 cột trên mobile — không bị khuyết ô 3+2) đồng bộ với phạm vi đang chọn (`Năm {year}` hoặc `Tất cả các năm`):
  1. `Tổng SK-CTKT` (phụ: `{approved} đồng ý · {pending} chờ duyệt`)
  2. `Đã vào KHMT` (phụ: `{khmt_considered}/{approved} SK đạt · còn {unassigned_approved} kho sẵn sàng`)
  3. `Chờ xử lý` (phụ: `{pending} chờ duyệt · {deferred} xem xét sau`)
  4. `Tiến độ thực hiện` (phụ: `{completed_count}/{total} đã hoàn thành · {not_completed} đang thực hiện`)
- **R03.3** KHI hiển thị `FI Dashboard`, giao diện PHẢI loại bỏ khối thẻ xanh `KHMT theo tháng` trùng lặp và khối `Tóm tắt trạng thái` dư thừa ở cuối trang; nếu hiển thị biểu đồ cột theo tháng bổ trợ cho bảng ma trận, biểu đồ PHẢI giữ đủ 12 tháng `T1 → T12` (không nhảy cóc tháng trống) và phân tầng theo 4 đội/tổ.
- **R03.4** KHI tính số lượng *"chưa vào KHMT"* giữa `FI Dashboard` và `Lịch sử FI`, cả hai màn hình PHẢI hiển thị nhất quán số **`SK đạt chưa vào KHMT`** (`status IN ('Approved', 'Completed') AND consider_for_khmt = false`, ví dụ `22`) thay vì hiển thị `113 chưa vào` (gồm cả phiếu chưa duyệt/từ chối) gây hiểu nhầm.
- **R03.5** KHI người dùng bấm **`Xuất Excel`** từ `FI Dashboard` hoặc `Lịch sử FI`, workbook Excel xuất ra PHẢI có bảng **`Ma trận KHMT theo Đội/Tổ × Tháng (T1–T12)`** (gồm 4 đội/tổ, dòng Tổng Xưởng, `Tổng năm`, `Kho sẵn sàng`, `Chờ duyệt`) ngay trong sheet `Tong hop`, khớp đúng số liệu đang hiển thị trên UI.

### R04 — Đại tu Trải nghiệm `Lịch sử FI` & Sửa lỗi Gán KHMT [P1]

*User story:* Là nhân sự hoặc đội trưởng tra cứu kho sáng kiến, tôi muốn gõ từ khóa tìm nhanh theo mã thiết bị/mã SK, nhìn thấy ngay đội/tổ trên mỗi dòng, lọc kết hợp không bị mất bộ lọc cũ và gán tháng/năm KHMT không sợ gán nhầm tháng đã đủ.

- **R04.1** KHI người dùng mở tab `Lịch sử FI`, thanh công cụ PHẢI hiển thị ô **Tìm kiếm từ khóa** (`<input type="search">`) rõ ràng ở vị trí đầu tiên (tìm theo mã `sk_code`, tiêu đề, tác giả, nội dung; debounce `300ms`; có nút xóa nhanh) kết nối với tham số `q` của `GET /fi/history` và `GET /fi/reports/export`.
- **R04.2** KHI hiển thị danh sách bản ghi trong `Lịch sử FI`, MỖI dòng bản ghi PHẢI hiển thị rõ ràng **`sk_code`** và **badge `Đội/tổ`** ngay trên hàng đầu tiên cùng tiêu đề.
- **R04.3** KHI người dùng thay đổi bộ lọc `Đội/tổ` trên `Lịch sử FI`, hệ thống PHẢI giữ nguyên tất cả các bộ lọc khác đang áp dụng (`q`, `Năm`, `Tháng`, `Kết luận LĐX`, `KHMT`, `Kỳ KHMT`, `Hoàn thành`, `Tác giả`, `Người đăng ký`), không được xóa trắng bộ lọc khác.
- **R04.4** KHI kiểm tra quyền gán KHMT trong `visibleActionsForSk`, hệ thống PHẢI so sánh `item.team === (currentTeam ?? currentUserId)` đối với vai trò `Team_Account` (khớp với backend `_ensure_khmt_editable` và `canSelectKhmtMonth`), bảo đảm mọi tài khoản Đội/Tổ trưởng thật (`linhln`, `minhvq`, `haint`, `thanhdq`, ...) đều thấy và dùng được thao tác gán KHMT nhất quán trên mọi màn hình.
- **R04.5** KHI người dùng đủ quyền mở bộ chọn KHMT trên một dòng `Lịch sử FI` hoặc trong Drawer chi tiết, bộ chọn PHẢI:
  - Cho phép chọn **cả Tháng (`T1–T12`) và Năm** (không khóa cứng theo năm đăng ký để hỗ trợ SK cuối năm gán vào KHMT đầu năm sau).
  - Hiển thị ngay **số lượng FI hiện có của đội đó ở từng tháng đích** (ví dụ: `T8/2026 (1 FI)`, `T9/2026 (0 FI · chưa có)`, `T10/2026 (3 FI · đủ HT tốt)`), kèm biểu tượng `🔒` vô hiệu hóa các tháng đã chốt.
  - Lưu mượt trong 1 thao tác rõ ràng (xác nhận ngay trong popover hoặc tự lưu kèm toast thông báo có nút hoàn tác), loại bỏ tình trạng chọn dropdown xong quên bấm nút `Lưu` nhỏ bên cạnh.
- **R04.6** KHI hiển thị thanh thẻ thống kê nhanh và bộ lọc của `Lịch sử FI` trên desktop, hệ thống PHẢI căn chỉnh gọn gàng không để thẻ `Hoàn thành` mồ côi 1 mình trên hàng 2 (gộp hoặc căn lưới đều), sửa nhãn `/ 69 chưa xong` thành `69 chưa xong`, và căn giữa theo trục dọc cho chip `Năm`.

### R05 — Nâng cấp `Xét duyệt SK-CTKT`, `Đăng ký SK-CTKT` & Unified Detail Drawer [P1]

*User story:* Là đầu mối FI xét duyệt 60 phiếu tồn đọng hoặc kỹ thuật viên đăng ký sáng kiến mới, tôi muốn lọc hàng chờ theo đội/từ khóa, xem chi tiết phiếu ngay tại chỗ không phải cuộn xuống đáy trang, và đăng ký nhanh kể cả khi dán ảnh chụp từ Zalo.

- **R05.1** KHI người duyệt mở tab `Xét duyệt SK-CTKT`, giao diện PHẢI cung cấp thanh lọc gọn gồm: **ô tìm kiếm từ khóa**, **chip lọc nhanh theo `Đội/tổ`** hiển thị số phiếu chờ của từng đội (ví dụ: `Tất cả (60)`, `TCĐK (25)`, `TBĐL (21)`, `TBCH (7)`, `TBHTĐK (7)`), và **lọc theo tháng đăng ký**, giúp xử lý dứt điểm tồn đọng cho đội đang thiếu nguồn KHMT.
- **R05.2** KHI người dùng bấm vào một SK-CTKT ở tab `Đăng ký SK-CTKT`, `Xét duyệt SK-CTKT`, `FI Dashboard` hoặc từ **Chuông thông báo**, hệ thống PHẢI mở **Unified Detail Drawer** trượt bên phải (hoặc modal trên mobile) hiển thị ngay trước mắt: metadata, nội dung, ảnh bằng chứng (có phóng to Lightbox), thanh cập nhật tiến độ, bộ chọn KHMT (nếu đủ quyền), khung xét duyệt (nếu là người duyệt) và lịch sử xử lý — thay thế hoàn toàn thẻ `.fi-detail-card` nằm ở đáy trang.
- **R05.3** KHI mở tab `Đăng ký SK-CTKT` trên màn hình laptop/desktop (`≥ 1080px`), bố cục 2 cột (Form đăng ký bên trái + `Sáng kiến của tôi` / `Phiếu tôi đã gửi` bên phải) PHẢI hiển thị song song ổn định và KHÔNG bị giới hạn chiều cao cứng `340px` gây cuộn lồng chật chội.
- **R05.4** KHI người dùng đang nhập form đăng ký hoặc chỉnh sửa SK-CTKT, hệ thống PHẢI hỗ trợ:
  - **Dán ảnh trực tiếp từ Clipboard (`Ctrl+V`)** và kéo-thả file ảnh vào khu vực đính kèm.
  - **Nút chèn khung gợi ý 1 chạm** (*Hiện trạng / Giải pháp cải tiến / Hiệu quả dự kiến*) khi khung mô tả đang trống hoặc chèn bổ sung mà không xóa nội dung đã gõ.
- **R05.5** KHI người dùng đăng ký giúp đồng nghiệp (`Phiếu tôi đã gửi`), các phiếu đã được duyệt (`Approved`) PHẢI tiếp tục hiển thị trong mục con **`Đã duyệt – đang thực hiện`** (bên dưới mục `Đang chờ xử lý`) thay vì bị đẩy ẩn ngay vào lịch sử, giúp người gửi hộ theo dõi và cập nhật tiến độ thực hiện trực tiếp.

### R06 — Tối ưu Mobile, Admin `Chốt KHMT & FI` & Vệ sinh Hệ thống [P2]

*User story:* Là người dùng xem trên điện thoại tại xưởng hoặc Admin chốt KHMT cuối tháng, tôi muốn bảng không bị cắt cột, thanh điều hướng không che mất thẻ và hệ thống không bắn lỗi 403 ngầm.

- **R06.1** KHI xem `FI Dashboard` trên màn hình điện thoại (`320–430px`):
  - Người dùng PHẢI có thể chuyển giữa dạng **Bảng cuộn ngang (ghim cột `Đội/tổ`)** và dạng **Thẻ từng đội (lưới 4×3 từ T1 đến T12, không cần cuộn ngang)** — mặc định trên mobile ưu tiên dạng Thẻ từng đội dễ bấm ngón tay (`touch target ≥ 40×40px`).
  - Vùng nội dung cuối trang PHẢI có khoảng đệm dưới đủ lớn (`≥ 76px + safe-area-inset-bottom`) để thanh điều hướng đáy cố định KHÔNG che nội dung thẻ cuối.
  - Header và thanh tab trên mobile PHẢI hiển thị sạch, không cắt cụt chồng lấn nút và có dấu hiệu cuộn ngang rõ khi tab vượt màn hình.
- **R06.2** KHI Admin mở `Quản trị → Chốt KHMT & FI` trên màn hình `1280–1440px`, bảng danh sách 4 đội PHẢI hiển thị đủ tất cả các cột (kể cả `Đang gán kỳ này`, `Trạng thái`, `Thao tác`) không bị cắt ngang, loại bỏ nút `Tải lại` trùng lặp, và cung cấp liên kết chuyển nhanh tới/từ `FI Dashboard → Ma trận KHMT`.
- **R06.3** KHI người dùng không có quyền `Admin` truy cập URL `/Admin` (hoặc đăng nhập lại khi trình duyệt đang giữ đường dẫn `/Admin`), `App.tsx` PHẢI KHÔNG mount `<LazyAdminPanel />` và KHÔNG gửi bất kỳ request API `/admin/*` hoặc `/fi/reports` nào trước khi chuyển hướng.
- **R06.4** KHI chuẩn bị phát hành lên production, kế hoạch vận hành PHẢI bao gồm bước chạy kiểm tra **chỉ đọc (dry-run)** bằng `backend/scripts/revert_fi_auto_done.py` để báo cáo chính xác các bản ghi `Draft`/`Rejected` lịch sử đang còn `completed_at` cũ cho chủ sản phẩm quyết định áp dụng riêng (không tự động mutate production).

---

## 5. Quyết định đã được Chủ sản phẩm xác nhận (23/11/2026)

1. **Quyền xét duyệt của `Workshop_Leader` (`Quách Kía`):** **ĐÃ CHỐT — Giữ nguyên chỉ xem** (`Workshop_Leader: set()`). Cập nhật nhãn cột/bộ lọc UI chung từ `"Kết luận LĐX"` sang `"Kết luận xét duyệt"` để nhất quán với thực tế `FI_Coordinator`/`Admin` xét duyệt (giữ nguyên tên trường legacy `workshop_leader_conclusion` cho dữ liệu cũ).
2. **Tab mặc định khi mở `/FI`:** **ĐÃ CHỐT — Giữ nguyên thứ tự tab và tab mặc định theo vai trò như hiện tại** (`Đăng ký SK-CTKT` cho `Staff`/`Team_Account`, `Xét duyệt SK-CTKT` cho `FI_Coordinator`/`Admin`, `FI Dashboard` cho `Workshop_Leader`).
3. **Gán thủ công vượt/lệch định mức:** **ĐÃ CHỐT — Cho phép lưu (cảnh báo mềm), nhưng hiển thị dấu `!`** trên ô ma trận khi số FI lệch định mức báo cáo OKR (`shortage`/`excess`) hoặc vượt mức tối đa `3` FI/tháng (chỉ chặn cứng khi kỳ đã chốt `409 PERIOD_LOCKED`).
