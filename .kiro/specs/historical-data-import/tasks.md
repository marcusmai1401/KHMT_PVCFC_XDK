# Implementation Plan: Historical Data Import

## Overview

Import KHMT/OKR historical data for T1-T4/2026 into the existing domain tables: `team_reports`, `historical_snapshots`, and `team_monthly_summaries`. The implementation is CLI-based and should reuse the current OKR parsing stack (`workbook.py`, `team_normalizer.py`, `kr_mapping.py`, `historical_snapshot.py`) instead of creating a parallel historical model.

The plan below reflects the confirmed source strategy:

- T1-T3 team reports: read from original monthly workbooks in `KHMT_T1_T2_T3_T4/`.
- T4 team reports: prefer standardized team templates in `template_xlsx/`.
- T4 Dashboard/data snapshots: still read from `KHMT_T1_T2_T3_T4/OKR tháng 04-2026 - X.ĐK.xlsx`.
- Canonical KR mapping: prefer `template_xlsx/OKR_Workshop.xlsx`, fall back to T4 workbook only if the Workshop file is unavailable.

## Tasks

- [x] 1. Prepare shared parsing infrastructure
  - [x] 1.1 Extend team label normalization
    - Update `backend/app/services/okr/team_normalizer.py` and, where still used, `backend/app/services/okr/workbook.py`.
    - Ensure these aliases resolve to canonical team codes:
      - `HTĐK`, `TBHTDK`, `TBHTĐK` -> `TBHTĐK`
      - `TBĐ`, `TBD`, `TBDL`, `TBĐL` -> `TBĐL`
      - `TCDK`, `TCĐK`, `Tổ trực ca` -> `TCĐK`
      - `TBCH`, `Đội thiết bị chấp hành`, `Đội thiết bị cơ cấu chấp hành` -> `TBCH`
    - Keep warnings traceable with original source sheet/cell text when a label cannot be normalized.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x]* 1.2 Add tests for team label normalization
    - Generate known aliases with random casing, spacing, punctuation, and accent/no-accent variants.
    - Verify all known aliases return one of `TBHTĐK`, `TBCH`, `TBĐL`, `TCĐK`.
    - Verify unknown labels return `None` and keep the original label for warning output.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.3 Implement strict canonical KR mapping resolution
    - Add `backend/app/services/okr/historical_import.py` for import-specific orchestration/helpers.
    - Implement `resolve_kr_mapping(workspace_dir: Path)`.
    - Load priority 1 from `template_xlsx/OKR_Workshop.xlsx`, sheet `OKR X.ĐK 2026`.
    - Load priority 2 from `KHMT_T1_T2_T3_T4/OKR tháng 04-2026 - X.ĐK.xlsx`, sheet `OKR X.ĐK 2026`.
    - Do not let `kr_mapping.load_master_kr_mapping()` silently return `fallback_kr_mapping()` for historical import.
    - If no valid real mapping can be loaded, record a high severity warning and do not import team reports without canonical mapping.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 2. Build source discovery and import source plan
  - [x] 2.1 Implement month/year filename parsing
    - Parse source workbook names matching `OKR tháng XX-YYYY - X.ĐK.xlsx`.
    - Return `(month, year)` and reject malformed names or invalid month numbers.
    - Treat the month from the filename as authoritative, including the known T1 `TBĐ` sheet title typo.
    - _Requirements: 1.1, 1.7_

  - [x] 2.2 Discover T1-T4 monthly Source_Workbooks
    - Scan `KHMT_T1_T2_T3_T4/` for months 1, 2, 3, and 4 of year 2026.
    - Record a warning with the missing path if any required monthly workbook is absent.
    - Record an error and continue if a workbook cannot be opened as valid `.xlsx`.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6_

  - [x] 2.3 Discover T4 Team_Template sources
    - Define `TEMPLATE_FILES` for `TBHTĐK.xlsx`, `TBCH.xlsx`, `TBĐL.xlsx`, and `TCĐK.xlsx` under `template_xlsx/`.
    - For T4 team reports, prefer the template path per team.
    - If a template is missing, warn and fall back to the T4 Source_Workbook team sheet for that team.
    - Keep Dashboard/data import for T4 tied to the T4 Source_Workbook, not the templates.
    - _Requirements: 1.3, 1.4, 1.5_

  - [x]* 2.4 Add tests for source discovery
    - Test valid filename extraction.
    - Test missing source workbook warnings.
    - Test T4 template preference and fallback plan.
    - _Requirements: 1.1, 1.3, 1.5_

- [x] 3. Fix reusable Excel parsers before adding the import CLI
  - [x] 3.1 Make report column detection month-aware
    - Update `backend/app/services/okr/workbook.py` so `detect_report_columns()` accepts the requested `report_month` and normalized `team`.
    - For `TBHTĐK`, map T1 `M:N:O`, T2 `P:Q:R`, T3 `S:T:U`, T4 `V:W:X` where those columns exist.
    - For `TBCH`, map T1 `P:Q:R` as the first month group, T2 `T:U:V`, T3 `W:X:Y`, T4 `Z:AA:AB` where those columns exist.
    - For `TBĐL`/`TBĐ` and `TCĐK` active-month sheets, use detected active columns for the file month.
    - If the requested month group is missing, create a high severity template warning and avoid silently importing another month.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.2 Update `parse_team_report()` to use the requested month group
    - Thread `month` and normalized `team` into the report-column detection path.
    - Preserve source cell references for implementation report, assessment, notes, and summary fields.
    - Skip empty/whitespace-only KR rows.
    - Preserve Vietnamese text and diacritics as read from Excel.
    - _Requirements: 5.1, 5.5, 5.6_

  - [x] 3.3 Implement historical team-level summary extraction
    - `TBHTĐK`: row 39, `N39=T1`, `Q39=T2`, `T39=T3`, `W39=T4`.
    - `TBCH`: row 44 using the corresponding month summary cell.
    - `TBĐL`: read `KẾT QUẢ ĐÁNH GIÁ` rows when present; for T1 fall back to Dashboard_History or KR-level assessment if no summary row exists.
    - `TCĐK`: read `Kết luận chung`, observed at `O42`.
    - Normalize summary text to dashboard-accepted assessment categories.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 3.4 Add parser regression/property tests
    - Verify T2/T3/T4 multi-month sheets do not import T1 columns.
    - Verify T2 `TBHTĐK` uses `P:Q:R` and T3 `TBHTĐK`/`HTĐK` uses `S:T:U`.
    - Verify empty row skipping.
    - Verify implementation report, self-assessment, and notes preserve source text.
    - Verify canonical KR mapping is preferred over messy raw KR tokens.
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 11.4_

- [x] 4. Fix Dashboard history and data snapshot import
  - [x] 4.1 Replace hard-coded Dashboard history row parsing
    - Update `backend/app/services/okr/historical_snapshot.py`.
    - Locate Dashboard_History by finding the row whose first cell is `Đội/Tổ`.
    - Parse team rows below that header dynamically until all known teams are found or the table ends.
    - Do not scan every arbitrary team label in column A before finding the `Đội/Tổ` header, because that can pick up other Dashboard sections.
    - Support T1-T3 history at rows 22-27 and T4 history at rows 20-25 without hard-coded row numbers.
    - _Requirements: 3.1, 3.2, 3.4_

  - [x] 4.2 Keep Dashboard month-column mapping explicit
    - Map `F=T1`, `H=T2`, `J=T3`, `L=T4`, then continue every 2 columns through T12.
    - Upsert one `HistoricalSnapshotModel` row for each non-empty team/month assessment cell.
    - Use a source range tied to the detected table rows, for example `Dashboard!A{header_row}:AC{last_team_row}`.
    - If the `Dashboard` sheet is missing, record an error for that workbook and continue other import phases where possible.
    - _Requirements: 3.3, 3.5, 3.6_

  - [x] 4.3 Keep confirmed data block parsing scoped
    - Import confirmed `data` blocks: `stop_by_team`, `stop_by_month`, `training`, `competency`, `vhdn_running`, `vhdn_sports`, `sk_initiatives`.
    - Preserve unconfirmed block references/warnings for `SCĐX`, `TCĐK shift`, `BDĐK NPK`, and `weekly SCĐX`.
    - Treat missing T1/T2 competency data as expected, not as an error.
    - If the `data` sheet is missing, record a warning and continue.
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x]* 4.4 Add snapshot parser tests
    - Test dynamic Dashboard history detection with header row shifted.
    - Test T4 Dashboard history rows 20-25.
    - Test missing `Dashboard` sheet error behavior.
    - Test missing `data` sheet warning behavior.
    - _Requirements: 3.1, 3.2, 3.4, 3.6, 4.4_

- [x] 5. Implement historical team report parsing flows
  - [x] 5.1 Implement T1-T3 multi-team workbook parsing
    - For each Source_Workbook month 1-3, parse all recognized team sheets.
    - Normalize sheet names such as `HTĐK`, `TBĐ`, and `TCDK`.
    - Pass the file month/year explicitly into `parse_team_report()`.
    - Handle the T1 `TBĐ` sheet title that says `THÁNG 2` as a known typo; import it as T1.
    - Return parsed report dicts compatible with `TeamReportModel`.
    - _Requirements: 1.2, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 5.1_

  - [x] 5.2 Implement T4 template-based parsing
    - For each of `TBHTĐK`, `TBCH`, `TBĐL`, and `TCĐK`, parse the preferred template file when present.
    - Fall back per team to the T4 Source_Workbook sheet only when the corresponding template is missing.
    - Apply canonical KR mapping to extracted KR rows.
    - Keep source path and source sheet metadata accurate so reports show whether data came from template or source workbook.
    - _Requirements: 1.3, 1.5, 11.1, 11.4_

  - [x] 5.3 Apply T4 discipline overrides
    - Define `T4_DISCIPLINE_OVERRIDES` for `TBĐL` and `TBCH`.
    - `TBĐL`: `discipline_status="NOK"`, description `Một nhân sự Đội TBĐL không tuân thủ quy định giờ công`.
    - `TBCH`: `discipline_status="NOK"`, description `Một nhân sự Đội TBCH không tuân thủ đúng HDBD trong quá trình thực hiện công việc bảo dưỡng định kỳ thiết bị Quan trắc`.
    - Store overrides in `team_level` and later in `team_monthly_summaries`.
    - Do not infer monthly assessment only from KR matrix when a discipline override exists.
    - _Requirements: 6.6, 6.7, 6.8, 6.9_

  - [x] 5.4 Record KR mapping and template mismatch warnings
    - Warn when a raw KR token conflicts with canonical mapping/template rules.
    - Prefer canonical/template mapping over the first raw KR token.
    - Warn, skip only the affected row when possible, and keep processing the team.
    - _Requirements: 2.5, 5.5, 11.4, 11.5_

- [x] 6. Implement storage with idempotent upserts
  - [x] 6.1 Upsert `team_reports`
    - Use the existing `TeamReportModel`.
    - Match current historical import records by `(team, report_month, report_year, source_type="historical_import")`.
    - Mark the previous current historical record non-current before inserting the new current version.
    - Set `source_type="historical_import"` and `report_status="submitted"` so existing dashboard/latest-period logic can use it.
    - Store `file_name`, `file_path`, `file_hash`, `sheet_name`, `assessments`, `team_level`, and `source_cell_references`.
    - _Requirements: 7.1, 7.4, 7.6, 8.2, 10.1, 10.2_

  - [x] 6.2 Upsert `team_monthly_summaries`
    - Use the existing unique key `(team, month, year)`.
    - Store `discipline_status`, `discipline_description`, `related_kr`, `monthly_assessment`, and `stats`.
    - Derive summary data from parsed `team_level`, discipline overrides, and fallback Dashboard_History where needed.
    - Update existing rows in place on rerun.
    - _Requirements: 7.3, 7.5, 7.6, 8.3, 10.3_

  - [x] 6.3 Upsert `historical_snapshots`
    - Reuse `import_historical_snapshot()` for Dashboard/data blocks after fixing its parser.
    - Keep duplicate detection on `(source_file_hash, team, month, year, source_range)`.
    - Report imported, skipped duplicate, and failed counts.
    - _Requirements: 7.2, 7.6, 8.1, 8.4_

  - [x]* 6.4 Add storage tests
    - Test `team_reports` rerun creates one current historical record per `(team, month, year)`.
    - Test `team_monthly_summaries` updates in place.
    - Test historical snapshot duplicate skip behavior.
    - Test no `HistoricalOKRRecord` or new historical table is introduced.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3_

- [x] 7. Implement import orchestrator and CLI
  - [x] 7.1 Define import result dataclasses
    - `SourceWarning`: source file, sheet, row/column or range, severity, reason.
    - `FileImportResult`: month/year, source paths, team reports count, snapshot count, summary count, warnings/errors.
    - `ImportSessionReport`: totals per table, inserted/updated/skipped/failed counts, missing team/month matrix, completeness status.
    - _Requirements: 8.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 7.2 Implement `run_historical_import()`
    - Orchestrate: discover sources -> resolve KR mapping -> parse snapshots -> parse team reports -> upsert reports/summaries -> build report.
    - Process each file independently; failure in one file must not stop remaining files.
    - Process each team independently; failure in one team must not stop other teams in the same workbook.
    - Treat missing files and invalid workbooks as reportable warnings/errors, not unhandled crashes.
    - Treat missing canonical KR mapping as blocking for team report import.
    - _Requirements: 1.1, 1.5, 1.6, 8.4, 11.5_

  - [x] 7.3 Add CLI entry point
    - Create `scripts/import_historical.py`.
    - Accept workspace/source root arguments, with defaults matching this repo layout.
    - Print a readable import report with per-month/per-table counts.
    - Print warnings with source file, sheet, row/column/range, severity, and reason.
    - Mark the session incomplete if any required team/month report, summary, or Dashboard_History coverage is missing.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x]* 7.4 Add report count tests
    - Generate controlled parsed inputs and verify totals match persisted records.
    - Verify missing team/month combinations are reported as incomplete.
    - Verify known non-blocking gaps are listed without failing the session.
    - _Requirements: 8.4, 9.1, 9.3, 9.5, 9.6_

- [x] 8. End-to-end verification
  - [x] 8.1 Add integration tests for the full import pipeline
    - Use representative T1-T4 workbook/template fixtures or guarded tests against local files.
    - Verify `team_reports`, `historical_snapshots`, and `team_monthly_summaries` are populated.
    - Verify T1-T4 have all four teams where source data exists.
    - Verify T4 `TBĐL` and `TBCH` discipline data is present.
    - _Requirements: 7.1, 7.2, 7.3, 10.1, 10.3, 10.4_

  - [x] 8.2 Verify dashboard readiness
    - Confirm latest-period resolution can resolve to April 2026 when May data is absent.
    - Confirm `build_dashboard_view()` can use imported team reports and snapshots.
    - Confirm Dashboard monthly history can show T1-T4.
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 8.3 Manual dry-run checklist
    - Run the CLI against the local source folders.
    - Review warnings for missing files/templates, unrecognized team labels, missing month columns, and KR mapping conflicts.
    - Confirm there are 4 `team_reports` and 4 `team_monthly_summaries` for each month T1-T4.
    - Confirm Dashboard_History snapshots cover four teams for months 1-4.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6_

## Notes

- Tasks marked with `*` are optional for a faster MVP, but should be kept if the importer will be rerun often.
- Do not add a new `HistoricalOKRRecord` model/table.
- New import orchestration should live in `backend/app/services/okr/historical_import.py`; the runnable command should live in `scripts/import_historical.py`.
- Changes to existing parsers should be small and reusable, because normal web uploads still depend on `workbook.py` and `historical_snapshot.py`.
- The import must be idempotent: rerunning after parser fixes should update/replace historical-import records without duplicating dashboard-visible data.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "2.3", "2.4"] },
    { "id": 2, "tasks": ["3.1", "4.1", "4.2", "4.3"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "4.4"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.4"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3", "6.4"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["7.3", "7.4"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.3"] }
  ]
}
```
