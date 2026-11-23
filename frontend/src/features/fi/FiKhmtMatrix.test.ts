import { describe, expect, it } from "vitest";
import {
  buildStatusSlices,
  buildTeamProgress,
  classifyKhmtCellTone,
  hasQuotaWarning,
  khmtCellTooltip,
  khmtUnassignedApprovedCount,
  resolveVisibleMonths,
} from "./utils/fiMetrics";
import type { KhmtMatrixCell } from "./types/fiDashboard";

function makeCell(overrides: Partial<KhmtMatrixCell> = {}): KhmtMatrixCell {
  return {
    month: 8,
    count: 0,
    is_locked: false,
    lock_reason: null,
    allocation_status: null,
    report_assessment: null,
    assessment_source: null,
    required_count: null,
    kr_tier: "none",
    quota_status: "no_report",
    is_current_month: false,
    is_future_month: false,
    ...overrides,
  };
}

describe("FI Dashboard metrics & KHMT Matrix helpers", () => {
  it("keeps Donut review-status slices mutually exclusive and summing to exact total even when completed_count > approved", () => {
    // Reproduces real production bug where 117 completed + 95 approved produced 208/186 (112%)
    const totals = {
      total: 186,
      approved: 95,
      completed: 0,
      completed_count: 117,
      deferred: 20,
      pending: 63,
      rejected: 8,
      cancelled: 0,
    };
    const slices = buildStatusSlices(totals);
    const sum = slices.reduce((acc, s) => acc + s.value, 0);
    expect(sum).toBe(186);
    expect(slices.map((s) => [s.key, s.value])).toEqual([
      ["approved", 95],
      ["pending", 63],
      ["deferred", 20],
      ["rejected", 8],
    ]);
  });

  it("classifies KHMT matrix cell tones according to O5.KR13 thresholds", () => {
    expect(classifyKhmtCellTone(makeCell({ count: 3, kr_tier: "good" }))).toBe("good");
    expect(classifyKhmtCellTone(makeCell({ count: 1, kr_tier: "ok" }))).toBe("ok");
    expect(classifyKhmtCellTone(makeCell({ count: 2, kr_tier: "ok" }))).toBe("ok");
    expect(classifyKhmtCellTone(makeCell({ count: 0, kr_tier: "none" }))).toBe("none");
    expect(classifyKhmtCellTone(makeCell({ count: 0, kr_tier: "exempt_zero" }))).toBe("exempt_zero");
    expect(classifyKhmtCellTone(makeCell({ count: 0, kr_tier: "future", is_future_month: true }))).toBe("future");
    // Future month with already pre-assigned FI should display its earned tier
    expect(classifyKhmtCellTone(makeCell({ count: 3, kr_tier: "good", is_future_month: true }))).toBe("good");
  });

  it("flags ! warning on quota shortage, quota excess, or count > 3 (soft warning policy)", () => {
    expect(hasQuotaWarning(makeCell({ count: 3, required_count: 3, quota_status: "matched" }))).toBe(false);
    expect(hasQuotaWarning(makeCell({ count: 2, required_count: 3, quota_status: "shortage" }))).toBe(true);
    expect(hasQuotaWarning(makeCell({ count: 4, required_count: 3, quota_status: "excess" }))).toBe(true);
    expect(hasQuotaWarning(makeCell({ count: 4, required_count: null, quota_status: "no_report" }))).toBe(true);
    expect(hasQuotaWarning(makeCell({ count: 0, required_count: 0, quota_status: "matched", kr_tier: "exempt_zero" }))).toBe(false);
  });

  it("builds informative Vietnamese tooltips for KHMT cells", () => {
    const lockedShortage = makeCell({
      month: 9,
      count: 2,
      required_count: 3,
      report_assessment: "Hoàn thành tốt nhiệm vụ",
      quota_status: "shortage",
      is_locked: true,
    });
    const tip = khmtCellTooltip("TBĐL", 2026, lockedShortage);
    expect(tip).toContain("TBĐL");
    expect(tip).toContain("T9/2026");
    expect(tip).toContain("2 FI");
    expect(tip).toContain("Thiếu 1 FI");
    expect(tip).toContain("Đã chốt kỳ");
  });

  it("resolves visible months for YTD vs Full year cleanly", () => {
    expect(resolveVisibleMonths(2026, 2026, 11, "ytd")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(resolveVisibleMonths(2026, 2026, 11, "full")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Past year always shows full 12 months
    expect(resolveVisibleMonths(2025, 2026, 11, "ytd")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("uses exact approved-unassigned count when provided and falls back cleanly", () => {
    expect(khmtUnassignedApprovedCount({ approved: 95, khmt_considered: 73, khmt_unassigned_approved: 22 })).toBe(22);
    expect(khmtUnassignedApprovedCount({ approved: 95, khmt_considered: 73 })).toBe(22);
    expect(khmtUnassignedApprovedCount({ approved: 10, khmt_considered: 12 })).toBe(0);
  });

  it("builds team progress bar breakdown cleanly", () => {
    const progress = buildTeamProgress([
      { team: "TBCH", total: 43, approved: 26, deferred: 5, pending: 10, rejected: 2, khmt_considered: 20 },
    ]);
    expect(progress[0]).toMatchObject({
      team: "TBCH",
      total: 43,
      approved: 26,
      deferred: 5,
      pending: 10,
      rejected: 2,
      khmt: 20,
      khmtRate: 77,
    });
  });
});
