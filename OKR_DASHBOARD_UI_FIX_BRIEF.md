# OKR Dashboard UI Fix Brief

## Mục tiêu

Tài liệu này dành cho AI Agent tiếp theo đọc nhanh bối cảnh và sửa lại phần **Ma trận đánh giá** trong `OKR dashboard`.

Người dùng không hài lòng với UI hiện tại vì ma trận đang quá rối, xấu, nặng thị giác và vẫn buộc người xem phải quét quá nhiều thông tin. Đây phải là khu vực tổng hợp nhanh nhất của dashboard: nhìn vào là biết đội/tổ nào ổn, đội/tổ nào có vấn đề, mục tiêu nào có rủi ro.

Không cần sửa lại logic dữ liệu backend trừ khi phát hiện bug rõ ràng. Trọng tâm là UI/UX frontend.

## Trạng thái Hiện Tại

Project đang chạy FastAPI backend và React/Vite frontend.

Frontend chính:

- `frontend/src/features/okr/OKRWorkspace.tsx`
- `frontend/src/styles.css`

Backend liên quan:

- `backend/app/services/okr/dashboard.py`
- `backend/app/api/routes/okr.py`

Payload dashboard:

- API: `GET /api/v1/okr/dashboard/{month}/{year}`
- Type frontend: `frontend/src/features/okr/types/dashboard.ts`

Hiện tại đã có các yêu cầu dữ liệu sau và phải giữ:

- Mọi vai trò đều xem chung dữ liệu **toàn Xưởng** trong `OKR dashboard`.
- Luôn hiển thị đủ 4 đội/tổ: `TBHTĐK`, `TBCH`, `TBĐL`, `TCĐK`.
- Nếu kỳ đó đội/tổ chưa cập nhật OKR thì hiển thị `N/A`, không giả lập `OK` hoặc `Hoàn thành`.
- `DashboardTeamRow.has_report` cho biết đội/tổ có dữ liệu kỳ đó hay chưa.
- `DashboardTeamRow.kr_statuses` chứa trạng thái KR theo mã, ví dụ `O5.KR13`.
- Status thường gặp: `OK`, `GOOD`, `NG`, `NOK`, `#N/A`.

Các thay đổi backend đã có:

- `backend/app/services/okr/dashboard.py`
  - Dòng quanh `84`: mặc định `monthly = "N/A"`, `discipline = "#N/A"`.
  - Dòng quanh `105`: thêm `has_report`.
  - Dòng quanh `154`: `_visible_teams()` luôn trả đủ `TEAMS`, không lọc theo `Team_Account`.
- `backend/app/api/routes/okr.py`
  - Dòng quanh `347`: cache key đã có namespace/version `okr:dashboard:v2`.

Không nên revert các thay đổi backend trên.

## Vấn Đề UI Hiện Tại

Phần hiện tại trong `OKRWorkspace.tsx`:

- `EvaluationMatrixOverview` bắt đầu quanh dòng `365`.
- `ObjectiveHeatmapCell` bắt đầu quanh dòng `457`.
- Các helper liên quan: `hasTeamReport`, `displayAssessment`, `displayAllocation`, `statusTone`, `teamObjectiveStats`, `objectiveStatusStats`, `objectiveTone`, `objectiveVerdict`.

CSS hiện tại:

- `.okr-matrix-overview` quanh dòng `891` và lại override quanh dòng `1289`.
- Nhóm `.okr-heatmap-*` quanh dòng `1295` trở đi.
- Các style cũ `.okr-objective-card`, `.okr-objective-table-*` vẫn còn trong file và có thể gây nhiễu.

UI hiện tại đang xấu vì:

- Quá nhiều số nhỏ và chip nhỏ trong từng ô.
- Các chấm KR có số `1,2,3...` tạo cảm giác như bảng kỹ thuật thô, không phải dashboard quản trị.
- Mật độ thông tin quá cao, nhìn vào không thấy thứ tự ưu tiên.
- Hàng `O5` có 15 KR làm vỡ nhịp thị giác.
- Cột và row quá lớn, bảng vẫn chiếm nhiều không gian.
- Màu xanh/đỏ/xám lặp lại dày đặc, gây nhiễu thay vì giúp đọc nhanh.
- Người dùng cần một tổng hợp nhanh “đập vào mắt”, không phải bảng chi tiết tất cả KR.

## Yêu Cầu UX Cần Đạt

Thiết kế lại `Ma trận đánh giá` theo hướng executive summary, gọn, chuyên nghiệp.

Yêu cầu bắt buộc:

- Desktop khoảng `1600x900`: phần ma trận chính phải nhìn gọn trong first viewport, không buộc kéo ngang.
- Không hiển thị toàn bộ chi tiết KR ngay trên ma trận chính.
- Không dùng dot grid nhiều số như hiện tại.
- Ma trận chính chỉ nên trả lời nhanh:
  - Đội/tổ nào đã cập nhật?
  - Đánh giá tháng của đội/tổ là gì?
  - Đội/tổ có vi phạm quy định không?
  - Mỗi mục tiêu `O1..O6` đang đạt, rủi ro, hay thiếu dữ liệu?
- Chi tiết KR chỉ mở khi người dùng bấm vào mục tiêu hoặc trạng thái.
- Giữ tương tác hiện tại:
  - Bấm vào mục tiêu `O1..O6` mở `ObjectiveKRPanel`.
  - Bấm vào KR cụ thể mở `KRDrillDownPanel`.

## Hướng Thiết Kế Khuyến Nghị

Nên thay heatmap hiện tại bằng một bảng executive compact:

Columns đề xuất:

- `Đội/Tổ` khoảng 110-130px
- `Đánh giá tháng` khoảng 130-150px
- `Quy định` khoảng 70px
- `KPI LĐ` khoảng 75px
- `O1`, `O2`, `O3`, `O4`, `O5`, `O6` mỗi cột khoảng 95-115px

Mỗi ô mục tiêu chỉ hiển thị:

- Một status badge lớn: `Đạt`, `Rủi ro`, `N/A`, hoặc `Một phần`.
- Một dòng nhỏ: ví dụ `13/15 KR đạt`, `2 NG`, `3 N/A`.
- Không hiển thị từng KR trong ô chính.

Khi bấm vào ô mục tiêu:

- Mở panel chi tiết bên phải hoặc bên dưới, liệt kê KR của mục tiêu đó cho đội/tổ được chọn.
- Có thể reuse `ObjectiveKRPanel`, nhưng tốt hơn là tạo panel mới hiển thị theo `team + objective`.
- Nếu không làm panel mới, ít nhất bấm vào header `O1` vẫn mở danh sách KR của toàn mục tiêu như hiện tại.

Visual style:

- Palette nhẹ, ít màu:
  - Đạt: xanh nhạt nền, chữ xanh đậm.
  - Rủi ro: đỏ nhạt nền, chữ đỏ đậm.
  - N/A: xám nhạt nền, chữ xám đậm.
  - Một phần: xanh/xám hoặc vàng nhạt, không quá chói.
- Không dùng chip quá nhỏ, không dùng chữ uppercase quá nhiều.
- Row height nên khoảng 56-68px.
- Border mảnh, ít box-shadow.
- Font nhỏ nhưng rõ, không nhồi quá nhiều label.

## Logic Tổng Hợp Status Gợi Ý

Cho mỗi đội/tổ và mục tiêu:

```ts
type ObjectiveCellSummary = {
  total: number;
  ok: number;
  risk: number;
  na: number;
  label: "Đạt" | "Rủi ro" | "Một phần" | "N/A";
};
```

Rules gợi ý:

- Nếu `na === total`: `N/A`
- Nếu `risk > 0`: `Rủi ro`
- Nếu `ok === total`: `Đạt`
- Nếu `ok > 0 && na > 0`: `Một phần`
- Nếu còn lại: `Rủi ro` hoặc `Một phần` tùy thực tế status.

`GOOD` nên tính cùng nhóm đạt.

`#N/A`, `N/A`, `NA`, empty nên tính là thiếu dữ liệu.

`NG`, `NOK` và status lạ không thuộc nhóm đạt/NA nên tính là rủi ro.

## Những Gì Nên Xóa/Thay

Trong `frontend/src/features/okr/OKRWorkspace.tsx`:

- Thay `EvaluationMatrixOverview` hiện tại.
- Có thể xóa hoặc không dùng `ObjectiveHeatmapCell`.
- Có thể giữ helper `displayStatus`, `isNaStatus`, `isGoodStatus`, nhưng nên viết helper summary rõ hơn.

Trong `frontend/src/styles.css`:

- Nên thay toàn bộ nhóm `.okr-heatmap-*`.
- Có thể dọn các block cũ không còn dùng:
  - `.okr-objective-table-stack`
  - `.okr-objective-table-row`
  - `.okr-kr-dot-grid`
  - `.okr-kr-dot`
  - các style heatmap cũ tạo dot grid.
- Cẩn thận vì `styles.css` đang chứa nhiều module khác như FI, ET, Admin. Chỉ sửa class OKR dashboard, không sửa global quá rộng.

## Các Thành Phần Không Nên Làm Hỏng

Không làm hỏng:

- `PeriodSelector`
- Upload/import/export buttons trong toolbar.
- `KRDrillDownPanel`
- `ObjectiveDashboard`
- `MonthlyHistoryHeatmap`
- `DisciplineViolations`
- FI workspace
- Web input OKR
- Sandbox/test account flow

## Kiểm Thử

Chạy frontend:

```bash
cd frontend
npm run build
npm test -- src/features/okr/DashboardComponents.test.tsx
```

Nếu sửa logic backend hoặc type payload:

```bash
python3 -m pytest -s backend/tests/unit/test_dashboard_enhancement.py backend/tests/property/test_okr_properties.py -q
```

Sau khi deploy hoặc chạy local, cần kiểm bằng mắt:

- Login bằng tài khoản Admin hoặc đội/tổ.
- Vào `OKR` -> `OKR dashboard`.
- Chọn `T4/2026`.
- Kiểm tra đủ 4 đội/tổ.
- Không có kéo ngang ở viewport desktop phổ biến.
- Ma trận chính đọc được trong 5 giây.
- `T5/2026` hoặc kỳ thiếu dữ liệu phải hiển thị `N/A` rõ ràng.
- Bấm vào mục tiêu/KR vẫn mở panel chi tiết.

## Lưu Ý Về Deploy

Production đang chạy ở VPS qua Docker Compose:

- `docker-compose.prod.yml`
- App path trên VPS thường là `/opt/okr-system`
- Frontend bundle được serve tại `http://103.200.20.225`

Nếu chỉ sửa frontend, chỉ cần rebuild frontend container. Nếu sửa backend dashboard payload, rebuild cả backend và frontend.

## Tóm Tắt Cho Agent Tiếp Theo

Nhiệm vụ chính không phải thêm dữ liệu mới. Nhiệm vụ là thiết kế lại ma trận `OKR dashboard` cho gọn và chuyên nghiệp.

Hãy giữ backend full-workshop/N-A logic hiện tại. Hãy thay UI heatmap/dot-grid hiện tại bằng một executive matrix ít chi tiết hơn, ưu tiên đọc nhanh, vừa màn hình desktop, và mở chi tiết bằng tương tác khi cần.
