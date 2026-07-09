import { describe, expect, it } from "vitest";
import {
  buildPersonFilterOptions,
  canSelectKhmtMonth,
  displayTeam,
  hasKhmtPendingChange,
  isKhmtConsidered,
  khmtLabel,
  recordSubmitterId,
  visibleActionsForSk,
} from "./FIWorkspace";

describe("FI person filters", () => {
  it("merges historical author rows into the matching employee account option", () => {
    const employees = [
      {
        id: "tungtp",
        display_name: "Trịnh Phước Tùng - Đội TBĐL",
        full_name: "Trịnh Phước Tùng",
        team: "TBĐL",
        role: "Staff",
      },
    ];
    const rows = [
      { author_name: "Trịnh Phước Tùng", author_user_id: "historical-import", team: "TBĐL" },
      { author_name: "Trịnh Phước Tùng", author_user_id: "tungtp", team: "TBĐL" },
    ];

    const options = buildPersonFilterOptions(rows, employees, "author", new Map());

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      key: "id:tungtp",
      accountId: "tungtp",
      label: "Trịnh Phước Tùng",
      team: "TBĐL",
      count: 2,
    });
  });

  it("normalizes imported author spacing before matching an employee account", () => {
    const employees = [
      {
        id: "tuyenpv",
        display_name: "Phạm Văn Tuyên - Đội TBCH",
        full_name: "Phạm Văn Tuyên",
        team: "TBCH",
        role: "Staff",
      },
    ];
    const rows = [
      { author_name: "Phạm Văn  Tuyên", author_user_id: "historical-import", team: "TBCH" },
    ];

    const options = buildPersonFilterOptions(rows, employees, "author", new Map());

    expect(options).toHaveLength(1);
    expect(options[0].key).toBe("id:tuyenpv");
    expect(options[0].count).toBe(1);
  });
});

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

  it("maps deploy-import legacy submissions back to the resolved author account", () => {
    const legacySubmitted = {
      status: "Deferred",
      is_historical_import: true,
      author_user_id: "historical-import",
      submitted_by: "deploy-import",
      effective_author_user_id: "trunghd",
      status_history: [
        { changed_by: "deploy-import", comments: { submitted_by: "deploy-import" } },
      ],
    };

    expect(recordSubmitterId(legacySubmitted)).toBe("trunghd");
    expect(visibleActionsForSk("Staff", "trunghd", legacySubmitted)).toEqual(["edit"]);
    expect(visibleActionsForSk("Staff", "other", legacySubmitted)).toEqual([]);
  });

  it("does not allow owners to edit SK after the decision is Approved", () => {
    const approved = { status: "Approved", author_user_id: "u1" };

    expect(visibleActionsForSk("Staff", "u1", approved)).toEqual([]);
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

  it("allows historical items to be reviewed and lets Admin delete them", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Submitted", is_historical_import: true })).toEqual(["reviewDecision"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Deferred", is_historical_import: true })).toEqual([]);
    expect(visibleActionsForSk("Admin", "admin", { status: "Approved", is_historical_import: true })).toEqual([
      "reviewDecision",
      "delete",
    ]);
  });

  it("keeps direct KHMT assignment on the owning team account", () => {
    const approved = { status: "Approved", author_user_id: "TBCH", team: "TBCH" };

    expect(visibleActionsForSk("Admin", "admin", approved)).toEqual(["reviewDecision", "assignKhmt", "delete"]);
    expect(visibleActionsForSk("Admin", "admin", { ...approved, author_user_id: "admin" })).toEqual([
      "reviewDecision",
      "assignKhmt",
      "delete",
    ]);
    expect(visibleActionsForSk("Team_Account", "TBCH", approved)).toEqual(["assignKhmt"]);
    expect(visibleActionsForSk("Team_Account", "TBĐL", approved)).toEqual([]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", approved)).toEqual([]);
  });

  it("hides admin edit actions when global edit mode is off", () => {
    const approved = { status: "Approved", author_user_id: "TBCH", team: "TBCH" };

    expect(visibleActionsForSk("Admin", "admin", approved, false)).toEqual([]);
    expect(visibleActionsForSk("Team_Account", "TBCH", approved, false)).toEqual(["assignKhmt"]);
  });

  it("allows admin and the owning team account to choose KHMT month", () => {
    const approved = { status: "Approved", team: "TBCH" };

    expect(canSelectKhmtMonth("Admin", "admin", approved)).toBe(true);
    expect(canSelectKhmtMonth("Team_Account", "TBCH", approved)).toBe(true);
    expect(canSelectKhmtMonth("Team_Account", "user1", approved, "TBCH")).toBe(true);
    expect(canSelectKhmtMonth("Team_Account", "TBĐL", approved)).toBe(false);
    expect(canSelectKhmtMonth("FI_Coordinator", "fi", approved)).toBe(false);
    expect(canSelectKhmtMonth("Admin", "admin", { ...approved, status: "Submitted" })).toBe(false);
    expect(canSelectKhmtMonth("Team_Account", "TBCH", { ...approved, status: "Submitted" })).toBe(false);
  });

  it("treats returning to Chưa vào KHMT as a KHMT change", () => {
    expect(hasKhmtPendingChange("", "5")).toBe(true);
    expect(hasKhmtPendingChange("5", "5")).toBe(false);
    expect(hasKhmtPendingChange("", "")).toBe(false);
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
