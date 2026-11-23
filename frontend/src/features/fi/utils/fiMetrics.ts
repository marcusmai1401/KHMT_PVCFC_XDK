import type {
  KhmtKrTier,
  KhmtMatrixCell,
  MatrixRangeMode,
} from "../types/fiDashboard";

export type StatusSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
  tone: string;
};

export type TeamProgress = {
  team: string;
  total: number;
  approved: number;
  deferred: number;
  pending: number;
  rejected: number;
  khmt: number;
  khmtRate: number;
};

const TEAM_DISPLAY_LABELS: Record<string, string> = {
  Workshop_Staff: "Xưởng quản lí",
};

export function displayTeamLabel(value: string | null | undefined): string {
  if (!value) return "";
  return TEAM_DISPLAY_LABELS[value] ?? value;
}

export function formatCount(value: number | undefined): string {
  return new Intl.NumberFormat("vi-VN").format(value ?? 0);
}

export function percent(value: number | undefined, total: number | undefined): number {
  if (!total) return 0;
  return Math.round(((value ?? 0) / total) * 100);
}

export function reviewPassedCount(row: any): number {
  return Number(row?.review_passed ?? row?.approved ?? 0);
}

export function reviewFailedCount(row: any): number {
  return Number(row?.review_failed ?? row?.rejected ?? 0);
}

export function khmtUnassignedApprovedCount(row: any): number {
  if (row?.khmt_unassigned_approved !== undefined && row?.khmt_unassigned_approved !== null) {
    return Number(row.khmt_unassigned_approved ?? 0);
  }
  if (row?.khmt_not_considered !== undefined && row?.khmt_not_considered !== null) {
    return Number(row.khmt_not_considered ?? 0);
  }
  return Math.max(0, reviewPassedCount(row) - Number(row?.khmt_considered ?? 0));
}

/**
 * Mutually exclusive review-status partition for the Donut chart.
 * Sum of returned slices ALWAYS equals totals.total (never mixes execution
 * completion_count into review statuses, fixing the 208/186 contradiction).
 */
export function buildStatusSlices(totals: Record<string, any>): StatusSlice[] {
  const approved = reviewPassedCount(totals);
  const pending = Number(totals?.pending ?? 0);
  const deferred = Number(totals?.deferred ?? 0);
  const rejected = reviewFailedCount(totals) + Number(totals?.cancelled ?? 0);
  return [
    { key: "approved", label: "Đồng ý", value: approved, color: "#169045", tone: "success" },
    { key: "pending", label: "Chờ xét duyệt", value: pending, color: "#2563eb", tone: "info" },
    { key: "deferred", label: "Xem xét sau", value: deferred, color: "#f59e0b", tone: "warning" },
    { key: "rejected", label: "Không đồng ý / Hủy", value: rejected, color: "#ef4444", tone: "danger" },
  ].filter((slice) => slice.value > 0);
}

export function buildTeamProgress(teams: any[]): TeamProgress[] {
  return teams.map((team) => {
    const total = Number(team.total ?? 0);
    const approved = reviewPassedCount(team);
    const deferred = Number(team.deferred ?? 0);
    const pending = Number(team.pending ?? 0);
    const rejected = reviewFailedCount(team) + Number(team.cancelled ?? 0);
    const khmt = Number(team.khmt_considered ?? 0);
    const khmtRate = approved ? Math.round((khmt / approved) * 100) : 0;
    return { team: team.team, total, approved, deferred, pending, rejected, khmt, khmtRate };
  });
}

export function resolveVisibleMonths(
  selectedYear: number,
  currentYear: number,
  currentMonth: number,
  rangeMode: MatrixRangeMode,
): number[] {
  const all = Array.from({ length: 12 }, (_, idx) => idx + 1);
  if (rangeMode === "ytd" && selectedYear === currentYear) {
    const clamped = Math.max(1, Math.min(12, currentMonth));
    return all.slice(0, clamped);
  }
  return all;
}

export function classifyKhmtCellTone(cell: Pick<KhmtMatrixCell, "kr_tier" | "count" | "is_future_month">): KhmtKrTier {
  if (cell.kr_tier) return cell.kr_tier;
  if (cell.is_future_month && cell.count === 0) return "future";
  if (cell.count >= 3) return "good";
  if (cell.count >= 1) return "ok";
  return "none";
}

export function hasQuotaWarning(cell: Pick<KhmtMatrixCell, "quota_status" | "count">): boolean {
  return cell.quota_status === "shortage" || cell.quota_status === "excess" || cell.count > 3;
}

export function krTierLabel(tier: KhmtKrTier): string {
  switch (tier) {
    case "good":
      return "Đạt mức HT tốt / Xuất sắc (≥ 3 FI)";
    case "ok":
      return "Đạt mức Hoàn thành (1–2 FI)";
    case "exempt_zero":
      return "Kỳ Không hoàn thành (định mức 0 FI)";
    case "future":
      return "Tháng chưa tới";
    default:
      return "Chưa xét FI vào KHMT";
  }
}

export function khmtCellTooltip(teamName: string, year: number, cell: KhmtMatrixCell): string {
  const parts: string[] = [
    `${teamName} · KHMT T${cell.month}/${year}: ${cell.count} FI`,
    krTierLabel(cell.kr_tier),
  ];
  if (cell.report_assessment && cell.required_count !== null) {
    parts.push(`Đánh giá OKR: ${cell.report_assessment} (định mức ${cell.required_count} FI)`);
  }
  if (cell.quota_status === "shortage" && cell.required_count !== null) {
    parts.push(`Cảnh báo: Thiếu ${cell.required_count - cell.count} FI so với định mức`);
  } else if (cell.quota_status === "excess") {
    if (cell.required_count !== null) {
      parts.push(`Cảnh báo: Vượt ${cell.count - cell.required_count} FI so với định mức (${cell.required_count} FI)`);
    } else {
      parts.push(`Cảnh báo: Đang gán ${cell.count} FI (vượt mức tối đa 3 FI/tháng)`);
    }
  }
  if (cell.is_locked) {
    parts.push("Trạng thái: Đã chốt kỳ");
  }
  return parts.join(" · ");
}
