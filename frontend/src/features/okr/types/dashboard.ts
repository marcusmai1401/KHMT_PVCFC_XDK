export type TeamStatus = "OK" | "GOOD" | "NG" | "#N/A" | string;

export type ChartBlockType =
  | "stop_by_team"
  | "stop_by_month"
  | "training"
  | "competency"
  | "vhdn_running"
  | "vhdn_sports"
  | "sk_initiatives"
  | "ctkt_fi";

export interface ChartDataset {
  label: string;
  data: Array<number | null>;
  chart_type?: "bar" | "line";
  axis?: "left" | "right";
  value_format?: "percent";
  color?: string;
}

export interface ChartBlockData {
  block_type: ChartBlockType;
  title: string;
  chart_type: "bar" | "line" | "cards" | "progress_grid";
  kr_code: string;
  labels: string[];
  datasets: ChartDataset[];
  master_target?: number | string | null;
  target_per_team?: number | null;
  target_team_count?: number;
  target_basis?: string;
  participation_target?: number | null;
  source_reference: string;
  mapping_status: "confirmed" | "needs_confirmation";
  warnings: Array<Record<string, unknown>>;
  items?: Array<Record<string, any>>;
  extra_items?: Array<Record<string, any>>;
  total?: number;
}

export type ObjectiveCode = "O1" | "O2" | "O3" | "O4" | "O5" | "O6";
export type ObjectiveStatus = "completed" | "at_risk" | "failed" | "no_plan" | "no_data";
export type DataState = "ready" | "partial" | "no_plan" | "no_data";
export type VisualKind =
  | "status_grid"
  | "metric_table"
  | "bar_line_chart"
  | "bar_chart"
  | "line_chart"
  | "training_bar_chart"
  | "radar_chart"
  | "narrative_card"
  | "progress_card"
  | "kpi_badges";

export interface DashboardPeriod {
  month: number;
  year: number;
  label: string;
  data_state: "ready" | "partial" | "no_data";
  source?: "last_selected" | "latest_data" | "workbook" | "current";
}

export interface VisualBlock {
  id: string;
  kind: VisualKind;
  title: string;
  data_state: DataState;
  empty_message?: string | null;
  source?: string | null;
  payload?: Record<string, any>;
}

export interface ObjectiveReportKR {
  code: string;
  title: string;
  lines: string[];
}

export interface ObjectiveReport {
  krs: ObjectiveReportKR[];
  notes: string[];
}

export interface ObjectiveSectionPayload {
  objective_code?: ObjectiveCode | string;
  title?: string;
  status?: ObjectiveStatus;
  conclusion?: string | null;
  target?: string | null;
  result?: string | null;
  headline?: string | null;
  visuals?: VisualBlock[];
  notes?: string[];
  report?: ObjectiveReport | null;
  source_references?: string[];
}

export interface TechnicalMetadata {
  warnings: Array<Record<string, any>>;
  source_references: Record<string, any>;
  latest_data_period?: { month: number; year: number } | null;
}

export interface MonthAssessment {
  month: number;
  year: number;
  assessment: "HT tốt" | "HT" | "Không HT" | string | null;
  source: "db" | "snapshot" | null;
}

export interface MonthlyHistoryEntry {
  team: string;
  team_name: string;
  months: MonthAssessment[];
}

export interface KRSummary {
  workshop_kr_code: string;
  kr_name: string;
  target_value: string | number | null;
  dashboard_column: string;
  source_row?: number | null;
  team_statuses: Record<string, TeamStatus>;
  numeric_metric?: {
    teams?: Record<string, any>;
    actual?: number | null;
    target?: number | string | null;
    percentage?: number | null;
  } | null;
}

export interface DashboardColumn {
  workshop_kr_code: string;
  kr_name: string;
  dashboard_column: string;
  measurement_type?: string;
  target_value?: string | number | null;
  source_row?: number | null;
}

export interface LeaderKPIAllocation {
  team: string;
  team_name?: string;
  current_assessment?: string;
  good_or_better_streak_months?: number;
  a1?: number;
  a2?: number;
  triggered_rules?: Array<{ rule?: string; grade?: string; reason?: string }>;
  history?: Array<Record<string, unknown>>;
  cap_note?: string;
}

export interface ManualLeaderKPIAllocation {
  team: string;
  team_name?: string;
  a1?: number | null;
  a2?: number | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface DashboardTeamRow {
  team: string;
  team_name: string;
  has_report?: boolean;
  discipline_status: string;
  discipline_description?: string;
  monthly_assessment: string;
  leader_kpi_allocation?: LeaderKPIAllocation;
  leader_kpi_manual_allocation?: ManualLeaderKPIAllocation;
  kr_statuses: Record<string, TeamStatus>;
}

export interface DashboardPayload {
  columns: DashboardColumn[];
  teams: DashboardTeamRow[];
  leader_kpi_allocations: LeaderKPIAllocation[];
  kpi_allocation_summary: Record<string, number>;
  manual_leader_kpi_allocations?: ManualLeaderKPIAllocation[];
  manual_kpi_allocation_summary?: Record<string, number>;
  period?: DashboardPeriod | { month: number; year: number; label?: string; data_state?: "ready" | "partial" | "no_data"; source?: string };
  matrix?: Record<string, any>;
  monthly_history?: MonthlyHistoryEntry[];
  chart_blocks?: Record<ChartBlockType, ChartBlockData | undefined>;
  minor_okr_summary?: KRSummary[];
  source_references?: Record<string, any>;
  warnings?: Array<Record<string, any>>;
  objective_sections?: ObjectiveSectionPayload[];
  technical_metadata?: TechnicalMetadata;
}
