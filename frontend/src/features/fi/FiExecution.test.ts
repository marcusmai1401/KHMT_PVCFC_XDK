import { describe, expect, it } from "vitest";
import {
  canDeleteSkImage,
  canUpdateExecution,
  canUploadCompletionImages,
  executionBlockedHint,
  isExecutionCompleted,
  resolveExecutionView,
  splitImagesByStage,
} from "./utils/fiExecution";

describe("FI execution permissions (A1)", () => {
  const teammateApproved = {
    id: "sk-1",
    status: "Approved",
    team: "TBHTĐK",
    author_user_id: "quynhnm",
    submitted_by: "quynhnm",
  };

  it("grants execution update and completion upload to Author, same-team Team_Account, FI_Coordinator, and Admin (editMode)", () => {
    expect(canUpdateExecution("Staff", "quynhnm", "TBHTĐK", teammateApproved)).toBe(true);
    expect(canUpdateExecution("Team_Account", "minhvq", "TBHTĐK", teammateApproved)).toBe(true);
    expect(canUpdateExecution("FI_Coordinator", "quyenpt", "TBHTĐK", teammateApproved)).toBe(true);
    expect(canUpdateExecution("Admin", "admin", null, teammateApproved, true)).toBe(true);

    expect(canUploadCompletionImages("Team_Account", "minhvq", "TBHTĐK", teammateApproved)).toBe(true);
    expect(canUploadCompletionImages("FI_Coordinator", "quyenpt", "TBHTĐK", teammateApproved)).toBe(true);
    expect(canUploadCompletionImages("Admin", "admin", null, teammateApproved, true)).toBe(true);
  });

  it("blocks other-team Team_Account, non-author Staff, Workshop_Leader, and Admin with editMode=false", () => {
    expect(canUpdateExecution("Team_Account", "linhln", "TBCH", teammateApproved)).toBe(false);
    expect(canUpdateExecution("Staff", "other_staff", "TBHTĐK", teammateApproved)).toBe(false);
    expect(canUpdateExecution("Workshop_Leader", "kiaq", null, teammateApproved)).toBe(false);
    expect(canUpdateExecution("Admin", "admin", null, teammateApproved, false)).toBe(false);

    expect(canUploadCompletionImages("Team_Account", "linhln", "TBCH", teammateApproved)).toBe(false);
    expect(canUploadCompletionImages("Workshop_Leader", "kiaq", null, teammateApproved)).toBe(false);
    expect(canUploadCompletionImages("Admin", "admin", null, teammateApproved, false)).toBe(false);
  });

  it("provides clear Vietnamese hints when execution update is blocked", () => {
    expect(executionBlockedHint("Admin", "admin", null, teammateApproved, false)).toContain("Chỉnh sửa");
    expect(executionBlockedHint("Workshop_Leader", "kiaq", null, teammateApproved)).toContain("chỉ xem");
    expect(executionBlockedHint("Team_Account", "linhln", "TBCH", teammateApproved)).toContain("TBHTĐK");
    expect(executionBlockedHint("Team_Account", "minhvq", "TBHTĐK", teammateApproved)).toBeUndefined();
  });

  it("protects registration images on Approved SKs from non-Admin deletion while allowing completion image deletion", () => {
    const regImg = { id: "i1", stage: "registration", uploaded_by: "quynhnm" };
    const compImg = { id: "i2", stage: "completion", uploaded_by: "minhvq" };

    expect(canDeleteSkImage("Staff", "quynhnm", "TBHTĐK", teammateApproved, regImg)).toBe(false);
    expect(canDeleteSkImage("Team_Account", "minhvq", "TBHTĐK", teammateApproved, regImg)).toBe(false);
    expect(canDeleteSkImage("FI_Coordinator", "quyenpt", "TBHTĐK", teammateApproved, regImg)).toBe(false);
    expect(canDeleteSkImage("Admin", "admin", null, teammateApproved, regImg, true)).toBe(true);
    expect(canDeleteSkImage("Admin", "admin", null, teammateApproved, regImg, false)).toBe(false);

    expect(canDeleteSkImage("Team_Account", "minhvq", "TBHTĐK", teammateApproved, compImg)).toBe(true);
    expect(canDeleteSkImage("FI_Coordinator", "quyenpt", "TBHTĐK", teammateApproved, compImg)).toBe(true);
    expect(canDeleteSkImage("Team_Account", "linhln", "TBCH", teammateApproved, compImg)).toBe(false);
  });
});

describe("FI execution state resolution (A2 & A4)", () => {
  const today = "2026-11-24";

  it("distinguishes confirmed completed, auto_completed, paused, and in_progress", () => {
    const confirmed = resolveExecutionView(
      {
        status: "Approved",
        execution_status: "completed",
        completed_at: "2026-11-20T00:00:00Z",
        completion_plan: "Đã hoàn thành 20/11/2026",
        execution_note: "Đã nghiệm thu",
      },
      today,
    );
    expect(confirmed).toMatchObject({ tone: "done", auto: false, date: "2026-11-20", executionNote: "Đã nghiệm thu" });
    expect(isExecutionCompleted({ status: "Approved", execution_status: "completed", completed_at: "2026-11-20T00:00:00Z" }, today)).toBe(true);

    const autoDone = resolveExecutionView(
      {
        status: "Approved",
        execution_status: "auto_completed",
        completed_at: "2026-10-15T00:00:00Z",
        completion_plan: "Đã hoàn thành 15/10/2026",
      },
      today,
    );
    expect(autoDone).toMatchObject({ tone: "done", auto: true, date: "2026-10-15" });

    const paused = resolveExecutionView(
      {
        status: "Approved",
        execution_status: "paused",
        completion_plan: "Dự kiến hoàn thành 15/10/2026",
        execution_note: "Chờ dừng máy",
      },
      today,
    );
    expect(paused).toMatchObject({ tone: "paused", auto: false, label: "Tạm dừng", executionNote: "Chờ dừng máy" });
    expect(isExecutionCompleted({ status: "Approved", execution_status: "paused", completion_plan: "Dự kiến hoàn thành 15/10/2026" }, today)).toBe(false);
  });

  it("splits supporting images cleanly into registration and completion stages", () => {
    const split = splitImagesByStage([
      { id: "1", file_name: "before.png" },
      { id: "2", file_name: "before2.png", stage: "registration" },
      { id: "3", file_name: "after.png", stage: "completion" },
    ]);
    expect(split.registration.map((i) => i.id)).toEqual(["1", "2"]);
    expect(split.completion.map((i) => i.id)).toEqual(["3"]);
  });
});
