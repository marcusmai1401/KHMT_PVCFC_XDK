# Audit remediation UX — local handoff

## Review bổ sung 10/09/2026

Review độc lập đã tìm và sửa thêm lỗi autosave A/B, conflict/guard, revision sau submit/mở chốt, concurrent ET/password reset, FI idempotency/upload/recovery, history SQL/facet và mobile, lỗi render sau lưu nội dung, lộ path nội bộ trong metadata, test isolation và import mặc định ghi đè. Xem [REVIEW-2026-09-10.md](REVIEW-2026-09-10.md) cho từng lỗi, test và giới hạn; [API-CONTRACT.md](API-CONTRACT.md) cho hợp đồng mới.

Full backend trên PostgreSQL: 245 passed ở mốc nạp test của run `20260910-100220-4d090b74`; các bổ sung sau có targeted evidence riêng. Frontend: 70 unit, 5 Chromium browser cases, build qua; npm audit 0 vulnerabilities. html2canvas tải khi xuất, entry gzip còn khoảng 66 KB. Không coi các số này là đã đạt tất cả AC hoặc đo performance production. Các ghi chú ngày 09/09 dưới đây là lịch sử, đã được review bổ sung ở tài liệu liên kết.

Ngày kiểm tra: 2026-09-09. Phạm vi: worktree local và dữ liệu synthetic; chưa deploy, chưa đọc/ghi production.

## Thay đổi theo hành vi

- OKR web input dùng `expected_revision`, autosave single-flight/latest-only, recovery theo user/module/resource, conflict dialog và guard khi điều hướng, reload, logout, `beforeunload`/`pagehide`.
- API lỗi chuẩn hóa metadata (`code`, `status`, `request_id`, field errors, `retry_after`); chỉ GET được retry giới hạn. Mutation không retry mù.
- FI create/upload/transition/assign/delete kiểm tra period guard, revision và idempotency; history lọc/paging server-side với envelope ổn định.
- Dashboard STOP biểu diễn tử/mẫu đúng, không clamp tỷ lệ thật; thiếu mẫu số, 0 và số âm có trạng thái giải thích.
- ET dashboard tách account, Personnel, dashboard-eligible và assessment-ready; Staff không có ET; FI Coordinator không gọi heatmap.
- Session version được kiểm tra server-side; đổi mật khẩu/revoke-all làm token cũ vô hiệu. Login limiter dùng Redis khi có cấu hình và fallback có TTL/bounded degraded state.
- Notification dùng visibility predicate chung và receipt theo user; trạng thái legacy không bị suy đoán thành đã đọc.
- LLM session có owner/namespace/TTL/giới hạn; tool đọc dữ liệu nhận principal và áp dụng scope.
- Feedback lưu nội bộ, consent bắt buộc, idempotency; telemetry client chỉ nhận allowlist, không ghi raw editor/password/token/chat/filename.
- Historical import mặc định preview, insert-missing giữ dữ liệu hiện hữu và rollback khi có lỗi. Excel replace cần preview token, revision, lý do và chặn kỳ locked.
- FI/OKR mutation dùng lock order thống nhất `team guard → period row → FI row → report/allocation`; team revision làm preview cũ bị từ chối với `409 FI_PREVIEW_STALE`, unlock giữ allocation ở trạng thái reopened.
- Export OKR bắt buộc `month`/`year` và artifact path riêng; file download dùng tên thân thiện tách khỏi storage key.
- Có harness isolated và backup/restore rehearsal synthetic.

## Kiểm tra local

Các lệnh và kết quả mới nhất được ghi trong `TRACEABILITY.md`. Bằng chứng local nằm tại `output/audit-2026-09-08/`, `output/audit-2026-09-09/` và `output/remediation-verification/20260909-003927-f90eaacc/`.

## Known limitations / gate còn chờ

- Chưa có PostgreSQL nhiều worker/barrier test và chưa đo benchmark 5.000 FI/10 client; SQLite local không chứng minh row-lock production.
- `npm audit --omit=dev` còn 3 cảnh báo high transitive (`browserslist`, `nanoid`, `postcss`); artifact đã lưu, chưa nâng dependency trong đợt này vì cần kiểm tra lockfile/build compatibility.
- Chưa có backup offsite thật, encryption/retention job thật hoặc restore production. RPO 24 giờ/RTO 4 giờ chỉ là mục tiêu đề xuất chờ xác nhận.
- Chưa có người dùng đại diện/thiết bị iPhone thật cho usability study; walkthrough local không được gọi là user validation.
- LLM store hiện process-local khi không cấu hình Redis; restart/multi-worker làm mất lịch sử theo đúng trạng thái đã giải thích trong API.
- Artifact metadata đầy đủ/pending-reconcile và migration rehearsal từ mọi revision legacy vẫn cần gate vận hành bổ sung.
