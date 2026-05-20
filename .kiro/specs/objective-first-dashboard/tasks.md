# Implementation Plan: Objective-First Dashboard

## Overview

Kế hoạch triển khai chuyển dashboard OKR từ mô hình "data-block-first" sang "objective-first" (`O1 → O6`), đồng thời sửa luồng chọn kỳ báo cáo mặc định và tách metadata kỹ thuật ra khỏi dashboard nghiệp vụ.

Thứ tự thực thi theo hướng backend-first (period resolver → objective_sections builder → wiring vào `build_dashboard_view` và route `/dashboard/latest`), sau đó frontend (types + i18n → primitives → ObjectiveSection/VisualBlockRenderer → TechnicalPanel/PeriodSelector/EmptyStateBanner → wiring vào `OKRWorkspace`). Mỗi tính năng có cả bài test ví dụ và property test bám theo 19 correctness properties đã định nghĩa ở design.

Ngôn ngữ triển khai: Python 3.11+ (backend, pytest + hypothesis) và TypeScript/React (frontend, vitest + React Testing Library), khớp với stack hiện có của repo.

## Tasks

- [ ] 1. Chuẩn bị types và hằng số dùng chung
  - [ ] 1.1 Định nghĩa TypedDict/Literal cho `ObjectiveSection`, `VisualBlock`, `ResolvedPeriod` ở backend
    - Tạo `backend/app/services/okr/objective_types.py` với các alias `ObjectiveCode`, `ObjectiveStatus`, `DataState`, `VisualKind` và TypedDict `ObjectiveSection`, `VisualBlock`
    - Tạo dataclass `ResolvedPeriod` trong `backend/app/services/okr/period_resolver.py` (chưa có logic, chỉ khai báo)
    - Export tập hợp các kind hợp lệ và mapping objective → kind bắt buộc cho PBT reuse
    - _Requirements: 4.2, 4.3, 4.4, 4.5_

  - [ ] 1.2 Thêm TypeScript types cho payload mới
    - Cập nhật `frontend/src/features/okr/types/` với `ObjectiveSection`, `VisualBlock`, `Period`, `TechnicalMetadata`, `DashboardPayload`
    - Export enum/literal types cho `ObjectiveCode`, `ObjectiveStatus`, `DataState`, `VisualKind`
    - Giữ tương thích với types `chart_blocks` hiện có
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 14.1, 14.2_

  - [ ] 1.3 Thêm bộ dịch tiếng Việt `vn()` ở frontend
    - Tạo `frontend/src/features/okr/i18n.ts` chứa `VN_STRINGS` mapping các token `EMPTY_CHART_DATA`, `UNCONFIRMED_EXCEL_BLOCKS`, `needs_confirmation`, `Target`, `LOW`, `MEDIUM`, `HIGH`
    - Implement helper `vn(token: string): string` với fallback trả về token gốc
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.8_

  - [ ]* 1.4 Unit test cho helper `vn()`
    - Kiểm tra mỗi token đã khai báo trả đúng bản dịch
    - Kiểm tra fallback với token không có trong mapping
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.8_

  - [ ]* 1.5 Property test: Việt hóa token nhất quán
    - **Property 18: Việt hóa token nhất quán**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.8**
    - Dùng `fast-check` (hoặc vitest property helper) sinh ngẫu nhiên token, kiểm: nếu token ∈ `VN_STRINGS` → `vn(t) === VN_STRINGS[t]`; ngược lại `vn(t) === t`
    - Tối thiểu 100 iterations

- [ ] 2. Triển khai Period Resolver (backend)
  - [ ] 2.1 Implement `resolve_default_period` và helpers tra cứu kỳ dữ liệu
    - Hoàn thiện `backend/app/services/okr/period_resolver.py` với `resolve_default_period`, `find_latest_data_period`, `find_workbook_period`
    - Xử lý đầy đủ thứ tự ưu tiên `last_selected > latest_data > workbook > today`
    - Trả về nhãn `"T{month}/{year}"` trong `ResolvedPeriod.label`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 2.2 Unit tests cho period resolver
    - Test từng nhánh ưu tiên (4 nhánh)
    - Test `last_selected` không hợp lệ bị bỏ qua
    - Test không có nguồn nào → fallback `today` với `source="current"`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 2.3 Property test: Period resolver tuân thủ thứ tự ưu tiên
    - **Property 1: Period resolver tuân thủ thứ tự ưu tiên**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
    - Dùng `hypothesis` sinh tổ hợp `(last_selected, latest_data, workbook, today)` với mỗi nguồn là `None` hoặc `(month, year)` hợp lệ
    - Kiểm resolver trả period từ nguồn ưu tiên cao nhất có giá trị
    - Kiểm idempotence: hai lần gọi liên tiếp cùng input cho kết quả bằng nhau
    - Tối thiểu 100 iterations

- [ ] 3. Triển khai Objective Sections Builder (backend)
  - [ ] 3.1 Hàm phụ trợ chọn nguồn dữ liệu theo thứ tự ưu tiên
    - Trong `backend/app/services/okr/objective_sections.py`, thêm helper `resolve_indicator_value(locked_value, normalized_value, snapshot_value, has_plan)` trả về `(value, source, data_state)` theo priority `locked > normalized > snapshot > no_plan/no_data`
    - Gắn `source` tương ứng: `db_locked`, `normalized`, `dashboard_snapshot`, hoặc `None` khi không có giá trị
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 3.2 Property test: Data priority resolution
    - **Property 17: Data priority resolution**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 13.2**
    - Hypothesis sinh tổ hợp `(locked_value, normalized_value, snapshot_value, has_plan)` (mỗi field có thể `None`)
    - Assert value/source/data_state khớp thứ tự ưu tiên đã mô tả
    - Tối thiểu 100 iterations

  - [ ] 3.3 Implement mapping nội dung O1–O6 trong `build_objective_sections`
    - Sinh đúng 6 section theo thứ tự `O1..O6` với tiêu đề tiếng Việt từ mapping R7
    - O1: ít nhất 1 `status_grid` + narrative cards vi phạm
    - O2: ít nhất 1 `bar_line_chart` theo tháng + `kpi_badges` target/result/lũy kế
    - O3: `bar_chart` STOP theo đội + `line_chart` STOP theo tháng (reuse `chart_blocks["stop_by_team"]`, `chart_blocks["stop_by_month"]`)
    - O4: narrative card tiến độ theo từng KR
    - O5: `training_bar_chart`, `radar_chart`, `kpi_badges` sáng kiến, `narrative_card` FI tách riêng, `narrative_card` AM/PM/CTKT
    - O6: `progress_card` chạy bộ, `bar_chart` hội thao, `narrative_card` chia sẻ văn hóa
    - Điền `objective_code`, `title`, `status`, `conclusion`, `visuals`, `notes`, `source_references` cho từng section
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ] 3.4 Tính `status` cho `ObjectiveSection` và `data_state` cho từng `VisualBlock`
    - Cài quy tắc `status`: `completed` / `at_risk` / `failed` / `no_plan` / `no_data` dựa trên `dashboard_status` của các KR trong objective
    - Khi thiếu dữ liệu khả dụng, gán `data_state = no_plan` hoặc `no_data` và điền `empty_message` tiếng Việt
    - Khi có dữ liệu, gán `data_state = ready` hoặc `partial` và đặt `empty_message = None`
    - _Requirements: 4.3, 4.5, 7.7, 7.8_

  - [ ]* 3.5 Unit tests cho `build_objective_sections`
    - Test: đủ dữ liệu kỳ T4/2026 → 6 section với visuals hợp lệ
    - Test: kỳ rỗng → 6 section, `status=no_data`, mỗi visual có `data_state` no_data và `empty_message` tiếng Việt
    - Test: chỉ có snapshot → các visual dùng snapshot có `source="dashboard_snapshot"`
    - Test: vừa có locked vừa có snapshot → ưu tiên locked, snapshot chỉ bổ sung thiếu
    - Test: FI tách khỏi sáng kiến ở O5
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 10.2, 10.3, 13.2_

  - [ ]* 3.6 Property test: 6 section với empty_message hợp lệ
    - **Property 6: `objective_sections` luôn có đủ 6 section với empty_message hợp lệ**
    - **Validates: Requirements 4.1, 7.7, 7.8**
    - Hypothesis sinh input (bao gồm input rỗng) và assert: luôn có 6 phần tử theo đúng thứ tự; với `data_state ∈ {no_plan, no_data}` thì `empty_message` là chuỗi tiếng Việt không rỗng; với `ready/partial` có thể `None`

  - [ ]* 3.7 Property test: Mỗi objective chứa các visual kind bắt buộc
    - **Property 7: Mỗi objective chứa các visual kind bắt buộc**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**
    - Hypothesis sinh input với và không có dữ liệu cho từng objective; assert mỗi section chứa ≥1 `VisualBlock` cho các kind bắt buộc theo mapping R7 (kể cả khi `data_state` là `no_data`/`no_plan`)

- [ ] 4. Wiring `build_dashboard_view` và route `/okr/dashboard/latest`
  - [ ] 4.1 Bổ sung `period`, `objective_sections`, `technical_metadata` vào `build_dashboard_view`
    - Sửa `backend/app/services/okr/dashboard.py`: sau khi build `chart_blocks`, gọi `build_objective_sections(...)`
    - Thêm key `period = {month, year, label, data_state}` với quy tắc `data_state`: `ready`/`partial`/`no_data`
    - Tách `technical_metadata = {warnings, source_references, latest_data_period}` bên cạnh root `warnings` (giữ để tương thích)
    - Bọc `build_objective_sections` trong try/except: lỗi → `objective_sections=[]` + warning `OBJECTIVE_SECTIONS_BUILD_FAILED`
    - Không thay đổi chữ ký `build_dashboard_view`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 14.1, 14.2, 14.3, 14.4_

  - [ ]* 4.2 Property test: Payload preservation và schema invariants
    - **Property 5: Payload preservation và schema invariants**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 10.5, 14.1, 14.2, 14.3**
    - Hypothesis sinh input `(team_reports, historical_snapshots, headcounts, fi_counts_by_team, month, year)`
    - Assert payload chứa field cũ, field mới, và schema của `ObjectiveSection`/`VisualBlock` đúng ràng buộc

  - [ ]* 4.3 Property test: Build failure degrades gracefully
    - **Property 19: Build failure degrades gracefully**
    - **Validates: Requirements 14.4**
    - Inject lỗi vào `build_objective_sections` (monkeypatch) và assert response có `objective_sections=[]`, warning `OBJECTIVE_SECTIONS_BUILD_FAILED`, không ảnh hưởng field cũ

  - [ ]* 4.4 Property test: Technical metadata không rò rỉ sang objective_sections
    - **Property 13: Technical metadata không rò rỉ sang objective_sections**
    - **Validates: Requirements 3.3, 10.6, 13.5**
    - Hypothesis sinh warnings/needs_confirmation và assert không `ObjectiveSection`/`VisualBlock` nào chứa các token kỹ thuật trong `title`, `conclusion`, `empty_message`, `notes`

  - [ ] 4.5 Thêm endpoint `GET /okr/dashboard/latest`
    - Sửa `backend/app/api/routes/okr.py`: thêm route mới nhận `last_selected_month`, `last_selected_year`
    - Gọi `resolve_default_period(...)` với nguồn từ DB (latest data) và workbook
    - Trả payload dashboard tương ứng, bổ sung `period.source = resolved.source`
    - Giữ nguyên `GET /okr/dashboard/{month}/{year}`, chỉ mở rộng payload theo 4.1
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 4.6 Integration tests cho dashboard API
    - `GET /okr/dashboard/latest` khi DB trống → fallback `today`
    - `GET /okr/dashboard/latest` khi có report T4/2026 → trả T4
    - `GET /okr/dashboard/4/2026` trên fixture snapshot → `objective_sections` không rỗng, `period.data_state ∈ {ready, partial}`
    - `GET /okr/dashboard/5/2026` trên fixture chỉ có T4 → `period.data_state = "no_data"`, `technical_metadata.latest_data_period = {month:4, year:2026}`
    - _Requirements: 2.1, 2.2, 2.3, 13.1, 13.2, 13.3, 13.4_

- [ ] 5. Checkpoint - Backend hoàn chỉnh
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Frontend visual primitives và renderer
  - [ ] 6.1 Trích các chart primitive từ `ChartBlocks.tsx`
    - Tách `BarBlock`, `LineBlock` hiện có thành primitive dùng chung trong `frontend/src/features/okr/components/charts/`
    - Không đổi render hiện tại của `ChartBlocks.tsx` (giữ tương thích)
    - Thêm primitive `BarLineChartInline`, `TrainingBarChart`, `RadarChartInline`, `StatusGrid`, `NarrativeCard`, `ProgressCard`, `KpiBadges`
    - Chỉ dùng CSS/SVG inline, không thêm dependency
    - _Requirements: 11.3, 11.4_

  - [ ] 6.2 Component `NoPlanBlock` và `NoDataBlock`
    - Tạo `frontend/src/features/okr/components/EmptyBlocks.tsx` với `NoPlanBlock` (nhãn `Không có KH trong tháng`) và `NoDataBlock` (nhãn `Chưa có dữ liệu`)
    - Gắn icon riêng khác icon chart thành công
    - _Requirements: 6.5, 6.6, 11.6_

  - [ ] 6.3 Component `VisualBlockRenderer`
    - Tạo `frontend/src/features/okr/components/VisualBlockRenderer.tsx`
    - Dispatch theo `kind` sang đúng primitive; khi `data_state ∈ {no_plan, no_data}` → render `NoPlanBlock`/`NoDataBlock` thay vì khung chart
    - Không crash khi `payload` thiếu field, sử dụng default an toàn
    - _Requirements: 6.1, 6.2, 6.3, 6.8, 11.6_

  - [ ]* 6.4 Unit tests cho `VisualBlockRenderer` và primitives
    - Test mỗi `kind` render đúng component
    - Test `data_state=ready` render chart, `data_state=no_plan` render `NoPlanBlock`, `data_state=no_data` render `NoDataBlock`
    - Test payload thiếu không làm crash
    - _Requirements: 6.1, 6.2, 6.3, 6.8_

- [ ] 7. Component `ObjectiveSection` và `ObjectiveDashboard`
  - [ ] 7.1 Component `ObjectiveStatusBadge`
    - Tạo `frontend/src/features/okr/components/ObjectiveStatusBadge.tsx` render badge với class phản ánh `status`
    - Hỗ trợ đủ 5 trạng thái: `completed`, `at_risk`, `failed`, `no_plan`, `no_data`
    - _Requirements: 11.1_

  - [ ] 7.2 Component `ObjectiveSection`
    - Tạo `frontend/src/features/okr/components/ObjectiveSection.tsx`
    - Header: `[O1] {title}` + `<ObjectiveStatusBadge />`
    - Body: nếu có `conclusion` → `NarrativeBlock`; duyệt `visuals` qua `VisualBlockRenderer`
    - Nếu `visuals` rỗng và không có `conclusion`: `status=no_plan` → `NoPlanBlock`; `status=no_data` → `NoDataBlock`
    - Field thiếu → để trống phần tương ứng, không bỏ qua section
    - _Requirements: 5.2, 5.3, 5.5, 6.4, 6.5, 6.6, 6.7, 11.1_

  - [ ] 7.3 Component `ObjectiveDashboard`
    - Tạo `frontend/src/features/okr/components/ObjectiveDashboard.tsx`
    - Duyệt `sections` theo thứ tự backend trả về, render `ObjectiveSection`
    - Không render `chart_blocks` như section chính
    - Truyền `onDrillDown` xuống từng section
    - _Requirements: 5.1, 5.4, 5.5_

  - [ ]* 7.4 Unit tests cho `ObjectiveSection` và `ObjectiveDashboard`
    - Test render 6 section đúng thứ tự
    - Test section có conclusion → render NarrativeBlock
    - Test section rỗng `status=no_plan` → text `Không có KH trong tháng`
    - Test section rỗng `status=no_data` → text `Chưa có dữ liệu`
    - Test field thiếu không làm section biến mất
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 7.5 Property test: Thứ tự render khớp thứ tự backend
    - **Property 10: Thứ tự render khớp thứ tự backend**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - Dùng `fast-check` sinh mảng `objective_sections` với thứ tự xáo trộn; assert thứ tự xuất hiện trong DOM khớp input; field thiếu vẫn giữ section

  - [ ]* 7.6 Property test: Empty-state rendering khi không có dữ liệu khả dụng
    - **Property 8: Empty-state rendering khi không có dữ liệu khả dụng**
    - **Validates: Requirements 6.2, 6.3, 6.5, 6.6, 6.8, 11.6**
    - Sinh `ObjectiveSection` không có visuals ready/partial và không có conclusion; assert DOM đúng với quy tắc status và `empty_message`, không có `<svg>` chart

  - [ ]* 7.7 Property test: Khi có nội dung, không render fallback empty-state
    - **Property 9: Khi có nội dung, không render fallback empty-state**
    - **Validates: Requirements 6.1, 6.4, 6.7**
    - Sinh section có ít nhất 1 visual ready/partial hoặc conclusion không rỗng; assert DOM render nội dung và không chứa text fallback ở cấp section

  - [ ]* 7.8 Property test: Header chứa code, title, badge, period label
    - **Property 11: Header section chứa code, title, status badge, và period label**
    - **Validates: Requirements 11.1, 11.2, 11.5**
    - Sinh section và period; assert DOM header chứa `objective_code`, `title`, `<ObjectiveStatusBadge>` với class theo status, và `period.label` hiện ở vùng header

- [ ] 8. Component `PeriodSelector` và persistence
  - [ ] 8.1 Tách `PeriodSelector` khỏi `OKRWorkspace.tsx`
    - Tạo `frontend/src/features/okr/components/PeriodSelector.tsx` với props `value`, `onChange`, `latestDataPeriod?`
    - Hiển thị label `T{month}/{year}`
    - `onChange` ghi `localStorage.setItem("okr.last_selected_period", JSON.stringify({month, year, savedAt}))`
    - Xử lý trường hợp `localStorage` không khả dụng (try/catch)
    - _Requirements: 1.6, 11.5_

  - [ ] 8.2 Helper đọc/ghi `Last_Selected_Period`
    - Tạo `frontend/src/features/okr/lastSelectedPeriod.ts` với `readLastSelectedPeriod()` và `writeLastSelectedPeriod()`
    - Validate khi đọc: `month ∈ [1,12]`, `year ∈ [2020,2100]`, `savedAt` parse được; nếu không hợp lệ → trả `null` và clear
    - _Requirements: 1.1, 1.2, 1.6_

  - [ ]* 8.3 Unit test cho `PeriodSelector` và persistence
    - Test `onChange` lưu đúng vào localStorage
    - Test đọc lại giá trị sau khi mount
    - Test validate loại bỏ giá trị không hợp lệ
    - _Requirements: 1.6_

  - [ ]* 8.4 Property test: Last_Selected_Period persistence round-trip
    - **Property 2: Last_Selected_Period persistence round-trip**
    - **Validates: Requirements 1.6**
    - `fast-check` sinh chuỗi period `P1..Pn` hợp lệ; sau khi play sequence `onChange(Pi)` → `readLastSelectedPeriod()` = `Pn`
    - Tối thiểu 100 iterations

- [ ] 9. Component `EmptyStateBanner`
  - [ ] 9.1 Implement `EmptyStateBanner`
    - Tạo `frontend/src/features/okr/components/EmptyStateBanner.tsx`
    - Nếu có `latestDataLabel` → hiển thị text + nút `Chuyển sang {latestDataLabel}` với aria-label tham chiếu label
    - Nếu không → hiển thị text `Chưa có dữ liệu dashboard cho {currentLabel}.`
    - Khi banner hiển thị: caller chịu trách nhiệm không render chart/số liệu
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 9.2 Unit test cho `EmptyStateBanner`
    - Test hiển thị đúng khi có và không có `latestDataLabel`
    - Test nút gọi đúng callback khi click
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 9.3 Property test: EmptyStateBanner chứa các nhãn kỳ đúng quy tắc
    - **Property 3: EmptyStateBanner chứa các nhãn kỳ đúng quy tắc**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - Sinh `(currentLabel, latestDataLabel | null)`; assert DOM chứa `currentLabel`; chứa `latestDataLabel` và nút chuyển nhanh khi và chỉ khi `latestDataLabel !== null`

- [ ] 10. Component `TechnicalPanel` và role resolver
  - [ ] 10.1 Helper `resolveTechnicalRole`
    - Tạo `frontend/src/features/okr/roleResolver.ts`
    - Map: `Admin`/`Workshop_Leader`/`FI_Coordinator` → kỹ thuật; nếu chỉ có vai trò nghiệp vụ → `Business_User`; hỗn hợp → `Mixed_Role_User`; chỉ kỹ thuật → `Admin_User`; vai trò không xác định → `Business_User` (an toàn)
    - _Requirements: 3.1, 3.2, 3.6_

  - [ ] 10.2 Component `TechnicalPanel`
    - Tạo `frontend/src/features/okr/components/TechnicalPanel.tsx`
    - Mặc định thu gọn
    - `Business_User`: không render nút toggle
    - `Admin_User`/`Mixed_Role_User`: có đúng một toggle; khi mở → liệt kê warnings theo nhóm với nhãn tiếng Việt qua `vn()` và giữ mã kỹ thuật gốc ở phần chi tiết
    - `useEffect([role])` reset state `expanded` khi role đổi
    - Nếu `Business_User` vào qua URL có state mở → hiển thị nội dung nhưng không có nút mở/đóng
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 9.7_

  - [ ]* 10.3 Unit tests cho `TechnicalPanel` và `resolveTechnicalRole`
    - Test `Business_User` không thấy toggle
    - Test `Admin_User`/`Mixed_Role_User` thấy toggle, mở/đóng đúng
    - Test role đổi → reset về default
    - Test `resolveTechnicalRole` với các tổ hợp vai trò
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ]* 10.4 Property test: TechnicalPanel tôn trọng vai trò
    - **Property 14: TechnicalPanel tôn trọng vai trò**
    - **Validates: Requirements 3.4, 3.5, 3.6, 3.8, 12.2**
    - `fast-check` sinh `role` và mảng warnings; assert: mount thu gọn; `Business_User` không có toggle; admin/mixed có đúng 1 toggle; khi mở → mỗi warning có nhãn VI + mã gốc; đổi role → reset

- [ ] 11. Cập nhật API client frontend
  - [ ] 11.1 Thêm `dashboardLatest` vào `client.ts`
    - Sửa `frontend/src/api/client.ts` thêm `dashboardLatest(lastSelected?)` gọi `/okr/dashboard/latest`
    - Query param `last_selected_month`/`last_selected_year` khi có `lastSelected`
    - Trả về `DashboardPayload` đã có `period`, `objective_sections`, `technical_metadata`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 11.2 Test cho client
    - Test `dashboardLatest` không có `lastSelected` → gọi đúng URL không query
    - Test có `lastSelected` → gọi đúng URL với query param
    - _Requirements: 1.6_

- [ ] 12. Wiring `OKRWorkspace` theo objective-first
  - [ ] 12.1 Thay thế render dashboard chính bằng `ObjectiveDashboard`
    - Sửa `frontend/src/features/okr/OKRWorkspace.tsx`: thay section render `ChartBlocks` bằng `<ObjectiveDashboard sections={dashboard.objective_sections} />`
    - Xóa render `<CompactKRView />` như section chính (giữ component, không unmount hoàn toàn nếu được dùng làm drill-down)
    - Giữ `<KRDrillDownPanel />` (hoặc tương đương) làm panel phụ mở từ drill-down
    - Đảm bảo dữ liệu KR vẫn có trong payload để panel phụ hoạt động
    - _Requirements: 5.1, 5.4, 8.1, 8.2, 8.4, 8.5_

  - [ ] 12.2 Bootstrap period và fetch dashboard
    - Khi mount: đọc `readLastSelectedPeriod()`; nếu có → gọi `/okr/dashboard/{m}/{y}`; nếu không → gọi `/okr/dashboard/latest`
    - Xử lý lỗi fetch `/dashboard/latest`: fallback `/okr/dashboard/{today.month}/{today.year}`
    - Cập nhật khi `PeriodSelector.onChange` → setState period + `writeLastSelectedPeriod`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ] 12.3 Render `EmptyStateBanner` khi `period.data_state === "no_data"`
    - Khi rỗng: render `<EmptyStateBanner currentLabel={period.label} latestDataLabel={technical_metadata.latest_data_period ? ... : undefined} onJumpToLatest={...} />`
    - Không render `ObjectiveDashboard`, không render chart/số liệu trong nhánh này
    - Nút "Chuyển sang {latestDataLabel}" gọi `setPeriod` và `writeLastSelectedPeriod`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 12.4 Wiring `TechnicalPanel` và layout order
    - Render `<TechnicalPanel metadata={dashboard.technical_metadata} role={resolveTechnicalRole([role])} />` ở cuối trang, sau nội dung nghiệp vụ
    - Layout đầu → cuối: header + `<PeriodSelector />` → `<EvaluationReference />`/ma trận đánh giá hiện có → `<ObjectiveDashboard />` (O1–O6) → `<MonthlyHistoryHeatmap />` nếu có → `<TechnicalPanel />`
    - Không render `KR_List_Section` như section chính
    - _Requirements: 8.1, 12.1, 12.2, 12.3_

  - [ ]* 12.5 Unit tests wiring `OKRWorkspace`
    - Test khi có `lastSelectedPeriod` → dùng period đó
    - Test khi không có → dùng kết quả `/dashboard/latest`
    - Test `period.data_state === "no_data"` → render `EmptyStateBanner`, không render chart/số liệu
    - Test layout order đúng thứ tự R12.1
    - Test không render `KR_List_Section` như section chính
    - Test drill-down mở panel phụ với KR thuộc objective
    - _Requirements: 1.1, 1.2, 2.4, 8.1, 8.2, 8.4, 12.1_

  - [ ]* 12.6 Property test: Không render chart hoặc số liệu khi kỳ không có dữ liệu
    - **Property 4: Không render chart hoặc số liệu khi kỳ không có dữ liệu**
    - **Validates: Requirements 2.4**
    - Sinh payload với `period.data_state === "no_data"`; assert DOM không chứa `svg.okr-chart`, `canvas`, `.okr-chart-bars`, `.kpi-badge`, `.metric-card .value`; chỉ có header, `PeriodSelector`, điều hướng cơ bản và `EmptyStateBanner`

  - [ ]* 12.7 Property test: Business_User không thấy token kỹ thuật trên main dashboard
    - **Property 12: Business_User không bao giờ thấy token kỹ thuật trên main dashboard**
    - **Validates: Requirements 3.1, 9.6, 13.5**
    - Sinh payload có token (`EMPTY_CHART_DATA`, `UNCONFIRMED_EXCEL_BLOCKS`, `needs_confirmation`, mã Excel `data!...`) trong `technical_metadata`; render với `role="Business_User"` (TechnicalPanel thu gọn); assert DOM vùng dashboard chính không chứa bất kỳ token nào

  - [ ]* 12.8 Property test: Layout order ổn định
    - **Property 15: Layout order ổn định**
    - **Validates: Requirements 8.1, 12.1, 12.3**
    - Sinh payload và role; assert thứ tự trục dọc: `[Header+PeriodSelector] → [Evaluation_Matrix] → [ObjectiveDashboard O1..O6] → [MonthlyHistoryHeatmap?] → [TechnicalPanel]`; không có `KR_List_Section` ở các landmark trên

  - [ ]* 12.9 Property test: Drill-down chỉ hiển thị KR thuộc objective được chọn
    - **Property 16: Drill-down chỉ hiển thị KR thuộc objective được chọn**
    - **Validates: Requirements 8.4**
    - Sinh `objective_code` và danh sách KR có `workshop_kr_code` đa dạng; mở drill-down; assert panel chỉ chứa KR khớp prefix `{objective_code}.KR`

- [ ] 13. Acceptance tests kịch bản T4/T5/2026
  - [ ]* 13.1 Integration test kỳ T4/2026 với snapshot
    - Mở `/okr/dashboard/latest` lần đầu (không `last_selected`) → trả kỳ T4/2026
    - Payload có `objective_sections` không rỗng; các visual dùng snapshot có `source="dashboard_snapshot"`
    - Warnings `needs_confirmation` chỉ xuất hiện trong `technical_metadata.warnings`
    - _Requirements: 13.1, 13.2, 13.5_

  - [ ]* 13.2 Integration/UI test kỳ T5/2026 không dữ liệu
    - Request `/okr/dashboard/5/2026` trên fixture chỉ có T4 → `period.data_state="no_data"`, `technical_metadata.latest_data_period={4,2026}`
    - Frontend render `EmptyStateBanner` với text `Chưa có dữ liệu dashboard cho T5/2026. Kỳ gần nhất có dữ liệu là T4/2026.`
    - Click nút "Chuyển sang T4/2026" chuyển về T4 và ghi `localStorage`
    - _Requirements: 2.1, 2.3, 13.3, 13.4_

- [ ] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Property tests (marked với `*`) bám theo 19 correctness properties ở `design.md`, mỗi property chạy tối thiểu 100 iterations với Hypothesis (backend) hoặc `fast-check`/property helper (frontend).
- Backend dùng Python 3.11+ với `pytest` + `hypothesis`; frontend dùng TypeScript + React + `vitest` + React Testing Library, khớp stack hiện có của repo.
- Thứ tự waves đảm bảo: types chung → backend resolver → objective builder → wiring `build_dashboard_view`/route → frontend primitives → section components → selectors/banners/panel → wiring `OKRWorkspace` → acceptance.
- Các task có khả năng xung đột ghi cùng file (ví dụ `OKRWorkspace.tsx`: 12.1, 12.2, 12.3, 12.4) được xếp vào các wave khác nhau.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "1.5", "2.1", "6.1", "6.2", "8.2", "10.1", "11.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1", "6.3", "7.1", "8.1", "9.1", "10.2", "11.2"] },
    { "id": 3, "tasks": ["3.2", "3.3", "6.4", "7.2", "8.3", "8.4", "9.2", "9.3", "10.3", "10.4"] },
    { "id": 4, "tasks": ["3.4", "7.3"] },
    { "id": 5, "tasks": ["3.5", "3.6", "3.7", "4.1", "7.4", "7.5", "7.6", "7.7", "7.8"] },
    { "id": 6, "tasks": ["4.2", "4.3", "4.4", "4.5"] },
    { "id": 7, "tasks": ["4.6", "12.1"] },
    { "id": 8, "tasks": ["12.2"] },
    { "id": 9, "tasks": ["12.3"] },
    { "id": 10, "tasks": ["12.4"] },
    { "id": 11, "tasks": ["12.5", "12.6", "12.7", "12.8", "12.9", "13.1", "13.2"] }
  ]
}
```

