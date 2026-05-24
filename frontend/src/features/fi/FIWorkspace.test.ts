import { describe, expect, it } from "vitest";
import { isKhmtConsidered, khmtLabel, visibleActionsForSk } from "./FIWorkspace";

describe("FI action visibility", () => {
  it("allows a team account to submit its own draft but not another team's draft", () => {
    const ownDraft = { status: "Draft", author_user_id: "u1" };
    const otherDraft = { status: "Draft", author_user_id: "u2" };

    expect(visibleActionsForSk("Team_Account", "u1", ownDraft)).toEqual(["edit", "submit", "delete"]);
    expect(visibleActionsForSk("Team_Account", "u1", otherDraft)).toEqual([]);
  });

  it("does not let a team account delete after submitting", () => {
    const ownSubmitted = { status: "Submitted", author_user_id: "u1" };

    expect(visibleActionsForSk("Team_Account", "u1", ownSubmitted)).toEqual(["edit"]);
  });

  it("shows one review decision action for FI_Coordinator on Submitted items", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Submitted" })).toEqual(["edit", "reviewDecision"]);
  });

  it("shows one review decision action for FI_Coordinator on Reviewed items", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Reviewed" })).toEqual(["edit", "reviewDecision"]);
  });

  it("shows review decision for reviewer roles on editable decision statuses", () => {
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Submitted" })).toEqual(["edit", "reviewDecision"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Deferred" })).toEqual(["edit", "reviewDecision"]);
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Deferred" })).toEqual(["edit", "reviewDecision"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Approved" })).toEqual(["edit", "reviewDecision"]);
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Rejected" })).toEqual(["edit", "reviewDecision"]);
  });

  it("allows historical pending items to be reviewed but not deleted", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Submitted", is_historical_import: true })).toEqual(["edit", "reviewDecision"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Deferred", is_historical_import: true })).toEqual(["edit", "reviewDecision"]);
    expect(visibleActionsForSk("Admin", "admin", { status: "Approved", is_historical_import: true })).toEqual(["edit", "reviewDecision"]);
  });

  it("keeps KHMT assignment admin-only", () => {
    const approved = { status: "Approved", author_user_id: "u1" };

    expect(visibleActionsForSk("Admin", "admin", approved)).toEqual(["edit", "reviewDecision", "assignKhmt", "delete"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", approved)).toEqual(["edit", "reviewDecision"]);
  });

  it("does not allow FI_Coordinator to delete approved items", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Approved" })).toEqual(["edit", "reviewDecision"]);
  });
});

describe("FI KHMT display", () => {
  it("shows KHMT only when the SK is considered for KHMT", () => {
    const approved = { status: "Approved", consider_for_khmt: true, khmt_month: 4, khmt_year: 2026 };
    const staleApproved = { status: "Approved", consider_for_khmt: false, khmt_month: 4, khmt_year: 2026 };
    const deferred = { status: "Deferred", consider_for_khmt: false, khmt_month: 4, khmt_year: 2026 };

    expect(isKhmtConsidered(approved)).toBe(true);
    expect(khmtLabel(approved)).toBe("KHMT T4/2026");
    expect(isKhmtConsidered(staleApproved)).toBe(false);
    expect(khmtLabel(staleApproved)).toBe("Chưa vào KHMT");
    expect(isKhmtConsidered(deferred)).toBe(false);
    expect(khmtLabel(deferred)).toBe("Chưa vào KHMT");
  });
});
