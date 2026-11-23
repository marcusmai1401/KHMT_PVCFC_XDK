export type KhmtKrTier = "good" | "ok" | "none" | "exempt_zero" | "future";
export type KhmtQuotaStatus = "matched" | "shortage" | "excess" | "missing_fi" | "no_report";
export type MatrixViewMode = "khmt" | "registration";
export type MatrixRangeMode = "full" | "ytd";

export type KhmtMatrixCell = {
  month: number;
  count: number;
  kr_tier: KhmtKrTier;
  is_current_month: boolean;
  is_future_month: boolean;
  is_locked: boolean;
  lock_reason: string | null;
  allocation_status: string | null;
  report_assessment: string | null;
  assessment_source: string | null;
  required_count: number | null;
  quota_status: KhmtQuotaStatus;
};

export type KhmtMatrixTeamRow = {
  team: string;
  display_name: string;
  months: KhmtMatrixCell[];
  year_khmt_total: number;
  approved_total: number;
  approved_unassigned_count: number;
  pending_count: number;
  deferred_count: number;
  rejected_count: number;
  total_sk: number;
};

export type NonOkrTeamSummary = {
  team: string;
  display_name: string;
  total_sk: number;
  approved_total: number;
  approved_unassigned_count: number;
  pending_count: number;
  deferred_count: number;
  rejected_count: number;
  year_khmt_total: number;
  year_registration_total: number;
};

export type FiKhmtMatrixData = {
  year: number;
  okr_teams: string[];
  rows: KhmtMatrixTeamRow[];
  workshop_totals: {
    months: Array<{ month: number; count: number }>;
    year_khmt_total: number;
    approved_total: number;
    approved_unassigned_count: number;
    pending_count: number;
    deferred_count: number;
    rejected_count: number;
    total_sk: number;
  };
  non_okr_summary: NonOkrTeamSummary[];
};

export type RegistrationMatrixMonthCell = {
  month: number;
  count: number;
  approved_count: number;
  in_khmt_count: number;
  is_current_month: boolean;
  is_future_month: boolean;
};

export type RegistrationMatrixTeamRow = {
  team: string;
  display_name: string;
  months: RegistrationMatrixMonthCell[];
  year_total: number;
  approved_unassigned_count: number;
  pending_count: number;
};

export type FiRegistrationMatrixData = {
  year: number;
  okr_teams: string[];
  rows: RegistrationMatrixTeamRow[];
  workshop_totals: {
    months: Array<{ month: number; count: number }>;
    year_total: number;
    approved_unassigned_count: number;
    pending_count: number;
  };
  non_okr_summary: NonOkrTeamSummary[];
};

export type FiDashboardSummary = {
  total: number;
  approved: number;
  review_passed: number;
  review_failed: number;
  rejected: number;
  deferred: number;
  pending: number;
  cancelled: number;
  khmt_considered: number;
  khmt_not_considered: number;
  khmt_unassigned_approved?: number;
  completed_count: number;
  completed?: number;
  not_completed: number;
};

export type FiDashboardPayload = {
  generated_at: string;
  current_year?: number;
  current_month?: number;
  year?: number;
  available_years?: number[];
  teams: Array<Record<string, any>>;
  totals: FiDashboardSummary;
  selected_year_totals?: FiDashboardSummary;
  selected_year_teams?: Array<Record<string, any>>;
  khmt_by_month: Array<{ year: number; month: number; count: number }>;
  status_order: string[];
  khmt_matrix?: FiKhmtMatrixData;
  registration_matrix?: FiRegistrationMatrixData;
};

export type FiDashboardCellResponse = {
  team: string;
  display_name: string;
  year: number;
  month: number;
  mode: MatrixViewMode;
  cell: {
    count: number;
    kr_tier: KhmtKrTier;
    is_current_month: boolean;
    is_future_month: boolean;
    is_locked: boolean;
    lock_reason: string | null;
    allocation_status: string | null;
    report_assessment: string | null;
    assessment_source: string | null;
    required_count: number | null;
    quota_status: KhmtQuotaStatus;
    can_edit_khmt: boolean;
    edit_blocked_reason: string | null;
    pending_count_for_team: number;
  };
  items: any[];
  available_pool: any[];
};

export type FiDashboardPoolResponse = {
  team: string;
  display_name: string;
  kind: "unassigned_approved" | "pending";
  total: number;
  can_edit_khmt: boolean;
  edit_blocked_reason: string | null;
  items: any[];
};

export type MatrixDrawerSelection =
  | { kind: "cell"; team: string; year: number; month: number; mode: MatrixViewMode }
  | { kind: "pool"; team: string; poolKind: "unassigned_approved" | "pending" };
