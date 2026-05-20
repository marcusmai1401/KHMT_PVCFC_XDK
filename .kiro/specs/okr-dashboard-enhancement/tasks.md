# Implementation Plan: OKR Dashboard UI Enhancement

## Overview

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

Implementation language: **Python** for backend (existing FastAPI + SQLAlchemy stack) and **TypeScript + React** for frontend (existing `frontend/src/features/okr/` stack).

Phase order:
1. Backend KR/data-block mapping fixes
2. Backend support services (team normalizer, evaluation rules, chart blocks)
3. Historical snapshot persistence + parsing
4. Dashboard view builder
5. API endpoints, role filtering, cache
6. Frontend types + components + integration
7. Excel export regression
8. Final checkpoint

## Tasks

- [ ] 1. Fix KR/data-block mappings in `populate_data_sheet_from_reports`
  - [ ] 1.1 Remap STOP block from `O3.KR1` to `O3.KR2`
    - Update writes for `data!A65:E84` so both the by-team (`data!A67:E70`) and by-month (`data!A72:D84`) sub-blocks emit `O3.KR2`
    - Keep target 200 thẻ and preserve per-team/per-month aggregation logic
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ] 1.2 Remap ET/Khung năng lực competency block from `O5.KR15` to `O5.KR1`
    - Update writes for `data!A130:B142` so the competency block emits `O5.KR1` with target 8
    - Preserve KNL KTV BDSC and KNL KS per-team structure
    - _Requirements: 2.1, 2.3, 2.5, 2.6_

  - [ ] 1.3 Split Sáng kiến mapping to `O5.KR12` (`data!A110:B114`)
    - Write only sáng kiến data to `O5.KR12` with target 8
    - Rename/update internal block naming where needed so `data!A110:B114` is not treated as generic `sk_ctkt`
    - Stop collapsing sáng kiến + CTKT into the same KR; do not auto-map text containing "sáng kiến" or "ctkt" into a shared domain
    - _Requirements: 3.1, 3.5, 3.6_

  - [ ] 1.4 Wire CTKT mapping to `O5.KR13` from the FI module source
    - Add an explicit FI counts input to the dashboard/export path (for example `fi_counts_by_team`) instead of making `populate_data_sheet_from_reports` query the DB implicitly
    - Read CTKT/approved ý tưởng counts from the FI module (not the sáng kiến block)
    - Emit `O5.KR13` with target 1 and surface empty/null when FI has no approved records (no dashboard/export failure)
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [ ] 1.5 Split VHDN `O6.KR1` (`data!A86:E89`) and Hội thao `O6.KR2` (`data!A91:E94`)
    - Emit VHDN/rèn luyện chạy bộ as `O6.KR1` (master target 2 lần)
    - Emit Hội thao/chương trình chung as `O6.KR2` (master target 1 lần)
    - Do not confuse the 0.5 participation target with master targets
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

  - [ ] 1.6 Update extraction/domain routing for corrected KR mappings
    - Update `backend/app/services/okr/extraction.py` so STOP hint uses `O3.KR2` while keeping text "stop"/"thẻ" support
    - Split extraction domain for `O5.KR12` sáng kiến and `O5.KR13` CTKT/FI where KR hint/source is available
    - Ensure generic text matching does not map every "sáng kiến" and "ctkt" mention into the same output domain
    - _Requirements: 1.1, 3.6_

  - [ ] 1.7 Unit tests for mapping writes and extraction routing
    - Assert `O3.KR2`, `O5.KR1`, `O5.KR12`, `O5.KR13`, `O6.KR1`, `O6.KR2` are written to the correct cells given synthetic reports
    - Assert training block still limited to T1-T11
    - Assert extraction routing distinguishes STOP `O3.KR2`, sáng kiến `O5.KR12`, and CTKT `O5.KR13`
    - _Requirements: 1.1, 2.1, 3.1, 3.2, 3.6, 4.1, 4.2_

- [ ] 2. Implement team label normalization
  - [ ] 2.1 Create `backend/app/services/okr/team_normalizer.py`
    - Define `TEAM_LABEL_ALIASES` mapping for TBHTĐK, TBCH, TBĐL, TCĐK variants
    - Expose `normalize_team_label(value: str) -> tuple[str | None, str]` with case-insensitive and whitespace-normalized matching
    - Preserve original source label in the returned tuple for debug/source metadata
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [ ] 2.2 Unit tests for team label aliases
    - Cover all alias pairs from Requirement 14 and mixed-case/whitespace variants
    - Assert original label is returned alongside normalized team code
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ] 3. Implement evaluation rule classifier
  - [ ] 3.1 Create `backend/app/services/okr/evaluation_rules.py`
    - Treat `Dashboard!M15:P15` and `Dashboard!M16:P16` as two separate merged blocks (never a single `M15:P16`)
    - Classify `Hoàn thành tốt` / `Hoàn thành` / `Không HT` following the rule set (O1-O5 NG, discipline violation, GOOD bonus from `O6.KR1`/`O6.KR2`/`O5.KR13`)
    - Return the set of rule source cell references for inclusion under `source_references.evaluation_rules`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ] 3.2 Write property test for evaluation rule classifier
    - **Property 9: Evaluation Rule Fidelity**
    - **Validates: Requirement 13**
    - Generate arbitrary O1-O5 status sets, discipline flags, and bonus KR statuses; assert classification follows the separate `M15:P15` and `M16:P16` rule blocks
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ] 3.3 Unit tests for rule classification examples
    - Cover all three outcomes with representative fixtures
    - _Requirements: 13.2, 13.3, 13.4_

- [ ] 4. Implement chart block builders
  - [ ] 4.1 Create `backend/app/services/okr/chart_blocks.py` skeleton
    - Define `ChartBlockType` literal and `ChartBlockConfig` dataclass
    - Expose a `build_chart_blocks(...)` entry point returning the typed block map
    - Accept all non-report sources needed by charts explicitly, including headcount data and FI CTKT counts
    - Represent missing values as `None`; never coerce null to zero
    - _Requirements: 6.1, 6.4, 6.6_

  - [ ] 4.2 Implement `stop_by_team` and `stop_by_month` builders
    - `stop_by_team` bar chart with 4 teams, series "Số thẻ ghi nhận" and "Tổng nhân sự", `master_target = 200`, `source_reference = "data!A67:E70"`, `kr_code = "O3.KR2"`
    - Use explicit headcount data (`TeamHeadcountModel`/baseline) for "Tổng nhân sự"; do not infer headcount from missing report totals
    - `stop_by_month` line chart with T1-T12, `source_reference = "data!A72:D84"`, `kr_code = "O3.KR2"`
    - _Requirements: 1.4, 1.5, 6.1, 6.5, 6.6_

  - [ ] 4.3 Implement `training` builder limited to T1-T11
    - Plan vs actual bar chart with labels T1-T11 only (never invent T12 for this block)
    - `kr_code = "O5.KR3"`, `source_reference = "data!A98:N107"`
    - _Requirements: 6.1, 6.5, 6.6_

  - [ ] 4.4 Implement `competency` builder with 8 target positions
    - Progress grid (radar is a later enhancement) showing the 8 target positions
    - When source has more than 8 positions, keep the 8 in the main chart and expose the extras under `warnings`/drill-down metadata — never silently drop
    - `kr_code = "O5.KR1"`, `master_target = 8`, `source_reference = "data!A135:B142"`
    - _Requirements: 2.2, 2.4, 2.6, 6.1, 6.6_

  - [ ] 4.5 Implement `vhdn_running` and `vhdn_sports` builders
    - Cards per team showing B/C ratio, always render for all 4 teams (including 0%)
    - `vhdn_running`: `kr_code = "O6.KR1"`, `participation_target = 0.5`, `master_target = 2`, `source_reference = "data!A86:E89"`
    - `vhdn_sports`: `kr_code = "O6.KR2"`, `participation_target = 0.5`, `master_target = 1`, `source_reference = "data!A91:E94"`
    - Emit both `participation_target` and `master_target` in the payload
    - _Requirements: 4.3, 4.5, 6.1, 6.5, 6.6_

  - [ ] 4.6 Implement `sk_initiatives` and `ctkt_fi` builders
    - `sk_initiatives`: `kr_code = "O5.KR12"`, per-team counts plus tổng xưởng, source `data!A110:B114`
    - `ctkt_fi`: `kr_code = "O5.KR13"`, per-team approved CTKT counts from the FI module; still render when count is zero
    - Return empty datasets + warning metadata rather than erroring when source is missing
    - _Requirements: 3.3, 3.4, 3.6, 6.1, 6.6_

  - [ ] 4.7 Write property test for competency excess handling
    - **Property 1: Competency Excess Data Preservation**
    - **Validates: Requirement 2.4**
    - Generate competency sources with arbitrary N positions; assert main chart keeps 8 positions and extras appear in drill-down/warning metadata
    - _Requirements: 2.4_

  - [ ] 4.8 Write property test for participation rate display
    - **Property 3: Participation Rate Always Displayed**
    - **Validates: Requirements 4.3, 4.5**
    - Generate VHDN/Hội thao sources including 0% participation; assert B/C ratio and `participation_target = 0.5` are present for every visible team
    - _Requirements: 4.3, 4.5_

  - [ ] 4.9 Write property test for missing chart data handling
    - **Property 5: Missing Chart Data Handling**
    - **Validates: Requirement 6.4**
    - Generate chart sources with arbitrary missing points; assert null/omit behavior and that `0` appears only when source actual is explicitly zero
    - _Requirements: 6.4_

  - [ ] 4.10 Unit tests for chart block builders
    - Cover source reference strings, `master_target`/`participation_target` values, and null-vs-zero semantics per block
    - _Requirements: 6.1, 6.4, 6.5, 6.6_

- [ ] 5. Backend service checkpoint
  - Run the backend unit/property tests added in tasks 1-4
  - Fix failures before starting persistence/API work

- [ ] 6. Historical snapshot persistence
  - [ ] 6.1 Define `HistoricalSnapshotModel`
    - Add model in the backend models module with fields: id, source_file_name, source_file_hash (indexed), source_sheet, source_range, source_label, team (indexed), month (indexed), year (indexed), monthly_assessment, kr_statuses (JSON), chart_payload (JSON), warnings (JSON), imported_by, imported_at, is_historical_snapshot
    - Add unique constraint `uq_historical_snapshot_source_period_team_range` on `(source_file_hash, team, month, year, source_range)`
    - _Requirements: 10.3, 10.6_

  - [ ] 6.2 Add migration / schema update for `historical_snapshots` table
    - Create the table and indexes matching the model
    - _Requirements: 10.3_

  - [ ] 6.3 Unit tests for unique constraint
    - Insert duplicate rows for the same `(source_file_hash, team, month, year, source_range)` and assert the constraint rejects the second insert
    - _Requirements: 10.6_

- [ ] 7. Historical snapshot parsing service
  - [ ] 7.1 Create `backend/app/services/okr/historical_snapshot.py`
    - Define the `import_historical_snapshot(workbook, *, imported_by)` entry point returning counts and warnings
    - Compute `source_file_hash` (sha256) and use it for idempotency
    - _Requirements: 10.1, 10.6_

  - [ ] 7.2 Parse `Dashboard!A20:AC25` into team monthly summaries
    - Normalize team labels via `team_normalizer`
    - Populate `monthly_assessment` per team/month/year
    - Leave `kr_statuses` empty for this range unless another parsed source explicitly provides KR statuses
    - _Requirements: 10.1_

  - [ ] 7.3 Parse `data` sheet blocks into `chart_payload`
    - Use the range table from the design (STOP, training, competency, VHDN, Hội thao, sáng kiến)
    - Mark `data!A3:E18`, `data!A21:E35`, and `data!A117:D127` as unconfirmed mapping blocks instead of assigning them silently to O2 KRs
    - Store warnings on parse failures for a given block, do not abort the whole import
    - _Requirements: 10.2, 10.5, 15.1, 15.2, 15.3_

  - [ ] 7.4 Make import idempotent by `source_file_hash`
    - On re-import of the same workbook, update/skip rows matched by the unique constraint and return `skipped_duplicates` count
    - _Requirements: 10.6_

  - [ ] 7.5 Collect and surface import warnings
    - Return `warnings` list in the import response and persist warnings per row
    - Return HTTP 400 for unrecoverable workbook/sheet errors (handled in endpoint task)
    - _Requirements: 10.5_

  - [ ] 7.6 Write property test for historical snapshot priority
    - **Property 8: Historical Snapshot Priority**
    - **Validates: Requirement 10.4**
    - For arbitrary overlapping `(team, month, year)` between DB reports and snapshots, assert the dashboard payload surfaces the DB value with `source = "db"`
    - _Requirements: 10.4_

  - [ ] 7.7 Unit tests for parser and idempotency
    - Test Dashboard parse, data block parse, hash-based idempotency, partial parse warnings
    - _Requirements: 10.1, 10.2, 10.5, 10.6_

- [ ] 8. Dashboard view builder
  - [ ] 8.1 Implement `build_dashboard_view` in `backend/app/services/okr/dashboard.py`
    - Keep `build_dashboard_matrix` as-is; call it and spread its keys for backward compatibility (`columns`, `teams`, `leader_kpi_allocations`, `kpi_allocation_summary`)
    - Add new grouped keys `period`, `matrix`, `monthly_history`, `chart_blocks`, `minor_okr_summary`, `source_references`, `warnings`
    - Accept optional `history_reports`, `historical_snapshots`, `headcounts`, `fi_counts_by_team`, and `principal` parameters
    - _Requirements: 9.1, 9.4_

  - [ ] 8.2 Build `monthly_history` with DB-over-snapshot priority
    - Produce exactly 12 month entries per visible team for the requested year
    - Tag each month with `source = "db" | "snapshot" | null`
    - Keep missing months as `null` assessment; never infer `HT`
    - _Requirements: 5.1, 5.3, 5.4, 5.6, 10.4_

  - [ ] 8.3 Build `minor_okr_summary` covering all master KRs
    - Populate `workshop_kr_code`, `kr_name`, `target_value`, `dashboard_column`, `source_row`, `team_statuses`, optional `numeric_metric`
    - Role filtering may narrow `team_statuses` but must not drop KR entries
    - Only include `numeric_metric` when numeric data exists for that KR
    - _Requirements: 7.1, 7.2, 7.4, 7.6, 8.3_

  - [ ] 8.4 Build `source_references` including `unconfirmed_blocks`
    - `data_blocks`: stop_by_team, stop_by_month, training, competency, vhdn_running, vhdn_sports, sk_initiatives, ctkt_fi when present
    - `evaluation_rules`: from `evaluation_rules.py`
    - `unconfirmed_blocks`: `data!A3:E18` (ĐK1.1 tổng hợp), `data!A21:E35` (Tổ trực ca điều khiển), `data!A117:D127` (Tuần 14-22 backlog) with `mapping_status = "needs_confirmation"` and a `reason`
    - Do not count unconfirmed blocks into O2 KRs in the UI dashboard
    - _Requirements: 2.6, 13.5, 15.1, 15.2, 15.3_

  - [ ] 8.5 Build dashboard `warnings` list
    - Collect mapping warnings, historical snapshot warnings, and chart-builder warnings into a single top-level `warnings`
    - Return null/empty arrays with warning metadata rather than failing when data is missing
    - _Requirements: 9.3, 12.4_

  - [ ] 8.6 Write property test for monthly history completeness
    - **Property 4: Monthly History Completeness**
    - **Validates: Requirements 5.1, 5.3**
    - Generate arbitrary report/snapshot coverage; assert each visible team gets exactly 12 entries and missing months are `null`, never `HT`
    - _Requirements: 5.1, 5.3_

  - [ ] 8.7 Write property test for KR summary complete coverage
    - **Property 6: KR Summary Complete Coverage**
    - **Validates: Requirements 7.1, 7.2**
    - For any master KR definition of size N, assert `minor_okr_summary` returns N entries (independent of role filtering) with all required fields present
    - _Requirements: 7.1, 7.2_

  - [ ] 8.8 Write property test for numeric metric conditional display
    - **Property 7: Numeric Metric Conditional Display**
    - **Validates: Requirements 7.6, 8.3**
    - For KRs with and without numeric metric data, assert `numeric_metric` is present/absent accordingly and drill-down shows only status badges when absent
    - _Requirements: 7.6, 8.3_

  - [ ] 8.9 Write property test for unconfirmed blocks not silent
    - **Property 10: Unconfirmed Blocks Are Not Silent**
    - **Validates: Requirement 15**
    - For `data!A3:E18`, `data!A21:E35`, `data!A117:D127`, assert values are never counted into O2 KRs without `mapping_status = "needs_confirmation"` metadata in `source_references.unconfirmed_blocks`
    - _Requirements: 15.1, 15.2, 15.3_

  - [ ] 8.10 Write property test for SK and CTKT separation
    - **Property 2: SK and CTKT Separation**
    - **Validates: Requirements 3.1-3.6**
    - Generate arbitrary inputs for SK (`O5.KR12`) and CTKT (`O5.KR13`) sources; assert neither is collapsed into the other and missing one source does not break the payload
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ] 8.11 Unit tests for dashboard view shape
    - Assert backward-compat top-level keys still exist alongside the new grouped keys
    - Assert 4 empty teams still produce 12-month history slots
    - _Requirements: 9.1, 9.4_

- [ ] 9. API endpoints, role filtering, and cache
  - [ ] 9.1 Extend `GET /api/v1/okr/dashboard/{month}/{year}`
    - Call `build_dashboard_view(...)` and return the new structured payload while keeping the old top-level keys
    - Query and wire `history_reports`, `historical_snapshots`, `TeamHeadcountModel` values, FI CTKT counts, and `principal` arguments
    - _Requirements: 9.1, 9.4_

  - [ ] 9.2 Apply role filtering in the dashboard route
    - Allow `Admin`, `Workshop_Leader`, `FI_Coordinator`, `Team_Account`
    - For `Team_Account`, derive own team from `principal["user_id"]` (team code IDs like `TBHTĐK`) and filter `matrix.teams`, `monthly_history`, `minor_okr_summary.team_statuses`, team-level `chart_blocks`, and drill-down data
    - Return 403 for other roles; enforce the same rule on the server regardless of UI
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 9.3 Implement dashboard cache with role/user scope
    - Cache key includes month, year, role, user_id, team scope (e.g. `okr:dashboard:{month}:{year}:{role}:{user_id}`) OR cache unfiltered and filter after read
    - TTL configurable, default 300 seconds, never exceeding 5 minutes (reduce from current `15 * 60`)
    - Invalidate on: report upload, web input submit, web input lock/unlock, historical snapshot import, admin KR mapping update, headcount update, FI record transition/upload/delete that changes OKR counts
    - _Requirements: 9.2_

  - [ ] 9.4 Implement `POST /api/v1/okr/historical-snapshots/import`
    - `Admin` only; accept `multipart/form-data` with an `.xlsx` workbook
    - Validate file extension/content type/size following existing upload patterns
    - Call `import_historical_snapshot(...)` and return `imported_count`, `updated_count`, `skipped_duplicates`, `months_covered`, `source_file_hash`, `warnings`
    - Return 400 on invalid workbook/missing sheets
    - Trigger cache invalidation on success
    - _Requirements: 10.1, 10.2, 10.5, 10.6, 10.7_

  - [ ] 9.5 API integration tests for role filtering and cache
    - Cover Admin/Workshop_Leader/FI_Coordinator/Team_Account behaviors (data scope, export access, import access)
    - Assert cache TTL ≤ 5 minutes and invalidation on every mutation source
    - Assert a Team_Account never receives another team's data even when Admin cached the full view first
    - _Requirements: 9.2, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 9.6 Integration tests for historical snapshot import endpoint
    - Valid workbook: counts correct, months_covered populated, DB overrides snapshot when a real report exists for the same period
    - Invalid workbook: 400 with details
    - Re-import same workbook: idempotent (skipped_duplicates)
    - Non-admin roles: 403
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [ ] 10. API checkpoint
  - Run backend unit/property/integration tests for tasks 1-9
  - Fix failures before frontend integration

- [ ] 11. Frontend types and components
  - [ ] 11.1 Add `frontend/src/features/okr/types/dashboard.ts`
    - Export `ChartBlockType`, `ChartDataset`, `ChartBlockData`, `MonthAssessment`, `MonthlyHistoryEntry`, `KRSummary`, and related types matching the backend payload
    - _Requirements: 9.1_

  - [ ] 11.2 Implement `components/MonthlyHistoryHeatmap.tsx`
    - Render a 12-column × team-row heatmap/timeline with labels `HT tốt` / `HT` / `Không HT`
    - Display `-` (or empty state) for null months; never render null as `HT`
    - _Requirements: 5.2, 5.3, 5.5_

  - [ ] 11.3 Implement `components/ChartBlocks.tsx`
    - Render `stop_by_team`, `stop_by_month`, `training`, `competency`, `vhdn_running`, `vhdn_sports` (and `sk_initiatives`, `ctkt_fi` when present)
    - CSS grid bars / inline SVG polyline first; Recharts remains optional as a later enhancement
    - Render null data points as gaps/empty cells; never show `0` for missing data
    - Show target line or target value per block when applicable
    - _Requirements: 6.1, 6.3, 6.4, 6.5_

  - [ ] 11.4 Implement `components/CompactKRView.tsx`
    - List all KRs from `minor_okr_summary` with visible-team status badges (`OK`/`GOOD`/`NG`/`#N/A`); manager roles normally see 4 team badges, `Team_Account` sees only its own team
    - Provide filter by objective O1-O6 and search by KR code or name
    - Show numeric value and target comparison only when `numeric_metric` exists
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ] 11.5 Implement `components/KRDrillDownPanel.tsx`
    - Open from matrix and compact view; show per-team status, numeric metric, target comparison, notes
    - When a KR has no numeric metric, show only status badges
    - Provide close action and highlight the active KR in the main view
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 11.6 Integrate new components into `OKRWorkspace.tsx`
    - Sections: Current matrix, Monthly history, Dashboard metrics (chart blocks), All KR compact view, Uploaded reports and warnings
    - Consume the new `/api/v1/okr/dashboard/{month}/{year}` payload via existing fetch layer
    - Surface `warnings` and `source_references.unconfirmed_blocks` visibly so unconfirmed mappings do not stay silent in the UI
    - _Requirements: 5.2, 6.1, 7.3, 8.1, 9.1, 15.3_

  - [ ] 11.7 Hide or disable unauthorized actions per role
    - `FI_Coordinator`: hide export and import actions
    - `Team_Account`: hide global team switcher / other teams' data
    - `Workshop_Leader`: allow export, hide import
    - _Requirements: 11.6_

  - [ ] 11.8 Frontend component tests
    - MonthlyHistoryHeatmap: renders 12 columns, null shown as `-`
    - ChartBlocks: all six required blocks render; null points render as gaps not zero
    - CompactKRView: objective filter and search behave correctly
    - KRDrillDownPanel: opens from matrix and compact view, highlight in main view
    - Role-based hide/disable behavior for all four roles
    - _Requirements: 5.2, 6.1, 7.3, 7.5, 8.1, 8.5, 11.6_

- [ ] 12. Excel export regression
  - [ ] 12.1 Update `export_dashboard_workbook(...)` to use corrected mappings
    - STOP block written as `O3.KR2`
    - Competency block written as `O5.KR1`
    - Sáng kiến block written as `O5.KR12`
    - CTKT/FI values written as `O5.KR13` without overwriting the `data!A110:B114` sáng kiến block; if the template has no dedicated CTKT data block, keep CTKT in dashboard matrix/metadata and document the export limitation with a warning
    - VHDN written as `O6.KR1`, Hội thao written as `O6.KR2`
    - Preserve `Dashboard` and `data` sheets and formula references where the current exporter intentionally preserves formulas
    - Keep legacy behavior isolated from `build_dashboard_view(...)` when export has to remain lenient
    - Log warnings and expose them in metadata when mapping parse fails, instead of silently failing
    - _Requirements: 12.1, 12.3, 12.4, 12.6, 15.4_

  - [ ] 12.2 Regression tests for corrected KR writes in export
    - Assert cells for STOP, ET/KNL, Sáng kiến, CTKT, VHDN, Hội thao land on the expected KR rows
    - Assert an export failure raises or returns a failure status (not silent empty file)
    - _Requirements: 12.1, 12.2, 12.5_

  - [ ] 12.3 Regression tests for sheet and formula preservation
    - Assert the workbook contains `Dashboard` and `data` sheets with expected structure
    - Assert formula references preserved in cells the current exporter treats as formula-preserving
    - _Requirements: 12.3, 12.6_

- [ ] 13. Final verification
  - Run backend tests, frontend tests, frontend build, and one export smoke test
  - Confirm the dashboard payload still includes backward-compatible top-level keys and the new structured keys

## Notes

- Each task references specific requirements (granular sub-clauses) for traceability.
- Property tests are placed close to their implementation so regressions are caught early.
- Checkpoints bracket backend build-out, API wiring, and frontend integration.
- Implementation language: Python (backend) and TypeScript + React (frontend). Do not introduce pseudocode during implementation.
- Manual verification (not in this plan, done after code tasks complete):
  - Compare STOP, training, competency, VHDN, Hội thao values against `OKR tháng 04-2026 - X.ĐK.xlsx`.
  - Verify `Team_Account` cannot see other teams.
  - Verify `FI_Coordinator` can view but cannot export/import.
  - Verify the exported workbook still opens and contains the corrected blocks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1", "6.1", "11.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.3", "4.2", "6.2", "7.1", "11.2", "11.3", "11.4", "11.5"] },
    { "id": 2, "tasks": ["1.3", "3.2", "4.3", "4.4", "6.3", "7.2"] },
    { "id": 3, "tasks": ["1.4", "4.5", "4.6", "7.3", "8.1"] },
    { "id": 4, "tasks": ["1.5", "4.7", "4.8", "4.9", "7.4", "8.2"] },
    { "id": 5, "tasks": ["1.6", "4.10", "7.5", "8.3"] },
    { "id": 6, "tasks": ["1.7", "7.6", "7.7", "8.4", "8.5"] },
    { "id": 7, "tasks": ["8.6", "8.7", "8.8", "8.9", "8.10", "9.1"] },
    { "id": 8, "tasks": ["8.11", "9.2", "12.1"] },
    { "id": 9, "tasks": ["9.3", "11.6"] },
    { "id": 10, "tasks": ["9.4", "11.7"] },
    { "id": 11, "tasks": ["9.5", "9.6", "11.8", "12.2", "12.3"] }
  ]
}
```
