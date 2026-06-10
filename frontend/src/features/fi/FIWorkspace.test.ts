import { describe, expect, it } from "vitest";
import { canSelectKhmtMonth, displayTeam, isKhmtConsidered, khmtLabel, recordSubmitterId, visibleActionsForSk } from "./FIWorkspace";

describe("FI action visibility", () => {
  it("allows a team account to edit/delete its own draft but not another person's draft", () => {
    const ownDraft = { status: "Draft", author_user_id: "u1" };
    const otherDraft = { status: "Draft", author_user_id: "u2" };

    expect(visibleActionsForSk("Team_Account", "u1", ownDraft)).toEqual(["edit", "delete"]);
    expect(visibleActionsForSk("Team_Account", "u1", otherDraft)).toEqual([]);
  });

  it("keeps edit/delete for a newly submitted item because there is no separate draft step", () => {
    const ownSubmitted = { status: "Submitted", author_user_id: "u1" };

    expect(visibleActionsForSk("Team_Account", "u1", ownSubmitted)).toEqual(["edit", "delete"]);
  });

  it("does not let another author account edit someone else's submitted SK", () => {
    const submitted = { status: "Submitted", author_user_id: "cunghv" };

    expect(visibleActionsForSk("Staff", "khanhdv1", submitted)).toEqual([]);
    expect(visibleActionsForSk("Team_Account", "TBCH", submitted)).toEqual([]);
    expect(visibleActionsForSk("Staff", "cunghv", submitted)).toEqual(["edit", "delete"]);
  });

  it("lets the proxy submitter manage the item without making it their own initiative", () => {
    const proxySubmitted = {
      status: "Submitted",
      author_user_id: "quyenpt",
      status_history: [
        { changed_by: "baomt", comments: { submitted_by: "baomt" } },
      ],
    };

    expect(recordSubmitterId(proxySubmitted)).toBe("baomt");
    expect(visibleActionsForSk("Staff", "baomt", proxySubmitted)).toEqual(["edit", "delete"]);
    expect(visibleActionsForSk("Staff", "quyenpt", proxySubmitted)).toEqual(["edit", "delete"]);
  });

  it("shows one review decision action for FI_Coordinator on Submitted items", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Submitted" })).toEqual(["reviewDecision"]);
  });

  it("shows one review decision action for FI_Coordinator on Reviewed items", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Reviewed" })).toEqual(["reviewDecision"]);
  });

  it("shows review decision for FI_Coordinator on editable decision statuses", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Deferred" })).toEqual(["reviewDecision"]);
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Rejected" })).toEqual(["reviewDecision"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Submitted" })).toEqual([]);
  });

  it("allows historical pending items to be reviewed but not deleted", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Submitted", is_historical_import: true })).toEqual(["reviewDecision"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Deferred", is_historical_import: true })).toEqual([]);
    expect(visibleActionsForSk("Admin", "admin", { status: "Approved", is_historical_import: true })).toEqual(["reviewDecision"]);
  });

  it("keeps direct KHMT assignment on the owning team account", () => {
    const approved = { status: "Approved", author_user_id: "TBCH", team: "TBCH" };

    expect(visibleActionsForSk("Admin", "admin", approved)).toEqual(["reviewDecision", "delete"]);
    expect(visibleActionsForSk("Admin", "admin", { ...approved, author_user_id: "admin" })).toEqual([
      "edit",
      "reviewDecision",
      "delete",
    ]);
    expect(visibleActionsForSk("Team_Account", "TBCH", approved)).toEqual(["edit", "assignKhmt"]);
    expect(visibleActionsForSk("Team_Account", "TBĐL", approved)).toEqual([]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", approved)).toEqual([]);
  });

  it("hides admin edit actions when global edit mode is off", () => {
    const approved = { status: "Approved", author_user_id: "TBCH", team: "TBCH" };

    expect(visibleActionsForSk("Admin", "admin", approved, false)).toEqual([]);
    expect(visibleActionsForSk("Team_Account", "TBCH", approved, false)).toEqual(["edit", "assignKhmt"]);
  });

  it("allows only the owning team account to choose KHMT month", () => {
    const approved = { status: "Approved", team: "TBCH" };

    expect(canSelectKhmtMonth("Admin", "admin", approved)).toBe(false);
    expect(canSelectKhmtMonth("Team_Account", "TBCH", approved)).toBe(true);
    expect(canSelectKhmtMonth("Team_Account", "user1", approved, "TBCH")).toBe(true);
    expect(canSelectKhmtMonth("Team_Account", "TBĐL", approved)).toBe(false);
    expect(canSelectKhmtMonth("FI_Coordinator", "fi", approved)).toBe(false);
    expect(canSelectKhmtMonth("Team_Account", "TBCH", { ...approved, status: "Submitted" })).toBe(false);
  });

  it("does not allow FI_Coordinator to delete approved items", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Approved" })).toEqual(["reviewDecision"]);
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

describe("FI team display", () => {
  it("uses the Vietnamese label for workshop staff accounts", () => {
    expect(displayTeam("Workshop_Staff")).toBe("Xưởng quản lí");
    expect(displayTeam("TBCH")).toBe("TBCH");
  });
});
