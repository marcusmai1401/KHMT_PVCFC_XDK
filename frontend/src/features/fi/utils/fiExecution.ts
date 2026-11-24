import type { FiExecutionState, FiExecutionStatusValue } from "../types/fiDashboard";

export const TEAM_ROLE = "Team_Account";
export const STAFF_ROLE = "Staff";
export const FI_COORDINATOR_ROLE = "FI_Coordinator";
export const ADMIN_ROLE = "Admin";
export const WORKSHOP_LEADER_ROLE = "Workshop_Leader";

export const EXECUTION_EDITABLE_STATUSES = ["Approved", "Completed"];
export const AUTHOR_CONTENT_EDITABLE_STATUSES = [
  "Draft",
  "NeedMoreInfo",
  "Submitted",
  "Reviewed",
  "Rejected",
  "Deferred",
];
export const OWNER_PRE_APPROVAL_PLAN_STATUSES = [
  "Submitted",
  "NeedMoreInfo",
  "Reviewed",
  "Deferred",
  "Rejected",
];
export const PLAN_HISTORY_REASONS = [
  "completion_plan_update",
  "execution_update",
  "completion_auto_done",
  "completion_auto_planned",
  "completion_auto_done_reverted",
];

const SYSTEM_ACTOR_IDS = new Set(["historical-import", "deploy-import", "system"]);

export type ExecutionTone = "done" | "planned" | "paused" | "unknown";

export type ExecutionView = {
  tone: ExecutionTone;
  status: FiExecutionStatusValue;
  label: string;
  date: string | null;
  dateText: string | null;
  note: string | null;
  executionNote: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  auto: boolean;
  applicable: boolean;
};

export function isoDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIsoDate(): string {
  return isoDateInput(new Date());
}

export function tomorrowIsoDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDateInput(d);
}

export function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDateInput(d);
}

export function addMonthsIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return isoDateInput(d);
}

export function endOfYearIso(): string {
  const year = new Date().getFullYear();
  return `${year}-12-31`;
}

export function formatDateVi(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
}

function endOfMonthIso(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number);
  return isoDateInput(new Date(year, month, 0));
}

function isSystemActor(value: string | null | undefined): boolean {
  return SYSTEM_ACTOR_IDS.has(String(value || "").trim());
}

export function getRecordAuthorId(item: any): string | null {
  if (item?.effective_author_user_id) return String(item.effective_author_user_id);
  if (item?.author_user_id && !isSystemActor(item.author_user_id)) return String(item.author_user_id);
  return null;
}

export function getRecordSubmitterId(item: any): string | null {
  if (item?.submitted_by && !isSystemActor(item.submitted_by)) return String(item.submitted_by);
  if (item?.effective_author_user_id && item?.is_historical_import) return String(item.effective_author_user_id);
  if (item?.created_by) return String(item.created_by);
  const history = Array.isArray(item?.status_history) ? item.status_history : [];
  const first = history[0];
  if (!first || typeof first !== "object") return null;
  const comments = typeof first.comments === "object" && first.comments !== null ? first.comments : {};
  const fallback = String(comments.submitted_by || comments.created_by || first.changed_by || "") || null;
  return isSystemActor(fallback) && item?.effective_author_user_id
    ? String(item.effective_author_user_id)
    : fallback;
}

export function lastPlanHistoryReason(item: any): string | null {
  const history = Array.isArray(item?.status_history) ? item.status_history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (PLAN_HISTORY_REASONS.includes(history[index]?.reason)) return history[index].reason;
  }
  return null;
}

export function parseCompletionPlanText(
  value: string | null | undefined,
  completedAt?: string | null,
): { date: string; done: boolean; hasFullDate: boolean } | null {
  if (completedAt) {
    const parsed = new Date(completedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return { date: isoDateInput(parsed), done: true, hasFullDate: true };
    }
  }
  if (!value) return null;
  const trimmed = String(value).trim();
  const done =
    /(^|\s)(đã\s+hoàn\s+thành|đã\s+thực\s+hiện|đã\s+triển\s+khai|hoàn\s+thành)(\s|$)/i.test(trimmed) &&
    !/(chưa\s+thực\s+hiện|chưa\s+hoàn\s+thành|dự\s+kiến|tạm\s+dừng)/i.test(trimmed);
  const dateMatch = trimmed.match(/\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(20\d{2})\b/);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = Number(dateMatch[3]);
    const dt = new Date(year, month - 1, day);
    if (dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day) {
      return { date: isoDateInput(dt), done, hasFullDate: true };
    }
  }
  const monthMatch = trimmed.match(/(?:T|tháng)?\s*(\d{1,2})\s*[./-]\s*(20\d{2})/i);
  if (monthMatch) {
    const month = Number(monthMatch[1]);
    const year = Number(monthMatch[2]);
    if (month >= 1 && month <= 12 && year >= 2020 && year <= 2100) {
      return { date: isoDateInput(new Date(year, month - 1, 1)), done, hasFullDate: false };
    }
  }
  return null;
}

function isStandardPlanFormat(raw: string): boolean {
  return (
    /^(đã hoàn thành|dự kiến hoàn thành)\s+\d{1,2}\/\d{1,2}\/\d{4}$/i.test(raw) ||
    /^tạm dừng(\s*·\s*dự kiến\s+\d{1,2}\/\d{1,2}\/\d{4}|\s*\/\s*chờ điều kiện triển khai)?$/i.test(raw)
  );
}

export function resolveExecutionView(item: any, today = todayIsoDate()): ExecutionView {
  const raw = String(item?.completion_plan ?? "").trim();
  const note = raw && !isStandardPlanFormat(raw) ? raw : null;
  const serverState = (item?.execution_state ?? null) as FiExecutionState | null;
  const executionNote = (serverState?.note ?? item?.execution_note ?? null) || null;
  const updatedAt = serverState?.updated_at ?? item?.execution_updated_at ?? null;
  const updatedBy = serverState?.updated_by ?? item?.execution_updated_by ?? null;
  const updatedByName = serverState?.updated_by_name ?? null;
  const applicable = serverState ? Boolean(serverState.applicable) : EXECUTION_EDITABLE_STATUSES.includes(item?.status);

  // Explicit paused state (either via server execution_state or execution_status column)
  if (serverState?.status === "paused" || (applicable && item?.execution_status === "paused")) {
    const due = serverState?.due_date ?? parseCompletionPlanText(raw, null)?.date ?? null;
    return {
      tone: "paused",
      status: "paused",
      label: "Tạm dừng",
      date: due,
      dateText: due ? formatDateVi(due) : null,
      note,
      executionNote,
      updatedAt,
      updatedBy,
      updatedByName,
      auto: false,
      applicable: true,
    };
  }

  // Trust server execution_state when provided for Approved/Completed items
  if (serverState && serverState.applicable) {
    if (serverState.status === "completed") {
      const compDate = serverState.completed_date || serverState.due_date;
      return {
        tone: "done",
        status: "completed",
        label: "Đã hoàn thành",
        date: compDate,
        dateText: compDate ? formatDateVi(compDate) : null,
        note,
        executionNote,
        updatedAt,
        updatedBy,
        updatedByName,
        auto: Boolean(serverState.is_auto_done),
        applicable: true,
      };
    }
    if (serverState.due_date) {
      const parsedRaw = parseCompletionPlanText(raw, null);
      const hasFullDate = parsedRaw ? parsedRaw.hasFullDate : true;
      const [yr, mo] = serverState.due_date.split("-");
      return {
        tone: "planned",
        status: "in_progress",
        label: "Dự kiến",
        date: serverState.due_date,
        dateText: hasFullDate ? formatDateVi(serverState.due_date) : `T${Number(mo)}/${yr}`,
        note,
        executionNote,
        updatedAt,
        updatedBy,
        updatedByName,
        auto: false,
        applicable: true,
      };
    }
    return {
      tone: "unknown",
      status: "in_progress",
      label: raw || "Đang thực hiện",
      date: null,
      dateText: null,
      note: null,
      executionNote,
      updatedAt,
      updatedBy,
      updatedByName,
      auto: false,
      applicable: true,
    };
  }

  // Client-side fallback (pre-approval items or fixtures without execution_state)
  const parsed = parseCompletionPlanText(raw, item?.completed_at);
  if (!parsed) {
    return {
      tone: "unknown",
      status: applicable ? "in_progress" : "not_applicable",
      label: raw || "Chưa ghi kế hoạch",
      date: null,
      dateText: null,
      note: null,
      executionNote,
      updatedAt,
      updatedBy,
      updatedByName,
      auto: false,
      applicable,
    };
  }

  const [year, month] = parsed.date.split("-");
  const dateText = parsed.hasFullDate ? formatDateVi(parsed.date) : `T${Number(month)}/${year}`;

  if (item?.execution_status === "completed" || (parsed.done && parsed.date <= today)) {
    const auto =
      item?.execution_status === "auto_completed" ||
      (item?.execution_status !== "completed" && lastPlanHistoryReason(item) === "completion_auto_done");
    return {
      tone: "done",
      status: applicable ? "completed" : "not_applicable",
      label: "Đã hoàn thành",
      date: parsed.date,
      dateText,
      note,
      executionNote,
      updatedAt,
      updatedBy,
      updatedByName,
      auto,
      applicable,
    };
  }

  const dueDate = parsed.hasFullDate ? parsed.date : endOfMonthIso(parsed.date);
  // Strict allowlist: only Approved (not paused) auto-completes when due date arrives.
  if (!parsed.done && dueDate <= today && item?.status === "Approved" && item?.execution_status !== "paused") {
    return {
      tone: "done",
      status: "completed",
      label: "Đã hoàn thành",
      date: dueDate,
      dateText: formatDateVi(dueDate),
      note,
      executionNote,
      updatedAt,
      updatedBy,
      updatedByName,
      auto: true,
      applicable: true,
    };
  }

  return {
    tone: "planned",
    status: applicable ? "in_progress" : "not_applicable",
    label: "Dự kiến",
    date: dueDate,
    dateText,
    note,
    executionNote,
    updatedAt,
    updatedBy,
    updatedByName,
    auto: false,
    applicable,
  };
}

export function isExecutionCompleted(item: any, today = todayIsoDate()): boolean {
  if (!item) return false;
  if (item.execution_status === "paused" || item.execution_state?.status === "paused") return false;
  return resolveExecutionView(item, today).tone === "done";
}

export function canUpdateExecution(
  role: string,
  currentUserId: string,
  currentTeam: string | null | undefined,
  item: any,
  editMode = true,
): boolean {
  if (!item) return false;
  if (role === ADMIN_ROLE && !editMode) return false;
  if (item.status === "Cancelled") return false;

  // When the backend explicitly computed execution_state.can_update for this principal, trust it.
  if (typeof item?.execution_state?.can_update === "boolean") {
    return item.execution_state.can_update;
  }

  const authorId = getRecordAuthorId(item);
  const submitterId = getRecordSubmitterId(item);
  const isOwner = authorId === currentUserId || submitterId === currentUserId;
  const ownerTeam = currentTeam ?? currentUserId;

  if (EXECUTION_EDITABLE_STATUSES.includes(item.status)) {
    if (role === ADMIN_ROLE) return editMode;
    if (role === FI_COORDINATOR_ROLE) return true;
    if (role === TEAM_ROLE && ownerTeam === item.team) return true;
    return isOwner;
  }

  if (OWNER_PRE_APPROVAL_PLAN_STATUSES.includes(item.status)) {
    return isOwner;
  }
  return false;
}

export function canUploadCompletionImages(
  role: string,
  currentUserId: string,
  currentTeam: string | null | undefined,
  item: any,
  editMode = true,
): boolean {
  if (!item || !EXECUTION_EDITABLE_STATUSES.includes(item.status)) return false;
  if (role === ADMIN_ROLE && !editMode) return false;
  if (typeof item?.execution_state?.can_upload_completion_image === "boolean") {
    return item.execution_state.can_upload_completion_image;
  }
  return canUpdateExecution(role, currentUserId, currentTeam, item, editMode);
}

export function canDeleteSkImage(
  role: string,
  currentUserId: string,
  currentTeam: string | null | undefined,
  item: any,
  image: any,
  editMode = true,
): boolean {
  if (!item || !image) return false;
  if (role === ADMIN_ROLE) return editMode;

  if (EXECUTION_EDITABLE_STATUSES.includes(item.status)) {
    const stage = String(image.stage || "registration");
    if (stage !== "completion") return false;
    if (image.uploaded_by === currentUserId) return true;
    if (role === FI_COORDINATOR_ROLE) return true;
    const ownerTeam = currentTeam ?? currentUserId;
    if (role === TEAM_ROLE && ownerTeam === item.team) return true;
    return false;
  }

  const isOwner = getRecordAuthorId(item) === currentUserId || getRecordSubmitterId(item) === currentUserId;
  return isOwner && AUTHOR_CONTENT_EDITABLE_STATUSES.includes(item.status);
}

export function executionBlockedHint(
  role: string,
  currentUserId: string,
  currentTeam: string | null | undefined,
  item: any,
  editMode = true,
): string | undefined {
  if (!item || !EXECUTION_EDITABLE_STATUSES.includes(item.status)) return undefined;
  if (canUpdateExecution(role, currentUserId, currentTeam, item, editMode)) return undefined;
  if (role === ADMIN_ROLE && !editMode) {
    return "Bật “Chỉnh sửa” ở góc trên để cập nhật tình hình thực hiện.";
  }
  if (role === WORKSHOP_LEADER_ROLE) {
    return "Chế độ chỉ xem · Đội/Tổ trưởng, tác giả hoặc Đầu mối FI cập nhật tiến độ.";
  }
  return (
    item?.execution_state?.update_blocked_reason ||
    `Chỉ tác giả, Đội/Tổ trưởng ${item.team || ""} hoặc Đầu mối FI được cập nhật.`.trim()
  );
}

export function splitImagesByStage(images: any[]): { registration: any[]; completion: any[] } {
  const registration: any[] = [];
  const completion: any[] = [];
  for (const img of images) {
    if (String(img?.stage || "registration") === "completion") {
      completion.push(img);
    } else {
      registration.push(img);
    }
  }
  return { registration, completion };
}
