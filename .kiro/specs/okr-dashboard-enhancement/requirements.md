# Requirements Document

## Introduction

Tài liệu này định nghĩa các yêu cầu chức năng cho việc nâng cấp OKR Dashboard UI. Hiện tại, dashboard chỉ hiển thị ma trận đánh giá tháng hiện tại, bảng phân bổ đội/tổ trưởng, báo cáo đã tải, và cảnh báo. Tài liệu findings `docs/findings-okr-dashboard-ui-plan.md` đã xác định các vấn đề mapping sai trong code backend và các tính năng UI còn thiếu.

Feature này sẽ:
1. Sửa các mapping KR đang sai trong backend
2. Bổ sung view lũy kế kết quả theo tháng
3. Thêm các chart/block trực quan cho các metrics quan trọng
4. Hiển thị compact view cho tất cả 37 KR
5. Cung cấp khả năng drill-down theo đội/tổ

## Glossary

- **OKR**: Objectives and Key Results - phương pháp quản trị mục tiêu
- **KR**: Key Result - kết quả then chốt trong OKR
- **Dashboard**: Giao diện hiển thị tổng quan tình hình OKR
- **Team/Đội/Tổ**: Đơn vị tổ chức (TBHTĐK, TBCH, TBĐL, TCĐK)
- **TBHTĐK**: Đội thiết bị hệ thống điều khiển
- **TBCH**: Đội thiết bị chấp hành / Đội thiết bị cơ cấu chấp hành trong một số vùng Excel
- **TBĐL**: Đội thiết bị đo / Đội thiết bị đo lường trong một số vùng Excel
- **TCĐK**: Tổ trực ca điều khiển
- **STOP**: Chương trình an toàn (Safety Training Observation Program)
- **ET**: Education & Training - Đào tạo và phát triển
- **KNL**: Khung năng lực
- **SK**: Sáng kiến
- **CTKT**: Cải tiến kỹ thuật
- **VHDN**: Văn hóa doanh nghiệp
- **TPM**: Total Productive Maintenance
- **BDĐK**: Bảo dưỡng định kỳ
- **SCĐX**: Sửa chữa đột xuất
- **Matrix**: Ma trận đánh giá trạng thái KR theo đội/tổ
- **Monthly History**: Lũy kế kết quả theo tháng
- **Chart Block**: Khối biểu đồ trực quan
- **Compact View**: Chế độ xem gọn nhẹ
- **Historical Snapshot**: Dữ liệu lịch sử import từ workbook Excel nguồn, dùng làm baseline khi DB chưa có dữ liệu thật
- **Normalized KR Code**: Mã KR dạng `O5.KR1` dùng trong hệ thống sau khi normalize từ master code như `ĐCM.O4.ĐK.O5.KR1`

## Requirements

### Requirement 1: Sửa mapping KR cho chương trình STOP

**User Story:** Là người quản lý, tôi muốn số liệu chương trình STOP được map đúng sang KR tương ứng trong master OKR, để đánh giá chính xác kết quả tham gia chương trình.

#### Acceptance Criteria

1. WHEN populate_data_sheet_from_reports được gọi, THE System SHALL map block STOP (`data!A65:E84`) sang `O3.KR2` thay vì `O3.KR1` hiện tại
2. WHEN target 200 thẻ được hiển thị, THE System SHALL khớp với master OKR 2026 (`ĐK.O3.KR2` = "Tham gia chương trình STOP", target 200)
3. THE System SHALL giữ nguyên logic aggregate số thẻ theo đội và theo tháng
4. WHEN API dashboard được gọi, THE System SHALL trả về `O3.KR2` cho STOP data trong `chart_blocks.stop_by_team` và `chart_blocks.stop_by_month`
5. THE System SHALL include source references `data!A67:E70` cho STOP by team và `data!A72:D84` cho STOP by month

### Requirement 2: Sửa mapping KR cho ET/Khung năng lực

**User Story:** Là người quản lý, tôi muốn dữ liệu khung năng lực được map đúng sang KR xây dựng khung năng lực, để theo dõi chính xác tiến độ xây dựng 8 vị trí khung năng lực.

#### Acceptance Criteria

1. WHEN populate_data_sheet_from_reports được gọi, THE System SHALL map block competency (`data!A130:B142`) sang `O5.KR1` thay vì `O5.KR15` hiện tại
2. THE System SHALL hiển thị 8 vị trí khung năng lực theo radar chart hoặc progress grid
3. WHEN target 8 vị trí được hiển thị, THE System SHALL khớp với master OKR 2026 (`ĐK.O5.KR1` = "ET: Xây dựng khung năng lực", target 8)
4. IF data source chứa nhiều hơn 8 vị trí khung năng lực, THE System SHALL không bỏ dữ liệu âm thầm; THE System SHALL hiển thị 8 vị trí target trong chart chính và expose các vị trí thừa trong drill-down hoặc warning metadata
5. THE System SHALL giữ nguyên cấu trúc dữ liệu KNL KTV BDSC và KNL KS theo đội
6. THE System SHALL include source reference `data!A135:B142` cho ET/KNL chart

### Requirement 3: Tách mapping KR cho Sáng kiến và CTKT

**User Story:** Là người quản lý, tôi muốn số liệu sáng kiến và CTKT được tách riêng thành 2 KR khác nhau, để đánh giá chính xác từng loại hình cải tiến.

#### Acceptance Criteria

1. WHEN populate_data_sheet_from_reports được gọi, THE System SHALL map block sáng kiến (`data!A110:B114`) sang `O5.KR12` (Sáng kiến được công nhận cấp tiểu ban, target 8)
2. THE System SHALL tách riêng `O5.KR13` (Ý tưởng/CTKT được công nhận cấp Xưởng, target 1) với source từ module FI
3. THE System SHALL hiển thị số sáng kiến theo đội (TBHTĐK, TBCH, TBĐL, TCĐK) và tổng xưởng kể cả khi `O5.KR13` chưa có CTKT được duyệt trong module FI
4. WHEN source cho `O5.KR12` hoặc `O5.KR13` thiếu dữ liệu, THE System SHALL trả về empty/null metric kèm warning metadata thay vì fail toàn bộ dashboard/export
5. WHEN export Excel, THE System SHALL ghi đúng KR code cho từng loại
6. THE extraction logic SHALL NOT tự động map mọi text chứa "sáng kiến" hoặc "ctkt" vào cùng một domain; THE System SHALL phân biệt `O5.KR12` sáng kiến và `O5.KR13` CTKT theo KR hint/source

### Requirement 4: Tách mapping KR cho VHDN và Hội thao

**User Story:** Là người quản lý, tôi muốn số liệu văn hóa doanh nghiệp và hội thao được tách riêng thành 2 KR khác nhau, để đánh giá chính xác từng hoạt động.

#### Acceptance Criteria

1. WHEN populate_data_sheet_from_reports được gọi, THE System SHALL map block VHDN (`data!A86:E89`) sang `O6.KR1` (Rèn luyện chạy bộ, target 2 lần)
2. THE System SHALL map block Hội thao (`data!A91:E94`) sang `O6.KR2` (Tổ chức hội thao, target 1 lần)
3. THE System SHALL hiển thị tỷ lệ tham gia (B/C với target 0.5) cho tất cả 4 đội kể cả khi tỷ lệ là 0%
4. WHEN export Excel, THE System SHALL ghi đúng KR code cho từng block
5. THE System SHALL không nhầm target tham gia `0.5` trong sheet `data` với target master `2 lần` / `1 lần`; payload SHALL include both `participation_target` and `master_target` when both are available

### Requirement 5: Thêm view lũy kế kết quả theo tháng

**User Story:** Là người quản lý, tôi muốn xem lũy kế kết quả đánh giá theo tháng trong năm, để theo dõi xu hướng và biến động thành tích của từng đội/tổ.

#### Acceptance Criteria

1. WHEN API `/api/v1/okr/dashboard/{month}/{year}` được gọi, THE System SHALL trả về `monthly_history` với 12 tháng của năm được chọn, trong đó các tháng có dữ liệu dùng DB hoặc snapshot, các tháng chưa có dữ liệu dùng `null`
2. THE System SHALL hiển thị `monthly_history` dạng heatmap hoặc timeline table với 12 cột tháng và 4 dòng đội/tổ
3. WHEN tháng chưa có dữ liệu, THE System SHALL hiển thị placeholder thống nhất (`-` hoặc trạng thái empty) và SHALL NOT hiển thị nhầm thành `HT`
4. THE System SHALL hỗ trợ data source từ cả `TeamReportModel` (DB) và historical snapshot từ Excel
5. THE UI SHALL hiển thị label "HT tốt", "HT", "Không HT" cho từng ô tháng
6. THE System SHALL ưu tiên dữ liệu thật trong DB hơn historical snapshot cho cùng team/month/year

### Requirement 6: Thêm chart blocks cho các metrics quan trọng

**User Story:** Là người quản lý, tôi muốn xem các biểu đồ trực quan cho STOP, Đào tạo, ET/KNL, và VHDN, để nhanh chóng nắm bắt tình hình mà không cần mở Excel.

#### Acceptance Criteria

1. WHEN API dashboard được gọi, THE System SHALL trả về `chart_blocks` chứa tối thiểu các block:
   - STOP by team: bar chart với 4 đội/tổ, series số thẻ ghi nhận và tổng nhân sự
   - STOP by month: line/scatter chart với T1-T12, series số thẻ theo tháng
   - Đào tạo nội bộ: plan vs actual bar chart với T1-T11
   - ET/KNL: radar chart hoặc progress grid với 8 vị trí khung năng lực
   - VHDN/rèn luyện: participation cards với tỷ lệ tham gia theo đội
   - Hội thao/chương trình chung: participation cards với tỷ lệ tham gia theo đội
2. THE System MAY trả về nhiều hơn các chart blocks trên nếu cần
3. THE Frontend SHALL render các chart sử dụng Recharts hoặc CSS/SVG đơn giản
4. WHEN chart data thiếu tháng, THE System SHALL dùng `null` hoặc omit data point; THE System SHALL chỉ hiển thị `0` khi source xác nhận actual bằng 0
5. THE System SHALL bao gồm target line hoặc target value cho mỗi chart khi applicable
6. THE System SHALL include source range cho từng chart block trong `source_references`

### Requirement 7: Thêm compact view cho tất cả 37 KR

**User Story:** Là người quản lý, tôi muốn xem tất cả KR trong một view compact, để không bỏ sót KR nào kể cả các KR ít quan trọng.

#### Acceptance Criteria

1. WHEN API dashboard được gọi, THE System SHALL trả về `minor_okr_summary` chứa tối thiểu tất cả 37 KR trong master OKR 2026 với các field: `workshop_kr_code`, `kr_name`, `target_value`, `team_statuses`, `numeric_metric` (nếu có), `dashboard_column`, `source_row`
2. THE System SHALL cho phép số lượng KR bất kỳ trong compact view nếu master mapping thay đổi trong tương lai (không hard-code đúng 37)
3. THE UI SHALL hiển thị section "Tất cả KR" với filter theo objective (O1-O6)
4. THE UI SHALL hiển thị mỗi KR dạng row/card với 4 badge trạng thái đội/tổ (`OK`, `GOOD`, `NG`, `#N/A`)
5. THE UI SHALL hỗ trợ search KR theo tên hoặc mã
6. WHEN KR có numeric metric, THE System SHALL hiển thị giá trị numeric và target comparison

### Requirement 8: Thêm team-level drill-down cho từng KR

**User Story:** Là người quản lý, tôi muốn click vào KR để xem chi tiết theo đội/tổ, để phân tích sâu hơn về thành tích của từng đơn vị.

#### Acceptance Criteria

1. WHEN user click vào một KR trong matrix hoặc compact view, THE System SHALL hiển thị drill-down panel
2. THE drill-down panel SHALL hiển thị chi tiết KR cho từng đội/tổ: trạng thái, numeric metric, target comparison, ghi chú
3. WHEN KR không có numeric metric, THE System SHALL hiển thị chỉ trạng thái OK/GOOD/NG
4. THE System SHALL hỗ trợ close panel và return to main view
5. THE UI SHALL highlight KR đang được drill-down trong main view

### Requirement 9: Mở rộng API dashboard payload

**User Story:** Là developer, tôi muốn API dashboard trả về đầy đủ các nhóm dữ liệu cần thiết, để frontend có thể render tất cả tính năng mới.

#### Acceptance Criteria

1. WHEN GET `/api/v1/okr/dashboard/{month}/{year}` được gọi, THE System SHALL trả về JSON với cấu trúc:
   - `period`: month, year
   - `matrix`: dữ liệu hiện có (columns, teams, leader_kpi_allocations, kpi_allocation_summary)
   - `monthly_history`: array kết quả theo tháng của 4 đội/tổ
   - `chart_blocks`: object chứa `stop_by_team`, `stop_by_month`, `training`, `competency`, `vhdn_running`, `vhdn_sports`
   - `minor_okr_summary`: array tất cả KR trong master với team statuses
   - `source_references`: object chứa cell/range tham chiếu để debug
2. THE System SHALL cache response trong thời gian cấu hình được, mặc định không quá 5 phút, và SHALL invalidate cache khi upload/import/submit/lock/unlock report hoặc FI record ảnh hưởng OKR
3. WHEN data thiếu, THE System SHALL trả về null/empty array kèm warning metadata thay vì error
4. THE System SHALL maintain backward compatibility với existing API consumers bằng cách vẫn trả các top-level keys hiện có (`columns`, `teams`, `leader_kpi_allocations`, `kpi_allocation_summary`) hoặc cập nhật frontend cùng lúc trong cùng change set

### Requirement 10: Import historical snapshot từ Excel nguồn

**User Story:** Là admin, tôi muốn import số liệu T1-T4 từ workbook Excel nguồn làm baseline, để dashboard có đầy đủ dữ liệu lịch sử trước khi app đi vào hoạt động.

#### Acceptance Criteria

1. WHEN admin upload workbook Excel nguồn, THE System SHALL parse `Dashboard!A20:AC25` để tạo historical snapshot
2. THE System SHALL parse các block `data` theo range đã định nghĩa trong findings document
3. THE System SHALL lưu snapshot vào DB bằng dedicated historical snapshot model/table hoặc model hiện có với `source_type = "excel_snapshot"` và flag tương đương `is_historical_snapshot`
4. WHEN DB có data thật cho tháng đó, THE System SHALL ưu tiên data thật hơn snapshot
5. THE System SHALL log warning nếu parse failure nhưng không fail toàn bộ operation
6. THE import operation SHALL be idempotent theo `source_file_hash`, `team`, `month`, `year`, và SHALL không tạo duplicate snapshot khi import lại cùng workbook
7. THE import operation SHALL chỉ cho role `Admin` thực hiện

### Requirement 11: Phân quyền truy cập dashboard

**User Story:** Là admin, tôi muốn dashboard có phân quyền truy cập theo role, để đảm bảo bảo mật thông tin.

#### Acceptance Criteria

1. WHEN user với role `Admin` truy cập dashboard, THE System SHALL cho phép full access tất cả tính năng
2. WHEN user với role `Workshop_Leader` truy cập dashboard, THE System SHALL cho phép xem dashboard và export Excel
3. WHEN user với role `FI_Coordinator` truy cập dashboard, THE System SHALL cho phép xem dashboard read-only và không cho upload/import/export nếu action đó không được cấp quyền
4. WHEN user với role `Team_Account` truy cập dashboard, THE System SHALL chỉ cho phép xem dashboard của đội/tổ tương ứng với account của mình
5. WHEN user không có quyền truy cập cố gắng truy cập dashboard, THE System SHALL trả về 403 Forbidden
6. WHEN user không có quyền cho một action, THE UI SHALL hide hoặc disable các button/action tương ứng và backend SHALL enforce cùng rule

### Requirement 12: Maintain backward compatibility với export Excel

**User Story:** Là developer, tôi muốn chức năng export Excel vẫn hoạt động đúng sau khi sửa mapping, để user không bị gián đoạn workflow hiện tại.

#### Acceptance Criteria

1. WHEN export_dashboard_workbook được gọi, THE System SHALL produce Excel file với đúng mapping đã sửa
2. WHEN export_dashboard_workbook không thể generate file do lỗi nội bộ, THE System SHALL throw error hoặc trả về failure status
3. THE System SHALL maintain các sheet `Dashboard` và `data` với cấu trúc tương thích với template hiện tại
4. WHEN source mapping bị thiếu hoặc không parse được, THE System SHALL log warning trong application log và expose warning metadata nếu dashboard/export vẫn tiếp tục được
5. THE System SHALL chạy regression test cho export function sau mỗi change
6. THE System SHALL preserve formula references nếu có trong template Excel

### Requirement 13: Giữ đúng luật đánh giá Dashboard Excel

**User Story:** Là người quản lý, tôi muốn UI áp dụng đúng luật đánh giá trong Dashboard Excel, để kết quả "Hoàn thành tốt", "Hoàn thành", "Không HT" không bị lệch so với file chuẩn.

#### Acceptance Criteria

1. THE System SHALL treat `Dashboard!M15:P15` and `Dashboard!M16:P16` as separate merged rule blocks and SHALL NOT assume one merged block `M15:P16`
2. THE System SHALL classify `Hoàn thành tốt` only when không vi phạm QĐ/QT, O1-O5 không có `NG`, and at least one GOOD bonus exists in `O6.KR1`, `O6.KR2`, or `O5.KR13`
3. THE System SHALL classify `Hoàn thành` when không vi phạm QĐ/QT and O1-O5 không có `NG` but no GOOD bonus condition is met
4. THE System SHALL classify `Không HT` when vi phạm QĐ/QT or any applicable O1-O5 KR is `NG`
5. THE System SHALL expose evaluation rule source references in `source_references.evaluation_rules`

### Requirement 14: Normalize tên đội/tổ từ Excel source

**User Story:** Là developer, tôi muốn hệ thống normalize tên đội/tổ từ nhiều vùng Excel khác nhau, để không tạo duplicate hoặc mất dữ liệu khi Excel dùng tên không đồng nhất.

#### Acceptance Criteria

1. THE System SHALL normalize `Đội thiết bị hệ thống điều khiển` and `Đội thiết bị Hệ thống điều khiển` to team code `TBHTĐK`
2. THE System SHALL normalize `Đội thiết bị đo` and `Đội thiết bị Đo lường`/`Đội thiết bị đo lường` to team code `TBĐL`
3. THE System SHALL normalize `Đội thiết bị chấp hành` and `Đội thiết bị cơ cấu chấp hành` to team code `TBCH`
4. THE System SHALL normalize `Tổ trực ca` and `Tổ trực ca điều khiển` to team code `TCĐK`
5. THE System SHALL preserve original source label in debug/source metadata

### Requirement 15: Không hard-code mapping cho các block Excel chưa xác nhận

**User Story:** Là developer, tôi muốn các block Excel chưa xác nhận mapping được đánh dấu rõ ràng, để tránh đưa số liệu vào sai KR và làm sai dashboard.

#### Acceptance Criteria

1. THE System SHALL mark `data!A3:E18` (`ĐK1.1` tổng hợp), `data!A21:E35` (`Tổ trực ca điều khiển`), and `data!A117:D127` (weekly backlog Tuần 14-22) as `mapping_status = "needs_confirmation"` until business mapping is confirmed
2. THE System SHALL expose these blocks under `source_references.unconfirmed_blocks` with source range, observed label, candidate KR codes, and reason for uncertainty
3. THE System SHALL NOT silently count these blocks into `O2.KR1`, `O2.KR2`, or `O2.KR3` in the UI dashboard without warning metadata
4. WHEN export Excel must preserve legacy output for compatibility, THE System SHALL keep the export behavior isolated from the UI dashboard view and document the mapping confidence
