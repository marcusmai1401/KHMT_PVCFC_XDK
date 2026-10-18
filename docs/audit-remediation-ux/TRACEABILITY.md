# Traceability and review record

> Review độc lập 10/09 phát hiện sai lệch và thiếu bằng chứng trong các kết luận bên dưới. Xem [REVIEW-2026-09-10.md](REVIEW-2026-09-10.md) để biết các lỗi đã sửa và gate còn thiếu. Bảng ngày 09/09 được giữ như lịch sử, không phải xác nhận worktree hiện tại đã đạt toàn bộ specs.

## Environment boundary

| Item | Evidence | Status |
|---|---|---|
| Source spec | `specs/audit-remediation-ux/{requirements,design,tasks}.md` | read |
| Baseline commit | `c3cdcc90fbaf995fa13d5e116d46314206593cd9` | recorded |
| Database/storage | isolated pytest fixtures and `backend/scripts/run_isolated_checks.py` | local pass; production untouched |
| Production writes/deploy | no command executed | pending authorization |
| Synthetic evidence | `output/audit-2026-09-08/` | available |

## Requirement coverage

| Requirement group | Implementation | Verification | Status |
|---|---|---|---|
| R01–R03 | isolated harness, deploy command, insert-only seeds/import | deploy/security tests; harness manifest; seed tests | local |
| R04–R05 | shared draft controller, recovery/guard, revision contracts | frontend controller/client tests; web-input API tests | local |
| R06–R09 | stable team/period guards, atomic FI allocation/idempotency, upload recovery | FI/web-input integration/unit tests; stale-preview regression | local SQLite; PostgreSQL concurrency pending |
| R10–R13 | FI history envelope/paging, STOP renderer, ET population | API and dashboard renderer tests | local |
| R14–R16 | typed errors, session version, limiter, notification receipts | client/auth/security/notification tests | local; PostgreSQL/shared-worker pending |
| R17 | scoped export, preview/replace binding, isolated file names | workbook/API tests | local; full artifact reconciler pending |
| R18 | synthetic backup/restore script and runbook | `test_backup_rehearsal.py` and rehearsal output | local synthetic; offsite pending |
| R19–R20 | login limiter and LLM owner/namespace/tool scope | limiter/LLM tests | local; shared-worker pending |
| R21–R23 | shared UX patterns, ET/FI/OKR states, feedback, allowlisted telemetry | frontend tests/build; renderer/feedback tests | local; human UX study pending |
| R24 | migrations, evidence package and this traceability record | compile, tests, build, migration rehearsal | local; release gate pending |

## Role / state / device matrix

| Role | OKR | FI | ET | Admin mutation |
|---|---|---|---|---|
| Admin | read/edit/lock | full | read/edit | available, edit mode off by default |
| Workshop Leader | read/export | read/review | dashboard + heatmap | denied |
| FI Coordinator | read | coordinate/review | summary only | denied |
| Staff | read | permitted FI scope | hidden/denied | denied |
| Team Account | own read | own FI scope | own linked personnel | denied |

States covered by UI contracts: loading, refresh, empty, filter-empty, forbidden, network/server error, read-only, locked, saved, pending/partial, conflict and recovery. Device targets covered by CSS/tests include desktop and narrow mobile; WebKit/iPhone real-device and zoom/assistive-technology gates remain pending.

## Test record format

| Task | AC / case | Command | Expected | Actual |
|---|---|---|---|---|
| T02/T04 | C01/C02 | `python backend/scripts/run_isolated_checks.py -- tests/unit/test_deploy_security.py tests/unit/test_backup_rehearsal.py` | isolated run; no business import/seed | PASS, 2.037s; run `output/remediation-verification/20260909-003927-f90eaacc`; `production_db_untouched=true`, fake secret, LLM disabled |
| T07/T10/T30/T33 | C05–C08/C18/C32/C33 | `npm test -- --run` and `npm run build` from `frontend` | typed errors, latest-only autosave, guard, UX/build chunks | PASS: 8 files/63 tests; build PASS, Admin 32.06KB, ET 47.05KB, FI 99.33KB, OKR 137.11KB; main 411.09KB |
| T12/T14/T15/T16/T27/T40 | C10/C12/C26/C31/C38 | `python -m pytest -q` from `backend` | revision/lock/receipt behavior and full regression | PASS: 233 passed in 370.36s; targeted guard suite 31 passed in 94.76s; stale-preview case PASS |
| T38 | C37 | isolated harness above; `test_backup_rehearsal.py` included in full suite | isolated restore counts/checksums; no overwrite | PASS; synthetic only, offsite/production restore pending |
| Migration | C30/C38 | Alembic upgrade from `0011_fi_monthly_allocations`, then `upgrade head` twice, `current`, `heads` | additive/idempotent schema upgrade | PASS; single head `0016_fi_team_write_guards` |
| Dependency audit | R22.4 | `npm audit --omit=dev --json` | record known dependency risk | command PASS; artifact `output/audit-2026-09-09/npm-audit.json` reports 3 transitive high findings (`browserslist`, `nanoid`, `postcss`), remediation pending |

Do not mark the production column complete from this local record. Before release, append exact command output, duration, commit/diff hash, artifact path and any skipped gate. Local completion does not substitute for PostgreSQL two-connection locking, multi-worker Redis validation, 5,000-FI performance measurement, dependency remediation, offsite backup/restore, or human UX acceptance.
