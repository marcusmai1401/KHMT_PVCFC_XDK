# Requirements Document

## Introduction

Tính năng `Objective-First Dashboard` chuyển dashboard OKR web từ mô hình "data-block-first" (render các khối dữ liệu rời rạc như STOP, đào tạo, ET/KNL, VHDN) sang mô hình "objective-first" bám theo workbook Excel gốc: dashboard được tổ chức theo 6 mục tiêu chiến lược `O1 → O6`, mỗi mục tiêu có tiêu đề, trạng thái, kết luận, biểu đồ và ghi chú riêng.

Tính năng giải quyết hai nhóm vấn đề đã được ghi nhận trong `docs/findings-okr-dashboard-current-issues.md`:

1. Luồng dữ liệu/kỳ báo cáo chưa đúng: UI mặc định mở kỳ hiện tại (T5/2026) thay vì kỳ mới nhất có dữ liệu (T4/2026), dẫn đến chart trống và cảnh báo kỹ thuật `EMPTY_CHART_DATA` lộ ra giao diện nghiệp vụ.
2. Thiết kế dashboard chưa bám nghiệp vụ: chart_blocks rời rạc, lặp `Tất cả KR` với `Ma trận đánh giá`, thuật ngữ tiếng Anh/debug token lẫn vào UI, thiếu visual hierarchy cho từng objective.

Phạm vi tính năng bao gồm: logic chọn kỳ báo cáo, ẩn/tách metadata kỹ thuật, payload `objective_sections` và renderer mới theo `O1 → O6`, gỡ/thu gọn `Tất cả KR`, Việt hóa chuỗi UI, ưu tiên dữ liệu locked DB report trước snapshot, và nâng chất lượng visual. Phạm vi KHÔNG bao gồm sửa launcher `start-dev.cmd -ResetData` (được tách thành spec riêng).

## Glossary

- **Dashboard_System**: Hệ thống dashboard OKR web bao gồm backend builder và frontend renderer.
- **Period_Selector**: Thành phần chọn kỳ báo cáo (tháng/năm) trên dashboard.
- **Objective_Code**: Mã mục tiêu chiến lược, giá trị thuộc `{O1, O2, O3, O4, O5, O6}`.
- **Objective_Section**: Khối hiển thị tương ứng một mục tiêu, gồm `objective_code`, `title`, `status`, `conclusion`, `visuals`, `notes`, `source_references`.
- **Visual_Block**: Đơn vị hiển thị bên trong một `Objective_Section`, có các trường `id`, `kind`, `title`, `data_state`, `empty_message`, `source`.
- **Data_State**: Trạng thái dữ liệu của `Visual_Block`, giá trị thuộc `{ready, partial, no_plan, no_data}`.
- **Objective_Status**: Trạng thái tổng thể của `Objective_Section`, giá trị thuộc `{completed, at_risk, failed, no_plan, no_data}`.
- **Technical_Metadata**: Thông tin kỹ thuật gồm `warnings`, `source_references`, mã block Excel (ví dụ `data!A3:E18`), token nội bộ (`EMPTY_CHART_DATA`, `UNCONFIRMED_EXCEL_BLOCKS`, `needs_confirmation`).
- **Technical_Panel**: Panel `Thông tin kỹ thuật` dành cho admin/debug, nơi hiển thị `Technical_Metadata`.
- **Business_User**: Người dùng nghiệp vụ thuần, không có bất kỳ vai trò kỹ thuật/admin nào.
- **Admin_User**: Người dùng có vai trò kỹ thuật/admin, có quyền truy cập `Technical_Panel`.
- **Mixed_Role_User**: Người dùng có kèm bất kỳ vai trò kỹ thuật nào (bao gồm vai trò hỗn hợp nghiệp vụ + kỹ thuật), được coi tương đương `Admin_User` về mức hiển thị `Technical_Panel`.
- **Dashboard_Builder**: Service backend tổng hợp payload dashboard.
- **Locked_Report**: Báo cáo kỳ đã được lock/submit trong DB.
- **Historical_Snapshot**: Snapshot dữ liệu nhập từ workbook Excel trước đó.
- **Workbook_Period**: Kỳ báo cáo đọc được từ tiêu đề workbook Excel khi import.
- **Last_Selected_Period**: Kỳ báo cáo mà người dùng lựa chọn gần nhất, được lưu ở phía client.
- **Latest_Data_Period**: Kỳ mới nhất có dữ liệu trong DB hoặc `Historical_Snapshot`.
- **Evaluation_Matrix**: Section `Ma trận đánh giá` hiện có, hiển thị KR theo đội.
- **KR_List_Section**: Section `Tất cả KR` hiện có trên dashboard.

## Requirements

### Requirement 1: Logic chọn kỳ báo cáo mặc định

**User Story:** Là một người dùng nghiệp vụ, tôi muốn dashboard tự mở đúng kỳ có dữ liệu khi tôi vào trang, để không phải chỉnh tay kỳ báo cáo và không thấy chart trống.

#### Acceptance Criteria

1. WHEN người dùng mở dashboard, THE Dashboard_System SHALL chọn kỳ báo cáo theo thứ tự ưu tiên sau: `Last_Selected_Period`, rồi `Latest_Data_Period`, rồi `Workbook_Period`, rồi kỳ của tháng/năm hiện tại.
2. WHEN `Last_Selected_Period` tồn tại và hợp lệ, THE Dashboard_System SHALL sử dụng `Last_Selected_Period` làm kỳ mặc định mà không xét các nguồn thấp hơn.
3. WHEN `Last_Selected_Period` không tồn tại và `Latest_Data_Period` có giá trị, THE Dashboard_System SHALL sử dụng `Latest_Data_Period` làm kỳ mặc định.
4. WHEN cả `Last_Selected_Period` và `Latest_Data_Period` đều không có và `Workbook_Period` vừa được import, THE Dashboard_System SHALL sử dụng `Workbook_Period` làm kỳ mặc định.
5. IF không có nguồn ưu tiên nào khả dụng, THEN THE Dashboard_System SHALL chọn kỳ báo cáo bằng tháng/năm hiện tại làm kỳ fallback và cho phép mở dashboard ngay cả khi kỳ hiện tại không có dữ liệu.
6. WHEN người dùng thay đổi kỳ báo cáo qua `Period_Selector`, THE Dashboard_System SHALL lưu kỳ được chọn vào `Last_Selected_Period` cho phiên kế tiếp.

### Requirement 2: Thông báo khi kỳ đang xem không có dữ liệu

**User Story:** Là một người dùng nghiệp vụ, tôi muốn biết rõ vì sao dashboard rỗng và kỳ nào đang có dữ liệu, để tôi chuyển sang kỳ đúng thay vì nghĩ hệ thống lỗi.

#### Acceptance Criteria

1. WHEN kỳ đang xem không có dữ liệu và `Latest_Data_Period` tồn tại, THE Dashboard_System SHALL hiển thị thông báo tiếng Việt nêu rõ kỳ đang xem và gợi ý kỳ gần nhất có dữ liệu, ví dụ `Chưa có dữ liệu dashboard cho T5/2026. Kỳ gần nhất có dữ liệu là T4/2026.`
2. WHEN kỳ đang xem không có dữ liệu và không có `Latest_Data_Period`, THE Dashboard_System SHALL hiển thị thông báo tiếng Việt `Chưa có dữ liệu dashboard cho <nhãn kỳ>.`
3. WHERE thông báo kỳ-không-có-dữ-liệu được hiển thị, THE Dashboard_System SHALL cung cấp hành động cho phép chuyển nhanh sang `Latest_Data_Period` khi kỳ đó tồn tại.
4. IF kỳ đang xem không có dữ liệu, THEN THE Dashboard_System SHALL không render chart và không render số liệu giả lập, chỉ giữ lại header kỳ báo cáo, `Period_Selector`, điều hướng cơ bản và thông báo không có dữ liệu.

### Requirement 3: Ẩn mặc định metadata kỹ thuật khỏi dashboard chính

**User Story:** Là một người dùng nghiệp vụ, tôi muốn dashboard chỉ hiển thị nội dung nghiệp vụ, để không bị rối bởi các token kỹ thuật như `data!A3:E18` hay `EMPTY_CHART_DATA`.

#### Acceptance Criteria

1. WHERE người xem là `Business_User`, THE Dashboard_System SHALL không hiển thị các token kỹ thuật `EMPTY_CHART_DATA`, `UNCONFIRMED_EXCEL_BLOCKS`, `needs_confirmation`, hoặc mã vùng Excel dạng `data!<range>` trong khu vực dashboard chính.
2. WHERE người xem là `Admin_User` hoặc `Mixed_Role_User`, THE Dashboard_System SHALL được phép hiển thị token kỹ thuật trong khu vực dashboard chính khi admin kích hoạt chế độ xem kỹ thuật để phục vụ troubleshooting.
3. THE Dashboard_System SHALL gom toàn bộ `Technical_Metadata` (warnings, source_references, mã block Excel) vào `Technical_Panel`.
4. WHERE người xem là `Business_User`, THE Dashboard_System SHALL hiển thị `Technical_Panel` ở trạng thái thu gọn và không cung cấp điều khiển mở rộng panel cho `Business_User`.
5. WHERE người xem là `Admin_User` hoặc `Mixed_Role_User`, THE Dashboard_System SHALL hiển thị `Technical_Panel` ở trạng thái thu gọn mặc định và cung cấp điều khiển (toggle/link) để mở rộng panel.
6. WHEN phiên người dùng chuyển từ `Admin_User`/`Mixed_Role_User` sang `Business_User` hoặc ngược lại, THE Dashboard_System SHALL đặt lại trạng thái `Technical_Panel` về mặc định theo vai trò mới (thu gọn và không cho mở rộng với `Business_User`; thu gọn nhưng cho phép mở rộng với `Admin_User`/`Mixed_Role_User`).
7. IF một `Business_User` truy cập được `Technical_Panel` qua URL trực tiếp hoặc state phiên, THEN THE Dashboard_System SHALL cho phép xem nội dung panel nhưng không cung cấp điều khiển mở/đóng panel.
8. WHEN `Technical_Panel` được mở rộng bởi `Admin_User` hoặc `Mixed_Role_User`, THE Dashboard_System SHALL liệt kê warnings theo nhóm với nhãn tiếng Việt và giữ mã kỹ thuật gốc ở phần chi tiết.

### Requirement 4: Payload `objective_sections` cho dashboard

**User Story:** Là nhà phát triển frontend, tôi muốn nhận payload đã được nhóm theo mục tiêu O1–O6, để render dashboard theo đúng cấu trúc báo cáo nghiệp vụ mà không phải tự gom lại từ chart_blocks.

#### Acceptance Criteria

1. THE Dashboard_Builder SHALL thêm trường `objective_sections` vào payload phản hồi của API dashboard, là một danh sách gồm đúng sáu phần tử tương ứng `O1`, `O2`, `O3`, `O4`, `O5`, `O6` theo thứ tự này.
2. THE Dashboard_Builder SHALL đảm bảo mỗi `Objective_Section` có các trường `objective_code`, `title`, `status`, `conclusion`, `visuals`, `notes`, `source_references`.
3. THE Dashboard_Builder SHALL gán `status` của mỗi `Objective_Section` một giá trị thuộc `{completed, at_risk, failed, no_plan, no_data}`.
4. THE Dashboard_Builder SHALL đảm bảo mỗi `Visual_Block` trong `visuals` có các trường `id`, `kind`, `title`, `data_state`, `empty_message`, `source`.
5. THE Dashboard_Builder SHALL gán `data_state` của mỗi `Visual_Block` một giá trị thuộc `{ready, partial, no_plan, no_data}`.
6. THE Dashboard_Builder SHALL bổ sung trường `period` vào payload gồm `month`, `year`, `label`, `data_state` mô tả kỳ báo cáo đang trả về.
7. THE Dashboard_Builder SHALL bổ sung trường `technical_metadata` vào payload chứa `warnings` và `source_references` đã được tách khỏi `objective_sections`.
8. THE Dashboard_Builder SHALL giữ các trường cũ (`columns`, `teams`, `leader_kpi_allocations`, `kpi_allocation_summary`, `monthly_history`, `chart_blocks`, `warnings`) trong payload để đảm bảo tương thích ngược với client cũ.

### Requirement 5: Render dashboard chính theo Objective

**User Story:** Là một người dùng nghiệp vụ, tôi muốn dashboard web trình bày theo từng mục tiêu O1–O6 giống workbook Excel, để đọc báo cáo theo đúng mạch từ O1 tới O6 thay vì danh sách block rời rạc.

#### Acceptance Criteria

1. THE Dashboard_System SHALL render khu vực dashboard chính bằng cách duyệt `objective_sections` theo đúng thứ tự trả về từ backend.
2. THE Dashboard_System SHALL hiển thị trong mỗi `Objective_Section`: mã `objective_code`, tiêu đề `title`, huy hiệu `Objective_Status`, và đoạn `conclusion` nếu có.
3. WHERE một `Objective_Section` thiếu hoặc không đầy đủ một trong các trường (`objective_code`, `title`, `status`, `conclusion`), THE Dashboard_System SHALL vẫn hiển thị `Objective_Section` đó với các trường sẵn có và bỏ trống các trường thiếu thay vì bỏ qua toàn bộ section.
4. THE Dashboard_System SHALL không render `chart_blocks` như một section chính độc lập, kể cả khi `objective_sections` trả về rỗng.
5. THE Dashboard_System SHALL phân tách các `Objective_Section` bằng header/section band rõ ràng để mỗi mục tiêu là một băng nội dung độc lập.

### Requirement 6: Logic hiển thị "có gì vẽ nấy, không có thì kết luận"

**User Story:** Là một người dùng nghiệp vụ, tôi muốn với mỗi mục tiêu: có dữ liệu thì vẽ biểu đồ, có kết luận thì hiện kết luận, không có kế hoạch thì ghi rõ, không có dữ liệu thì ghi rõ, để không thấy chart trắng hoặc card rỗng.

#### Acceptance Criteria

1. WHEN `data_state` của một `Visual_Block` bằng `ready` hoặc `partial`, THE Dashboard_System SHALL render biểu đồ tương ứng với `kind` của `Visual_Block`.
2. WHEN `data_state` của một `Visual_Block` bằng `no_plan`, THE Dashboard_System SHALL render khối thông báo tiếng Việt dựa trên `empty_message`, ví dụ `Không có KH trong tháng`, thay vì render khung biểu đồ.
3. WHEN `data_state` của một `Visual_Block` bằng `no_data`, THE Dashboard_System SHALL render khối thông báo tiếng Việt dựa trên `empty_message`, ví dụ `Chưa có dữ liệu`, thay vì render khung biểu đồ.
4. IF `Objective_Section` không có `Visual_Block` nào ở trạng thái `ready` hoặc `partial` nhưng có `conclusion`, THEN THE Dashboard_System SHALL hiển thị `conclusion` dưới dạng khối văn bản kết luận.
5. IF `Objective_Section` không có `Visual_Block` và không có `conclusion`, THEN THE Dashboard_System SHALL hiển thị thông báo `Không có KH trong tháng` khi `status` là `no_plan`.
6. IF `Objective_Section` không có `Visual_Block` và không có `conclusion`, THEN THE Dashboard_System SHALL hiển thị thông báo `Chưa có dữ liệu` khi `status` là `no_data`.
7. WHERE `Objective_Section` có ít nhất một `Visual_Block` hoặc có `conclusion`, THE Dashboard_System SHALL render nội dung khả dụng và không áp dụng các fallback thông báo ở AC 5 và AC 6, bất kể giá trị của `status`.
8. THE Dashboard_System SHALL không render khung biểu đồ rỗng khi không đủ dữ liệu và không render số liệu placeholder.

### Requirement 7: Mapping nội dung cho từng mục tiêu O1–O6

**User Story:** Là một người dùng nghiệp vụ, tôi muốn mỗi mục tiêu hiển thị đúng nội dung nghiệp vụ kỳ vọng, để dashboard web bám sát workbook Excel.

#### Acceptance Criteria

1. THE Dashboard_Builder SHALL điền vào `O1` các visual về tình trạng sự cố dừng máy/mất sản lượng/lỗi chủ quan, gồm ít nhất một `Visual_Block` kiểu `status_grid` và cho phép thêm các card ghi chú vi phạm.
2. THE Dashboard_Builder SHALL điền vào `O2` các visual về bảo dưỡng định kỳ, sửa chữa đột xuất, bảo dưỡng tổng thể và hạng mục nâng cao độ tin cậy, gồm ít nhất một `Visual_Block` kiểu `bar_line_chart` theo tháng kèm huy hiệu target/result.
3. THE Dashboard_Builder SHALL điền vào `O3` các visual về chương trình STOP (theo đội và lũy kế) cùng các chỉ số an toàn/sức khỏe/môi trường, gồm ít nhất một `Visual_Block` kiểu `bar_chart` theo đội và một `Visual_Block` kiểu `line_chart` theo tháng.
4. THE Dashboard_Builder SHALL điền vào `O4` các hạng mục cải tiến chuyên môn dưới dạng narrative card có trạng thái tiến độ theo từng KR.
5. THE Dashboard_Builder SHALL điền vào `O5` các visual về ET/khung năng lực, đào tạo nội bộ, AM/PM, FI, sáng kiến, CTKT, bao gồm `Visual_Block` kiểu `training_bar_chart` cho đào tạo và `Visual_Block` kiểu `radar_chart` cho khung năng lực khi đủ dữ liệu, đồng thời tách FI thành `Visual_Block` riêng không gộp với sáng kiến.
6. THE Dashboard_Builder SHALL điền vào `O6` các visual về chạy bộ, hội thao, chia sẻ văn hóa và hoạt động chung, gồm ít nhất một `Visual_Block` tiến độ chạy bộ và một `Visual_Block` mức độ tham gia hội thao.
7. WHERE một nội dung mục tiêu không có dữ liệu trong kỳ, THE Dashboard_Builder SHALL gán `Visual_Block` tương ứng `data_state` là `no_plan` hoặc `no_data` kèm `empty_message` tiếng Việt thay vì bỏ qua `Visual_Block`.
8. WHERE một nội dung mục tiêu có sẵn dữ liệu nhưng không có kế hoạch trong kỳ, THE Dashboard_Builder SHALL được phép gán `data_state` của `Visual_Block` là `no_plan`, coi trạng thái kế hoạch độc lập với mức độ sẵn có của dữ liệu.

### Requirement 8: Loại bỏ `Tất cả KR` khỏi dashboard chính

**User Story:** Là một người dùng nghiệp vụ, tôi không muốn thấy section `Tất cả KR` lặp lại với `Ma trận đánh giá`, để trang dashboard gọn và tập trung vào mục tiêu.

#### Acceptance Criteria

1. THE Dashboard_System SHALL không hiển thị `KR_List_Section` như một section chính trên dashboard objective-first, kể cả khi panel phụ KR đang được hiển thị đồng thời.
2. THE Dashboard_System SHALL cho phép người dùng tra cứu chi tiết danh sách KR qua `Evaluation_Matrix`, hoặc qua panel phụ/drawer, hoặc qua drill-down từ một KR/mục tiêu cụ thể.
3. IF các phương thức truy cập KR thay thế (`Evaluation_Matrix`, panel phụ, drill-down) tạm thời không khả dụng do lỗi hệ thống hoặc đang tải, THEN THE Dashboard_System SHALL cho phép tạm không có phương thức truy cập KR và vẫn giữ quy tắc không hiển thị `KR_List_Section` như section chính.
4. WHEN người dùng mở drill-down từ một `Objective_Section`, THE Dashboard_System SHALL hiển thị danh sách KR liên quan đến mục tiêu đó trong panel phụ.
5. THE Dashboard_System SHALL không xóa dữ liệu KR khỏi payload backend và vẫn giữ khả năng hiển thị thông qua `Evaluation_Matrix` hoặc panel drill-down.

### Requirement 9: Việt hóa chuỗi UI nghiệp vụ

**User Story:** Là một người dùng nghiệp vụ tiếng Việt, tôi muốn dashboard dùng tiếng Việt nhất quán, để không phải đọc các token tiếng Anh hoặc thuật ngữ kỹ thuật.

#### Acceptance Criteria

1. THE Dashboard_System SHALL thay chuỗi `EMPTY_CHART_DATA` trên giao diện nghiệp vụ bằng `Chưa có dữ liệu biểu đồ cho kỳ này`.
2. THE Dashboard_System SHALL thay chuỗi `UNCONFIRMED_EXCEL_BLOCKS` trên giao diện nghiệp vụ bằng `Một số vùng Excel chưa xác nhận mapping`.
3. THE Dashboard_System SHALL thay chuỗi `needs_confirmation` trên giao diện nghiệp vụ bằng `Cần xác nhận`.
4. THE Dashboard_System SHALL thay nhãn `Target` trên giao diện nghiệp vụ bằng `Mục tiêu` và thay `LOW` bằng `Mức thấp`.
5. THE Dashboard_System SHALL hiển thị toàn bộ label biểu đồ, tooltip, tiêu đề section và thông báo trống bằng tiếng Việt trên giao diện nghiệp vụ.
6. WHERE `Business_User` đang xem dashboard và `Technical_Panel` đang đóng, THE Dashboard_System SHALL không hiển thị mã kỹ thuật gốc ở bất kỳ vị trí nào trên giao diện.
7. WHERE `Technical_Panel` được mở bởi `Admin_User` hoặc `Mixed_Role_User`, THE Dashboard_System SHALL được phép giữ lại mã kỹ thuật gốc kèm mô tả tiếng Việt.
8. IF bản dịch tiếng Việt cho một chuỗi UI không có sẵn, THEN THE Dashboard_System SHALL hiển thị token tiếng Anh gốc làm fallback thay vì ném lỗi.

### Requirement 10: Thứ tự ưu tiên nguồn dữ liệu của Dashboard Builder

**User Story:** Là nhà phát triển backend, tôi muốn dashboard builder tổng hợp dữ liệu theo một thứ tự ưu tiên rõ ràng, để dữ liệu locked không bị snapshot ghi đè và dashboard vẫn hiển thị được khi chỉ có snapshot.

#### Acceptance Criteria

1. THE Dashboard_Builder SHALL đánh giá từng nguồn dữ liệu độc lập theo thứ tự ưu tiên: `Locked_Report` trong DB, rồi dữ liệu FI/headcount đã chuẩn hóa, rồi `Historical_Snapshot` từ workbook, rồi fallback trạng thái `no_plan`/`no_data`; mỗi chỉ số được lấy từ nguồn ưu tiên cao nhất có giá trị mà không yêu cầu các nguồn ưu tiên cao hơn phải đồng thời tồn tại cho toàn bộ dashboard.
2. WHEN `Locked_Report` tồn tại cho một chỉ số, THE Dashboard_Builder SHALL dùng giá trị từ `Locked_Report` và không ghi đè bằng `Historical_Snapshot`.
3. WHEN `Locked_Report` không cung cấp một chỉ số nhưng `Historical_Snapshot` có, THE Dashboard_Builder SHALL dùng `Historical_Snapshot` để bổ sung chỉ số đó và gán `source` của `Visual_Block` tương ứng là `dashboard_snapshot` hoặc giá trị tương đương.
4. WHEN một chỉ số không có ở bất kỳ nguồn nào, THE Dashboard_Builder SHALL gán `data_state` cho `Visual_Block` liên quan là `no_data` hoặc `no_plan` tùy ngữ nghĩa kế hoạch.
5. THE Dashboard_Builder SHALL tách payload thành các phần: dữ liệu ma trận đánh giá KR, dữ liệu visual dashboard, dữ liệu cảnh báo/debug, dữ liệu source reference.
6. IF `Historical_Snapshot` chứa dữ liệu mà workbook gốc chưa xác nhận mapping, THEN THE Dashboard_Builder SHALL ghi cảnh báo vào `technical_metadata.warnings` nhưng không làm block không xác nhận xuất hiện trên dashboard chính.

### Requirement 11: Chất lượng visual dashboard

**User Story:** Là một người dùng nghiệp vụ, tôi muốn dashboard nhìn giống một báo cáo quản trị với visual hierarchy rõ ràng, để đọc nhanh được trạng thái từng mục tiêu.

#### Acceptance Criteria

1. THE Dashboard_System SHALL hiển thị mỗi `Objective_Section` bằng một band/section có header chứa `objective_code`, tên mục tiêu và huy hiệu `Objective_Status`.
2. THE Dashboard_System SHALL hiển thị KPI `Mục tiêu`/`Kết quả`/`Lũy kế` dưới dạng huy hiệu (KPI badge) nổi bật khi `Visual_Block` cung cấp các giá trị này.
3. THE Dashboard_System SHALL gắn icon có ý nghĩa cho các nhóm: an toàn (O3), bảo trì (O2), đào tạo (O5), FI/cải tiến (O4, O5), VHDN (O6).
4. THE Dashboard_System SHALL render biểu đồ bằng CSS/SVG inline ở phạm vi tính năng này và không bắt buộc phụ thuộc vào thư viện chart nặng.
5. THE Dashboard_System SHALL hiển thị tiêu đề kỳ báo cáo (ví dụ `T4/2026`) ở đầu dashboard và cho phép thay đổi kỳ qua `Period_Selector`.
6. THE Dashboard_System SHALL hiển thị trạng thái thiếu dữ liệu của `Visual_Block` bằng khối thông báo tiếng Việt có icon phân biệt với khối biểu đồ thành công.

### Requirement 12: Bố cục trang dashboard

**User Story:** Là một người dùng nghiệp vụ, tôi muốn trang dashboard có thứ tự bố cục ổn định, để dễ di chuyển giữa các phần.

#### Acceptance Criteria

1. THE Dashboard_System SHALL sắp xếp các khu vực trang dashboard theo thứ tự: header kỳ báo cáo với `Period_Selector`, `Evaluation_Matrix`, khu vực objective-first gồm `O1` đến `O6`, lịch sử tháng khi khả dụng, `Technical_Panel` ở cuối.
2. THE Dashboard_System SHALL giữ `Technical_Panel` ở trạng thái thu gọn và đặt sau tất cả nội dung nghiệp vụ.
3. WHEN người dùng kéo đến cuối trang, THE Dashboard_System SHALL không yêu cầu người dùng đi qua `KR_List_Section` như một block chính, kể cả khi `Technical_Panel` đang hiển thị cho `Admin_User` hoặc `Mixed_Role_User`.

### Requirement 13: Tiêu chí nghiệm thu dữ liệu kỳ T4/T5

**User Story:** Là một người kiểm thử, tôi muốn xác nhận dashboard xử lý đúng hai trường hợp cụ thể: kỳ T4/2026 có snapshot và kỳ T5/2026 không có dữ liệu, để đảm bảo mô hình objective-first hoạt động đúng đầu cuối.

#### Acceptance Criteria

1. WHEN workbook/snapshot của kỳ T4/2026 được import và người dùng mở dashboard lần đầu, THE Dashboard_System SHALL mặc định chọn kỳ T4/2026 theo quy tắc ưu tiên trong Requirement 1.
2. WHEN dashboard đang ở kỳ T4/2026 và chỉ có `Historical_Snapshot`, THE Dashboard_Builder SHALL sử dụng `Historical_Snapshot` để render các `Objective_Section` có dữ liệu và gán `source` tương ứng.
3. WHEN dashboard đang ở kỳ T5/2026 và không có dữ liệu, THE Dashboard_System SHALL hiển thị thông báo `Chưa có dữ liệu dashboard cho T5/2026. Kỳ gần nhất có dữ liệu là T4/2026.` và không render số liệu giả lập.
4. WHEN dashboard đang ở kỳ T5/2026 và không có dữ liệu, THE Dashboard_System SHALL cung cấp hành động chuyển nhanh sang kỳ T4/2026.
5. IF `technical_metadata.warnings` có cảnh báo mapping chưa xác nhận ở kỳ T4/2026, THEN THE Dashboard_System SHALL ghi nhận cảnh báo vào `Technical_Panel` và không hiển thị cảnh báo trong dashboard chính.

### Requirement 14: Tương thích ngược với client cũ

**User Story:** Là nhà phát triển bảo trì, tôi muốn API dashboard mới vẫn chạy được với client cũ, để việc triển khai payload mới không làm gián đoạn người dùng đang dùng bản frontend cũ.

#### Acceptance Criteria

1. THE Dashboard_Builder SHALL giữ nguyên tên và schema của các trường payload hiện có (`columns`, `teams`, `leader_kpi_allocations`, `kpi_allocation_summary`, `monthly_history`, `chart_blocks`, `warnings`).
2. THE Dashboard_Builder SHALL thêm các trường mới (`period`, `objective_sections`, `technical_metadata`) mà không thay đổi kiểu dữ liệu của các trường hiện có.
3. WHEN client cũ không đọc các trường mới, THE Dashboard_System SHALL vẫn trả về dashboard render được từ `chart_blocks` cho client cũ.
4. IF cấu trúc `objective_sections` phát sinh lỗi build, THEN THE Dashboard_Builder SHALL tiếp tục xử lý các phần payload khác và trả về phản hồi với `objective_sections` rỗng, ghi cảnh báo vào `technical_metadata.warnings` thay vì hủy toàn bộ response.
