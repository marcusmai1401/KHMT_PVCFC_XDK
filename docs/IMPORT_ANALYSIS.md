# KHMT Import Analysis - Findings & Import Plan

> **Ngày tạo**: 2026-05-14
> **Mục tiêu**: Import dữ liệu KHMT tháng 1-4 (T1-T4) vào hệ thống để dashboard hiển thị lịch sử, đảm bảo nếu T5 chưa update thì dashboard vẫn hiển thị được data T4.

## 0. Quyết định đã chốt sau khi rà soát với user

### 0.1. Nguyên tắc import

- Website/dashboard phải hiển thị theo cấu trúc cố định của hệ thống, không phụ thuộc layout Excel gốc.
- Tool import được phép dò động theo nhãn, header, tên đội/tổ, tháng báo cáo và source cell; mục tiêu là lấy đúng dữ liệu để đưa lên dashboard web.
- T1, T2, T3 lấy dữ liệu từ 3 file gốc chưa chuẩn hóa trong `KHMT_T1_T2_T3_T4/`.
- T4 là tháng đã được user chuẩn hóa kỹ hơn theo template chung; dữ liệu đội/tổ T4 ưu tiên đọc từ `template_xlsx/` khi import team reports.
- Các template T4 hiện có: `template_xlsx/TBHTĐK.xlsx`, `template_xlsx/TBCH.xlsx`, `template_xlsx/TBĐL.xlsx`, `template_xlsx/TCĐK.xlsx`; `template_xlsx/OKR_Workshop.xlsx` là template cấp xưởng.
- Sheet `data` còn một số block chưa chắc mapping KR; trước mắt không coi các block chưa xác nhận là blocker. Ưu tiên lấy dữ liệu từ report đội/tổ và Dashboard.
- T1/T2 chưa có block năng lực `data!A135:B142` là đúng nghiệp vụ; năng lực bắt đầu xây dựng từ T3/T4.

### 0.2. Chuẩn hóa tên đội/sheet

- Thống nhất dùng team code hệ thống:
  - `TBHTĐK`
  - `TBCH`
  - `TBĐL`
  - `TCĐK`
- `HTĐK` trong file T3 phải được hiểu là `TBHTĐK`.
- `TBĐ` trong file gốc phải được hiểu là `TBĐL`.
- `TCDK` và `TCĐK` đều phải được hiểu là `TCĐK`.

### 0.3. Đánh giá chung và kỷ luật

- Các đội/tổ tự đánh giá, nên ô `Đánh giá chung tháng`/`Kết luận chung` trong report đội/tổ là nguồn hợp lệ.
- Trường hợp T4 `TBĐL` bị `Không HT` trên Dashboard dù team summary ghi `HOÀN THÀNH` là do yếu tố kỷ luật: `Một nhân sự Đội TBĐL không tuân thủ quy định giờ công`.
- Trường hợp T4 `TBCH` bị `Không HT` do yếu tố kỷ luật: `Một nhân sự Đội TBCH không tuân thủ đúng HDBD trong quá trình thực hiện công việc bảo dưỡng định kỳ thiết bị Quan trắc`.
- Website đã có cột/thông tin kỷ luật, nên import cần lưu được `discipline_status` và `discipline_description`, không chỉ dựa vào KR matrix.

### 0.4. Mã KR trong file gốc

- File gốc T1-T3 có nhiều mã KR đội/tổ bị nhập ẩu, một ô có thể chứa cả mã cấp xưởng và mã cấp đội/tổ khác nhau.
- Khi import, không tự suy luận lại theo Excel gốc nếu trái với rules hiện tại trong codebase và các template đã được user chỉnh chuẩn.
- Quy tắc triển khai: theo rules hiện tại của repo, nhưng cần ưu tiên mapping theo template chuẩn và tên KR/master mapping khi mã trong Excel gốc mâu thuẫn.

### 0.5. Ghi chú file

- T1 sheet `TBĐ` có tiêu đề ghi nhầm `THÁNG 2`; thực tế thuộc tháng 1.
- T4 file lớn chủ yếu do ảnh nhúng. Import chỉ cần dữ liệu; ảnh/embedded objects không phải trọng tâm giai đoạn này.

---

## 1. Tổng quan kiến trúc hệ thống

### 1.1. Stack công nghệ
- **Backend**: Python/FastAPI + SQLAlchemy + SQLite
- **DB Path**: `storage/okr_automation.db` (SQLite)
- **Frontend**: React/TypeScript + Vite
- **Config**: `backend/app/core/config.py` → `Settings` class

### 1.2. Luồng dữ liệu hiện tại

```
Excel Upload → parse_team_report() → TeamReportModel (DB)
                                     ↓
Historical Snapshot Import → HistoricalSnapshotModel (DB)
                                     ↓
Dashboard API → build_dashboard_view() → Kết hợp TeamReports + Snapshots → UI
```

### 1.3. Period Resolution (Fallback Logic)

**File**: `backend/app/services/okr/period_resolver.py:37-54`

Khi user mở dashboard, hệ thống resolve tháng hiển thị theo thứ tự ưu tiên:
1. `last_selected` — tháng user chọn lần trước (frontend gửi lên)
2. **`latest_data`** — tháng có data mới nhất trong DB (team_reports + historical_snapshots)
3. `workbook` — tháng từ snapshot import gần nhất
4. `current` — tháng hiện tại (today)

→ **Đây là logic chính giúp fallback**: Nếu T5 chưa có data, `find_latest_data_period()` sẽ tìm thấy T4 (nếu đã import) và dashboard sẽ hiển thị T4.

**Chứng cứ code** — `period_resolver.py:64-83`:
```python
def find_latest_data_period(db: Session) -> tuple[int, int] | None:
    # Query cả TeamReportModel VÀ HistoricalSnapshotModel
    # Lấy max(month, year) → trả về tháng có data mới nhất
    return _latest_tuple([(int(month), int(year)) for month, year in [*report_rows, *snapshot_rows]])
```

---

## 2. Phân tích 4 file Excel nguồn

### 2.1. Danh sách file

| # | File | Size | Sheets / ghi chú |
|---|------|------|------------------|
| 1 | `OKR tháng 01-2026 - X.ĐK.xlsx` | 835 KB | `Dashboard`, `data`, `TBHTĐK`, `TBCH`, `TBĐ`, `TCDK`, reference sheets |
| 2 | `OKR tháng 02-2026 - X.ĐK.xlsx` | 850 KB | `Dashboard`, `data`, `TBHTĐK`, `TBĐ`, `TBCH`, `TCĐK`, reference sheets |
| 3 | `OKR tháng 03-2026 - X.ĐK.xlsx` | 902 KB | `Dashboard`, `data`, `HTĐK`, `TBCH`, `TBĐ`, `TCĐK`, reference sheets. `HTĐK` phải normalize thành `TBHTĐK`. |
| 4 | `OKR tháng 04-2026 - X.ĐK.xlsx` | 12.2 MB | `data`, `Dashboard`, `TBHTĐK`, `TBCH`, `TBĐL`, `TCĐK`, reference sheets. File lớn chủ yếu do ảnh nhúng; dữ liệu đội/tổ T4 ưu tiên template đã chuẩn hóa trong `template_xlsx/`. |

### 2.2. Sheets có trong mỗi file

| Sheet | Hàng | Cột | Vai trò | Có import không? |
|-------|------|-----|---------|-----------------|
| `Dashboard` | ~247-282 | ~50 | Bảng tổng hợp đánh giá + KPI phân bổ + lũy kế 12 tháng | ✅ Import historical snapshot, dò động vùng lũy kế |
| `data` | ~130-142 | 16 | Dữ liệu biểu đồ: SCĐX, STOP, Training, VHDN, SK, competency từ T3 | ✅ Import confirmed blocks; block chưa map KR để sau |
| `TBHTĐK`/`HTĐK` | ~807 | 15-25 | Báo cáo team TBHTĐK | ✅ Import team report; `HTĐK` = `TBHTĐK` |
| `TBCH` | ~47 | 22-28 | Báo cáo team TBCH | ✅ Import team report |
| `TBĐ`/`TBĐL` | ~42 | 16 | Báo cáo team TBĐL | ✅ Import team report; T1 title ghi nhầm tháng 2 nhưng thuộc T1 |
| `TCDK`/`TCĐK` | ~50 | 18 | Báo cáo team TCĐK | ✅ Import team report |
| `OKR X.ĐK 2026` | ~818 | 23 | Master OKR plan (reference) | ❌ Không import (đã dùng cho KR mapping) |
| `TCĐG` | ~10 | 3 | Tiêu chí đánh giá | ❌ Không import (reference) |
| `NTĐG` | ~17 | 9 | Nguyên tắc đánh giá | ❌ Không import (reference) |
| `OKR X.ĐK 2025 Nội bộ` | ~813 | 47 | OKR 2025 (old) | ❌ Không import |
| `OKR X.ĐK 2025 X.ĐK` | ~930 | 21 | OKR 2025 (old) | ❌ Không import |

---

## 3. Chi tiết cấu trúc từng sheet cần import

### 3.1. Sheet `Dashboard` — Historical Snapshot

#### 3.1.1. Vùng đánh giá chung (rows 8-11)

**Chứng cứ** — File T1, `Dashboard` sheet:
```
R8:  C1:Tổ trực ca                    | C6:14 | C8:Hoàn thành tốt | C12:#N/A | C13:OK | C14:OK | C15:OK | C16:OK | C17:OK | C18:#N/A | C19:OK
R9:  C1:Đội thiết bị hệ thống điều khiển | C6:10 | C8:Hoàn thành      | C12:OK   | C13:OK | C14:OK | C15:OK | C16:OK | C17:#N/A | C18:OK | C19:OK
R10: C1:Đội thiết bị đo              | C6:12 | C8:Hoàn thành tốt | C12:OK   | C13:OK | C14:OK | C15:OK | C16:OK | C17:#N/A | C18:OK | C19:OK
R11: C1:Đội thiết bị cơ cấu chấp hành | C6:14 | C8:Hoàn thành      | C12:OK   | C13:OK | C14:OK | C15:OK | C16:OK | C17:#N/A | C18:OK | C19:OK
```

- **C1**: Tên đội/tổ
- **C6**: Headcount
- **C8**: Monthly assessment (Đánh giá chung tháng)
- **C10-C11**: KPI allocation (A2, A1 counts)
- **C12-C29**: KR status matrix (O1.KR1 → O6.KR4)

#### 3.1.2. Vùng lũy kế 12 tháng

**Chứng cứ** — File T1, `Dashboard` sheet:
```
R22: C1:LŨY KẾT KẾT QUẢ THỰC HIỆN KẾ HOẠCH MỤC TIÊU NĂM 2026 CỦA ĐỘ
R23: C1:Đội/Tổ | C6:Tháng 1 | C8:Tháng 2 | C10:Tháng 3 | C12:Tháng 4 | ...
R24: C1:Tổ trực ca                        | C6:HT tốt
R25: C1:Đội thiết bị hệ thống điều khiển | C6:HT
R26: C1:Đội thiết bị đo                  | C6:HT tốt
R27: C1:Đội thiết bị cơ cấu chấp hành    | C6:HT
```

**Chứng cứ** — File T2, `Dashboard` sheet (có data T1 + T2):
```
R24: C1:Tổ trực ca                        | C6:HT tốt | C8:HT tốt
R25: C1:Đội thiết bị hệ thống điều khiển | C6:HT     | C8:HT
R26: C1:Đội thiết bị đo                  | C6:HT tốt | C8:HT
R27: C1:Đội thiết bị cơ cấu chấp hành    | C6:HT     | C8:HT tốt
```

**Chứng cứ bổ sung** — File T4, `Dashboard` sheet:
```
R20: C1:LŨY KẾ KẾT QUẢ THỰC HIỆN KẾ HOẠCH MỤC TIÊU NĂM 2026 CỦA ĐỘI/TỔ
R21: C1:Đội/Tổ | C6:Tháng 1 | C8:Tháng 2 | C10:Tháng 3 | C12:Tháng 4 | ...
R22: C1:Tổ trực ca                        | C6:HT tốt | C8:HT tốt | C10:HT tốt | C12:HT tốt
R23: C1:Đội thiết bị hệ thống điều khiển | C6:HT     | C8:HT     | C10:HT tốt | C12:HT tốt
R24: C1:Đội thiết bị đo                  | C6:HT tốt | C8:HT     | C10:HT tốt | C12:Không HT
R25: C1:Đội thiết bị cơ cấu chấp hành    | C6:HT     | C8:HT tốt | C10:Không HT | C12:Không HT
```

→ Không được hard-code row. T1-T3 dùng rows 22-27, nhưng T4 dùng rows 20-25. Tool import phải tìm row header `Đội/Tổ`, sau đó đọc 4 dòng đội/tổ ngay bên dưới.

**Mapping cột → tháng**:
| Cột | Tháng |
|-----|-------|
| C6  | T1    |
| C8  | T2    |
| C10 | T3    |
| C12 | T4    |
| C14 | T5    |
| C16 | T6    |
| C18 | T7    |
| C20 | T8    |
| C22 | T9    |
| C24 | T10   |
| C26 | T11   |
| C28 | T12   |

→ Công thức cột tháng vẫn đúng: `col = 6 + ((month - 1) * 2)` → khớp với code `historical_snapshot.py:96`

**Mapping tên đội → team code** (xác nhận từ `team_normalizer.py`):
| Tên trong Excel | Team code |
|----------------|-----------|
| Tổ trực ca | TCĐK |
| Đội thiết bị hệ thống điều khiển | TBHTĐK |
| Đội thiết bị đo | TBĐL |
| Đội thiết bị cơ cấu chấp hành | TBCH |

#### 3.1.3. Vùng KPI Allocation (rows 4-6, 15, 17-20)

**Chứng cứ** — File T1:
```
R4:  C2:Được Phân bổ | C4:Đã phân bổ | C6:Còn lại
R5:  C1:A2 | C2:6 | C4:0 | C6:6
R6:  C1:A1 | C2:2 | C4:0 | C6:2 | C10:Phân bổ | C12:O1 | C15:O2
R15: C1:Tổng nhân sự | C6:54
```

→ Dữ liệu này dùng cho KPI allocation calculations, không cần import riêng.

#### 3.1.4. Parsing logic hiện tại

**File**: `backend/app/services/okr/historical_snapshot.py:151-178`

```python
def _parse_dashboard_history(db, workbook, result, *, source_file_name, imported_by):
    sheet = workbook["Dashboard"]
    year = _source_year(workbook)  # Tìm năm từ A20 hoặc A1
    for row in range(22, 26):      # Rows 22-25 (4 đội)
        source_label = str(sheet.cell(row, 1).value or "").strip()
        team, original_label = normalize_team_label(source_label)
        for month, col in _dashboard_month_columns():  # C6, C8, ..., C28
            assessment = str(sheet.cell(row, col).value or "").strip()
            if not assessment:
                continue
            _upsert_snapshot(...)  # → historical_snapshots table
```

**⚠️ Vấn đề**: Code đọc `range(22, 26)` = rows 22, 23, 24, 25. Thực tế:
- T1-T3: data ở rows 24, 25, 26, 27.
- T4: data ở rows 22, 23, 24, 25.

**Chứng cứ**:
- T1: R22 = "LŨY KẾT KẾT QUẢ...", R23 = "Đội/Tổ | Tháng 1 | ...", R24-R27 = data
- T2: R22 = "LŨY KẾ KẾT QUẢ...", R23 = "Đội/Tổ | Tháng 1 | ...", R24-R27 = data
- T3: R22 = "LŨY KẾ KẾT QUẢ...", R23 = "Đội/Tổ | Tháng 1 | ...", R24-R27 = data
- T4: R20 = "LŨY KẾ KẾT QUẢ...", R21 = "Đội/Tổ | Tháng 1 | ...", R22-R25 = data

→ **Bug thực tế với code hiện tại**:
- T1-T3: rows 22,23 bị skip; rows 24,25 parse được TCĐK/TBHTĐK; rows 26,27 bị bỏ qua → mất TBĐL/TBCH.
- T4: rows 22-25 parse được đủ 4 đội/tổ tình cờ đúng, nhưng source range vẫn sai và không bền.

→ **Đây là BUG cần fix**: không đổi sang một range cứng khác. Cần dò row có label `Đội/Tổ`, rồi parse 4 row tiếp theo có team label normalize được.

---

### 3.2. Sheet `data` — Chart Data Blocks

#### 3.2.1. Cấu trúc các block

**Chứng cứ** — File T1, `data` sheet:

| Block | Rows | Nội dung | Columns |
|-------|------|----------|---------|
| SCĐX monthly | R3-R15 | Tỷ lệ SCĐX theo tháng (T1-T12 + Lũy kế) | C1:Tháng, C2:completed, C3:total, C4:%, C5:target |
| SCĐX by team | R16-R18 | SCĐX theo đội (HTĐK, CHẤP HÀNH, ĐO LƯỜNG) | C1:team, C2:completed, C3:total, C4:%, C5:target |
| TCĐK shift | R21-R35 | TCĐK monthly SCĐX | C1:label, C2:completed, C3:total, C4:%, C5:target |
| BĐDK NPK | R43-R62 | BDĐK NPK theo tháng/đội | C1:label, C2-C5: data |
| STOP cards | R67-R70 | STOP theo đội | C1:team, C2:actual, C3:target, C4:%, C5:target |
| STOP by month | R72-R84 | STOP theo tháng | C1:month, C2:count |
| VHDN running | R86-R89 | Chạy bộ theo đội | C1:team, C2:actual, C3:target, C4:%, C5:target |
| VHDN sports | R91-R94 | Hội thao theo đội | C1:team, C2:actual, C3:target, C4:%, C5:target |
| Training | R98-R107 | Đào tạo nội bộ theo tháng/đội | C1:team, C2-T12: hours |
| SK initiatives | R110-R114 | Sáng kiến theo đội | C1:team, C2:count |
| Weekly SCĐX | R117-R127 | TCĐK weekly SCĐX (W14-W22) | C1:week, C2:total, C3:completed, C4:backlog |

**Chứng cứ cụ thể** — SCĐX block:
```
R3:  C1:T1 | C2:1302 | C3:1495 | C4:0.8709 | C5:0.98
R4:  C1:T2 | C5:0.98
R15: C1:Lũy kế | C2:1302 | C3:1495 | C4:0.8709 | C5:0.98
R16: C1:Đội thiết bị Hệ thống điều khiển | C2:254 | C3:254 | C4:1 | C5:0.98
R17: C1:Đội thiết bị Chấp hành | C2:682 | C3:801 | C4:0.8514 | C5:0.98
R18: C1:Đội thiết bị Đo lường | C2:366 | C3:440 | C4:0.8318 | C5:0.98
```

**Chứng cứ cụ thể** — STOP block:
```
R67: C1:Đội thiết bị Hệ thống điều khiển | C2:17 | C3:10 | C4:1.7 | C5:0.5
R68: C1:Đội thiết bị Chấp hành | C2:14 | C3:14 | C4:1 | C5:0.5
R69: C1:Đội thiết bị Đo lường | C2:10 | C3:12 | C4:0.833 | C5:0.5
R70: C1:Tổ trực ca điều khiển | C2:10 | C3:14 | C4:0.714 | C5:0.5
```

**Chứng cứ cụ thể** — Training block:
```
R98:  C1:Đào tạo nội bộ | C2:T1 | C3:T2 | C4:T3 | ... | C12:T11
R99:  C1:Đội thiết bị Hệ thống điều khiển | C2:0 | C3:32 | C4:32 | ...
R100: C1:Đội thiết bị Chấp hành | C2:0 | C3:15 | C4:30 | ...
R101: C1:Đội thiết bị Đo lường | C2:24 | C3:0 | C4:44 | ...
R102: C1:Tổ trực ca điều khiển | C2:0 | C3:0 | C4:0 | C5:104 | ...
R103: C1:Kế hoạch | C2:24 | C3:47 | C4:106 | ... | C14:1126
```

#### 3.2.2. Parsing logic hiện tại

**File**: `backend/app/services/okr/historical_snapshot.py:19-27`

```python
DATA_BLOCK_RANGES = {
    "stop_by_team": ("data", "A67:E70"),
    "stop_by_month": ("data", "A72:D84"),
    "training": ("data", "A98:N107"),
    "competency": ("data", "A135:B142"),
    "vhdn_running": ("data", "A86:E89"),
    "vhdn_sports": ("data", "A91:E94"),
    "sk_initiatives": ("data", "A110:B114"),
}
```

→ **Không parse SCĐX block** (rows 3-18), `TCĐK shift` (rows 21-35), `BDĐK NPK` (rows 43-62) và **weekly SCĐX** (rows 117-127). Chỉ parse STOP, training, competency, VHDN, SK.

**Quyết định hiện tại**:
- Các block chưa rõ mapping KR chưa phải blocker.
- Trước mắt dashboard/import ưu tiên dữ liệu từ team reports và Dashboard snapshot.
- Khi cần UI/biểu đồ chi tiết cho SCĐX/BDĐK/weekly backlog thì quay lại xác nhận mapping sau.
- `competency` chỉ có data từ T3/T4 là đúng; T1/T2 chưa xây dựng khung năng lực nên không coi là thiếu file.

---

### 3.3. Sheet `TBHTĐK` — Team Report

#### 3.3.1. Cấu trúc header

**Chứng cứ** — File T1, `TBHTĐK` sheet:
```
R1: C1:BÁO CÁO KẾ HOẠCH /MỤC TIÊU 2026 ĐỘI THIẾT BỊ HỆ THỐNG ĐIỀU KHIỂN
R2: C1:STT | C2:Mã mục tiêu/Kết quả then chốt Đội/Tổ | C3:Tên mục tiêu / Kết quả then chốt | C4:Đo lường | C5:Mục đích | C6:Tần suất đo lường | C7:Tỷ trọng mục tiêu | C8:Kế hoạch hành động | C9:Ngày bắt đầu | C10:Ngày hoàn thành | C11:Người thực hiện | C12:Kiểm tra đánh giá | C13:Báo cáo tình hình thực hiện tháng 1
R3: C1:1 | C2:ĐK.O1.TBHTĐK.O1 | ... | C13:Tình hình thực hiện | C14:Đánh giá | C15:Ghi chú
```

**Column layout**:
| Col | Nội dung |
|-----|---------|
| C1  | STT |
| C2  | Mã KR (format: `ĐK.O{x}.KR{y}.TBHTĐK.O{x}.KR{y}`) |
| C3  | Tên KR |
| C4  | Đo lường |
| C5  | Mục đích/Target |
| C6  | Tần suất |
| C7  | Tỷ trọng |
| C8  | Kế hoạch hành động |
| C9  | Ngày bắt đầu |
| C10 | Ngày hoàn thành |
| C11 | Người thực hiện |
| C12 | Kiểm tra đánh giá |
| **C13** | **Tình hình thực hiện** (Implementation report) |
| **C14** | **Đánh giá** (Self-assessment) |
| **C15** | **Ghi chú** (Notes) |

#### 3.3.2. Team-level summary

**Chứng cứ** — File T1, `TBHTĐK` sheet, R39:
```
R39: C1:Đánh giá chung tháng | C14:Hoàn thành
```

**Chứng cứ bổ sung** — các file có nhiều tháng:
- T1 `TBHTĐK`: R39 có `N=Hoàn thành` cho tháng 1.
- T2 `TBHTĐK`: R39 có `Q=Hoàn thành` cho tháng 2.
- T3 `HTĐK`: R39 có `T=Hoàn thành Tốt` cho tháng 3.
- T4 `TBHTĐK`: R39 có `W=Hoàn thành Tốt` cho tháng 4.

→ `Đánh giá chung tháng` là nguồn hợp lệ, nhưng parser hiện tại `_team_level()` chưa đọc được vì giá trị nằm xa nhãn `A39`. Cần map theo tháng: T1=`N39`, T2=`Q39`, T3=`T39`, T4=`W39`, hoặc dò theo cụm cột report tháng.

#### 3.3.3. Số KR rows

TBHTĐK: ~36 KR rows (R4-R38, bỏ qua R3 là parent objective)
- R4-R6: O1.KR1-KR3 (Safety)
- R7-R12: O2.KR1-KR6 (Equipment stability)
- R13-R16: O3.KR1-KR3 (Safety incidents)
- R17-R20: O4.KR1-KR4 (Cải hoán)
- R21-R34: O5.KR1-KR15 (TPM pillars)
- R35-R38: O6.KR1-KR4 (VHDN)

#### 3.3.4. ⚠️ Tên sheet T3

- File T3 dùng sheet `HTĐK`, nhưng đây chính là `TBHTĐK`.
- Cần thêm alias `HTĐK` → `TBHTĐK` trong `team_normalizer.py`/`identify_team()`.

---

### 3.4. Sheet `TBCH` — Team Report (format khác!)

#### 3.4.1. Cấu trúc header

**Chứng cứ** — File T1, `TBCH` sheet:
```
R1: C1:BÁO CÁO KẾ HOẠCH MỤC TIÊU ĐỘI THIẾT BỊ CHẤP HÀNH THÁNG 1
R2: C1:STT | C2:Mã mục tiêu/KQTC phòng xưởng | C3:Mã mục tiêu/KQTC Đội/Tổ | C4:Tên KQTC | C5:Đo lường | C6:Mục đích | C7:Tần suất | C8:Tỷ trọng | C9:Kế hoạch hành động của Xưởng | C10:Kế hoạch hành động của Đội TBCH | C11:Ngày bắt đầu | C12:Ngày hoàn thành | C13:Ngân sách | C14:Người thực hiện | C15:Kiểm tra đánh giá | C16:Báo cáo tình hình thực hiện tháng 1
R3: C1:1 | C2:ĐCM.O1.KR1.ĐK.O1 | C3:ĐK.O1.TBCH.O1 | ... | C16:Tình hình thực hiện | C17:Đánh giá | C18:Ghi chú
```

**⚠️ Khác biệt với TBHTĐK**:
| Đặc điểm | TBHTĐK | TBCH |
|-----------|--------|------|
| Số cột header | 15 | 24 (có thêm C9: KH Xưởng, C10: KH Đội, C13: Ngân sách) |
| Mã KR ở | C2 | C2 (mã xưởng) + C3 (mã đội) |
| Report col | C13 | **C16** |
| Assessment col | C14 | **C17** |
| Notes col | C15 | **C18** |

**Column layout TBCH**:
| Col | Nội dung |
|-----|---------|
| C1  | STT |
| C2  | Mã mục tiêu phòng xưởng (e.g., `ĐCM.O1.KR1.ĐK.O1.KR1`) |
| C3  | Mã mục tiêu Đội/Tổ (e.g., `ĐK.O1.KR1.TBCH.O1.KR1`) |
| C4  | Tên KR |
| C5-C8 | Đo lường, Mục đích, Tần suất, Tỷ trọng |
| C9  | Kế hoạch hành động của Xưởng |
| C10 | Kế hoạch hành động của Đội TBCH |
| C11-C12 | Ngày bắt đầu/kết thúc |
| C13 | Ngân sách |
| C14 | Người thực hiện |
| C15 | Kiểm tra đánh giá |
| **C16** | **Tình hình thực hiện** |
| **C17** | **Đánh giá** |
| **C18** | **Ghi chú** |

#### 3.4.2. Team-level summary

**Chứng cứ** — File T1, `TBCH` sheet, R44:
```
R44: C1:TỔNG | C8:1.0 | C10:Đánh giá chung | C16:Hoàn thành nhiệm vụ
```

→ Assessment = "Hoàn thành nhiệm vụ" (không phải "Hoàn thành" đơn giản)

**Chứng cứ bổ sung** — các file có nhiều tháng:
- T1 `TBCH`: R44 `P=Hoàn thành nhiệm vụ`
- T2 `TBCH`: R44 `T=Hoàn thành tốt nhiệm vụ`
- T3 `TBCH`: R44 `W=Không hoàn thành nhiệm vụ`
- T4 `TBCH`: R44 `Z=Không hoàn thành nhiệm vụ`

→ Parser cần lấy đúng cột theo tháng, không lấy cụm tháng đầu tiên.

#### 3.4.3. Parsing compatibility

**File**: `backend/app/services/okr/workbook.py:54-60`

```python
def detect_report_columns(sheet) -> tuple[int, int, int] | None:
    for row in range(1, min(sheet.max_row, 10) + 1):
        values = [str(sheet.cell(row, col).value or "").lower() for col in range(1, sheet.max_column + 1)]
        for idx, value in enumerate(values, start=1):
            if "tình hình thực hiện" in value:
                return idx, idx + 1, idx + 2
```

→ Hàm này tự detect cột report bằng cách tìm header "tình hình thực hiện". Logic này đúng với file chỉ có một tháng, nhưng **không đủ cho T2-T4** vì một sheet có nhiều cụm cột tháng.

Ví dụ:
- T4 `TBHTĐK`: tháng 1 ở `M:N:O`, tháng 2 ở `P:Q:R`, tháng 3 ở `S:T:U`, tháng 4 ở `V:W:X`.
- T4 `TBCH`: tháng 1 ở `Q:R:S`, tháng 2 ở `T:U:V`, tháng 3 ở `W:X:Y`, tháng 4 ở `Z:AA:AB`.

→ **BUG cần fix**: `detect_report_columns()` phải nhận `report_month` và chọn đúng cụm cột tháng tương ứng, không return cụm đầu tiên.

---

### 3.5. Sheet `TBĐ` (TBĐL) — Team Report

#### 3.5.1. Cấu trúc header

**Chứng cứ** — File T1, `TBĐ` sheet:
```
R1: C1:BÁO CÁO KẾ HOẠCH MỤC TIÊU ĐỘI TB ĐO LƯỜNG_THÁNG 2
R2: C1:STT | C2:Mã mục tiêu/KQTC Đội/Tổ | C3:Tên KQTC | C4:Đo lường | C5:Mục đích | C6:Tần suất | C7:Tỷ trọng | C8:Kế hoạch hành động | C9:Ngày bắt đầu | C10:Ngày hoàn thành | C11:Ngân sách | C12:Người thực hiện | C13:Kiểm tra đánh giá | C14:Báo cáo tình hình thực hiện tháng 1
R3: C1:1 | C2:ĐK.O1.TBĐ.O1 | ... | C14:Tình hình thực hiện | C15:Đánh giá | C16:Ghi chú
```

**Column layout**:
| Col | Nội dung |
|-----|---------|
| C2  | Mã KR (format: `ĐK.O{x}.KR{y}.TBĐ.O{x}.KR{y}`) |
| **C14** | **Tình hình thực hiện** |
| **C15** | **Đánh giá** |
| **C16** | **Ghi chú** |

#### 3.5.2. Team-level summary

**Chứng cứ**:
- T1 `TBĐ`: chưa có row tổng riêng; dùng đánh giá chi tiết hoặc Dashboard snapshot.
- T2 `TBĐ`: R39 `B=KẾT QUẢ ĐÁNH GIÁ | N=HOÀN THÀNH`.
- T3 `TBĐ`: R39 `B=KẾT QUẢ ĐÁNH GIÁ | N=HOÀN THÀNH TỐT`.
- T4 `TBĐL`: R39 `B=KẾT QUẢ ĐÁNH GIÁ | N=HOÀN THÀNH`.

**Lưu ý nghiệp vụ đã chốt**:
- T1 `TBĐ` title ghi nhầm `THÁNG 2`; thực tế thuộc tháng 1.
- T4 `TBĐL` team summary ghi `HOÀN THÀNH`, nhưng Dashboard tháng 4 ghi `Không HT` vì có kỷ luật: `Một nhân sự Đội TBĐL không tuân thủ quy định giờ công`.
- Import cần lưu team self-assessment và discipline fields riêng; không coi đây là lỗi dữ liệu.

#### 3.5.3. ⚠️ Tên sheet "TBĐ" vs "TBĐL"

- Sheet name trong Excel: `TBĐ`
- Team code trong hệ thống: `TBĐL`
- `identify_team("TBĐ")` → gọi `normalize_team_label("TBĐ")` → lookup `TEAM_LABEL_ALIASES["tbđ"]` → returns `"TBĐL"` ✅

---

### 3.6. Sheet `TCDK`/`TCĐK` — Team Report

#### 3.6.1. Cấu trúc header

**Chứng cứ** — File T1, `TCDK` sheet:
```
R2: C1:KẾ HOẠCH /MỤC TIÊU 2026 TỔ TRỰC CA ĐIỀU KHIỂN | C14:Báo cáo tình hình thực hiện: Tháng 1/2026
R3: C1:STT | C2:Mã mục tiêu/KQTC Đội/Tổ | C3:Tên KQTC | C4:Đo lường | C5:Mục đích | C6:Tần suất | C7:Tỷ trọng | C8:Kế hoạch hành động | C9:Ngày bắt đầu | C10:Ngày hoàn thành | C11:Ngân sách | C12:Người thực hiện | C13:Kiểm tra đánh giá | C14:Tình hình thực hiện | C15:Đánh giá | C16:Ghi chú
```

**Column layout**:
| Col | Nội dung |
|-----|---------|
| C2  | Mã KR (format: `ĐK.O{x}.KR{y}.TCĐK.O{x}.KR{y}`) |
| **C14** | **Tình hình thực hiện** |
| **C15** | **Đánh giá** |
| **C16** | **Ghi chú** |

#### 3.6.2. ⚠️ Header ở R2 không phải R1

- R1: **trống** (không có data)
- R2: Title + month info
- R3: Column headers + "Tình hình thực hiện"

→ `detect_report_columns()` scan từ row 1-10, sẽ tìm thấy "tình hình thực hiện" ở R3 → return (14, 15, 16) ✅

#### 3.6.3. ⚠️ Tên sheet "TCDK" vs "TCĐK"

- File T1: Sheet name = `TCDK`
- File T2: Sheet name = `TCĐK` (có dấu)
- Team code: `TCĐK`
- `identify_team("TCDK")` → `normalize_team_label("TCDK")` → lookup `TEAM_LABEL_ALIASES["tcdk"]` → returns `"TCĐK"` ✅
- `identify_team("TCĐK")` → direct match in TEAMS ✅

#### 3.6.4. Team-level summary

TCĐK không dùng label `Đánh giá chung tháng`; file dùng dòng `Kết luận chung`:
- T1 `TCDK`: `O42=Hoàn thành tốt`
- T2 `TCĐK`: `O42=Hoàn thành tốt`
- T3 `TCĐK`: `O42=Hoàn thành tốt`
- T4 `TCĐK`: `O42=Hoàn thành tốt`

→ `_team_level()` hiện chưa đọc được format này; cần thêm rule nhận diện `Kết luận chung` làm `monthly_assessment`.

---

## 4. Mapping giữa Excel và Database

### 4.1. Team Reports → `team_reports` table

| Field trong DB | Nguồn từ Excel | Notes |
|---------------|----------------|-------|
| `id` | Auto-generated (`make_id("report")`) | |
| `team` | Tên sheet → `identify_team()` | TBHTĐK, TBCH, TBĐL, TCĐK |
| `report_month` | Extract từ R1 title hoặc metadata | T1→1, T2→2, T3→3, T4→4 |
| `report_year` | Extract từ filename/title | 2026 |
| `file_name` | Tên file upload | |
| `file_hash` | SHA256 của file content | |
| `assessments` | JSON array từ `parse_team_report()` | Mỗi KR 1 assessment object |
| `team_level` | JSON từ `_team_level()` | `{monthly_assessment, discipline_status}` |
| `source_type` | `"excel_upload"` | |
| `report_status` | `"submitted"` | Khi import historical |

**Ghi chú team_level sau khi chốt nghiệp vụ**:
- `monthly_assessment`: lấy từ ô đội/tổ tự đánh giá hoặc Dashboard snapshot.
- `discipline_status`: cần set `NOK` khi có vi phạm kỷ luật làm kết quả chung bị hạ.
- `discipline_description`: lưu nguyên nhân để website giải thích, ví dụ T4 `TBĐL` và `TBCH`.
- Không dùng KR matrix đơn thuần để suy ra kết quả chung nếu có discipline override.

**Assessment object structure** (mỗi KR):
```json
{
  "workshop_kr_code": "O2.KR1",
  "kr_name": "Triển khai công tác BD định kỳ...",
  "team_self_assessment": "Hoàn thành",
  "dashboard_status": "OK",
  "has_plan": true,
  "implementation_report": "Hoàn thành 254/254 hạng mục...",
  "notes": "",
  "source_cell": {"sheet_name": "TBHTĐK", "row": 9, "column": "M", "field_name": "Implementation_Report"},
  "metrics": [{"kind": "scdx", "actual": 254, "total": 254, "percentage": 100, "target": 98, "confidence": 0.9}]
}
```

### 4.2. Historical Snapshots → `historical_snapshots` table

| Field trong DB | Nguồn từ Excel | Notes |
|---------------|----------------|-------|
| `id` | Auto-generated (`make_id("snap")`) | |
| `source_file_name` | Tên file | |
| `source_file_hash` | SHA256 của file content | Dùng cho dedup |
| `source_sheet` | `"Dashboard"` hoặc `"data"` | |
| `source_range` | e.g., `"Dashboard!A20:AC25"` hoặc `"data!A67:E70"` | |
| `team` | Team code hoặc `"__CHARTS__"` | |
| `month` | Tháng (1-12) hoặc 0 cho chart blocks | |
| `year` | 2026 | |
| `monthly_assessment` | Text assessment (e.g., "HT tốt") | Chỉ cho dashboard history |
| `chart_payload` | JSON data block | Chỉ cho data sheet blocks |
| `imported_by` | User ID | |

### 4.3. Team Monthly Summaries → `team_monthly_summaries` table

**Model**: `backend/app/models/domain.py:99-113`

Table này có unique constraint `(team, month, year)` qua `uq_team_month_year`.

| Field trong DB | Nguồn từ Excel/import | Notes |
|---------------|------------------------|-------|
| `team` | Team code sau normalize | `TBHTĐK`, `TBCH`, `TBĐL`, `TCĐK` |
| `month` | Tháng import | T1-T4 |
| `year` | Năm import | 2026 |
| `monthly_assessment` | Team-level summary hoặc Dashboard snapshot | Nguồn chính cho kết luận tháng nếu cần đọc độc lập |
| `discipline_status` | Team-level/discipline override | `OK` hoặc `NOK` |
| `discipline_description` | Ghi chú kỷ luật | Bắt buộc quan trọng cho T4 `TBĐL` và `TBCH` |
| `related_kr` | KR liên quan nếu có | Optional |
| `stats` | Thống kê phụ trợ | Optional, có thể để `{}` giai đoạn đầu |

**Kết luận triển khai**:
- `build_dashboard_view()` hiện tại không đọc trực tiếp `team_monthly_summaries`; dashboard vẫn chạy nếu chỉ có `team_reports.team_level` + `historical_snapshots`.
- Tuy nhiên import script **nên upsert luôn** vào `team_monthly_summaries` để tránh thiếu dữ liệu nếu logic sau này đọc bảng summary trực tiếp.
- Upsert key: `(team, month, year)`.

---

## 5. Vấn đề phát hiện (Issues Found)

### 5.1. 🔴 BUG: Dashboard history parsing hard-code row

**File**: `backend/app/services/okr/historical_snapshot.py:156`

```python
for row in range(22, 26):  # Chỉ đọc rows 22, 23, 24, 25
```

**Thực tế**:
- T1-T3: data teams nằm ở rows 24, 25, 26, 27.
- T4: data teams nằm ở rows 22, 23, 24, 25.

| Row | Content | Parsed? |
|-----|---------|---------|
| R22 | Header text | ✅ Skipped (normalize_team_label returns None) |
| R23 | Column headers | ✅ Skipped |
| R24 | Tổ trực ca (TCĐK) | ✅ Parsed |
| R25 | Đội TBHTĐK | ✅ Parsed |
| R26 | Đội TBĐL | ❌ **MISSING** (row 26 > 25) |
| R27 | Đội TBCH | ❌ **MISSING** (row 27 > 25) |

**Impact**: TBĐL và TBCH sẽ không có historical snapshot data từ Dashboard sheet.

**Fix**: Dò row header `Đội/Tổ`, rồi đọc các row đội/tổ ngay bên dưới. Không dùng range cứng.

### 5.2. 🔴 BUG: chọn sai cụm cột tháng trong team reports

`detect_report_columns()` hiện return cụm đầu tiên chứa `Tình hình thực hiện`. Với file có nhiều tháng trong cùng sheet, T2-T4 có thể bị import nhầm tháng 1.

Ví dụ:
- T2 `TBHTĐK`: tháng 2 ở `P:Q:R`, không phải `M:N:O`.
- T3 `HTĐK`/`TBHTĐK`: tháng 3 ở `S:T:U`, không phải `M:N:O`.
- T4 `TBHTĐK`: phải lấy `V:W:X` cho tháng 4, không phải `M:N:O`.
- T4 `TBCH`: phải lấy `Z:AA:AB` cho tháng 4, không phải `Q:R:S`.

**Fix**: `detect_report_columns(sheet, month)` cần ưu tiên header `Báo cáo tình hình thực hiện tháng X` hoặc cụm cột thứ X.

### 5.3. 🔴 BUG: team-level monthly assessment chưa parse đúng

`_team_level()` chỉ tìm value ở vài cột kế bên label, trong khi Excel đặt value xa label:

| Team | Pattern thực tế |
|------|----------------|
| TBHTĐK | `A39=Đánh giá chung tháng`, value theo tháng ở `N/Q/T/W` |
| TBCH | `J44=Đánh giá chung`, value theo tháng ở `P/T/W/Z` hoặc `Q/T/W/Z` tùy file |
| TBĐL | `B39=KẾT QUẢ ĐÁNH GIÁ`, value thường ở `N39`; T1 không có row tổng |
| TCĐK | `J42=Kết luận chung`, value ở `O42` |

**Fix**: thêm parser team-level theo team/month/template, sau đó normalize text (`Hoàn thành nhiệm vụ` → `Hoàn thành`, `Không hoàn thành nhiệm vụ` → `Không HT`, ...).

### 5.4. 🟡 WARNING: Sheet name inconsistency

| File | TBHTĐK sheet name | TBĐL sheet name | TCĐK sheet name |
|------|-------------------|----------------|----------------|
| T1   | `TBHTĐK`          | `TBĐ`          | `TCDK`          |
| T2   | `TBHTĐK`          | `TBĐ`          | `TCĐK`          |
| T3   | `HTĐK`            | `TBĐ`          | `TCĐK`          |
| T4   | `TBHTĐK`          | `TBĐL`         | `TCĐK`          |

**Fix**: thêm alias `HTĐK` → `TBHTĐK`; giữ alias `TBĐ` → `TBĐL`, `TCDK` → `TCĐK`.

### 5.5. 🟡 WARNING: T4 có kết quả Không HT do kỷ luật

Đây không phải lỗi Excel:
- `TBĐL`: Dashboard T4 = `Không HT`, team summary = `HOÀN THÀNH`, do kỷ luật: `Một nhân sự Đội TBĐL không tuân thủ quy định giờ công`.
- `TBCH`: Dashboard T4 = `Không HT`, do kỷ luật: `Một nhân sự Đội TBCH không tuân thủ đúng HDBD trong quá trình thực hiện công việc bảo dưỡng định kỳ thiết bị Quan trắc`.

**Fix**: import cần lưu `discipline_status`/`discipline_description` riêng để dashboard giải thích được vì sao monthly assessment bị hạ.

### 5.6. 🟡 WARNING: File T4 size rất lớn (12.2 MB)

Kiểm tra zip nội bộ cho thấy T4 lớn chủ yếu do ảnh nhúng:
- `xl/media/image20.png` khoảng 5.75 MB
- `xl/media/image19.png` khoảng 5.54 MB

**Impact**: import data không cần giữ ảnh. Nếu upload raw workbook qua API bị giới hạn `max_excel_upload_mb=10`, T4 có thể vượt limit.

**Fix**:
- Offline import từ file local thì không blocker.
- Nếu upload qua API, cần tăng limit hoặc bỏ/nén ảnh trước.

### 5.7. 🟡 INFO: KR code mapping giữa các sheets

| Sheet | Cột mã KR | Format mẫu | extract_workshop_kr_code() |
|-------|----------|------------|---------------------------|
| TBHTĐK | C2 | `ĐK.O1.KR1.TBHTĐK.O1.KR1` | Match `ĐK.O{x}.KR{y}` → `O1.KR1` ✅ |
| TBCH (C2) | C2 | `ĐCM.O1.KR1.ĐK.O1.KR1` | Match `ĐK.O{x}.KR{y}` → `O1.KR1` ✅ |
| TBCH (C3) | C3 | `ĐK.O1.KR1.TBCH.O1.KR1` | Match `ĐK.O{x}.KR{y}` → `O1.KR1` ✅ |
| TBĐ | C2 | `ĐK.O1.KR1.TBĐ.O1.KR1` | Match `ĐK.O{x}.KR{y}` → `O1.KR1` ✅ |
| TCDK | C2 | `ĐK.O1.KR1.TCĐK.O1.KR3` | Match `ĐK.O{x}.KR{y}` → `O1.KR1` ✅ |

**Quyết định đã chốt**:
- File gốc T1-T3 có nhiều mã KR nhập sai/ẩu.
- Khi mã trong Excel mâu thuẫn, import không được tin tuyệt đối vào chuỗi mã đầu tiên.
- Ưu tiên rules hiện tại trong codebase và template chuẩn đã được user chỉnh sửa.
- Cần cân nhắc mapping theo tên KR/master mapping để sửa các trường hợp như `ĐK.O2.KR1.TBĐ.O2.KR2`, nơi prefix xưởng và mã đội/tổ khác nhau.

### 5.8. 🟡 INFO: Block `data` chưa map không phải blocker

Các block `SCĐX`, `TCĐK shift`, `BDĐK NPK`, `weekly SCĐX` chưa cần chốt ngay. Import trước dữ liệu có thể chắc chắn từ Dashboard/team reports; các block chart chưa rõ mapping để sau.

---

## 6. Import Strategy

### 6.1. Approach: Import từng file, từng loại

Import chia theo 3 nhóm dữ liệu:

**Bước 1: Import Historical Snapshots** (Dashboard + data)
- Gọi `import_historical_snapshot(db, workbook_bytes, ...)` với file tháng tương ứng.
- Tự động dò vùng Dashboard history bằng header `Đội/Tổ`, không dùng range cứng.
- Import confirmed `data` blocks hiện có; block chưa rõ mapping giữ dạng source reference/warning, không chặn import.
- Upsert vào `historical_snapshots` table (dedup by source_file_hash + team + month + year + source_range)

**Bước 2: Import Team Reports** (4 sheets × 1 file)
- T1-T3: đọc team report từ workbook tháng tương ứng trong `KHMT_T1_T2_T3_T4/`.
- T4: ưu tiên đọc team report từ file template đã chuẩn hóa trong `template_xlsx/`.
- Với mỗi team (`TBHTĐK`, `TBCH`, `TBĐL`, `TCĐK`):
  - Gọi `parse_team_report(path, team=team_code, month=report_month, year=2026)`.
  - Parser phải chọn đúng cụm cột report của tháng đang import.
  - Tạo `TeamReportModel` record
  - Upsert logic: nếu đã có report cho team+month+year → replace

**Bước 3: Upsert Team Monthly Summaries**
- Từ `team_reports.team_level` đã parse và discipline override nếu có.
- Upsert vào `team_monthly_summaries` theo `(team, month, year)`.
- Bảng này chưa bắt buộc với `build_dashboard_view()` hiện tại, nhưng nên populate để đảm bảo dữ liệu summary có nguồn độc lập và ổn định cho logic sau này.

### 6.2. Thứ tự import

```
1. OKR tháng 01-2026 - X.ĐK.xlsx  →  Historical Snapshot + 4 Team Reports từ file gốc + Team Monthly Summaries
2. OKR tháng 02-2026 - X.ĐK.xlsx  →  Historical Snapshot + 4 Team Reports từ file gốc + Team Monthly Summaries
3. OKR tháng 03-2026 - X.ĐK.xlsx  →  Historical Snapshot + 4 Team Reports từ file gốc, `HTĐK` = `TBHTĐK` + Team Monthly Summaries
4. OKR tháng 04-2026 - X.ĐK.xlsx  →  Historical Snapshot từ workbook T4, Team Reports ưu tiên `template_xlsx/` + Team Monthly Summaries
```

### 6.3. Import method

**Option A: Script trực tiếp vào DB** (Recommended)
- Viết Python script chạy offline, không cần start server
- Truy cập SQLite DB trực tiếp
- Dùng lại logic từ `parse_team_report()` và `import_historical_snapshot()`

**Option B: API calls**
- Start backend server
- Gọi API endpoints: `POST /okr/reports/upload` + `POST /okr/historical-snapshots/import`
- Cần auth token

→ **Recommend Option A** vì đơn giản hơn, không cần start server.

### 6.4. Expected results sau import

| Tháng | Team Reports | Historical Snapshots | Team Monthly Summaries | Dashboard hiển thị |
|-------|-------------|---------------------|------------------------|-------------------|
| T1    | 4 records (TBHTĐK, TBCH, TBĐL, TCĐK) | Dashboard + data blocks | 4 summary records | ✅ Full data |
| T2    | 4 records | Dashboard + data blocks | 4 summary records | ✅ Full data |
| T3    | 4 records | Dashboard + data blocks | 4 summary records | ✅ Full data |
| T4    | 4 records từ template chuẩn hóa | Dashboard + data blocks | 4 summary records | ✅ Full data, có discipline notes |
| T5    | 0 records | 0 | 0 | → Fallback to T4 ✅ |

### 6.5. Data flow sau import

```
User mở Dashboard
  → GET /okr/dashboard/latest
  → resolve_default_period()
    → find_latest_data_period(db)
      → Query TeamReport + HistoricalSnapshot
      → max month = 4 (T4)
    → Return ResolvedPeriod(month=4, year=2026, source="latest_data")
  → _dashboard_payload(4, 2026, ...)
    → Build dashboard với T4 data
```

---

## 7. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Dashboard parsing hard-code row (BUG) | 🔴 HIGH | Dò header `Đội/Tổ`, đọc 4 team rows bên dưới |
| Team report chọn sai cụm cột tháng (BUG) | 🔴 HIGH | `detect_report_columns()` nhận `month` và chọn đúng cụm cột |
| Team-level summary chưa parse được | 🔴 HIGH | Thêm rule theo team/month: `Đánh giá chung`, `KẾT QUẢ ĐÁNH GIÁ`, `Kết luận chung` |
| T4 discipline làm monthly assessment bị hạ | 🟡 MEDIUM | Lưu `discipline_status` + `discipline_description`, không coi là mismatch |
| `team_monthly_summaries` không được populate | 🟡 MEDIUM | Upsert summary theo `(team, month, year)` trong import script |
| File T4 quá lớn (12.2MB) | 🟡 MEDIUM | Offline import hoặc tăng upload limit/bỏ ảnh nếu dùng API upload |
| Duplicate data khi import lại | 🟢 LOW | Dedup by file_hash + team + month + year |
| KR code trong file gốc nhập sai | 🟡 MEDIUM | Ưu tiên rules repo + template chuẩn + mapping theo tên KR khi mâu thuẫn |
| Sheet name inconsistency | 🟢 LOW | Thêm alias `HTĐK`; đã có alias `TBĐ`, `TCDK` |

---

## 8. Bước thực hiện tiếp theo

1. **Fix Dashboard history parser**: dò row `Đội/Tổ`, không hard-code `range(22, 26)`.
2. **Fix team report month-column detection**: chọn đúng cụm cột tháng khi sheet có nhiều tháng.
3. **Fix team-level summary parser**: đọc đúng `Đánh giá chung tháng`, `KẾT QUẢ ĐÁNH GIÁ`, `Kết luận chung`.
4. **Add aliases**: `HTĐK` → `TBHTĐK`, giữ `TBĐ` → `TBĐL`, `TCDK` → `TCĐK`.
5. **Add discipline import fields** cho T4 `TBĐL` và `TBCH`.
6. **Upsert `team_monthly_summaries`** từ `team_reports.team_level` + discipline override theo `(team, month, year)`.
7. **Viết import script** (`scripts/import_historical.py`) với nguồn:
   - T1-T3: raw workbooks trong `KHMT_T1_T2_T3_T4/`
   - T4 team reports: ưu tiên `template_xlsx/`
8. **Chạy import** từng tháng T1 → T4.
9. **Verify** dashboard hiển thị đúng T4 và có giải thích kỷ luật.
10. **Test fallback**: khi chưa có T5 data, dashboard should show T4.
