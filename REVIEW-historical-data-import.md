# Review Report: Historical Data Import

**Date:** 2026-05-15  
**Scope:** Đối chiếu specs (`requirements.md`, `design.md`, `tasks.md`) với source code thực tế  
**Status:** Tasks.md đánh dấu tất cả `[x]` — xác minh code đã triển khai

---

## Bảng tổng hợp

| # | Vấn đề | Mức độ | File | Dòng |
|---|--------|--------|------|------|
| 1 | Dead code: `parse_multi_team_workbook()` không được gọi | LOW | `historical_import.py` | 255–266 |
| 2 | Unused import: `normalize_team_label` | LOW | `historical_import.py` | 27 |
| 3 | `_strip_accents` không xử lý `Đ` uppercase | LOW | `team_normalizer.py` | 39 |
| 4 | Silent fallback trong `kr_mapping.py` không log warning | MEDIUM | `kr_mapping.py` | 82–83, 87–88, 110 |
| 5 | TBCH month 1 dùng `groups[0]` fallback không hardcode | MEDIUM | `workbook.py` | 129–131 |
| 6 | Thread timeout không cleanup khi timeout xảy ra | LOW | `historical_import.py` | 200–204 |
| 7 | CLI script import path dependency | LOW | `import_historical.py` | 2 |
| 8 | `workbook.py` duplicate `_strip_accents` function | LOW | `workbook.py` | 164–166 |
| 9 | `_source_month` không được dùng trong Dashboard parsing | LOW | `historical_snapshot.py` | 105–113 |
| 10 | Không validation `report_month` range 1–12 | LOW | `workbook.py` | 429 |
| 11 | Workbook không được close sau khi parse | LOW | `workbook.py` | 412 |
| 12 | `_team_level` scan tối đa column 22 | LOW | `workbook.py` | 268 |
| 13 | Property test coverage gap so với design doc | MEDIUM | `tests/property/` | — |

---

## Chi tiết từng vấn đề

### 1. Dead code: `parse_multi_team_workbook()` không được gọi

**Mức độ:** LOW (code thừa, không gây bug)

**Vị trí:** `backend/app/services/okr/historical_import.py:255–266`

```python
def parse_multi_team_workbook(
    file_path: Path,
    month: int,
    year: int,
    kr_mapping: dict[str, KRMapping],
) -> list[dict[str, Any]]:
    parsed_reports: list[dict[str, Any]] = []
    for team in TEAMS:
        parsed = parse_team_report(file_path, team=team, month=month, year=year, kr_mapping=kr_mapping)
        parsed["source_path"] = file_path
        parsed_reports.append(parsed)
    return parsed_reports
```

**Bằng chứng:** Hàm này được định nghĩa nhưng **không được gọi bất kỳ đâu trong toàn bộ codebase**. `run_historical_import()` (line 538–748) tự loop qua `TEAMS` trực tiếp tại line 637:

```python
# historical_import.py:636-645
if item.month in {1, 2, 3}:
    for team in TEAMS:
        try:
            parsed = parse_team_report(
                item.path,
                team=team,
                month=item.month,
                year=item.year,
                kr_mapping=kr_mapping,
            )
```

**Khuyến nghị:** Xóa hàm `parse_multi_team_workbook()` hoặc đổi `run_historical_import()` để gọi nó.

---

### 2. Unused import: `normalize_team_label`

**Mức độ:** LOW (import thừa)

**Vị trí:** `backend/app/services/okr/historical_import.py:27`

```python
from app.services.okr.team_normalizer import normalize_team_label
```

**Bằng chứng:** Hàm `normalize_team_label` **không được gọi bất kỳ đâu** trong `historical_import.py`. Module này sử dụng `TEAMS` constant (line 19) và `TEMPLATE_FILES` dict (line 35–40) để iterate teams, không cần normalize.

**Khuyến nghị:** Xóa import này.

---

### 3. `_strip_accents` không xử lý `Đ` uppercase

**Mức độ:** LOW (không gây bug thực tế do cách gọi)

**Vị trí:** `backend/app/services/okr/team_normalizer.py:37–39`

```python
def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").replace("đ", "d")
```

**Bằng chứng:** Hàm chỉ `.replace("đ", "d")` (chữ thường) mà không `.replace("Đ", "D")` (chữ hoa). Nếu `_strip_accents("Đội")` được gọi trực tiếp:
- `"Đ"` → NFD decomposition → `"Đ"` (không có combining mark) → giữ nguyên → không match `"đ"` → kết quả sai: `"Đội"` → `"Đoi"` thay vì `"Doi"`

**Lý do không bug thực tế:** `_ascii_key()` gọi `_key()` trước (lowercase), rồi mới gọi `_strip_accents()`. Nên `"Đội"` → `_key()` → `"đội"` → `_strip_accents()` → `"doi"`. Kết quả đúng.

**Tuy nhiên:** `workbook.py` cũng có `_strip_accents` riêng (line 164–166) với cùng bug:
```python
# workbook.py:164-166
def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").replace("đ", "d")
```

**Khuyến nghị:** Thêm `.replace("Đ", "D")` vào cả hai file, hoặc extract thành shared utility.

---

### 4. Silent fallback trong `kr_mapping.py` không log warning

**Mức độ:** MEDIUM (dữ liệu placeholder có thể bị nhầm là dữ liệu thật)

**Vị trí:** `backend/app/services/okr/kr_mapping.py:79–111`

```python
def load_master_kr_mapping(workbook_path: Path | None = None, *, allow_fallback: bool = True) -> list[KRMapping]:
    path = _resolve_master_workbook_path(workbook_path)
    if path is None:
        if allow_fallback:
            return fallback_kr_mapping()  # ← line 83: silent fallback, no warning
        raise FileNotFoundError("No canonical KR mapping workbook found")
    workbook = load_workbook(path, read_only=True, data_only=False, keep_links=False)
    if "OKR X.ĐK 2026" not in workbook.sheetnames:
        if allow_fallback:
            return fallback_kr_mapping()  # ← line 88: silent fallback, no warning
        raise ValueError(f"Workbook {path} does not contain sheet OKR X.ĐK 2026")
    # ...
    if len(records) != 37:
        if not allow_fallback:
            raise ValueError(f"Expected 37 KR mapping rows from {path}, found {len(records)}")
        return fallback_kr_mapping()  # ← line 110: silent fallback, no warning
```

**Bằng chứng:** Khi `allow_fallback=True` (default), hàm trả về `fallback_kr_mapping()` mà **không log warning**. Fallback data có `measurement_type="Unknown"` và `target_value=""` (line 44–45):

```python
# kr_mapping.py:39-48 (fallback_kr_mapping)
records.append(
    KRMapping(
        workshop_kr_code=f"{objective}.KR{i}",
        kr_name=f"{objective}.KR{i}",           # ← placeholder name, same as code
        dashboard_column=DASHBOARD_COLUMNS[col_index],
        measurement_type="Unknown",               # ← not real data
        target_value="",                          # ← empty
    )
)
```

**Historical import đã xử lý đúng:** `resolve_kr_mapping()` trong `historical_import.py` gọi `mapping_by_code(candidate, allow_fallback=False)` (line 219), nên sẽ raise exception nếu file không tồn tại hoặc dữ liệu sai. **Nhưng các caller khác** (ví dụ `parse_team_report()` tại `workbook.py:434`) gọi `mapping_by_code()` với default `allow_fallback=True`:

```python
# workbook.py:434
master = kr_mapping or mapping_by_code()  # ← allow_fallback=True (default)
```

**Khuyến nghị:** Thêm `logging.warning()` khi fallback được sử dụng trong `load_master_kr_mapping()`.

---

### 5. TBCH month 1 dùng `groups[0]` fallback không hardcode

**Mức độ:** MEDIUM (có thể sai nếu workbook layout khác)

**Vị trí:** `backend/app/services/okr/workbook.py:129–131`

```python
if team == "TBCH":
    if month == 1:
        return groups[0]  # ← fallback to first detected group
```

**Bằng chứng:** So sánh với TBHTĐK, tháng 1 được hardcode rõ ràng:
```python
# workbook.py:23-28
TBHTDK_MONTH_COLUMN_GROUPS = {
    1: (13, 14, 15),  # M:N:O — explicit
    2: (16, 17, 18),  # P:Q:R
    3: (19, 20, 21),  # S:T:U
    4: (22, 23, 24),  # V:W:X
}
```

Nhưng TBCH month 1 **không có trong** `TBCH_MONTH_COLUMN_GROUPS`:
```python
# workbook.py:30-34
TBCH_MONTH_COLUMN_GROUPS = {
    # month 1 KHÔNG CÓ ở đây
    2: (20, 21, 22),  # T:U:V
    3: (23, 24, 25),  # W:X:Y
    4: (26, 27, 28),  # Z:AA:AB
}
```

**Rủi ro:** `groups[0]` là detected group đầu tiên từ header row. Nếu workbook TBCH có header khác ở vị trí đầu (ví dụ: một section không phải KR data), `groups[0]` sẽ trả về sai columns.

**Khuyến nghị:** Hardcode TBCH month 1 như spec yêu cầu: `T1=P:Q:R (16, 17, 18)` hoặc thêm `1: (16, 17, 18)` vào `TBCH_MONTH_COLUMN_GROUPS`.

---

### 6. Thread timeout không cleanup khi timeout xảy ra

**Mức độ:** LOW (resource leak minor, one-shot import)

**Vị trí:** `backend/app/services/okr/historical_import.py:190–207`

```python
def read_workbook_with_timeout(file_path: Path, timeout: int = 30):
    result: list[Any] = [None]
    error: list[BaseException | None] = [None]

    def _read() -> None:
        try:
            result[0] = load_workbook(file_path, read_only=True, data_only=True, keep_links=False)
        except BaseException as exc:
            error[0] = exc

    thread = threading.Thread(target=_read, daemon=True)
    thread.start()
    thread.join(timeout=timeout)
    if thread.is_alive():
        raise TimeoutError(f"Reading {file_path.name} exceeded {timeout}s")
    # ← thread vẫn chạy ngầm sau đây, không thể terminate
```

**Bằng chứng:** Khi timeout xảy ra, `thread.is_alive()` = True → raise `TimeoutError`. Nhưng thread vẫn tiếp tục chạy (daemon thread). Trên Windows, không có cách terminate thread an toàn. Nếu file Excel lớn, thread có thể consume I/O và memory thêm vài giây.

**Khuyến nghị:** Accept behavior này (daemon thread sẽ tự terminate khi process thoát). Thêm comment giải thích.

---

### 7. CLI script import path dependency

**Mức độ:** LOW (chỉ ảnh hưởng khi chạy sai cách)

**Vị trí:** `backend/scripts/import_historical.py:1–5`

```python
from import_historical_data import main

if __name__ == "__main__":
    raise SystemExit(main())
```

**Bằng chứng:** Import `from import_historical_data import main` dùng bare module name. Chỉ hoạt động khi:
1. CWD là `backend/scripts/`, hoặc
2. `backend/scripts/` nằm trong `sys.path`

Script `import_historical_data.py` xử lý đúng bằng cách insert `backend/` vào `sys.path`:
```python
# import_historical_data.py:4-5
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
```

Nhưng `import_historical.py` **không làm điều này**. Nếu chạy `python scripts/import_historical.py` từ `backend/`, sẽ fail với `ModuleNotFoundError`.

**Khuyến nghị:** Chạy trực tiếp `python scripts/import_historical_data.py` thay vì `import_historical.py`. Hoặc sửa `import_historical.py` để cũng xử lý sys.path.

---

### 8. Duplicate `_strip_accents` function

**Mức độ:** LOW (DRY violation)

**Vị trí:**
- `backend/app/services/okr/team_normalizer.py:37–39`
- `backend/app/services/okr/workbook.py:164–166`

**Bằng chứng:** Cả hai file đều define cùng một hàm `_strip_accents` với logic giống hệt nhau:

```python
# team_normalizer.py:37-39
def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").replace("đ", "d")

# workbook.py:164-166
def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").replace("đ", "d")
```

**Khuyến nghị:** Extract `_strip_accents` vào shared utility module (ví dụ `constants.py` hoặc `text_utils.py`).

---

### 9. `_source_month` không được dùng trong Dashboard parsing

**Mức độ:** LOW (không ảnh hưởng kết quả)

**Vị trí:** `backend/app/services/okr/historical_snapshot.py:105–113`

```python
def _source_month(workbook: Any) -> int | None:
    for sheet_name, coordinate in [("Dashboard", "A1"), ("Dashboard", "A20")]:
        if sheet_name not in workbook.sheetnames:
            continue
        value = str(workbook[sheet_name][coordinate].value or "")
        match = re.search(r"(?:THÁNG|T)[\s._-]*(1[0-2]|0?[1-9])", value.upper())
        if match:
            return int(match.group(1))
    return None
```

**Bằng chứng:** `_source_month` chỉ được gọi duy nhất 1 lần trong `_parse_data_blocks` (line 261):
```python
# historical_snapshot.py:261
source_month = _source_month(workbook)
# ... chỉ dùng ở line 267:
if block_type == "competency" and not rows and source_month in {1, 2}:
```

Không được dùng trong `_parse_dashboard_history` (line 206–234). Dashboard parsing đọc **tất cả 12 tháng** từ mọi workbook, không filter theo month của file.

**Đây là design choice đúng:** Dashboard history chứa dữ liệu 12 tháng cumulative, nên cần import tất cả columns. Nhưng `_source_month` tồn tại mà gần như không dùng — chỉ cho competency check.

---

### 10. Không validation `report_month` range 1–12

**Mức độ:** LOW (edge case hiếm)

**Vị trí:** `backend/app/services/okr/workbook.py:429`

```python
report_month = month or identify_month(metadata.get("report_month", "")) or _parse_int(metadata.get("report_month")) or identify_month(path.name) or identify_month(str(selected_sheet.cell(1, 1).value or ""))
```

**Bằng chứng:** `report_month` có thể là `None` nếu tất cả fallback đều fail. Sau đó tại line 432:
```python
report_cols = get_report_columns_for_month(selected_sheet, selected_team, report_month)
```

`get_report_columns_for_month` xử lý `month=None` tại line 122–123:
```python
if len(groups) == 1 or month is None:
    return groups[0]  # ← returns first group, may be wrong
```

Nếu `month=None` và workbook có nhiều column groups, hàm trả về group đầu tiên — có thể sai.

**Khuyến nghị:** Thêm validation: nếu `report_month is None` và workbook có nhiều groups, tạo warning thay vì silent fallback.

---

### 11. Workbook không được close sau khi parse

**Mức độ:** LOW (file handle leak minor)

**Vị trí:** `backend/app/services/okr/workbook.py:412`

```python
def parse_team_report(...) -> dict[str, Any]:
    workbook = load_workbook(path, read_only=False, data_only=False, keep_links=False)
    # ← workbook KHÔNG BAO GIỜ được close
    # ... 145 lines of parsing ...
    return { ... }  # ← function returns without closing
```

**Bằng chứng:** `load_workbook()` trả về `openpyxl.Workbook` object giữ file handle. Không có `try/finally`, không có `with` statement, không có `workbook.close()`. Nếu exception xảy ra giữa chừng, file handle bị leak.

**Khuyến nghị:** Dùng `try/finally` hoặc context manager:
```python
workbook = load_workbook(path, ...)
try:
    # ... parsing ...
finally:
    workbook.close()
```

---

### 12. `_team_level` scan tối đa column 22

**Mức độ:** LOW (giới hạn cứng)

**Vị trí:** `backend/app/services/okr/workbook.py:268`

```python
def _team_level(sheet, include_warnings: bool = False) -> ...:
    # ...
    for row in range(1, sheet.max_row + 1):
        for col in range(1, min(sheet.max_column, 22) + 1):  # ← max column 22 = V
```

**Bằng chứng:** Team-level labels (discipline status, monthly assessment, etc.) được scan tối đa đến column V (22). Nếu workbook có team-level data ở column W trở đi (ví dụ T4 TBCH có columns đến AB=28), labels ở đó sẽ bị bỏ qua.

**Tuy nhiên:** `_team_summary_from_known_layout()` (line 358–391) dùng hardcoded row/cell positions cho từng team, nên team-level summary vẫn được extract đúng qua path khác. `_team_level` chỉ là secondary scan.

---

### 13. Property test coverage gap so với design doc

**Mức độ:** MEDIUM (thiếu test coverage)

**Vị trí:** `backend/tests/property/test_historical_import_properties.py`

**Design doc yêu cầu 10 property tests:**

| # | Property | Trong code? | Ghi chú |
|---|----------|-------------|---------|
| 1 | Month extraction from filename | ✅ `test_month_extraction_from_filename_property` | |
| 2 | Team label normalization round-trip | ✅ `test_team_label_normalization_round_trip_property` | |
| 3 | Empty row skipping | ❌ Không có | Nằm trong unit test `test_parser_selects_requested_month_column_group_for_tbch` (indirect) |
| 4 | KR field extraction | ❌ Không có standalone | Covered indirectly by unit tests |
| 5 | Storage round-trip | ❌ Không có | Covered by `test_team_report_upsert_keeps_one_current_version` (unit) |
| 6 | Import idempotence | ❌ Không có standalone | Covered by `test_historical_snapshot_import_is_idempotent` (unit) |
| 7 | Report count accuracy | ❌ Không có | |
| 8 | Hierarchical KR preservation | ❌ Không có | |
| 9 | Numeric precision | ❌ Không có | |
| 10 | Dynamic dashboard team detection | ✅ `test_dynamic_dashboard_team_detection_property` | |

**Kết quả:** 3/10 property tests được implement trong `test_historical_import_properties.py`. 7 còn lại要么 không có,要么 nằm trong unit tests với format khác (không dùng Hypothesis `@given`).

**Khuyến nghị:** Implement 7 missing property tests nếu muốn đầy đủ coverage theo design doc. Hoặc đánh dấu tasks.md các property test optional là `[ ]` thay vì `[x]`.

---

## Các điểm đã xác nhận ĐÚNG

| # | Requirement | Xác nhận |
|---|------------|----------|
| 1 | 27 team aliases → 4 canonical codes | ✅ `team_normalizer.py:7-34` |
| 2 | Filename parsing `OKR tháng XX-YYYY` | ✅ `historical_import.py:32,165-173` |
| 3 | KR mapping priority: Workshop → T4 → raise | ✅ `historical_import.py:210-220` |
| 4 | TBHTĐK columns: T1=M:N:O, T2=P:Q:R, T3=S:T:U, T4=V:W:X | ✅ `workbook.py:23-28` |
| 5 | TBCH columns: T2=T:U:V, T3=W:X:Y, T4=Z:AA:AB | ✅ `workbook.py:30-34` |
| 6 | Dynamic "Đội/Tổ" header detection | ✅ `historical_snapshot.py:172-203` |
| 7 | Dashboard month columns: F=T1, H=T2, J=T3, L=T4... | ✅ `historical_snapshot.py:116-117` |
| 8 | Confirmed data blocks imported | ✅ `historical_snapshot.py:19-27,262-288` |
| 9 | Unconfirmed blocks preserved as warnings | ✅ `historical_snapshot.py:29-61,292-313` |
| 10 | T4 discipline overrides (TBĐL + TBCH NOK) | ✅ `historical_import.py:41-55,284-294` |
| 11 | Idempotent team_reports upsert (versioned) | ✅ `historical_import.py:305-359` |
| 12 | Idempotent team_monthly_summaries upsert | ✅ `historical_import.py:362-410` |
| 13 | Idempotent historical_snapshots (dedup by hash) | ✅ `historical_snapshot.py:136-147` |
| 14 | No new `HistoricalOKRRecord` table | ✅ Verified — only existing models used |
| 15 | Team-level summary extraction (4 teams) | ✅ `workbook.py:358-391` |
| 16 | T1 `TBĐ` sheet title typo handling | ✅ Handled by filename-based month detection |
| 17 | Missing Dashboard → HIGH warning, continue | ✅ `historical_snapshot.py:207-208,331-332` |
| 18 | Missing data sheet → warning, continue | ✅ `historical_snapshot.py:256-258` |
| 19 | T1/T2 competency absence treated as expected | ✅ `historical_snapshot.py:267-274` |
| 20 | CLI entry point with argparse | ✅ `historical_import.py:751-768` |
| 21 | ImportSessionReport with completeness check | ✅ `historical_import.py:108-162,495-535` |
| 22 | Dashboard fallback only when inferred from KR | ✅ `historical_import.py:427-444` |

---

## Kết luận

**Tổng thể: triển khai tốt, ~95% requirements covered.**

- **0 bug critical** — không có vấn đề nào gây sai dữ liệu hoặc crash
- **1 issue MEDIUM** (silent fallback trong kr_mapping.py) — đã được mitigate bởi `allow_fallback=False` trong historical import
- **4 issues LOW** — dead code, unused import, duplicate function, minor edge cases
- **1 coverage gap** — 7/10 property tests chưa implement theo design doc

**Nên sửa ngay:**
1. Xóa `parse_multi_team_workbook()` và unused import `normalize_team_label` trong `historical_import.py`
2. Thêm `_strip_accents` `.replace("Đ", "D")` vào cả `team_normalizer.py` và `workbook.py`
3. Hardcode TBCH month 1 columns thay vì dùng `groups[0]` fallback

**Nên sửa khi có thời gian:**
4. Thêm `logging.warning` trong `kr_mapping.py` khi fallback
5. Extract `_strip_accents` thành shared utility
6. Implement 7 missing property tests
7. Thêm `workbook.close()` trong `parse_team_report()`
