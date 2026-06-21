# Hệ thống Tự động hóa OKR — Xưởng Điều khiển

## Hệ thống này dùng để làm gì?

Hệ thống này giúp **tự động hóa** quy trình báo cáo và đánh giá OKR (Kế hoạch Mục tiêu) hàng tháng cho Xưởng Điều khiển, thay vì phải làm thủ công bằng Excel như trước đây.

Hệ thống gồm **2 module chính**:

### Module 1: Tự động hóa Báo cáo OKR

- Nhận file Excel báo cáo tháng từ 4 đội/tổ (TBHTĐK, TBCH, TBĐL, TCĐK)
- Tự động đọc, kiểm tra và trích xuất dữ liệu từ file báo cáo
- Tự động tổng hợp vào bảng Data (142 dòng × 16 cột)
- Tạo Dashboard đánh giá với ma trận 37 chỉ tiêu (KR) cho 4 đội/tổ
- Cảnh báo các lỗi sai sót, dữ liệu bất thường trước khi hoàn tất báo cáo
- Theo dõi hạn nộp báo cáo (ngày 25 hàng tháng)

### Module 2: Đăng ký Sáng kiến - Cải tiến Kỹ thuật (SK-CTKT)

- Đăng ký sáng kiến qua web form (không cần file Excel)
- Quy trình xét duyệt tự động: Đăng ký → Xem xét → Phê duyệt/Từ chối
- Thông báo tự động cho người đăng ký khi có thay đổi trạng thái
- Xem danh sách sáng kiến đã được phê duyệt công khai

---

## Đối tượng sử dụng

Hệ thống phục vụ **55 nhân sự** của Xưởng Điều khiển:

| Nhóm | Số người | Vai trò trong hệ thống |
|------|----------|----------------------|
| Đội TBHTĐK (Thiết bị Hệ thống Điều khiển) | 10 | Đăng ký SK-CTKT, xem báo cáo |
| Đội TBCH (Thiết bị Chấp hành) | 14 | Đăng ký SK-CTKT, xem báo cáo |
| Đội TBĐL (Thiết bị Đo lường) | 12 | Đăng ký SK-CTKT, xem báo cáo |
| Tổ TCĐK (Tổ trực ca) | 14 | Đăng ký SK-CTKT, xem báo cáo |
| Nhóm Xưởng (Lãnh đạo + nhân sự) | 5 | Quản trị, phê duyệt, không nằm trong ma trận OKR |

---

## Các vai trò trong hệ thống

| Vai trò | Ai | Quyền hạn |
|---------|-----|-----------|
| **Admin** | Người quản trị hệ thống | Upload file báo cáo, quản lý template, điều chỉnh dữ liệu, xuất báo cáo |
| **Workshop_Leader** | Lãnh đạo Xưởng (LĐX) | Phê duyệt/từ chối sáng kiến, xem Dashboard tổng hợp |
| **FI_Coordinator** | Đầu mối SK | Xem xét, góp ý sáng kiến trước khi trình LĐX |
| **Team_Account** | Tài khoản từng đội/tổ | Đăng ký sáng kiến, xem dữ liệu công khai |

---

## Các trang trong hệ thống

Sau khi đăng nhập, hệ thống có các trang chính:

| Trang | Mô tả | Ai được xem |
|-------|-------|-------------|
| **OKR Dashboard** | Xem bảng tổng hợp đánh giá OKR 37 chỉ tiêu cho 4 đội/tổ | Tất cả |
| **Tiêu chí đánh giá** | Xem bảng tiêu chí đánh giá OKR | Tất cả |
| **Nguyên tắc đánh giá** | Xem các nguyên tắc đánh giá (NTĐG) | Tất cả |
| **SK-CTKT Workflow** | Đăng ký, xem xét, phê duyệt sáng kiến | Tất cả (theo quyền) |
| **Admin Console** | Quản lý hệ thống: upload file, điều chỉnh dữ liệu, xuất báo cáo | Chỉ Admin |

---

## Quy trình xử lý OKR hàng tháng

```
4 đội/tổ nộp file Excel
        ↓
Admin upload file lên hệ thống
        ↓
Hệ thống tự động kiểm tra format
        ↓
Hệ thống trích xuất dữ liệu (có thể dùng AI)
        ↓
Hệ thống cảnh báo lỗi/nếu có → Admin duyệt và điều chỉnh
        ↓
Hệ thống tổng hợp vào bảng Data (142 dòng × 16 cột)
        ↓
Hệ thống tạo Dashboard đánh giá (37 KR × 4 đội/tổ)
        ↓
LĐX xem Dashboard và đánh giá tổng thể
        ↓
Xuất file Excel báo cáo hoàn chỉnh
```

---

## Quy trình SK-CTKT

```
Nhân viên đăng ký sáng kiến qua web form
        ↓
Trạng thái: "Đã gửi" → Đầu mối SK nhận thông báo
        ↓
Đầu mối SK xem xét, góp ý
    ├── Cần bổ sung → Trả lại cho người đăng ký
    └── Đạt yêu cầu → Trạng thái: "Đã xem xét" → LĐX nhận thông báo
        ↓
LĐX phê duyệt
    ├── Phê duyệt → Công khai, có thể ghi nhận vào KHMT
    ├── Từ chối → Ghi rõ lý do
    └── Hoãn/Lưu → Ghi rõ lý do
```

---

## Cấu trúc thư mục

```
KHMT Hàng tháng/
├── backend/                        ← Phần xử lý dữ liệu phía máy chủ
│   ├── app/
│   │   ├── api/routes/             ← Các đường dẫn API (đăng nhập, OKR, SK-CTKT, quản trị)
│   │   ├── core/                   ← Cấu hình hệ thống và bảo mật
│   │   ├── models/                 ← Định dạng dữ liệu lưu trong cơ sở dữ liệu
│   │   ├── services/               ← Xử lý nghiệp vụ chính
│   │   │   ├── okr/                ← Xử lý báo cáo OKR, trích xuất, dashboard
│   │   │   ├── fi/                 ← Xử lý quy trình SK-CTKT
│   │   │   └── llm/                ← Tích hợp AI (tùy chọn)
│   │   └── main.py                 ← Điểm khởi chạy backend
│   ├── tests/                      ← Bộ kiểm thử tự động
│   ├── alembic/                    ← Quản lý thay đổi cấu trúc cơ sở dữ liệu
│   └── pyproject.toml              ← Danh sách thư viện Python
│
├── frontend/                       ← Phần giao diện người dùng
│   ├── src/
│   │   ├── app/App.tsx             ← Giao diện chính (đăng nhập, điều hướng)
│   │   ├── features/okr/           ← Giao diện Dashboard OKR
│   │   ├── features/fi/            ← Giao diện đăng ký SK-CTKT
│   │   ├── features/admin/         ← Giao diện Admin
│   │   └── api/client.ts           ← Kết nối giữa giao diện và máy chủ
│   └── package.json                ← Danh sách thư viện Node.js
│
├── docs/                           ← Tài liệu kỹ thuật
│   ├── Huong_dan_API.md            ← Hướng dẫn tích hợp API AI
│   ├── Debug_finding.md            ← Ghi chú lỗi tìm được
│   └── findings-okr-analysis.md    ← Phân tích dữ liệu OKR
│
├── specs/                          ← Đặc tả yêu cầu hệ thống
│   └── okr-automation-system/
│       ├── requirements.md         ← 21 yêu cầu chi tiết với tiêu chí chấp nhận
│       ├── design.md               ← Thiết kế hệ thống
│       └── tasks.md                ← Danh sách công việc cần làm
│
├── template_xlsx/                  ← Các file Excel mẫu cho 4 đội/tổ
│   ├── OKR_Workshop.xlsx           ← Bảng mapping 37 KR chuẩn
│   ├── TBCH.xlsx                   ← Mẫu cho Đội TBCH
│   ├── TBĐL.xlsx                   ← Mẫu cho Đội TBĐL
│   ├── TBHTĐK.xlsx                 ← Mẫu cho Đội TBHTĐK
│   └── TCĐK.xlsx                   ← Mẫu cho Tổ TCĐK
│
├── storage/                        ← Dữ liệu hệ thống lưu trữ
│   ├── uploads/                    ← File báo cáo đã upload
│   ├── exports/                    ← File báo cáo đã xuất
│   └── backups/                    ← Bản sao lưu
│
├── infra/                          ← Cấu hình hạ tầng triển khai
│   └── docker-compose.yml          ← Cấu hình PostgreSQL + Redis
│
├── OKR tháng 04-2026 - X.ĐK.xlsx  ← File nguồn 37 KR mapping
├── BM 01 Dang ky - Danh gia SK _Rev1.xlsx ← File lịch sử SK-CTKT
├── TONG_HOP_SAI_SOT_KHMT_OKR_2026.md     ← Tổng hợp lỗi đã sửa trong OKR
└── README.md                       ← Tài liệu này
```

---

## Công nghệ sử dụng

| Thành phần | Công nghệ | Vai trò |
|------------|-----------|---------|
| Backend | Python 3.11 + FastAPI | Xử lý dữ liệu, API |
| Frontend | React + TypeScript + Vite | Giao diện người dùng |
| Cơ sở dữ liệu | SQLite (dev) / PostgreSQL (deploy) | Lưu trữ dữ liệu |
| Cache | Redis (tùy chọn) | Tăng tốc truy xuất |
| AI | OpenAI-compatible API (danglamgiau.com) | Trích xuất dữ liệu tự động |
| Xác thực | JWT + bcrypt | Đăng nhập, phân quyền |
| Container | Docker + Docker Compose | Triển khai hạ tầng |

---

## Quy trình làm việc và tự động deploy

Repo này đã cấu hình GitHub Actions để tự động kiểm tra và deploy production.

### Nguyên tắc nhánh

- `main` là nhánh production. Code đã merge vào `main` sẽ được deploy lên VPS production sau khi CI pass.
- Không làm việc trực tiếp trên `main` nếu là thay đổi có rủi ro.
- Mỗi task nên tạo branch riêng từ `main`, ví dụ:
  - `feature/fi-dashboard`
  - `fix/khmt-display`
  - `hotfix/login-error`

### Quy trình chuẩn cho team

```
git checkout main
git pull origin main
git checkout -b feature/ten-task
        ↓
code + test local
        ↓
git push origin feature/ten-task
        ↓
tạo Pull Request vào main
        ↓
GitHub Actions chạy Frontend CI + Backend CI
        ↓
review code, sửa nếu cần
        ↓
merge Pull Request vào main
        ↓
GitHub Actions chạy CI lại và Deploy Production
        ↓
kiểm tra production
```

### GitHub Actions đang làm gì?

Workflow chính nằm ở `.github/workflows/deploy-production.yml`.

Khi tạo Pull Request vào `main`:

- Chạy test frontend.
- Build frontend.
- Chạy test backend.
- Không deploy production.

Khi push hoặc merge vào `main`:

- Chạy test frontend.
- Build frontend.
- Chạy test backend.
- Nếu tất cả pass, tự động deploy lên VPS.

Production hiện chạy tại:

```text
http://xdk-pvcfc.com/
```

Health check:

```text
http://xdk-pvcfc.com/health
```

IP VPS dự phòng khi DNS chưa cập nhật:

```text
http://103.200.20.225/
```

### Khi nào cần deploy thủ công?

Thông thường không cần deploy thủ công nữa. Nếu cần chạy lại deploy cho cùng một commit:

Chạy bằng script:

```bash
./deploy_github_actions.sh --watch
```

Nếu cần import lại BM01 legacy trong lúc deploy:

```bash
./deploy_github_actions.sh --import-bm01 --watch
```

Script này chỉ kích hoạt GitHub Actions, không lưu password VPS trong máy. Cần cài GitHub CLI và đăng nhập trước bằng `gh auth login`.

Hoặc chạy trên giao diện GitHub:

1. Vào GitHub repo.
2. Mở tab `Actions`.
3. Chọn workflow `CI and Production Deploy`.
4. Bấm `Run workflow`.

Các tùy chọn thủ công:

- `import_bm01`: mặc định tắt, chỉ bật khi muốn import lại dữ liệu BM01 legacy.
- `reset_user_passwords`: mặc định tắt, chỉ bật khi thật sự muốn reset password các user seed.

### GitHub Secrets production

Deploy dùng GitHub Environment `production` và các secret sau:

| Secret | Ý nghĩa |
|--------|---------|
| `VPS_HOST` | IP VPS production |
| `VPS_PORT` | Port SSH |
| `VPS_USER` | User SSH |
| `VPS_PASSWORD` | Password SSH |
| `VPS_REMOTE_DIR` | Thư mục deploy trên VPS, hiện là `/opt/okr-system` |
| `VPS_HOST_KEY` | Khuyến nghị, dùng xác thực SSH host key |

Không commit password, `.env.production`, private key hoặc thông tin nhạy cảm vào repo.

Chi tiết thêm: `docs/GITHUB_ACTIONS_DEPLOY.md`.

---

## Dữ liệu tự động nạp khi khởi động lần đầu

- **37 KR mapping** — bảng mapping chuẩn cho 6 Objectives (O1–O6), đọc từ file `OKR tháng 04-2026 - X.ĐK.xlsx`
- **Tài khoản mẫu** — 7 tài khoản cho admin, lãnh đạo, đầu mối SK, 4 đội/tổ
- **Sĩ số cơ bản** — TBHTĐK=10, TBCH=14, TBĐL=12, TCĐK=14, Xưởng=5
- **Danh sách miễn trừ VHDN** — Phạm Văn Tuyên (TBCH), Lê Bá Tứ (TBHTĐK)
- **Template báo cáo chuẩn** — 16 cột dữ liệu theo format quy định
- **Cấu hình hệ thống** — hạn nộp báo cáo ngày 25, kênh thông báo trong hệ thống

---

## Quy mô dữ liệu OKR

| Hạng mục | Chi tiết |
|----------|----------|
| Số Objectives | 6 (O1 → O6) |
| Tổng số Key Results | 37 KR |
| O1 — An toàn | 3 KR |
| O2 — Sửa chữa đột xuất | 6 KR |
| O3 — Bảo dưỡng định kỳ | 3 KR |
| O4 — Nâng cao năng lực | 6 KR |
| O5 — Quản lý & Cải tiến | 15 KR |
| O6 — Đo lường & Kiểm tra | 4 KR |
| Bảng Data tổng hợp | 142 dòng × 16 cột |
| Đội/tổ đánh giá trên Dashboard | 4 (TBHTĐK, TBCH, TBĐL, TCĐK) |

---

## Các file Excel đi kèm

| File | Mô tả |
|------|-------|
| `OKR tháng 04-2026 - X.ĐK.xlsx` | Bảng mapping 37 KR chuẩn của Xưởng Điều khiển, dùng làm nguồn seed dữ liệu |
| `BM 01 Dang ky - Danh gia SK _Rev1.xlsx` | File lịch sử đăng ký và đánh giá SK-CTKT, dùng import dữ liệu cũ vào hệ thống |
| `template_xlsx/*.xlsx` | Các file mẫu cho từng đội/tổ điền báo cáo hàng tháng |
