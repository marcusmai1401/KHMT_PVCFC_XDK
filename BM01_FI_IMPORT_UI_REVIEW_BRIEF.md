# BM01 FI Import and UI Review Brief

Mục tiêu của review này: kiểm tra độc lập xem dữ liệu FI/SK-CTKT từ workbook BM01 đã được import đúng vào database chưa, và UI `Luồng SK-CTKT` đã thể hiện đúng thông tin KHMT/FI Dashboard chưa.

Không đưa mật khẩu SSH/VPS vào báo cáo review. Nếu cần truy cập production, dùng credential được cấp riêng qua kênh bảo mật.

## Phạm vi cần review

- Workbook nguồn mới: `BM 01 Dang ky - Danh gia SK.xlsx`.
- Workbook app dùng khi deploy: `FI xlsx/BM 01 Dang ky - Danh gia SK _Rev1.xlsx`.
- Deploy script hiện map workbook nguồn mới vào path app ở trên khi build/deploy production.
- Production URL: `http://103.200.20.225`.
- Production app path trên VPS: `/opt/okr-system`.

## Expected Source Parsing

Workbook có 4 sheet chính:

| Sheet Excel | Team DB | Tổng dòng | Approved | Deferred | Rejected | Submitted | Đã KHMT |
|---|---:|---:|---:|---:|---:|---:|---:|
| `TBCH` | `TBCH` | 24 | 12 | 6 | 4 | 2 | 6 |
| `TBĐ` | `TBĐL` | 14 | 11 | 0 | 0 | 3 | 8 |
| `TBHTĐK` | `TBHTĐK` | 18 | 15 | 2 | 0 | 1 | 8 |
| `TC- ĐK` | `TCĐK` | 29 | 14 | 5 | 2 | 8 | 13 |
| **Tổng** |  | **85** | **52** | **13** | **6** | **14** | **35** |

Expected KHMT by month:

| KHMT | Count |
|---|---:|
| T1/2026 | 8 |
| T2/2026 | 8 |
| T3/2026 | 10 |
| T4/2026 | 8 |
| T5/2026 | 1 |

Important invariant:

- `consider_for_khmt=true` chỉ hợp lệ khi `status in ('Approved', 'Completed')`.
- Expected count for invalid/non-approved KHMT rows: `0`.
- Sau fix ngày 2026-05-24, backend/UI/dashboard/count OKR phải dựa vào flag rõ ràng `consider_for_khmt`; không tự suy luận là đã vào KHMT chỉ vì có `khmt_month`/`khmt_year`.
- Nút gán KHMT trên UI không được hardcode `T4/2026`; Admin phải chọn được tháng/năm trước khi ghi nhận.
- `deploy_prod.py` mặc định reject SSH host key lạ; chỉ dùng `--accept-new-host-key` khi chủ động chấp nhận host key mới.

## Excel Mapping Rules

Parser/import phải đọc theo mapping cố định, không đoán cột tự do:

| Field | Column |
|---|---|
| Tháng đăng ký | `A` |
| Tác giả | `D` |
| Tên SK-CTKT | `E` |
| Nội dung | `F` |
| Kế hoạch hoàn thành | `K` |
| Xét duyệt/góp ý đầu mối SK | `M` |
| Kết luận LĐX | `N` với `TBCH`, `TBHTĐK`, `TC- ĐK` |
| KHMT | `O` với `TBCH`, `TBHTĐK`, `TC- ĐK`; riêng `TBĐ` dùng `N` |

Special case:

- Sheet `TBĐ` có header `Kết luận LĐX/Đã xem xét vào KHMT` ở cột `N`; cột này phải được xem là KHMT, không phải kết luận LĐX riêng.

Status rule:

- Cột `M` chứa `Đồng ý` -> `Approved`.
- Cột `M` chứa `Không đồng ý`, `Không đạt`, các biến thể không dấu/sai chính tả đã hỗ trợ -> `Rejected`.
- Cột `M` chứa `Xem xét sau` -> `Deferred`.
- Trống/không rõ -> `Submitted`.
- Negative markers phải được kiểm trước `Đồng ý` để không bắt nhầm `Không đồng ý`.

KHMT rule:

- `khmt_month/year`, `consider_for_khmt`, `is_counted_for_okr` chỉ set khi dòng đã `Approved` hoặc `Completed` và có tháng KHMT.
- Các dòng `Deferred`, `Rejected`, `Submitted` không được tính KHMT dù có text phụ trong workbook.

## Code Areas to Review

Backend:

- `backend/app/services/integration/bm01_import.py`
  - `preview_bm01`
  - `build_bm01_status_history`
  - `SHEET_KHMT_COLUMN`, `SHEET_LEADER_CONCLUSION_COLUMN`
- `backend/scripts/import_bm01_legacy_sheet.py`
  - CLI import legacy vào DB.
  - Phải dùng cùng helper `build_bm01_status_history`.
- `backend/app/services/fi/service.py`
  - `assign_khmt`
  - `fi_dashboard`
  - `_is_khmt_considered`
- `backend/app/api/routes/fi.py`
  - `GET /api/v1/fi/dashboard`
  - `POST /api/v1/fi/import/bm01/commit`
- Tests:
  - `backend/tests/integration/test_bm01_preview.py`
  - `backend/tests/unit/test_fi_service.py`
  - `backend/tests/integration/test_auth_fi_okr_regressions.py`

Frontend:

- `frontend/src/features/fi/FIWorkspace.tsx`
  - Tab `FI Dashboard`.
  - Helper `isKhmtConsidered`, `khmtLabel`.
  - `Lịch sử FI` row side: period, status, KHMT pill, actions.
  - Detail section shows `Đã xem xét vào KHMT`.
- `frontend/src/api/client.ts`
  - `fiDashboard()`.
- `frontend/src/styles.css`
  - `.fi-dashboard-*`
  - `.legacy-khmt-pill`
  - `.legacy-khmt-note`
- Tests:
  - `frontend/src/features/fi/FIWorkspace.test.ts`

Deploy:

- `deploy_prod.py`
  - Should not contain hard-coded SSH password.
  - Should build archive, backup production DB/storage, upload source, rebuild Docker, run migrations/import BM01, health check.
- `.gitignore`
  - `deploy_prod.py` should not be ignored anymore.

## Local Verification Commands

Run from repo root unless specified.

Parse target workbook:

```bash
cd backend
python3 - <<'PY'
from pathlib import Path
from collections import Counter, defaultdict
from app.services.integration.bm01_import import preview_bm01

preview = preview_bm01(Path("../BM 01 Dang ky - Danh gia SK.xlsx"))
print("row_count", preview["row_count"])
by_sheet = defaultdict(list)
for row in preview["rows"]:
    by_sheet[row["source_sheet"]].append(row)
for sheet, rows in by_sheet.items():
    print(sheet, len(rows), dict(Counter(r["status"] for r in rows)), "khmt", sum(r["consider_for_khmt"] for r in rows))
print("non_approved_khmt", sum(1 for r in preview["rows"] if r["consider_for_khmt"] and r["status"] not in {"Approved", "Completed"}))
PY
```

Expected:

```text
row_count 85
TBCH 24 {'Deferred': 6, 'Rejected': 4, 'Approved': 12, 'Submitted': 2} khmt 6
TBĐ 14 {'Approved': 11, 'Submitted': 3} khmt 8
TBHTĐK 18 {'Approved': 15, 'Deferred': 2, 'Submitted': 1} khmt 8
TC- ĐK 29 {'Approved': 14, 'Deferred': 5, 'Rejected': 2, 'Submitted': 8} khmt 13
non_approved_khmt 0
```

Run tests:

```bash
cd backend
python3 -m pytest -s tests/integration/test_bm01_preview.py tests/unit/test_fi_service.py tests/integration/test_auth_fi_okr_regressions.py::test_legacy_sk_is_history_and_can_be_reviewed_from_history -q

cd ../frontend
npm test -- --run src/features/fi/FIWorkspace.test.ts src/api/client.test.ts
npm run build
```

Known result from implementation pass:

- Backend targeted tests: `11 passed`.
- Frontend targeted tests: `23 passed`.
- Frontend build passes with only existing chunk-size warning.

## Production Verification Commands

Run on VPS:

```bash
cd /opt/okr-system
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1/health
```

Verify production DB counts:

```bash
cd /opt/okr-system
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend python - <<'PY'
from collections import Counter, defaultdict
from app.db.session import create_session
from app.models.domain import SKCTKTModel

with create_session() as db:
    rows = db.query(SKCTKTModel).all()
    print("total", len(rows))
    print("status", dict(Counter(r.status for r in rows)))
    print("khmt", sum(1 for r in rows if r.consider_for_khmt))
    print("non_approved_khmt", sum(1 for r in rows if r.consider_for_khmt and r.status not in {"Approved", "Completed"}))
    by_team = defaultdict(list)
    for r in rows:
        by_team[r.team].append(r)
    for team, team_rows in sorted(by_team.items()):
        print(team, len(team_rows), dict(Counter(r.status for r in team_rows)), "khmt", sum(1 for r in team_rows if r.consider_for_khmt))
PY
```

Expected production snapshot after deploy:

```text
total 85
status {'Approved': 52, 'Rejected': 6, 'Deferred': 13, 'Submitted': 14}
khmt 35
non_approved_khmt 0
TBCH 24 ... khmt 6
TBHTĐK 18 ... khmt 8
TBĐL 14 ... khmt 8
TCĐK 29 ... khmt 13
```

Verify API dashboard:

```bash
# Use a valid login token; do not paste secrets into reports.
curl -fsS http://127.0.0.1:8000/api/v1/fi/dashboard \
  -H "Authorization: Bearer <TOKEN>" | python3 -m json.tool
```

Dashboard totals should include:

- `totals.total = 85`
- `totals.approved = 52`
- `totals.deferred = 13`
- `totals.pending = 14`
- `totals.khmt_considered = 35`
- `khmt_by_month = T1:8, T2:8, T3:10, T4:8, T5:1`

## UI Review Checklist

Open production:

```text
http://103.200.20.225
```

Review `Luồng SK-CTKT`:

1. Có 3 tab:
   - `Đăng ký SK-CTKT`
   - `FI Dashboard`
   - `Lịch sử FI`
2. Tab `FI Dashboard` hiển thị:
   - Tổng SK.
   - Đã duyệt.
   - Xem xét sau.
   - Đã xét vào KHMT.
   - Hoàn thành/chưa hoàn thành.
   - Bảng theo đội/tổ với các cột tổng, đã duyệt, xem xét sau, chưa duyệt, KHMT, hoàn thành.
   - Block KHMT theo tháng.
3. Tab `Lịch sử FI`:
   - Có filter đội/tổ `TBCH`, `TBĐL`, `TBHTĐK`, `TCĐK`.
   - Có filter tháng đăng ký.
   - Mỗi row hiển thị status theo legacy:
     - `Approved` -> `Đồng ý`
     - `Deferred` -> `Xem xét sau`
     - `Rejected` -> `Không đồng ý`
     - `Submitted` -> `Chờ xét duyệt`
   - Kế bên pill status phải có pill KHMT:
     - Dòng có KHMT: `KHMT T<month>/2026`, màu success.
     - Dòng chưa KHMT: `Chưa vào KHMT`, màu neutral.
   - Các dòng `Xem xét sau`, `Không đồng ý`, `Chờ xét duyệt` không được hiển thị là đã KHMT.
4. Khi mở chi tiết một SK lịch sử:
   - Có field `Xét vào KHMT`.
   - Section `Đã xem xét vào KHMT` hiển thị đúng label.
   - Nếu dòng có KHMT, lịch sử xử lý có note `KHMT`/`khmt_legacy_note` hoặc dữ liệu tương đương trong `status_history`.
5. Tab `Đăng ký SK-CTKT`:
   - Danh sách xử lý không được lẫn các dòng `is_historical_import=true` theo mặc định.
   - SK hiện hành đã được gán KHMT hiển thị `KHMT T<month>/<year>` trong meta/detail.

## Spot Checks by Source Row

Nên kiểm ít nhất các dòng sau:

| Sheet row | Expected |
|---|---|
| `TBĐ!7` | `Approved`, team `TBĐL`, KHMT `T1/2026`; xác nhận sheet `TBĐ` đọc KHMT từ cột `N`. |
| `TBCH!11` | `Approved`, KHMT `T1/2026`. |
| `TBCH!7` | `Deferred`, không KHMT. |
| `TBCH!12` | `Rejected`, không KHMT. |
| `TBHTĐK!13` | `Approved`, KHMT `T4/2026`. |
| `TC- ĐK!26` | `Approved`, KHMT `T5/2026`. |
| `TC- ĐK!27` | `Submitted`, không KHMT. |

SQL/API query idea:

```bash
cd /opt/okr-system
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend python - <<'PY'
from app.db.session import create_session
from app.models.domain import SKCTKTModel

checks = [("TBĐ", 7), ("TBCH", 11), ("TBCH", 7), ("TBCH", 12), ("TBHTĐK", 13), ("TC- ĐK", 26), ("TC- ĐK", 27)]
with create_session() as db:
    for sheet, row in checks:
        r = db.query(SKCTKTModel).filter_by(bm01_source_sheet=sheet, bm01_source_row=row).one_or_none()
        print(sheet, row, None if r is None else {
            "team": r.team,
            "status": r.status,
            "khmt": (r.khmt_month, r.khmt_year),
            "consider_for_khmt": r.consider_for_khmt,
            "is_counted_for_okr": r.is_counted_for_okr,
        })
PY
```

## Deployment Notes to Validate

Latest production deploy completed with:

- Backup DB: `/backup/okr/okr_20260523235850.sql.gz`
- Backup storage: `/backup/okr/storage_20260523235850.tar.gz`
- Backend and frontend rebuilt.
- Alembic was stamped to `0004_historical_snapshots` because production schema already existed from previous `create_all`/legacy initialization. This should be explicitly checked before future schema changes.
- BM01 import command updated existing 85 rows, not inserted duplicates.

Important deployment script expectations:

- `deploy_prod.py` should prompt for SSH password or read `VPS_PASSWORD`.
- It must not store the password in source code.
- It creates backup before extracting source.
- It maps root `BM 01 Dang ky - Danh gia SK.xlsx` into `FI xlsx/BM 01 Dang ky - Danh gia SK _Rev1.xlsx` in the deployment archive.

## Review Output Requested

Ask the reviewing agent to return:

1. Whether backend parser/import matches workbook exactly.
2. Whether DB production counts and row-level spot checks match expected values.
3. Whether KHMT rule is enforced correctly.
4. Whether FI Dashboard API and UI totals match DB.
5. Whether `Lịch sử FI` UI clearly shows KHMT beside status and in detail view.
6. Any regressions, missing tests, or risky assumptions.
7. Exact file/line references for any findings.
