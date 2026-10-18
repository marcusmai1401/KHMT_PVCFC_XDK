# Contract bổ sung trong remediation local

Đây là phần hợp đồng đã sửa và kiểm tra, không phải danh mục đầy đủ mọi endpoint. OpenAPI sinh từ app là nguồn schema chi tiết. Phiên bản backend và frontend phải được phát hành đồng bộ; chưa có lệnh deploy nào được thực thi từ review này.

| Luồng | Request / response |
|---|---|
| OKR web input | GET `/api/v1/okr/web-input/{team}/{month}/{year}` trả revision. Draft PUT, submit/lock/unlock POST yêu cầu `expected_revision`; lock còn cần `expected_fi_team_revision` và `expected_plan_hash` từ preview. |
| ET assessment | PUT assessment, POST submit và refresh-required-scores yêu cầu revision. Revision bao phủ cả điểm/ghi chú con và trạng thái. |
| Client cũ | Thiếu revision hoặc preview binding được yêu cầu: HTTP 428 `CLIENT_UPDATE_REQUIRED`; không bỏ qua kiểm tra. |
| Conflict | HTTP 409 `VERSION_CONFLICT`, `current_revision` khi tài nguyên đã đổi. Không tự retry mutation hoặc lấy revision mới rồi ghi đè. UI tải riêng bản server và cần lựa chọn của người dùng. |
| Kỳ chốt | HTTP 409 `PERIOD_LOCKED`/`REPORT_LOCKED`; Admin cũng phải mở chốt có lý do. |
| Preview cũ | Backend FI hiện dùng `FI_PREVIEW_STALE`; client chuẩn hóa thành `PREVIEW_STALE`. Cần preview lại, không tự finalize một kế hoạch khác. |
| FI create | `Idempotency-Key` ổn định theo thao tác. Cùng actor/key/payload trả hồ sơ trước; payload khác trả `IDEMPOTENCY_CONFLICT`. UI giữ key qua timeout/reload. |
| FI image | Key riêng theo record/ảnh. Replay được tra trước revision; cùng lần upload với revision ban đầu trả ảnh đã nhận. API xác minh nội dung ảnh và MIME, giới hạn byte đọc. |
| History FI | GET `/api/v1/fi/history`: page mặc định 1, page_size 25, tối đa 100. Trả `items`, `total`, `summary`, `facets`, `applied_filters`, `has_next`, `total_pages`, `data_revision`, `sort`. SQL lọc/đếm trước LIMIT và serialize. Facet là metadata toàn history có quyền, summary theo bộ lọc đang áp dụng. |
| History filters/export | `q`, `registration_year`, đội, tháng đăng ký, author/submitter keys, decisions, KHMT, kỳ KHMT, completion được gửi rõ. Person key `id:<id>` hoặc `name:<normalized>:team:<normalized>`. Export dùng cùng điều kiện; cần thêm ma trận tổ hợp regression. |
| Nội dung/file | Save/submit thành công vẫn trả 200 nếu render sau commit lỗi: `artifact_status=pending` và warning. Nội dung đã lưu; không yêu cầu tạo lại báo cáo. File pointer chỉ cập nhật nếu revision còn khớp. |
| Phiên | Token chứa session version. Đổi/reset mật khẩu và revoke-all tăng version trong transaction; token cũ bị từ chối. Sau 401, client dừng mutation mới đến khi cài token mới; đăng nhập lại giữ đúng user và recovery namespace. |
| Notification | List/read dùng cùng predicate nhận; receipt riêng user, UPSERT chống trùng. Cờ read legacy không suy ra danh tính, trả `legacy_unknown` khi phù hợp. |
| Lỗi client | Giữ status/code/fields/request ID/Retry-After. HTML proxy không hiện nguyên văn. GET retry hữu hạn với lỗi tạm thời; mutation không tự retry. |

Schema tăng thêm: migrations 0012–0017 bổ sung revision/session version, idempotency/receipt, period/team guards, feedback và hai unique index report current. Draft hiện hành và published hiện hành được cùng tồn tại; mỗi luồng tối đa một row trong cùng đội/tháng/năm. Migration 0017 dừng nếu phát hiện duplicate legacy, không chọn bản thắng. PostgreSQL `alembic_version.version_num` được mở rộng để chứa revision ID dài.

Migration 0018 thêm index thứ tự FI `coalesce(created_at, submitted_at, updated_at) DESC, id DESC`; không sửa dữ liệu. History lấy trang và tổng bằng cùng SQL window; trang vượt phạm vi vẫn trả tổng đúng bằng truy vấn aggregate dự phòng. JSON tháng/năm không hợp lệ hoặc quá dài được fallback, tránh lỗi integer overflow trên PostgreSQL.

Giới hạn: `data_revision=max(revision)` hiện chưa phải token thay đổi toàn tập có thể phát hiện mọi insert/delete; không dùng nó làm bằng chứng tuyệt đối cache/scroll chưa đổi. File orphan reconciler, legacy rehearsal toàn bộ và cutover production còn nằm trong review pending.
