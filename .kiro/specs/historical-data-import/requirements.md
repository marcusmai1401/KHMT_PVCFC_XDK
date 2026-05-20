# Requirements Document

## Introduction

This feature imports historical KHMT/OKR data for January through April 2026 into the existing OKR Automation database so the web dashboard can show historical periods and fall back to April 2026 when May data is not yet available.

The import must work with two source styles:

- T1-T3: original unstandardized monthly workbooks in `KHMT_T1_T2_T3_T4/`.
- T4: dashboard/data snapshot from `KHMT_T1_T2_T3_T4/OKR tháng 04-2026 - X.ĐK.xlsx`, with team reports preferred from standardized templates in `template_xlsx/`.

The import must not create a separate historical OKR table. It must reuse existing domain tables: `team_reports`, `historical_snapshots`, and `team_monthly_summaries`.

## Glossary

- **Source_Workbook**: A monthly workbook in `KHMT_T1_T2_T3_T4/`, named `OKR tháng XX-2026 - X.ĐK.xlsx`.
- **Team_Template**: A standardized team report workbook in `template_xlsx/`, such as `TBHTĐK.xlsx`, `TBCH.xlsx`, `TBĐL.xlsx`, and `TCĐK.xlsx`.
- **Dashboard_History**: The cumulative 12-month assessment table on the `Dashboard` sheet, identified by the `Đội/Tổ` header row.
- **Team_Report**: A team/tổ report sheet or template parsed into `TeamReportModel`.
- **Team_Monthly_Summary**: One row per `(team, month, year)` in `TeamMonthlySummaryModel`.
- **Historical_Snapshot**: A persisted dashboard/data snapshot row in `HistoricalSnapshotModel`.
- **Confirmed_Data_Block**: A `data` sheet range whose meaning is already supported by the dashboard.
- **Unconfirmed_Data_Block**: A `data` sheet range preserved as a source reference but not yet used as authoritative dashboard data.
- **Discipline_Override**: A discipline result that can lower the overall monthly assessment even when KR details look completed.
- **Master_KR_Mapping**: The canonical workshop KR mapping from the standardized `OKR X.ĐK 2026` sheet, preferred from `template_xlsx/OKR_Workshop.xlsx` or the T4 Source_Workbook.

## Requirements

### Requirement 1: Discover Historical Sources

**User Story:** As a data administrator, I want the importer to locate the correct historical files and templates, so that it imports the intended months and teams.

#### Acceptance Criteria

1. WHEN an import session starts, THE Importer SHALL discover Source_Workbooks for months 1, 2, 3, and 4 of year 2026 from `KHMT_T1_T2_T3_T4/`.
2. WHEN importing team reports for months 1-3, THE Importer SHALL read team reports from the corresponding monthly Source_Workbook.
3. WHEN importing team reports for month 4, THE Importer SHALL prefer Team_Templates from `template_xlsx/` for `TBHTĐK`, `TBCH`, `TBĐL`, and `TCĐK`.
4. WHEN importing dashboard history and `data` snapshots for month 4, THE Importer SHALL read them from the month 4 Source_Workbook.
5. IF a required Source_Workbook or Team_Template is missing, THEN THE Importer SHALL record a warning with the missing path and continue with any remaining importable sources.
6. IF a workbook cannot be opened as a valid `.xlsx`, THEN THE Importer SHALL record the file name and error details and continue processing remaining sources.
7. THE Importer SHALL treat the month 1 `TBĐ` sheet title that says `THÁNG 2` as a known source typo and import it as month 1.

### Requirement 2: Normalize Teams and Sheet Names

**User Story:** As a dashboard user, I want historical data grouped under the correct team codes, so that inconsistent Excel sheet names do not create duplicate or missing teams.

#### Acceptance Criteria

1. THE Parser SHALL normalize `TBHTĐK`, `HTĐK`, `TBHTDK`, and equivalent labels to team code `TBHTĐK`.
2. THE Parser SHALL normalize `TBĐ`, `TBĐL`, `TBDL`, and equivalent labels to team code `TBĐL`.
3. THE Parser SHALL normalize `TCDK`, `TCĐK`, `Tổ trực ca`, and equivalent labels to team code `TCĐK`.
4. THE Parser SHALL normalize `TBCH`, `Đội thiết bị chấp hành`, and `Đội thiết bị cơ cấu chấp hành` to team code `TBCH`.
5. IF a team label cannot be normalized, THEN THE Parser SHALL skip that row/sheet and add a warning with the source sheet and cell reference.

### Requirement 3: Import Dashboard Historical Snapshots

**User Story:** As a dashboard user, I want the 12-month history table imported accurately, so that historical monthly assessments are visible even when team report formats differ.

#### Acceptance Criteria

1. WHEN parsing a `Dashboard` sheet, THE Parser SHALL locate the Dashboard_History table by finding the row whose first cell is `Đội/Tổ`.
2. THE Parser SHALL parse team rows below that header dynamically, not by hard-coded row numbers.
3. THE Parser SHALL map month columns using `F=T1`, `H=T2`, `J=T3`, `L=T4`, then continuing every 2 columns through T12.
4. THE Parser SHALL support T1-T3 Dashboard_History at rows 22-27 and T4 Dashboard_History at rows 20-25.
5. FOR each non-empty team/month assessment cell, THE Importer SHALL upsert a `HistoricalSnapshotModel` record with source file, source range, team, month, year, and monthly assessment.
6. IF the `Dashboard` sheet is missing, THEN THE Importer SHALL record an error for that workbook and continue with other import phases where possible.

### Requirement 4: Import Confirmed Data Sheet Blocks

**User Story:** As a dashboard user, I want supported chart data imported where mappings are known, while unclear blocks are not treated as authoritative.

#### Acceptance Criteria

1. THE Parser SHALL import confirmed `data` sheet blocks currently supported by the codebase: `stop_by_team`, `stop_by_month`, `training`, `competency`, `vhdn_running`, `vhdn_sports`, and `sk_initiatives`.
2. THE Parser SHALL preserve unconfirmed block references for `SCĐX`, `TCĐK shift`, `BDĐK NPK`, and `weekly SCĐX` as source references or warnings, but SHALL NOT require those mappings to complete the import.
3. THE Parser SHALL treat the absence of `competency` data in T1 and T2 as expected because competency data starts from T3.
4. IF the `data` sheet is missing, THEN THE Importer SHALL record a warning and continue importing team reports and dashboard history.

### Requirement 5: Import Team Reports with Correct Month Columns

**User Story:** As a data administrator, I want each team report parsed from the correct month-specific columns, so that multi-month sheets do not import January data for later months.

#### Acceptance Criteria

1. THE Parser SHALL select implementation, assessment, and notes columns for the requested report month, not simply the first `Tình hình thực hiện` header.
2. FOR `TBHTĐK` multi-month sheets, THE Parser SHALL map month 1 to `M:N:O`, month 2 to `P:Q:R`, month 3 to `S:T:U`, and month 4 to `V:W:X` where those columns exist.
3. FOR `TBCH` multi-month sheets, THE Parser SHALL map month 1 to the first month group, month 2 to `T:U:V`, month 3 to `W:X:Y`, and month 4 to `Z:AA:AB` where those columns exist.
4. FOR `TBĐ`/`TBĐL` and `TCĐK` source sheets that only contain the active month columns, THE Parser SHALL use the detected active report columns for that file month.
5. IF the requested report month column group cannot be found, THEN THE Parser SHALL record a high severity template warning for that team/month and avoid silently importing another month.
6. THE Parser SHALL preserve source cell references for implementation report, assessment, notes, and team-level summary fields.

### Requirement 6: Parse Team-Level Monthly Summaries and Discipline

**User Story:** As a dashboard user, I want the monthly conclusion and discipline information imported, so that team status explains both performance and violations.

#### Acceptance Criteria

1. THE Parser SHALL parse `TBHTĐK` team-level monthly assessment from row 39 using `N39=T1`, `Q39=T2`, `T39=T3`, and `W39=T4`, or equivalent detected month groups.
2. THE Parser SHALL parse `TBCH` team-level monthly assessment from row 44 using the corresponding month summary cell.
3. THE Parser SHALL parse `TBĐL` team-level monthly assessment from `KẾT QUẢ ĐÁNH GIÁ` rows when present; for T1, it SHALL fall back to Dashboard_History or KR-level assessments if no summary row exists.
4. THE Parser SHALL parse `TCĐK` team-level monthly assessment from `Kết luận chung`, observed at `O42`.
5. THE Parser SHALL normalize assessment text such as `Hoàn thành nhiệm vụ`, `Hoàn thành tốt nhiệm vụ`, and `Không hoàn thành nhiệm vụ` into the dashboard's accepted assessment categories.
6. THE Importer SHALL support discipline overrides for T4 `TBĐL` and `TBCH`.
7. FOR T4 `TBĐL`, THE Importer SHALL store discipline status `NOK` and discipline description `Một nhân sự Đội TBĐL không tuân thủ quy định giờ công`.
8. FOR T4 `TBCH`, THE Importer SHALL store discipline status `NOK` and discipline description `Một nhân sự Đội TBCH không tuân thủ đúng HDBD trong quá trình thực hiện công việc bảo dưỡng định kỳ thiết bị Quan trắc`.
9. THE dashboard monthly assessment SHALL NOT be inferred solely from KR matrix values when a discipline override exists.

### Requirement 7: Persist to Existing Domain Tables

**User Story:** As a developer, I want historical import data persisted in the existing schema, so that the dashboard can use current services without new parallel models.

#### Acceptance Criteria

1. THE Importer SHALL persist parsed team reports to `TeamReportModel`.
2. THE Importer SHALL persist dashboard history and chart payloads to `HistoricalSnapshotModel`.
3. THE Importer SHALL upsert one `TeamMonthlySummaryModel` row per `(team, month, year)`.
4. THE Importer SHALL NOT create or depend on a new `HistoricalOKRRecord` or `historical_okr_records` table.
5. THE TeamMonthlySummary upsert SHALL use the existing unique key `(team, month, year)`.
6. THE Importer SHALL store source file names, source hashes where available, and source cell references for traceability.

### Requirement 8: Idempotent Import

**User Story:** As a data administrator, I want to rerun the import safely, so that parser fixes can be applied without duplicating historical data.

#### Acceptance Criteria

1. WHEN the same Historical_Snapshot source hash, team, month, year, and source range already exists, THE Importer SHALL skip or update without creating duplicates according to existing snapshot uniqueness.
2. WHEN a Team_Report already exists for the same team, month, and year from historical import, THE Importer SHALL replace or mark the old version non-current before inserting the new current version.
3. WHEN a Team_Monthly_Summary already exists for the same team, month, and year, THE Importer SHALL update it in place.
4. THE Importer SHALL report inserted, updated, skipped duplicate, and failed counts per month and per table.

### Requirement 9: Import Reporting and Verification

**User Story:** As a data administrator, I want a detailed import report, so that I can verify historical dashboard readiness.

#### Acceptance Criteria

1. WHEN an import session completes, THE Importer SHALL report records imported/updated for `team_reports`, `historical_snapshots`, and `team_monthly_summaries`.
2. THE Importer SHALL report warnings by source file, sheet, row/column, severity, and reason.
3. THE Importer SHALL report whether all four teams have Team_Report and Team_Monthly_Summary records for each month T1-T4.
4. THE Importer SHALL report whether Dashboard_History snapshots cover all four teams for months T1-T4.
5. THE Importer SHALL report known non-blocking gaps, including unconfirmed `data` blocks and missing T1/T2 competency data.
6. IF any required team/month is missing after import, THEN THE report SHALL mark the import as incomplete.

### Requirement 10: Dashboard Readiness

**User Story:** As a dashboard user, I want imported data to drive the existing dashboard fallback behavior, so that April data appears when May is not available.

#### Acceptance Criteria

1. AFTER importing T1-T4, THE database SHALL contain data for month 4 of year 2026 in `team_reports` or `historical_snapshots`.
2. WHEN May 2026 has no data and dashboard latest-period resolution runs, THE system SHALL resolve to April 2026 via existing latest-data logic.
3. THE dashboard SHALL be able to show T4 data including team assessments and discipline status for `TBĐL` and `TBCH`.
4. THE import SHALL preserve enough historical monthly assessment data for the dashboard monthly history section to show T1-T4.

### Requirement 11: Use Canonical KR Mapping

**User Story:** As a developer, I want historical reports mapped using the corrected master/template rules, so that messy raw KR codes in older workbooks do not corrupt dashboard KR status.

#### Acceptance Criteria

1. THE Parser SHALL use Master_KR_Mapping from `template_xlsx/OKR_Workshop.xlsx` when available.
2. IF `template_xlsx/OKR_Workshop.xlsx` is unavailable, THEN THE Parser SHALL use the `OKR X.ĐK 2026` sheet from the T4 Source_Workbook.
3. THE Parser SHALL NOT silently fall back to generated placeholder KR mapping when a real Master_KR_Mapping source is available elsewhere in the workspace.
4. WHEN raw Excel KR codes conflict with Master_KR_Mapping or corrected template rules, THE Parser SHALL prefer the codebase/template mapping rules over the first raw KR token.
5. IF no valid Master_KR_Mapping can be loaded, THEN THE Importer SHALL record a high severity warning before importing team reports.
