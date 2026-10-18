# Migration, backup, restore and release runbook

## Local synthetic rehearsal

Review 10/09 bổ sung harness bắt buộc trước import engine. Chạy từ repo root:

```powershell
backend/.venv/Scripts/python.exe backend/scripts/test_isolation_guard.py
backend/.venv/Scripts/python.exe backend/scripts/run_isolated_checks.py
backend/.venv/Scripts/python.exe backend/scripts/run_isolated_checks.py --suite postgres-local --postgres-bin output/review-2026-09-10/tools/pgsql/bin --migrate
backend/.venv/Scripts/python.exe backend/scripts/run_isolated_checks.py --suite postgres-local --postgres-bin output/review-2026-09-10/tools/pgsql/bin -- tests/integration/test_postgres_concurrency.py
```

PostgreSQL portable chỉ cần khi dùng `postgres-local`; không cài service. Harness tạo cluster dưới thư mục evidence mới, chọn cổng loopback và dừng cluster sau chạy. Không truyền connection string từ môi trường thật. CI dùng PostgreSQL service giả riêng và `--suite postgres-ci`. Head hiện tại là `0018_fi_history_order`; 0017 preflight dừng khi nhiều current report cùng luồng, giữ nguyên dữ liệu cũ; 0018 thêm index thứ tự lịch sử FI. Migration database rỗng và rehearsal dữ liệu legacy đã qua SQLite/PostgreSQL; chạy app rollback và rehearsal đầy đủ vẫn là gate riêng. `--migrate` chỉ chạy Alembic; chạy pytest ở lệnh riêng. Harness từ chối trộn hai chế độ để không bỏ qua test âm thầm.

FI history performance lab (chạy riêng khi không có test tải khác):

```powershell
backend/.venv/Scripts/python.exe backend/scripts/run_isolated_checks.py --suite postgres-local --postgres-bin output/review-2026-09-10/tools/pgsql/bin -- tests/integration/test_history_performance_lab.py -s
```

Đọc `history-performance-{in-process,loopback}-{uniform,varied}.json` trong run directory: 5.000 FI, 10 client, 21 warmup request và 50 mẫu đo mỗi dataset. `varied` thêm 40 users, 4 đội, 12 tháng, 5 trạng thái và hồ sơ legacy. `loopback` chạy Uvicorn một worker trong subprocess, chỉ bind 127.0.0.1, dùng đúng môi trường giả của harness và tự dừng sau đo. `target_met=false` nghĩa là chưa đạt gate 500 ms dù pytest kiểm tra dữ liệu passed. Không coi TestClient in-process hoặc loopback là đo production/reverse proxy. Hàm bỏ dấu dùng `normalize(..., NFD)` có sẵn PostgreSQL 16 và hàm SQLite tương đương; không cần cài extension.

Use a new fixture database/storage and a new restore destination for every run. The script refuses the normal workspace database/storage paths and never overwrites an existing restore directory.

```text
python backend/scripts/backup_rehearsal.py backup \
  --database <synthetic>/database.sqlite3 \
  --storage <synthetic>/storage \
  --output-root <synthetic>/backups \
  --app-revision <git-sha> \
  --schema-revision <alembic-revision>

python backend/scripts/backup_rehearsal.py restore \
  --backup-dir <synthetic>/backups/snapshot-... \
  --restore-root <new-synthetic>/restore-...
```

The manifest records UTC start/end, duration, database size/checksum, referenced files, file checksums, row counts, application/schema revision, proposed retention and restore status. A missing or altered referenced file fails verification. The restored copy rewrites copied database file references to the new storage root; the source is untouched.

The current local design proposes 7 daily, 4 weekly and 3 monthly copies. At least one encrypted, access-controlled copy outside the VPS is required before production release, but its provider, retention and credentials are a product/infrastructure decision. Proposed targets are RPO 24 hours and RTO 4 hours; neither is evidence of achieved production capability.

## Alembic migration rehearsal

1. Create a synthetic database from the previous Alembic revision.
2. Insert realistic legacy rows: a draft and locked report, FI allocation, image/file references, users with changed role/password, and legacy notification read values.
3. Run `alembic upgrade head` against that database.
4. Compare counts, checksums, current IDs, status, allocation links, session version and legacy receipt semantics. Run the application contract tests.
5. Re-run the migration command to prove idempotent behavior. Do not autoclean duplicate current lanes; stop with a diagnostic if preflight finds them.

Additive schema rollback is preferred. Roll back the application image to a schema-compatible build; do not restore a database dump over new production transactions as the default release rollback.

## Production release gate

### File retention preview

New OKR web-input Excel/email files and FI images are registered under `storage/artifact-manifests` before being written. `python -m scripts.reconcile_artifacts` from `backend` previews only these manifest-owned files. It preserves every file referenced by any report version or FI image, files younger than 24 hours and every legacy file without a manifest. Invalid/traversing manifests are reported and skipped.

To apply in an authorized maintenance window, pause all writers first and use `python -m scripts.reconcile_artifacts --apply --writers-paused`. This is an operator assertion, not an automatic global lock. Do not schedule apply while the app is accepting writes. No cleanup was executed on production during this review. Other export/import generators still require provenance integration before claiming complete coverage of R17.6.

Before any production operation, a reviewed operator must choose the offsite backup destination, maintenance/write-pause policy, migration window, session cutover timing and rollback owner. The operator must inspect the actual backup inventory and health output, approve the scope, and retain the command transcript without credentials. This repository does not authorize that operation.
