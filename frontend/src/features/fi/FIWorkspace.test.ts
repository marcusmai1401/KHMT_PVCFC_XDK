import { describe, expect, it } from "vitest";
import { visibleActionsForSk } from "./FIWorkspace";

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

  it("shows approve and reject for FI_Coordinator on Submitted items", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Submitted" })).toEqual(["edit", "approve", "reject"]);
  });

  it("shows approve and reject for FI_Coordinator on Reviewed items", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Reviewed" })).toEqual(["edit", "approve", "reject"]);
  });

  it("shows approve and reject for reviewer roles on pending items", () => {
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Submitted" })).toEqual(["edit", "approve", "reject"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Deferred" })).toEqual(["edit", "approve", "reject"]);
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Deferred" })).toEqual(["edit", "approve", "reject"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Approved" })).toEqual(["edit"]);
  });

  it("allows historical pending items to be reviewed but not deleted", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Submitted", is_historical_import: true })).toEqual(["edit", "approve", "reject"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", { status: "Deferred", is_historical_import: true })).toEqual(["edit", "approve", "reject"]);
    expect(visibleActionsForSk("Admin", "admin", { status: "Approved", is_historical_import: true })).toEqual(["edit"]);
  });

  it("keeps KHMT assignment admin-only", () => {
    const approved = { status: "Approved", author_user_id: "u1" };

    expect(visibleActionsForSk("Admin", "admin", approved)).toEqual(["edit", "assignKhmt", "delete"]);
    expect(visibleActionsForSk("Workshop_Leader", "leader", approved)).toEqual(["edit"]);
  });

  it("does not allow FI_Coordinator to delete approved items", () => {
    expect(visibleActionsForSk("FI_Coordinator", "coord", { status: "Approved" })).toEqual(["edit"]);
  });
});
