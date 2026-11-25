import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Flag,
  FileDown,
  History,
  Image as ImageIcon,
  ImagePlus,
  Info,
  ListChecks,
  Pencil,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users2,
  UserRound,
  X,
} from "lucide-react";
import { ApiError, api } from "../../api/client";

import { DraftRecoveryStore, downloadDraft } from "../../shared/editing/DraftRecoveryStore";
import { useNavigationGuard } from "../../shared/editing/NavigationGuardProvider";
import { FiDashboardView } from "./components/FiDashboardView";
import { FiDetailDrawer } from "./components/FiDetailDrawer";
import { FiCompletionPill, FiExecutionBand } from "./components/FiExecutionBand";
import { FiExecutionUpdateModal, type ExecutionModalInitialStatus } from "./components/FiExecutionUpdateModal";
import { FiKhmtMonthPicker } from "./components/FiKhmtMonthPicker";
import { FiMatrixCellDrawer } from "./components/FiMatrixCellDrawer";
import type { MatrixDrawerSelection } from "./types/fiDashboard";
import {
  EXECUTION_EDITABLE_STATUSES,
  PLAN_HISTORY_REASONS as EXECUTION_PLAN_HISTORY_REASONS,
  canDeleteSkImage,
  canUpdateExecution,
  canUploadCompletionImages,
  executionBlockedHint,
  isExecutionCompleted,
  resolveExecutionView,
  splitImagesByStage,
} from "./utils/fiExecution";
import {
  buildStatusSlices,
  khmtUnassignedApprovedCount,
} from "./utils/fiMetrics";

export { buildStatusSlices };

const TEAM_ROLE = "Team_Account";
const STAFF_ROLE = "Staff";
const FI_COORDINATOR_ROLE = "FI_Coordinator";
const ADMIN_ROLE = "Admin";
// FI_Coordinator (Phạm Thanh Quyền) cũng là tác giả cho team TBHTĐK,
// không chỉ là người xét duyệt.
const AUTHOR_ROLES = [TEAM_ROLE, STAFF_ROLE, FI_COORDINATOR_ROLE];
const AUTHOR_PICKER_ROLES = [...AUTHOR_ROLES, ADMIN_ROLE];
const FI_TEAMS = ["TBCH", "TBĐL", "TBHTĐK", "TCĐK"];
const TEAM_DISPLAY_LABELS: Record<string, string> = {
  Workshop_Staff: "Xưởng quản lí",
};
const REVIEWER_ROLES = [ADMIN_ROLE, FI_COORDINATOR_ROLE];
const REVIEW_DECISION_STATUSES = ["Submitted", "Reviewed", "Deferred", "Approved", "Rejected"];
const REVIEWED_STATUSES = ["Approved", "Rejected", "Deferred", "Reviewed"];
// Sau khi đã đăng ký xét duyệt, tác giả vẫn được sửa nội dung (trừ Completed/Cancelled).
// Edit này sẽ kích hoạt noti SK_CONTENT_EDITED để FI/Admin xét duyệt lại.
const AUTHOR_EDITABLE_STATUSES = [
  "Draft",
  "NeedMoreInfo",
  "Submitted",
  "Reviewed",
  "Rejected",
  "Deferred",
];
// SK đã Đồng ý: nội dung đã duyệt giữ nguyên, tác giả/người gửi hộ chỉ cập
// nhật Kế hoạch hoàn thành; trạng thái không đổi và không cần xét duyệt lại.
const PLAN_ONLY_EDITABLE_STATUSES = ["Approved"];
export function isPlanOnlyEdit(item: any) {
  return PLAN_ONLY_EDITABLE_STATUSES.includes(item?.status);
}
// Sửa nội dung SK ở các trạng thái này sẽ nộp lại, đưa về Chờ xét duyệt.
const RESUBMIT_ON_EDIT_STATUSES = ["NeedMoreInfo", "Deferred", "Rejected"];
// Cùng quy ước với backend: nháp và SK Không đồng ý không tự hoàn thành khi tới ngày dự kiến.
const NOT_AUTO_DONE_STATUSES = ["Draft", "Rejected", "Cancelled"];
function editActionTitle(item: any) {
  if (isPlanOnlyEdit(item)) return "Cập nhật kế hoạch hoàn thành";
  if (RESUBMIT_ON_EDIT_STATUSES.includes(item?.status)) return "Chỉnh sửa và gửi xét duyệt lại";
  if (item?.status !== "Draft") return "Chỉnh sửa (sẽ gửi thông báo xét duyệt lại)";
  return "Chỉnh sửa nội dung/kế hoạch";
}
const OWNER_DELETABLE_STATUSES = ["Draft", "Submitted", "NeedMoreInfo"];
const OWNERSHIP_PREVIEW_LIMIT = 5;
const OWNERSHIP_PENDING_STATUSES = new Set(["Draft", "Submitted", "NeedMoreInfo"]);
const KHMT_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const KHMT_ASSIGNABLE_STATUSES = ["Approved", "Completed"];

const statusLabels: Record<string, string> = {
  Draft: "Chưa trình duyệt",
  Submitted: "Chờ xét duyệt",
  NeedMoreInfo: "Cần bổ sung",
  Reviewed: "Đã xem xét",
  Approved: "Đã phê duyệt",
  Rejected: "Từ chối",
  Deferred: "Xem xét sau",
  Cancelled: "Đã hủy",
  Completed: "Hoàn tất",
};

const renderEmptyState = (message: string) => (
  <div className="fi-empty-state">
    <div className="fi-empty-state-icon">
      <ClipboardList size={24} />
    </div>
    <p>{message}</p>
  </div>
);

const importedStatusLabels: Record<string, string> = {
  Approved: "Đồng ý",
  Submitted: "Chờ xét duyệt",
  Rejected: "Không đồng ý",
  Deferred: "Xem xét sau",
  Completed: "Hoàn tất",
};

type FITab = "register" | "review" | "history" | "dashboard";
const fiSnapshotNames: Record<FITab, string> = {
  register: "fi-dang-ky",
  review: "fi-xet-duyet",
  dashboard: "fi-dashboard",
  history: "fi-lich-su",
};
type ReviewQueueFilter = "pending" | "reviewed" | "all";
type OwnershipBucket = "pending" | "implementation" | "history";
type OwnershipMode = "mine" | "sent";
type OwnershipListKey = "minePending" | "mineImplementation" | "sentPending" | "sentImplementation";
type HistoryMonthGroup = { key: string; month: number | null; year: number; items: any[] };
type ReviewDecision = "approve" | "request-info" | "defer" | "reject";

type HistoryDecisionFilter = "approved" | "rejected" | "deferred" | "pending";
type HistoryKhmtFilter = "in" | "out";
type HistoryCompletionFilter = "done" | "pending" | "auto_done" | "paused";
type EmployeeOption = { id: string; display_name: string; full_name: string; team: string | null; role: string };
type PersonFilterOption = {
  key: string;
  label: string;
  accountId: string | null;
  team: string | null;
  count: number;
  nameKey: string;
  searchText: string;
};

const reviewDecisionOptions: Array<{ value: ReviewDecision; label: string; helper: string }> = [
  { value: "approve", label: "Đồng ý", helper: "Ghi nhận SK đạt yêu cầu xét duyệt." },
  { value: "request-info", label: "Cần bổ sung", helper: "Trả về tác giả bổ sung ảnh/thông tin; tác giả sửa xong SK tự quay lại hàng chờ." },
  { value: "defer", label: "Xem xét sau", helper: "Giữ lại để đánh giá tiếp hoặc cần thêm cơ sở." },
  { value: "reject", label: "Không đồng ý", helper: "Không đưa SK vào luồng thực hiện." },
];

// "Cần bổ sung" chỉ áp dụng cho SK tạo trên web đang chờ duyệt (backend: Submitted → NeedMoreInfo).
function reviewDecisionOptionsFor(item: any) {
  const canRequestInfo = item?.status === "Submitted" && !item?.is_historical_import;
  return reviewDecisionOptions.filter((option) => option.value !== "request-info" || canRequestInfo);
}

const historyDecisionFilterOptions: Array<{ value: HistoryDecisionFilter; label: string; tone: string }> = [
  { value: "approved", label: "Đồng ý", tone: "success" },
  { value: "rejected", label: "Không đồng ý", tone: "danger" },
  { value: "deferred", label: "Xem xét sau", tone: "warning" },
  { value: "pending", label: "Chưa duyệt", tone: "neutral" },
];

const historyKhmtFilterOptions: Array<{ value: HistoryKhmtFilter; label: string; tone: string }> = [
  { value: "in", label: "Đã vào KHMT", tone: "success" },
  { value: "out", label: "Chưa vào KHMT", tone: "neutral" },
];

const historyCompletionFilterOptions: Array<{ value: HistoryCompletionFilter; label: string; tone: string }> = [
  { value: "done", label: "Đã hoàn thành", tone: "success" },
  { value: "pending", label: "Chưa hoàn thành", tone: "warning" },
  { value: "auto_done", label: "Tự ghi nhận · cần xác nhận", tone: "info" },
];

function decisionFilterForItem(item: any): HistoryDecisionFilter {
  const status = item?.status;
  if (status === "Approved" || status === "Completed") return "approved";
  if (status === "Rejected") return "rejected";
  if (status === "Deferred") return "deferred";
  return "pending";
}

function khmtFilterForItem(item: any): HistoryKhmtFilter {
  return isKhmtConsidered(item) ? "in" : "out";
}

export function matchesHistoryKhmtFilters(
  item: any,
  statuses: HistoryKhmtFilter[],
  periods: string[],
) {
  const status = khmtFilterForItem(item);
  if (statuses.length > 0 && !statuses.includes(status)) return false;
  if (periods.length === 0) return true;
  if (status === "out") return statuses.includes("out");
  return periods.includes(`${Number(item?.khmt_year)}-${Number(item?.khmt_month)}`);
}

// Single source of truth for the LĐX decision badge in the history view, so the
// per-item pill and the filter chip always speak the same language
// (Đồng ý / Không đồng ý / Xem xét sau / Chưa duyệt) regardless of whether the
// record came from the live workflow or an Excel import.
const historyDecisionBadgeMap = Object.fromEntries(
  historyDecisionFilterOptions.map((option) => [option.value, { label: option.label, tone: option.tone }]),
) as Record<HistoryDecisionFilter, { label: string; tone: string }>;

function historyDecisionBadge(item: any): { label: string; tone: string } {
  return historyDecisionBadgeMap[decisionFilterForItem(item)];
}

function completionFilterForItem(item: any): HistoryCompletionFilter {
  if (item?.status === "Completed") return "done";
  return completionState(item).tone === "done" ? "done" : "pending";
}

function displayStatus(value: string) {
  return statusLabels[value] ?? value;
}

export function displayTeam(value: string | null | undefined) {
  if (!value) return "";
  return TEAM_DISPLAY_LABELS[value] ?? value;
}

function displayImportedStatus(value: string) {
  return importedStatusLabels[value] ?? displayStatus(value);
}

function displayHistoryStatus(item: any) {
  return displayImportedStatus(item.status);
}

function reviewDecisionFromStatus(status: string): ReviewDecision {
  if (status === "Deferred") return "defer";
  if (status === "Rejected") return "reject";
  return "approve";
}

function reviewDecisionLabel(value: ReviewDecision) {
  return reviewDecisionOptions.find((option) => option.value === value)?.label ?? value;
}

function reviewDecisionRequiresNote(value: ReviewDecision) {
  return value === "defer" || value === "reject" || value === "request-info";
}

function todayIsoDate() {
  return isoDateInput(new Date());
}

function tomorrowIsoDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return isoDateInput(date);
}

// Keep the date valid for the chosen state: a completion date cannot be in the
// future, and a planned date must still be ahead (reaching it counts as done).
function completionDateFor(done: boolean, current: string) {
  const today = todayIsoDate();
  if (done) return !current || current > today ? today : current;
  return current && current > today ? current : isoDateInput(addMonths(new Date(), 1));
}

function completionPlanError(done: boolean, date: string, allowTodayPlanned = true) {
  const today = todayIsoDate();
  if (done && date > today) return "Ngày hoàn thành không được sau ngày hôm nay.";
  if (!done && (allowTodayPlanned ? date < today : date <= today)) {
    return allowTodayPlanned
      ? "Ngày dự kiến không được trước ngày hôm nay. Nếu sáng kiến đã xong, chọn “Đã hoàn thành”."
      : "Ngày dự kiến phải sau hôm nay. Nếu sáng kiến đã xong, chọn “Đã hoàn thành”.";
  }
  return "";
}

function isoDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonths(date: Date, months: number) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function ownershipTimestamp(item: any) {
  for (const value of [item?.updated_at, item?.submitted_at, item?.created_at]) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

export function ownershipBucketForItem(item: any): OwnershipBucket {
  if (OWNERSHIP_PENDING_STATUSES.has(item?.status)) return "pending";
  if (item?.status === "Approved") {
    return isExecutionCompleted(item) ? "history" : "implementation";
  }
  return "history";
}

export function buildOwnershipSections(rows: any[], _mode: OwnershipMode) {
  const sections = {
    pending: [] as any[],
    implementation: [] as any[],
    history: [] as any[],
  };
  const sortedRows = [...rows].sort(
    (a, b) => ownershipTimestamp(b) - ownershipTimestamp(a) || String(b?.id || "").localeCompare(String(a?.id || "")),
  );

  sortedRows.forEach((item) => {
    const bucket = ownershipBucketForItem(item);
    sections[bucket].push(item);
  });
  return sections;
}

// Chuẩn hoá chuỗi để tìm tác giả không phân biệt dấu/hoa-thường: gõ "Vo", "Võ",
// "vo" đều khớp "Võ"; gõ "do" khớp "Đỗ" (đ → d). Dùng cho bộ lọc combobox tác giả.
function normalizeAuthorQuery(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

const SYSTEM_ACTOR_ID = "historical-import";
const SYSTEM_ACTOR_IDS = new Set([SYSTEM_ACTOR_ID, "deploy-import"]);

function isSystemActorId(value: string | null | undefined) {
  return SYSTEM_ACTOR_IDS.has(String(value || "").trim());
}

function personFilterKey(userId: string | null | undefined, displayName: string | null | undefined) {
  const cleanId = String(userId || "").trim();
  if (cleanId && !isSystemActorId(cleanId)) return `id:${cleanId}`;
  const nameKey = normalizeAuthorQuery(displayName || (isSystemActorId(cleanId) ? "Hệ thống" : ""));
  return nameKey ? `name:${nameKey}` : "";
}

function parseCompletionPlan(value: string | null | undefined, completedAt?: string | null): { date: string; done: boolean } | null {
  if (completedAt) {
    const parsed = new Date(completedAt);
    if (!Number.isNaN(parsed.getTime())) return { date: isoDateInput(parsed), done: true };
  }
  if (!value) return null;
  const trimmed = String(value).trim();
  const done = /(^|\s)(đã\s+hoàn\s+thành|đã\s+thực\s+hiện|đã\s+triển\s+khai|hoàn\s+thành)(\s|$)/i.test(trimmed) &&
    !/(chưa\s+thực\s+hiện|chưa\s+hoàn\s+thành|dự\s+kiến)/i.test(trimmed);
  const dateMatch = trimmed.match(/\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(20\d{2})\b/);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = Number(dateMatch[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return { date: isoDateInput(date), done };
    }
  }
  // Hỗ trợ các dạng: "T6/2026", "06/2026", "6-2026", "T6 / 2026", và text có kèm tháng/năm.
  const monthMatch = trimmed.match(/(?:T|tháng)?\s*(\d{1,2})\s*[./-]\s*(20\d{2})/i);
  if (monthMatch) {
    const month = Number(monthMatch[1]);
    const year = Number(monthMatch[2]);
    if (month >= 1 && month <= 12 && year >= 2020 && year <= 2100) {
      return { date: isoDateInput(new Date(year, month - 1, 1)), done };
    }
  }
  return null;
}

function formatDateForPlan(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
}

type CompletionTone = "done" | "planned" | "paused" | "unknown";

const PLAN_HISTORY_REASONS = EXECUTION_PLAN_HISTORY_REASONS;

export function completionState(item: any, today = todayIsoDate()): {
  tone: CompletionTone;
  label: string;
  date: string | null;
  /** Date as shown to users: dd/mm/yyyy, or Tm/yyyy when the source only gave a month. */
  dateText: string | null;
  note: string | null;
  /** Ghi nhận hoàn thành do tới ngày dự kiến, không phải do tác giả xác nhận. */
  auto: boolean;
} {
  const view = resolveExecutionView(item, today);
  return {
    tone: view.tone,
    label: view.label,
    date: view.date,
    dateText: view.dateText,
    note: view.note,
    auto: view.auto,
  };
}

// Form values that already follow the completion rule (see completionState).
function completionFormValues(item: any) {
  const state = completionState(item);
  const done = state.tone === "done";
  return { completion_done: done, completion_plan_date: completionDateFor(done, state.date ?? "") };
}

function CompletionPlanField({
  idPrefix,
  done,
  date,
  disabled = false,
  allowTodayPlanned = true,
  onChange,
}: {
  idPrefix: string;
  done: boolean;
  date: string;
  disabled?: boolean;
  allowTodayPlanned?: boolean;
  onChange: (next: { done: boolean; date: string }) => void;
}) {
  const choose = (nextDone: boolean) => {
    if (nextDone !== done) onChange({ done: nextDone, date: completionDateFor(nextDone, date) });
  };
  return (
    <fieldset className="fi-plan-field" disabled={disabled}>
      <legend>
        Tiến độ thực hiện <span className="fi-required">*</span>
      </legend>
      <div className="fi-plan-segment" role="radiogroup" aria-label="Tiến độ thực hiện">
        <button
          aria-checked={!done}
          className={`fi-plan-segment-option tone-planned ${!done ? "selected" : ""}`}
          onClick={() => choose(false)}
          role="radio"
          type="button"
        >
          <Clock3 size={16} />
          Đang thực hiện
        </button>
        <button
          aria-checked={done}
          className={`fi-plan-segment-option tone-done ${done ? "selected" : ""}`}
          onClick={() => choose(true)}
          role="radio"
          type="button"
        >
          <CheckCircle2 size={16} />
          Đã hoàn thành
        </button>
      </div>
      <div className="fi-plan-field-date">
        <label htmlFor={`${idPrefix}-date`}>{done ? "Ngày hoàn thành" : "Ngày dự kiến hoàn thành"}</label>
        <input
          id={`${idPrefix}-date`}
          max={done ? todayIsoDate() : undefined}
          min={done ? undefined : allowTodayPlanned ? todayIsoDate() : tomorrowIsoDate()}
          onChange={(event) => onChange({ done, date: event.target.value })}
          required
          type="date"
          value={date}
        />
      </div>
    </fieldset>
  );
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatCompletionPlan(done: boolean, isoDate: string): string {
  const dateText = formatDateForPlan(isoDate);
  return done ? `Đã hoàn thành ${dateText}` : `Dự kiến hoàn thành ${dateText}`;
}

function registrationInfo(item: any) {
  const history = Array.isArray(item.status_history) ? item.status_history : [];
  const comments = history[0]?.comments ?? {};
  const month = Number(comments.registration_month);
  const year = Number(comments.registration_year ?? item.khmt_year ?? 2026) || 2026;
  if (Number.isFinite(month) && month >= 1 && month <= 12) return { month, year };
  if (item.created_at) {
    const date = new Date(item.created_at);
    if (!Number.isNaN(date.getTime())) return { month: date.getMonth() + 1, year: date.getFullYear() };
  }
  return { month: null, year };
}

function registrationMonthValue(item: any) {
  return registrationInfo(item).month;
}

function registrationMonthLabel(item: any) {
  const { month, year } = registrationInfo(item);
  return month ? `T${month}/${year}` : "Chưa rõ tháng";
}

function statusTone(status: string) {
  if (["Approved", "Completed"].includes(status)) return "success";
  if (["Submitted", "Reviewed"].includes(status)) return "info";
  if (["NeedMoreInfo", "Deferred"].includes(status)) return "warning";
  if (["Rejected", "Cancelled"].includes(status)) return "danger";
  return "neutral";
}

function makeIdempotencyKey(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

async function uploadWithRetry(
  skId: string,
  file: File,
  idempotencyKey: string,
  expectedRevision: number,
  stage?: "registration" | "completion",
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await api.uploadSkImageWithOptions(skId, file, { idempotencyKey, expectedRevision, stage });
    } catch (error) {
      lastError = error;
      const transient = !(error instanceof ApiError)
        || error.code === "NETWORK_ERROR"
        || [408, 425, 429].includes(error.status)
        || error.status >= 500;
      if (!transient) throw error;
      if (attempt < 2) await new Promise((resolve) => globalThis.setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Không thể tải ảnh lên");
}

function historyActionLabel(history: any) {
  if (history.reason === "execution_update") return "Cập nhật tình hình thực hiện";
  if (history.reason === "completion_plan_update") return "Cập nhật kế hoạch hoàn thành";
  if (history.reason === "completion_auto_done") return "Tự ghi nhận hoàn thành (tới ngày dự kiến)";
  if (history.reason === "completion_auto_planned") return "Chuyển về dự kiến (ngày hoàn thành ở tương lai)";
  if (history.reason === "completion_auto_done_reverted") return "Hoàn tác tự ghi nhận hoàn thành";
  if (!history.from_status && history.to_status === "Draft") return "Ghi nhận đăng ký";
  if (!history.from_status && history.to_status === "Submitted") return "Đăng ký xét duyệt";
  if (!history.from_status) return displayStatus(history.to_status);
  return `${displayStatus(history.from_status)} → ${displayStatus(history.to_status)}`;
}

function actorLabel(actor: string | null | undefined) {
  if (!actor) return "Hệ thống";
  const labels: Record<string, string> = {
    admin: "Quản trị",
    fi: "Đầu mối SK",
    leader: "Lãnh đạo Xưởng",
    test: "Tài khoản kiểm thử",
    system: "Hệ thống",
    "historical-import": "Hệ thống",
    "deploy-import": "Hệ thống",
  };
  return labels[actor] ?? actor;
}

function historyDetail(history: any) {
  const reason = typeof history.reason === "string" ? history.reason.trim() : "";
  const comments = typeof history.comments === "string" ? history.comments.trim() : "";
  const structuredComments = typeof history.comments === "object" && history.comments !== null ? history.comments : null;
  if (reason === "web_registration") {
    return { label: "Ghi nhận", text: "Đăng ký mới" };
  }
  if (reason === "khmt_assignment" || reason === "khmt_legacy_note") {
    const month = structuredComments?.khmt_month;
    const year = structuredComments?.khmt_year;
    return { label: "KHMT", text: month && year ? `Đã xem xét vào KHMT T${month}/${year}` : "Đã xem xét vào KHMT" };
  }
  if (PLAN_HISTORY_REASONS.includes(reason)) {
    const previous = String(structuredComments?.previous_completion_plan || "Chưa ghi");
    const next = String(structuredComments?.completion_plan || "Chưa ghi");
    const execNote = typeof structuredComments?.execution_note === "string" && structuredComments.execution_note.trim()
      ? ` · Ghi chú: ${structuredComments.execution_note.trim()}`
      : "";
    return { label: reason === "execution_update" ? "Tình hình thực hiện" : "Kế hoạch", text: `${previous} → ${next}${execNote}` };
  }
  if (reason === "khmt_unassignment") {
    const month = structuredComments?.previous_khmt_month;
    const year = structuredComments?.previous_khmt_year;
    return { label: "KHMT", text: month && year ? `Đã bỏ khỏi KHMT T${month}/${year}` : "Đã bỏ khỏi KHMT" };
  }
  if (comments) {
    return { label: "Nhận xét", text: comments };
  }
  if (!reason) return null;
  if (history.to_status === "Rejected") return { label: "Lý do từ chối", text: reason };
  if (history.to_status === "NeedMoreInfo") return { label: "Yêu cầu bổ sung", text: reason };
  if (["Approved", "Completed"].includes(history.to_status)) return { label: "Ghi chú quyết định", text: reason };
  return { label: "Ghi chú", text: reason };
}

function planUpdateHistory(item: any) {
  const history = Array.isArray(item?.status_history) ? item.status_history : [];
  return history.filter((entry: any) => PLAN_HISTORY_REASONS.includes(entry?.reason));
}

function formatHistoryTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function isKhmtConsidered(item: any) {
  return Boolean(item?.consider_for_khmt);
}

export function khmtLabel(item: any) {
  if (isKhmtConsidered(item)) return `KHMT T${item.khmt_month}/${item.khmt_year}`;
  return "Chưa vào KHMT";
}

export function recordSubmitterId(item: any): string | null {
  if (item?.submitted_by && !isSystemActorId(item.submitted_by)) return String(item.submitted_by);
  if (item?.effective_author_user_id && item?.is_historical_import) return String(item.effective_author_user_id);
  if (item?.created_by) return String(item.created_by);
  const history = Array.isArray(item?.status_history) ? item.status_history : [];
  const first = history[0];
  if (!first || typeof first !== "object") return null;
  const comments = typeof first.comments === "object" && first.comments !== null ? first.comments : {};
  const fallback = String(comments.submitted_by || comments.created_by || first.changed_by || "") || null;
  return isSystemActorId(fallback) && item?.effective_author_user_id ? String(item.effective_author_user_id) : fallback;
}

function recordAuthorId(item: any): string | null {
  if (item?.effective_author_user_id) return String(item.effective_author_user_id);
  if (item?.author_user_id && !isSystemActorId(item.author_user_id)) return String(item.author_user_id);
  return null;
}

function employeeLabel(employee: EmployeeOption) {
  return employee.full_name || employee.display_name || employee.id;
}

function employeeNameAliases(employee: EmployeeOption) {
  const aliases = new Set<string>();
  [employee.full_name, employee.display_name].forEach((value) => {
    const clean = String(value || "").trim();
    if (!clean) return;
    aliases.add(clean);
    if (clean.includes(" - ")) aliases.add(clean.split(" - ", 1)[0].trim());
  });
  return Array.from(aliases);
}

function buildEmployeeIdentityMaps(employees: EmployeeOption[]) {
  const byId = new Map<string, EmployeeOption>();
  const byNameAndTeam = new Map<string, EmployeeOption>();
  const byName = new Map<string, EmployeeOption | null>();

  employees.forEach((employee) => {
    byId.set(employee.id, employee);
    employeeNameAliases(employee).forEach((alias) => {
      const nameKey = normalizeAuthorQuery(alias);
      if (!nameKey) return;
      byNameAndTeam.set(`${nameKey}::${employee.team || ""}`, employee);
      if (!byName.has(nameKey)) {
        byName.set(nameKey, employee);
      } else if (byName.get(nameKey)?.id !== employee.id) {
        byName.set(nameKey, null);
      }
    });
  });

  return { byId, byName, byNameAndTeam };
}

export function buildPersonFilterOptions(
  rows: any[],
  employees: EmployeeOption[],
  mode: "author" | "submitter",
  labelById: Map<string, string>,
): PersonFilterOption[] {
  const options = new Map<string, PersonFilterOption>();
  const employeeMaps = buildEmployeeIdentityMaps(employees);
  const resolveEmployee = (
    userId: string | null | undefined,
    displayName: string | null | undefined,
    team: string | null | undefined,
  ) => {
    const cleanId = String(userId || "").trim();
    if (cleanId && !isSystemActorId(cleanId)) return employeeMaps.byId.get(cleanId) || null;
    const nameKey = normalizeAuthorQuery(displayName);
    if (!nameKey) return null;
    return employeeMaps.byNameAndTeam.get(`${nameKey}::${team || ""}`) || employeeMaps.byName.get(nameKey) || null;
  };
  const upsert = (
    userId: string | null | undefined,
    displayName: string | null | undefined,
    team: string | null | undefined,
    countDelta: number,
  ) => {
    const employee = mode === "author" ? resolveEmployee(userId, displayName, team) : null;
    const canonicalUserId = employee?.id || userId;
    const canonicalTeam = employee?.team ?? team;
    const label = (
      employee
        ? employeeLabel(employee)
        : displayName || (userId ? labelById.get(userId) : "") || userId || "Hệ thống"
    ).trim();
    const key = personFilterKey(canonicalUserId, label);
    if (!key) return;
    const accountId = canonicalUserId && !isSystemActorId(canonicalUserId) ? canonicalUserId : null;
    const nameKey = normalizeAuthorQuery(label);
    const searchText = normalizeAuthorQuery(`${label} ${displayName || ""} ${accountId || ""} ${displayTeam(canonicalTeam)}`);
    const existing = options.get(key);
    if (existing) {
      existing.count += countDelta;
      if (!existing.team && canonicalTeam) existing.team = canonicalTeam;
      existing.searchText = `${existing.searchText} ${searchText}`.trim();
      return;
    }
    options.set(key, {
      key,
      label,
      accountId,
      team: canonicalTeam || null,
      count: countDelta,
      nameKey,
      searchText,
    });
  };

  rows.forEach((item) => {
    if (mode === "author") {
      const authorId = isSystemActorId(item?.author_user_id) ? item?.effective_author_user_id : item?.author_user_id;
      upsert(authorId, item?.author_name, item?.team, 1);
      return;
    }
    const submitterId = recordSubmitterId(item);
    upsert(submitterId, item?.submitted_by_name || labelById.get(submitterId || "") || submitterId, null, 1);
  });

  employees.forEach((employee) => {
    upsert(employee.id, employee.full_name || employee.display_name, employee.team, 0);
  });

  return Array.from(options.values()).sort(
    (a, b) =>
      b.count - a.count ||
      String(a.label || "").localeCompare(String(b.label || ""), "vi") ||
      String(a.accountId || "").localeCompare(String(b.accountId || "")),
  );
}

function expandPersonFilterKeys(selected: string[], optionByKey: Map<string, PersonFilterOption>) {
  const keys = new Set<string>();
  selected.forEach((key) => {
    keys.add(key);
    const option = optionByKey.get(key);
    if (option?.nameKey) {
      const teamKey = normalizeAuthorQuery(option.team);
      keys.add(teamKey ? `name:${option.nameKey}:team:${teamKey}` : `name:${option.nameKey}`);
    }
  });
  return Array.from(keys);
}

function khmtAssignmentYear(item: any) {
  const registration = registrationInfo(item);
  return Number(item?.khmt_year || registration.year || new Date().getFullYear());
}

export function canSelectKhmtMonth(role: string, currentUserId: string, item: any, currentTeam?: string | null) {
  if (!KHMT_ASSIGNABLE_STATUSES.includes(item?.status)) return false;
  if (role === ADMIN_ROLE) return true;
  if (role !== TEAM_ROLE) return false;
  const ownerTeam = currentTeam ?? currentUserId;
  return FI_TEAMS.includes(ownerTeam) && item?.team === ownerTeam;
}

export function hasKhmtPendingChange(selectedValue: string, currentValue: string) {
  return selectedValue !== currentValue;
}

function formatCount(value: number | undefined) {
  return new Intl.NumberFormat("vi-VN").format(value ?? 0);
}

function percent(value: number | undefined, total: number | undefined) {
  if (!total) return 0;
  return Math.round(((value ?? 0) / total) * 100);
}

function reviewPassedCount(row: any) {
  return Number(row?.review_passed ?? row?.approved ?? 0);
}

function reviewFailedCount(row: any) {
  return Number(row?.review_failed ?? row?.rejected ?? 0);
}

function khmtMissingCount(row: any) {
  if (row?.khmt_not_considered !== undefined && row?.khmt_not_considered !== null) {
    return Number(row.khmt_not_considered ?? 0);
  }
  return Math.max(0, reviewPassedCount(row) - Number(row?.khmt_considered ?? 0));
}

export function visibleActionsForSk(
  role: string,
  currentUserId: string,
  item: any,
  editMode = true,
  currentTeam?: string | null,
): string[] {
  const actions: string[] = [];
  if (role === ADMIN_ROLE && !editMode) return actions;
  const reviewableStatuses = REVIEW_DECISION_STATUSES;
  const isAuthor = AUTHOR_ROLES.includes(role);
  const authorId = recordAuthorId(item);
  const isOwnAuthor = authorId === currentUserId;
  const isOwnSubmitter = recordSubmitterId(item) === currentUserId;
  const canManageAsOwner = isOwnAuthor || isOwnSubmitter;
  // Tác giả được sửa nội dung trong toàn bộ vòng đời của SK (kể cả sau khi
  // đã đánh giá) miễn là chưa hoàn tất/hủy. Legacy import được map về account
  // tác giả thật ở backend nên vẫn đi theo cùng quyền owner.
  // Sau khi sửa, FI/Admin sẽ nhận noti SK_CONTENT_EDITED để xét duyệt lại.
  const canEdit = canManageAsOwner && AUTHOR_EDITABLE_STATUSES.includes(item.status);
  // Execution / progress updates: on Approved/Completed FIs, Author/Submitter,
  // same-team Team_Account, FI_Coordinator, or Admin (in edit mode) may update;
  // pre-approval, the owner may still adjust the planned date.
  const canUpdatePlan = canUpdateExecution(role, currentUserId, currentTeam, item, editMode);
  // FI_Coordinator không được xét duyệt SK do chính mình đăng ký (xung đột lợi ích).
  const canReviewDecision =
    REVIEWER_ROLES.includes(role) &&
    reviewableStatuses.includes(item.status) &&
    !(role === FI_COORDINATOR_ROLE && (authorId === currentUserId || recordSubmitterId(item) === currentUserId));
  const ownerTeam = currentTeam ?? currentUserId;
  const canAssign =
    !item.is_historical_import &&
    (role === ADMIN_ROLE || (role === TEAM_ROLE && item.team === ownerTeam)) &&
    ["Approved", "Completed"].includes(item.status);
  const canDelete =
    role === ADMIN_ROLE ||
    (!item.is_historical_import && isAuthor && canManageAsOwner && OWNER_DELETABLE_STATUSES.includes(item.status));
  if (canEdit) actions.push("edit");
  if (canUpdatePlan) actions.push("updatePlan");
  if (canReviewDecision) actions.push("reviewDecision");
  if (canAssign) actions.push("assignKhmt");
  if (canDelete) actions.push("delete");
  return actions;
}

const isReviewerRole = (role: string) => REVIEWER_ROLES.includes(role);

function canUploadImages(
  role: string,
  currentUserId: string,
  item: any,
  editMode = true,
  currentTeam?: string | null,
) {
  if (!item) return false;
  if (EXECUTION_EDITABLE_STATUSES.includes(item.status)) {
    return canUploadCompletionImages(role, currentUserId, currentTeam, item, editMode);
  }
  if (role === ADMIN_ROLE) return editMode;
  return (
    AUTHOR_ROLES.includes(role) &&
    (recordAuthorId(item) === currentUserId || recordSubmitterId(item) === currentUserId) &&
    AUTHOR_EDITABLE_STATUSES.includes(item.status)
  );
}

function AuthenticatedSkImage({ skId, image, onOpen }: { skId: string; image: any; onOpen: () => void }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setSrc("");
    setFailed(false);
    api.getSkImageBlob(skId, image.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) {
          setSrc("");
          setFailed(true);
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [skId, image.id]);

  if (failed) {
    return (
      <div className="image-placeholder">
        Không hiển thị được ảnh
      </div>
    );
  }
  if (!src) return <div className="image-placeholder">Đang tải ảnh...</div>;
  return (
    <button className="image-thumb" onClick={onOpen} type="button">
      <img
        src={src}
        alt={image.file_name}
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function SkImageViewer({
  skId,
  images,
  index,
  canDelete,
  onClose,
  onIndexChange,
  onDelete,
}: {
  skId: string;
  images: any[];
  index: number;
  canDelete: boolean;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onDelete: (imageId: string) => void;
}) {
  const image = images[index];
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const hasMultiple = images.length > 1;

  useEffect(() => {
    if (!image) {
      setSrc("");
      setFailed(false);
      return;
    }
    let active = true;
    let objectUrl = "";
    setSrc("");
    setFailed(false);
    api.getSkImageBlob(skId, image.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [skId, image?.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (!hasMultiple) return;
      if (event.key === "ArrowLeft") onIndexChange((index - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") onIndexChange((index + 1) % images.length);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasMultiple, images.length, index, onClose, onIndexChange]);

  if (!image) return null;

  const previous = () => onIndexChange((index - 1 + images.length) % images.length);
  const next = () => onIndexChange((index + 1) % images.length);

  return (
    <div className="image-viewer-backdrop" role="dialog" aria-modal="true" aria-label="Xem ảnh bằng chứng">
      <div className="image-viewer">
        <div className="image-viewer-toolbar">
          <strong title={image.file_name}>{image.file_name}</strong>
          <div>
            {canDelete && (
              <button
                title="Xóa ảnh"
                type="button"
                onClick={() => {
                  onDelete(image.id);
                  onClose();
                }}
              >
                <Trash2 size={16} />
                Xóa ảnh
              </button>
            )}
            <button aria-label="Đóng" title="Đóng" type="button" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="image-viewer-stage">
          {hasMultiple ? (
            <button aria-label="Ảnh trước" className="image-viewer-nav" onClick={previous} title="Ảnh trước" type="button">
              <ChevronLeft size={22} />
            </button>
          ) : (
            <span />
          )}
          {failed ? (
            <div className="image-placeholder">Không hiển thị được ảnh</div>
          ) : src ? (
            <img src={src} alt={image.file_name} onError={() => setFailed(true)} />
          ) : (
            <div className="image-placeholder">Đang tải ảnh...</div>
          )}
          {hasMultiple ? (
            <button aria-label="Ảnh sau" className="image-viewer-nav" onClick={next} title="Ảnh sau" type="button">
              <ChevronRight size={22} />
            </button>
          ) : (
            <span />
          )}
        </div>
        {hasMultiple && <small>{index + 1}/{images.length}</small>}
      </div>
    </div>
  );
}

function aggregateTeamSummaries(rows: any[]) {
  if (rows.length === 0) return null;
  return rows.reduce(
    (acc, row) => {
      acc.total += Number(row?.total ?? 0);
      acc.current += Number(row?.current ?? 0);
      acc.historical += Number(row?.historical ?? 0);
      acc.review_passed += reviewPassedCount(row);
      acc.review_failed += reviewFailedCount(row);
      acc.khmt_considered += Number(row?.khmt_considered ?? 0);
      acc.khmt_not_considered += khmtMissingCount(row);
      acc.khmt_unassigned_approved += khmtUnassignedApprovedCount(row);
      acc.deferred += Number(row?.deferred ?? 0);
      acc.pending += Number(row?.pending ?? 0);
      acc.completed_count += Number(row?.completed_count ?? row?.completed ?? 0);
      acc.not_completed += Number(row?.not_completed ?? 0);
      acc.cancelled += Number(row?.cancelled ?? 0);
      return acc;
    },
    {
      total: 0,
      current: 0,
      historical: 0,
      review_passed: 0,
      review_failed: 0,
      khmt_considered: 0,
      khmt_not_considered: 0,
      khmt_unassigned_approved: 0,
      deferred: 0,
      pending: 0,
      completed_count: 0,
      not_completed: 0,
      cancelled: 0,
    },
  );
}

type FilterChipOption<T extends string | number> = {
  value: T;
  label: string;
  count?: number;
  tone?: string;
};

function FilterChip<T extends string | number>({
  label,
  icon,
  options,
  selected,
  onChange,
  emptyLabel = "Tất cả",
  single = false,
  prominent = false,
  align = "left",
  summary,
  footer,
}: {
  label: string;
  icon?: React.ReactNode;
  options: FilterChipOption<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  emptyLabel?: string;
  single?: boolean;
  prominent?: boolean;
  align?: "left" | "right";
  summary?: string;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstOptionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    const id = window.setTimeout(() => firstOptionRef.current?.focus(), 30);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.clearTimeout(id);
    };
  }, [open]);

  const toggle = (value: T) => {
    if (single) {
      // Single-select: replace selection and close.
      if (!selected.includes(value)) onChange([value]);
      setOpen(false);
      return;
    }
    if (selected.includes(value)) onChange(selected.filter((entry) => entry !== value));
    else onChange([...selected, value]);
  };

  const selectedOptions = options.filter((option) => selected.includes(option.value));
  const summaryText = summary ?? (selectedOptions.length === 0
    ? emptyLabel
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `${selectedOptions.length} mục`);

  // In single mode the chip is always "active" because there's always exactly one value;
  // we keep the visual neutral so it looks like a primary selector rather than an active filter.
  const isActive = single ? false : selected.length > 0;
  const chipClass = [
    "fi-filter-chip",
    isActive ? "active" : "",
    single ? "single" : "",
    prominent ? "prominent" : "",
  ].filter(Boolean).join(" ");

  return (
    <div ref={containerRef} className={`fi-filter-chip-wrap ${open ? "open" : ""}`}>
      <button
        type="button"
        className={chipClass}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon && <span className="fi-filter-chip-icon" aria-hidden="true">{icon}</span>}
        <span className="fi-filter-chip-label">{label}</span>
        <span className="fi-filter-chip-divider" aria-hidden="true">·</span>
        <span className="fi-filter-chip-value" title={summaryText}>{summaryText}</span>
        <ChevronDown size={14} className={`fi-filter-chip-caret ${open ? "open" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          className={`fi-filter-popover ${single ? "single" : ""} ${footer ? "has-footer" : ""} ${align === "right" ? "align-right" : ""}`}
          role="listbox"
          aria-multiselectable={!single}
          aria-label={label}
        >
          <div className="fi-filter-popover-head">
            <span>{label}</span>
            {!single && selected.length > 0 ? (
              <button
                type="button"
                className="fi-filter-popover-clear"
                onClick={() => onChange([])}
              >
                Bỏ chọn
              </button>
            ) : (
              <small className="fi-filter-popover-hint">{single ? "Chọn một" : "Chọn để lọc"}</small>
            )}
          </div>
          <div className="fi-filter-popover-body">
            {options.length === 0 && (
              <p className="fi-filter-popover-empty">Không có giá trị để lọc.</p>
            )}
            {options.map((option, index) => {
              const checked = selected.includes(option.value);
              return (
                <label
                  key={String(option.value)}
                  className={`fi-filter-option ${checked ? "checked" : ""} ${single ? "is-radio" : ""} ${option.tone ? `tone-${option.tone}` : ""}`}
                >
                  <input
                    ref={index === 0 ? firstOptionRef : undefined}
                    type={single ? "radio" : "checkbox"}
                    name={single ? `fi-filter-${label}` : undefined}
                    checked={checked}
                    onChange={() => toggle(option.value)}
                  />
                  <span className="fi-filter-option-mark" aria-hidden="true" />
                  <span className="fi-filter-option-label">{option.label}</span>
                  {option.count !== undefined && (
                    <small className="fi-filter-option-count">{option.count}</small>
                  )}
                </label>
              );
            })}
          </div>
          {footer}
        </div>
      )}
    </div>
  );
}

function PersonFilterCombobox({
  label,
  icon,
  options,
  selected,
  onChange,
  align = "left",
}: {
  label: string;
  icon?: React.ReactNode;
  options: PersonFilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.clearTimeout(id);
    };
  }, [open]);

  const selectedOptions = selected
    .map((key) => options.find((option) => option.key === key))
    .filter((option): option is PersonFilterOption => Boolean(option));
  const selectedText = selectedOptions.length === 0
    ? "Tất cả"
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `${selectedOptions.length} người`;
  const tokens = normalizeAuthorQuery(query).trim().split(/\s+/).filter(Boolean);
  const visibleOptions = options
    .filter((option) => tokens.length === 0 || tokens.every((token) => option.searchText.includes(token)))
    .slice(0, 80);
  const toggleOption = (key: string) => {
    if (selected.includes(key)) onChange(selected.filter((entry) => entry !== key));
    else onChange([...selected, key]);
  };

  return (
    <div ref={containerRef} className={`fi-person-filter ${open ? "open" : ""}`}>
      <button
        type="button"
        className={`fi-filter-chip ${selected.length > 0 ? "active" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon && <span className="fi-filter-chip-icon" aria-hidden="true">{icon}</span>}
        <span className="fi-filter-chip-label">{label}</span>
        <span className="fi-filter-chip-divider" aria-hidden="true">·</span>
        <span className="fi-filter-chip-value" title={selectedText}>{selectedText}</span>
        <ChevronDown size={14} className={`fi-filter-chip-caret ${open ? "open" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className={`fi-person-filter-popover ${align === "right" ? "align-right" : ""}`} role="dialog" aria-label={`Lọc theo ${label.toLowerCase()}`}>
          <div className="fi-person-filter-search">
            <UserRound size={14} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Gõ tên hoặc mã tài khoản..."
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === "Enter" && visibleOptions.length > 0) {
                  event.preventDefault();
                  toggleOption(visibleOptions[0].key);
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="fi-person-filter-clear"
                title="Xóa từ khóa"
                onClick={() => setQuery("")}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="fi-person-filter-head">
            <span>{label}</span>
            {selected.length > 0 ? (
              <button type="button" onClick={() => onChange([])}>Bỏ chọn</button>
            ) : (
              <small>Chọn để lọc</small>
            )}
          </div>
          <div className="fi-person-filter-list" role="listbox" aria-multiselectable="true">
            {visibleOptions.map((option) => {
              const checked = selected.includes(option.key);
              const optionMeta = [
                option.accountId ? option.accountId : "",
                displayTeam(option.team),
              ].filter(Boolean).join(" · ");
              return (
                <button
                  key={option.key}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={checked ? "selected" : ""}
                  onClick={() => toggleOption(option.key)}
                >
                  <span className="fi-person-filter-mark" aria-hidden="true" />
                  <span className="fi-person-filter-name">
                    <strong>{option.label}</strong>
                    <small>
                      {optionMeta || "Theo tên trong lịch sử"}
                    </small>
                  </span>
                  <span className="fi-person-filter-count">{option.count}</span>
                </button>
              );
            })}
            {visibleOptions.length === 0 && (
              <p className="fi-person-filter-empty">
                Không tìm thấy ai khớp “{query.trim()}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function FIWorkspace({
  role,
  currentUserId,
  currentTeam,
  displayName,
  editMode = true,
  tabsHost = null,
  focusRequest = null,
  matrixRequest = null,
}: {
  role: string;
  currentUserId: string;
  currentTeam?: string | null;
  displayName?: string | null;
  editMode?: boolean;
  // Node trong topbar (do App cung cấp) để render hàng tab lên chung với tiêu đề.
  tabsHost?: HTMLElement | null;
  // SK cần mở (vd. khi bấm một thông báo); nonce đổi mỗi lần bấm.
  focusRequest?: { id: string; nonce: number } | null;
  // Yêu cầu mở thẳng Ma trận KHMT trên FI Dashboard (vd. từ trang Admin Chốt KHMT).
  matrixRequest?: { year: number; nonce: number } | null;
}) {
  const canUseAuthorPicker = AUTHOR_PICKER_ROLES.includes(role);
  const teamFromAccount = currentTeam ?? (AUTHOR_ROLES.includes(role) ? currentUserId : null);
  const isLockedToTeam = AUTHOR_ROLES.includes(role) && teamFromAccount && FI_TEAMS.includes(teamFromAccount);
  const defaultFormTeam = isLockedToTeam && teamFromAccount ? teamFromAccount : "TBCH";
  const defaultAuthorName = AUTHOR_ROLES.includes(role)
    ? (typeof displayName === "string" && displayName.includes(" - ") ? displayName.split(" - ")[0] : displayName ?? "")
    : "";
  const registrarName = (typeof displayName === "string" && displayName.includes(" - ") ? displayName.split(" - ")[0] : displayName) || currentUserId;
  const accountAuthorName = AUTHOR_ROLES.includes(role) ? defaultAuthorName || currentUserId : "";
  const accountTeam = AUTHOR_ROLES.includes(role) ? teamFromAccount : null;
  const canRegister = AUTHOR_ROLES.includes(role) || (role === ADMIN_ROLE && editMode);
  const canReview = REVIEWER_ROLES.includes(role);
  const defaultTab: FITab = canRegister ? "register" : canReview ? "review" : "dashboard";
  const [items, setItems] = useState<any[]>([]);
  // Legacy (imported) FI still pending a decision are reviewed from the
  // history tab; the review queue only lists records created in the app.
  const [legacyPendingCount, setLegacyPendingCount] = useState(0);
  const [allHistoryItems, setAllHistoryItems] = useState<any[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyYear, setHistoryYear] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  // Phones start with the filter bar folded behind a "Bộ lọc" button; desktop
  // always shows it (the toggle is hidden by CSS there).
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 760,
  );
  const historyPanelRef = useRef<HTMLElement | null>(null);
  const goToHistoryPage = (page: number) => {
    setHistoryPage(page);
    historyPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const [historyPageSize, setHistoryPageSize] = useState<25 | 50>(25);
  const [historyMeta, setHistoryMeta] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [dashboardYear, setDashboardYear] = useState<number>(() => matrixRequest?.year ?? new Date().getFullYear());
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [matrixDrawer, setMatrixDrawer] = useState<MatrixDrawerSelection | null>(null);
  const [matrixRefreshNonce, setMatrixRefreshNonce] = useState(0);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [historyTeams, setHistoryTeams] = useState<string[]>([]);
  const [historyMonths, setHistoryMonths] = useState<number[]>([]);
  const [historyDecisions, setHistoryDecisions] = useState<HistoryDecisionFilter[]>([]);
  const [historyKhmt, setHistoryKhmt] = useState<HistoryKhmtFilter[]>([]);
  const [historyKhmtPeriods, setHistoryKhmtPeriods] = useState<string[]>([]);
  const [historyCompletion, setHistoryCompletion] = useState<HistoryCompletionFilter[]>([]);
  const [historyAuthors, setHistoryAuthors] = useState<string[]>([]);
  const [historySubmitters, setHistorySubmitters] = useState<string[]>([]);
  const [exportingHistoryExcel, setExportingHistoryExcel] = useState(false);
  const [activeTab, setActiveTab] = useState<FITab>(() => (matrixRequest ? "dashboard" : defaultTab));
  const [reviewFilter, setReviewFilter] = useState<ReviewQueueFilter>("pending");
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewTeamFilter, setReviewTeamFilter] = useState("");
  const [reviewMonthFilter, setReviewMonthFilter] = useState("");
  const [expandedOwnershipLists, setExpandedOwnershipLists] = useState<Record<OwnershipListKey, boolean>>({
    minePending: false,
    mineImplementation: false,
    sentPending: false,
    sentImplementation: false,
  });
  const [form, setForm] = useState(() => {
    const today = new Date();
    return {
      author_name: defaultAuthorName,
      author_user_id: AUTHOR_ROLES.includes(role) ? currentUserId : "",
      team: defaultFormTeam,
      title: "",
      content_description: "",
      completion_done: false,
      completion_plan_date: isoDateInput(addMonths(today, 1)),
      registration_month: today.getMonth() + 1,
      registration_year: today.getFullYear(),
    };
  });
  const [error, setError] = useState("");
  const [actionTarget, setActionTarget] = useState<{ id: string; label: string; decision: ReviewDecision; revision: number } | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [editTarget, setEditTarget] = useState<any>(null);
  const [planTarget, setPlanTarget] = useState<{ item: any; initialStatus?: ExecutionModalInitialStatus } | null>(null);
  const [confirmingAutoDoneId, setConfirmingAutoDoneId] = useState<string | null>(null);
  const openExecutionModal = (item: any, initialStatus?: ExecutionModalInitialStatus) => {
    setError("");
    setPlanTarget({ item, initialStatus });
  };
  const handleQuickConfirmAutoDone = async (item: any) => {
    if (!item?.id || confirmingAutoDoneId) return;
    setConfirmingAutoDoneId(item.id);
    setError("");
    setNotice("");
    try {
      const view = resolveExecutionView(item);
      const updated = await api.updateSkExecution(item.id, {
        execution_status: "completed",
        completion_date: view.date || todayIsoDate(),
        execution_note: view.executionNote ?? null,
        expected_revision: item.server_revision ?? item.revision ?? 0,
      });
      setSelectedItem((current: any) => (current?.id === updated.id ? { ...current, ...updated } : current));
      setNotice(`Đã xác nhận hoàn thành ${updated.sk_code || updated.title}.`);
      reload();
      setMatrixRefreshNonce((n) => n + 1);
    } catch (err: any) {
      setError(err?.message || "Không thể xác nhận hoàn thành.");
    } finally {
      setConfirmingAutoDoneId(null);
    }
  };
  const [editForm, setEditForm] = useState({
    title: "",
    content_description: "",
    completion_done: false,
    completion_plan_date: isoDateInput(addMonths(new Date(), 1)),
    completion_plan_raw: "" as string,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const editLoadEpoch = useRef(0);
  const editTargetRef = useRef(editTarget);
  editTargetRef.current = editTarget;
  const [khmtTarget, setKhmtTarget] = useState<{ id: string; label: string; month: number; year: number; revision: number } | null>(null);
  const [assigningKhmt, setAssigningKhmt] = useState(false);
  const [draftDragOver, setDraftDragOver] = useState(false);
  const draftFileInputRef = useRef<HTMLInputElement>(null);
  const detailFileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  // Combobox chọn tác giả: mặc định là chính chủ tài khoản, nhưng cho phép tìm và
  // chọn người khác khi "đăng ký giúp". authorQuery là từ khoá đang gõ; tên đã chốt
  // nằm ở form.author_name.
  const [authorOptions, setAuthorOptions] = useState<
    EmployeeOption[]
  >([]);
  const [authorPickerOpen, setAuthorPickerOpen] = useState(false);
  const [authorQuery, setAuthorQuery] = useState("");

  const recoveryStore = useMemo(() => new DraftRecoveryStore<any>({
    namespace: "okr", userId: currentUserId, module: "fi-register", resource: "active", schemaVersion: "1",
  }), [currentUserId]);
  const [recovery, setRecovery] = useState(() => recoveryStore.read());
  const [recoveryWarning, setRecoveryWarning] = useState("");
  const [operation, setOperation] = useState<any>(null);
  const operationRef = useRef<any>(null);
  const navigationSaved = useRef(false);
  const { registerGuard, requestNavigation } = useNavigationGuard();
  // Only what the user typed or attached counts as unsaved work. Author, team
  // and dates are filled in automatically after mount, so comparing the whole
  // form with its first render flagged an untouched form as changed.
  const formDirty = Boolean(form.title.trim() || form.content_description.trim())
    || evidenceFiles.length > 0
    || Boolean(operation);
  const persist = (nextOperation = operationRef.current) => {
    const result = recoveryStore.write({ form, operation: nextOperation, files: evidenceFiles.map((file) => file.name) }, null, 1);
    if (!result.ok) setRecoveryWarning(result.warning ?? "");
    return result;
  };
  useEffect(() => { navigationSaved.current = false; if (formDirty && !recovery) persist(); }, [form, evidenceFiles, operation, recovery]);
  useEffect(() => registerGuard(`fi-register:${currentUserId}`, {
    isDirty: () => creating || (formDirty && !navigationSaved.current),
    message: "Phiếu đăng ký đang nhập chưa được gửi duyệt. Bạn có thể giữ bản nháp trên máy này để quay lại nhập tiếp, hoặc xóa nội dung đã nhập.",
    saveLabel: "Giữ bản nháp",
    discardLabel: "Xóa nội dung",
    save: async () => { const result = persist(); if (result.ok) navigationSaved.current = true; },
    discard: () => { recoveryStore.remove(); resetRegistration(); navigationSaved.current = true; },
  }), [registerGuard, currentUserId, formDirty, creating, form, evidenceFiles]);
  const resetRegistration = () => {
    recoveryStore.remove(); setRecovery(null); setOperation(null); operationRef.current = null;
    setForm((current) => ({
      ...current,
      title: "",
      content_description: "",
      completion_done: false,
      completion_plan_date: isoDateInput(addMonths(new Date(), 1)),
    }));
    setEvidenceFiles([]);
  };
  const reloadEpoch = useRef(0);
  const reload = (overrideYear?: number) => {
    const epoch = ++reloadEpoch.current;
    const yearToLoad = overrideYear ?? dashboardYear;
    setDashboardLoading(true);
    const listFilters = canReview ? {} : { mine_only: true };
    const historyRequest = activeTab === "history"
      ? api.fiHistory({
          q: historyQuery || undefined,
          registration_year: historyYear ? Number(historyYear) : undefined,
          teams: historyTeams.length ? historyTeams.join(",") : undefined,
          registration_months: historyMonths.length ? historyMonths.join(",") : undefined,
          authors: historyAuthors.length ? historyAuthors.join(",") : undefined,
          submitters: historySubmitters.length ? historySubmitters.join(",") : undefined,
          decisions: historyDecisions.length ? historyDecisions.join(",") : undefined,
          khmt: historyKhmt.length ? historyKhmt.join(",") : undefined,
          khmt_periods: historyKhmtPeriods.length ? historyKhmtPeriods.join(",") : undefined,
          completion: historyCompletion.length ? historyCompletion.join(",") : undefined,
          page: historyPage,
          page_size: historyPageSize,
        })
      : Promise.resolve(null);
    const needDashboard = activeTab !== "history" || !dashboard || overrideYear !== undefined;
    Promise.all([
      activeTab === "history" ? Promise.resolve(items) : api.listSk(listFilters),
      historyRequest,
      needDashboard ? api.fiDashboard({ year: yearToLoad }) : Promise.resolve(dashboard),
    ])
      .then(([privateList, historyList, dashboardData]) => {
        if (epoch !== reloadEpoch.current) return;
        setItems(privateList.filter((item) => !item.is_historical_import));
        if (historyList) {
          setAllHistoryItems(historyList.items ?? []);
          setHistoryMeta(historyList);
        }
        setDashboard(dashboardData);
        setError("");
      })
      .catch((err) => { if (epoch === reloadEpoch.current) setError(err.message); })
      .finally(() => { if (epoch === reloadEpoch.current) setDashboardLoading(false); });
    if (canReview && activeTab !== "history") {
      api.listSk({ include_historical: true, status: "Submitted" })
        .then((list) => {
          if (epoch !== reloadEpoch.current) return;
          setLegacyPendingCount(list.filter((item) => item.is_historical_import).length);
        })
        .catch(() => undefined);
    }
  };

  useEffect(() => {
    setMatrixDrawer(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, dashboardYear]);

  // Refresh when the user comes back to FI Dashboard; the initial load is done by
  // the role/year effect above, so skip the first run to avoid a duplicate fetch.
  const tabEffectMounted = useRef(false);
  useEffect(() => {
    if (!tabEffectMounted.current) {
      tabEffectMounted.current = true;
      return;
    }
    if (activeTab !== "dashboard") return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "history") return;
    const timer = window.setTimeout(() => reload(), 250);
    return () => { window.clearTimeout(timer); reloadEpoch.current += 1; };
  }, [activeTab, historyQuery, historyYear, historyPage, historyPageSize, historyTeams, historyMonths, historyAuthors, historySubmitters, historyDecisions, historyKhmt, historyKhmtPeriods, historyCompletion]);

  useEffect(() => {
    if (activeTab !== "history") return;
    setHistoryPage(1);
  }, [historyQuery, historyYear, historyTeams, historyMonths, historyAuthors, historySubmitters, historyDecisions, historyKhmt, historyKhmtPeriods, historyCompletion, historyPageSize]);

  useEffect(() => {
    if (!canUseAuthorPicker) return;
    if (!AUTHOR_ROLES.includes(role)) {
      setForm((current) => ({
        ...current,
        author_name: "",
        author_user_id: "",
        team: defaultFormTeam,
      }));
      setAuthorQuery("");
      return;
    }
    setForm((current) => ({
      ...current,
      author_name: accountAuthorName,
      author_user_id: currentUserId,
      team: accountTeam ?? current.team,
    }));
    setAuthorQuery(accountAuthorName);
  }, [role, accountAuthorName, accountTeam, canUseAuthorPicker, currentUserId, defaultFormTeam]);

  // Nạp danh sách nhân sự cho combobox tác giả (chỉ với vai trò được phép đăng ký).
  // Nếu không tải được vẫn cho nhập tay tên tác giả nên lỗi được bỏ qua êm.
  useEffect(() => {
    if (!canUseAuthorPicker) return;
    let active = true;
    api.listTaggableEmployees()
      .then((rows) => {
        if (active) setAuthorOptions(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [canUseAuthorPicker]);

  // Sắp xếp: chính mình lên đầu → cùng đội/tổ → còn lại theo bảng chữ cái (tiếng Việt).
  const sortedAuthorOptions = useMemo(() => {
    const selfRank = (row: { id: string }) => (row.id === currentUserId ? 0 : 1);
    const teamRank = (row: { team: string | null }) => (accountTeam && row.team === accountTeam ? 0 : 1);
    return [...authorOptions].sort(
      (a, b) =>
        selfRank(a) - selfRank(b) ||
        teamRank(a) - teamRank(b) ||
        String(a.full_name || "").localeCompare(String(b.full_name || ""), "vi"),
    );
  }, [authorOptions, currentUserId, accountTeam]);

  const filteredAuthors = useMemo(() => {
    const term = normalizeAuthorQuery(authorQuery).trim();
    const committed = normalizeAuthorQuery(form.author_name).trim();
    // Khi ô đang hiển thị đúng tên đã chốt (chưa gõ để tìm) thì cho xem toàn bộ danh sách.
    if (!term || term === committed) return sortedAuthorOptions;
    const tokens = term.split(/\s+/).filter(Boolean);
    return sortedAuthorOptions.filter((row) => {
      // Cho tìm theo cả mã tài khoản (vd "baomt" ↔ Mai Thái Bảo, "minhvq" ↔ Võ Quang Minh).
      const haystack = normalizeAuthorQuery(`${row.full_name} ${row.display_name} ${row.id} ${displayTeam(row.team)}`);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [sortedAuthorOptions, authorQuery, form.author_name]);

  const isProxyAuthor =
    canUseAuthorPicker &&
    form.author_user_id.trim().length > 0 &&
    form.author_user_id !== currentUserId;

  const chooseAuthor = (row: { id: string; full_name: string; display_name: string; team: string | null }) => {
    const name = row.full_name || row.display_name || "";
    setForm((current) => ({ ...current, author_name: name, author_user_id: row.id, team: row.team ?? current.team }));
    setAuthorQuery(name);
    setAuthorPickerOpen(false);
  };

  const resetAuthorSelection = () => {
    if (AUTHOR_ROLES.includes(role)) {
      setForm((current) => ({ ...current, author_name: accountAuthorName, author_user_id: currentUserId, team: accountTeam ?? current.team }));
      setAuthorQuery(accountAuthorName);
    } else {
      setForm((current) => ({ ...current, author_name: "", author_user_id: "", team: defaultFormTeam }));
      setAuthorQuery("");
    }
    setAuthorPickerOpen(false);
  };

  // Đóng dropdown và "chốt" lựa chọn khi rời ô / nhấn Enter. CHỈ tự nhận một nhân sự khi
  // chuỗi gõ trùng ĐẦY ĐỦ & CHÍNH XÁC mã tài khoản ("baomt", "minhvq") hoặc đúng họ tên.
  // Gõ dở/mảnh ngắn (vd "vq", "vo") thì KHÔNG tự thành người nào — trả ô về tên đã chốt
  // trước đó. Muốn chọn nhanh từ gợi ý thì bấm trực tiếp vào danh sách.
  const commitAuthorQuery = () => {
    setAuthorPickerOpen(false);
    const norm = normalizeAuthorQuery(authorQuery.trim());
    const exact = norm
      ? sortedAuthorOptions.find(
          (option) =>
            normalizeAuthorQuery(option.id) === norm ||
            normalizeAuthorQuery(option.full_name) === norm ||
            normalizeAuthorQuery(option.display_name) === norm,
        )
      : null;
    if (exact) {
      const name = exact.full_name || exact.display_name;
      setForm((current) => ({ ...current, author_name: name, author_user_id: exact.id, team: exact.team ?? current.team }));
      setAuthorQuery(name);
    } else {
      // Không khớp đầy đủ → giữ nguyên tên tác giả đã chốt, đưa ô về đúng giá trị đó.
      setAuthorQuery(form.author_name);
    }
  };

  // Reset tab nếu role thay đổi và tab hiện tại không còn hợp lệ
  // (vd: Admin đang ở "review" → giả lập Team_Account thì canReview = false).
  useEffect(() => {
    if (activeTab === "register" && !canRegister) setActiveTab(defaultTab);
    if (activeTab === "review" && !canReview) setActiveTab(defaultTab);
  }, [activeTab, canRegister, canReview, defaultTab]);

  useEffect(() => {
    setImagePreviewIndex(null);
  }, [selectedItem?.id]);

  const reloadDetail = (id: string) => {
    api.getSk(id).then(setSelectedItem).catch((err) => setError(err.message));
  };

  const create = async () => {
    if (creating || recovery) return;
    if (role === ADMIN_ROLE && !editMode) return;
    // Client-side validation: prevent submitting empty registrations.
    const missing: string[] = [];
    // Tác giả: với vai trò đăng ký, dùng tên đã chọn/nhập; trống thì quay về chính chủ.
    const selectedAuthor = canUseAuthorPicker
      ? sortedAuthorOptions.find((option) => option.id === form.author_user_id)
      : null;
    const authorName = canUseAuthorPicker
      ? form.author_name.trim() || (AUTHOR_ROLES.includes(role) ? accountAuthorName : "")
      : form.author_name;
    const authorUserId = canUseAuthorPicker
      ? form.author_user_id || selectedAuthor?.id || (AUTHOR_ROLES.includes(role) ? currentUserId : "")
      : form.author_user_id;
    const team = canUseAuthorPicker
      ? selectedAuthor?.team || form.team || (AUTHOR_ROLES.includes(role) ? accountTeam : "")
      : form.team;
    if (!authorName.trim()) missing.push("Tác giả");
    if (!authorUserId?.trim() && canUseAuthorPicker) missing.push("Tài khoản tác giả");
    if (!team?.trim()) missing.push("Đội/tổ tác giả");
    if (!form.title.trim()) missing.push("Tên SK-CTKT");
    if (!form.content_description.trim()) missing.push("Nội dung đăng ký");
    if (!form.completion_plan_date) {
      missing.push(form.completion_done ? "Ngày hoàn thành" : "Ngày dự kiến hoàn thành");
    }
    if (missing.length > 0) {
      setError(`Vui lòng nhập: ${missing.join(", ")}.`);
      setNotice("");
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="alert"]')?.focus());
      return;
    }
    const planError = completionPlanError(form.completion_done, form.completion_plan_date);
    if (planError) {
      setError(planError);
      setNotice("");
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="alert"]')?.focus());
      return;
    }
    const completionPlan = formatCompletionPlan(form.completion_done, form.completion_plan_date);
    const basePayload = {
      author_name: form.author_name,
      author_user_id: form.author_user_id,
      team: form.team,
      title: form.title,
      content_description: form.content_description,
      completion_plan: completionPlan,
      completion_done: form.completion_done,
      completion_date: form.completion_plan_date,
      registration_month: form.registration_month,
      registration_year: form.registration_year,
    };
    const payload = canUseAuthorPicker
      ? { ...basePayload, author_name: authorName, author_user_id: authorUserId, team }
      : basePayload;
    const filesToUpload = [...evidenceFiles];
    const currentOperation = operationRef.current ?? {
      key: makeIdempotencyKey("fi-create"), payload, recordId: null,
      images: filesToUpload.map((file, index) => ({ name: file.name, index, status: "pending" })),
    };
    operationRef.current = currentOperation;
    setOperation({ ...currentOperation });
    persist(currentOperation);
    const createKey = currentOperation.key;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const created = currentOperation.recordId
        ? await api.getSk(currentOperation.recordId)
        : await api.createSk(currentOperation.payload, createKey);
      currentOperation.recordId = created.id;
      currentOperation.code = created.sk_code;
      setOperation({ ...currentOperation });
      persist(currentOperation);
      setSelectedItem(created);
      let createRevision = created.server_revision ?? created.revision ?? 1;
      const uploadResults: Array<PromiseSettledResult<any>> = [];
      for (const file of filesToUpload) {
        const imageState = currentOperation.images.find((entry: any) => entry.name === file.name && entry.status !== "done");
        if (!imageState) { uploadResults.push({ status: "fulfilled", value: null }); continue; }
        try {
          imageState.status = "uploading";
          const response = await uploadWithRetry(created.id, file, `${createKey}:image:${imageState.index}`, createRevision);
          imageState.status = "done";
          imageState.id = response.id;
          createRevision = response.server_revision ?? createRevision + 1;
          uploadResults.push({ status: "fulfilled", value: response });
        } catch (reason) {
          imageState.status = "failed";
          uploadResults.push({ status: "rejected", reason });
          // Reconcile a possibly committed upload before sending the next one.
          const latest = await api.getSk(created.id).catch(() => null);
          if (latest) createRevision = latest.server_revision ?? latest.revision;
        }
        setOperation({ ...currentOperation });
        persist(currentOperation);
      }
      const failedFiles = filesToUpload.filter((_, index) => uploadResults[index].status === "rejected");
      setEvidenceFiles(failedFiles);
      reload();
      reloadDetail(created.id);
      if (failedFiles.length > 0) {
        setError(`Đã đăng ký xét duyệt nhưng ${failedFiles.length}/${filesToUpload.length} ảnh chưa tải lên được. Có thể thử tải lại trong phần chi tiết hồ sơ.`);
      } else {
        // Everything was received: clear the form so it is ready for the next
        // registration and leaving the tab does not ask about unsaved work.
        resetRegistration();
        const code = created.sk_code ? ` ${created.sk_code}` : "";
        setNotice(filesToUpload.length > 0
          ? `Đã đăng ký xét duyệt${code} và tải lên ${filesToUpload.length} ảnh bằng chứng.`
          : `Đã đăng ký xét duyệt${code}.`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const showItemDetail = (id: string) => {
    api.getSk(id)
      .then((item) => {
        setSelectedItem(item);
        setError("");
      })
      .catch((err) => setError(err.message));
  };

  const openItem = (id: string) => {
    if (selectedItem?.id === id) {
      setSelectedItem(null);
      setError("");
      return;
    }
    showItemDetail(id);
  };

  const selectTab = async (tab: FITab) => {
    if (!await requestNavigation("đổi tab FI")) return false;
    setActiveTab(tab);
    setActionTarget(null);
    setEditTarget(null);
    setKhmtTarget(null);
    setMatrixDrawer(null);
    setSelectedItem(null);
    return true;
  };

  const jumpToHistoryWithFilters = async (filters: {
    team?: string;
    khmt?: HistoryKhmtFilter;
    khmtPeriod?: string;
    registrationMonth?: number;
    registrationYear?: number;
    decision?: HistoryDecisionFilter;
    completion?: HistoryCompletionFilter;
  }) => {
    if (!await selectTab("history")) return;
    setHistoryQuery("");
    setHistoryYear(filters.registrationYear ? String(filters.registrationYear) : "");
    setHistoryTeams(filters.team ? [filters.team] : []);
    setHistoryMonths(filters.registrationMonth ? [filters.registrationMonth] : []);
    setHistoryDecisions(filters.decision ? [filters.decision] : []);
    setHistoryKhmt(filters.khmt ? [filters.khmt] : []);
    setHistoryKhmtPeriods(filters.khmtPeriod ? [filters.khmtPeriod] : []);
    setHistoryCompletion(filters.completion ? [filters.completion] : []);
    setHistoryAuthors([]);
    setHistorySubmitters([]);
    setHistoryPage(1);
  };

  const jumpToReviewForTeam = async (team?: string) => {
    if (!canReview) return;
    if (!await selectTab("review")) return;
    setReviewFilter("pending");
    setReviewTeamFilter(team || "");
    setReviewMonthFilter("");
    setReviewSearch("");
  };

  // Mở SK được yêu cầu từ ngoài (chuông thông báo): mở ngay Detail Drawer.
  useEffect(() => {
    if (!focusRequest) return;
    let active = true;
    api.getSk(focusRequest.id)
      .then(async (item) => {
        if (!active) return;
        const isOwner = recordAuthorId(item) === currentUserId || recordSubmitterId(item) === currentUserId;
        const tab: FITab | null = item.is_historical_import
          ? null
          : canReview && !isOwner ? "review" : canRegister ? "register" : canReview ? "review" : null;
        if (!await selectTab(tab ?? "history")) return;
        if (!active) return;
        if (tab === null) setHistoryQuery(item.sk_code || "");
        setSelectedItem(item);
        setError("");
      })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [focusRequest?.nonce]);

  useEffect(() => {
    if (!matrixRequest) return;
    setDashboardYear(matrixRequest.year);
    setActiveTab("dashboard");
    setMatrixDrawer(null);
    setSelectedItem(null);
  }, [matrixRequest?.nonce]);

  const selectHistoryTeams = (teams: string[]) => {
    setHistoryTeams(teams);
    setSelectedItem(null);
  };

  const changeHistoryMonths = (next: number[]) => {
    setHistoryMonths([...next].sort((a, b) => b - a));
    setSelectedItem(null);
  };

  const changeHistoryDecisions = (next: HistoryDecisionFilter[]) => {
    setHistoryDecisions(next);
    setSelectedItem(null);
  };

  const changeHistoryKhmt = (next: HistoryKhmtFilter[]) => {
    setHistoryKhmt(next);
    if (!next.includes("in")) setHistoryKhmtPeriods([]);
    setSelectedItem(null);
  };

  const changeHistoryKhmtPeriods = (next: string[]) => {
    const sorted = [...next].sort((a, b) => {
      const [ya, ma] = a.split("-").map(Number);
      const [yb, mb] = b.split("-").map(Number);
      return (yb - ya) || (ma - mb);
    });
    setHistoryKhmtPeriods(sorted);
    if (sorted.length > 0 && !historyKhmt.includes("in")) {
      setHistoryKhmt([...historyKhmt, "in"]);
    }
    setSelectedItem(null);
  };

  const changeHistoryCompletion = (next: HistoryCompletionFilter[]) => {
    setHistoryCompletion(next);
    setSelectedItem(null);
  };

  const changeHistoryAuthors = (next: string[]) => {
    setHistoryAuthors(next);
    setSelectedItem(null);
  };

  const changeHistorySubmitters = (next: string[]) => {
    setHistorySubmitters(next);
    setSelectedItem(null);
  };

  const resetHistoryFilters = () => {
    setHistoryQuery(""); setHistoryYear("");
    setHistoryTeams([]);
    setHistoryMonths([]);
    setHistoryDecisions([]);
    setHistoryKhmt([]);
    setHistoryKhmtPeriods([]);
    setHistoryCompletion([]);
    setHistoryAuthors([]);
    setHistorySubmitters([]);
    setSelectedItem(null);
  };

  const openOwnershipHistory = async (mode: OwnershipMode) => {
    const currentUserKey = personFilterKey(
      currentUserId,
      mode === "mine" ? accountAuthorName : registrarName,
    );
    if (!await selectTab("history")) return;
    setHistoryQuery("");
    setHistoryYear("");
    setHistoryTeams([]);
    setHistoryMonths([]);
    setHistoryDecisions([]);
    setHistoryKhmt([]);
    setHistoryKhmtPeriods([]);
    setHistoryCompletion([]);
    setHistoryAuthors(mode === "mine" && currentUserKey ? [currentUserKey] : []);
    setHistorySubmitters(mode === "sent" && currentUserKey ? [currentUserKey] : []);
  };

  // Quick-filter from the summary stat cards: clicking a card applies that single
  // facet (and toggles off when it is already the only active value).
  const isOnlyHistoryDecision = (value: HistoryDecisionFilter) =>
    historyDecisions.length === 1 && historyDecisions[0] === value;
  const toggleHistoryDecision = (value: HistoryDecisionFilter) =>
    changeHistoryDecisions(isOnlyHistoryDecision(value) ? [] : [value]);
  const isOnlyHistoryKhmt = (value: HistoryKhmtFilter) =>
    historyKhmt.length === 1 && historyKhmt[0] === value;
  const toggleHistoryKhmt = (value: HistoryKhmtFilter) =>
    changeHistoryKhmt(isOnlyHistoryKhmt(value) ? [] : [value]);
  const isOnlyHistoryCompletion = (value: HistoryCompletionFilter) =>
    historyCompletion.length === 1 && historyCompletion[0] === value;
  const toggleHistoryCompletion = (value: HistoryCompletionFilter) =>
    changeHistoryCompletion(isOnlyHistoryCompletion(value) ? [] : [value]);

  const openHistoryItem = (item: any) => {
    if (selectedItem?.id === item.id) {
      setSelectedItem(null);
      setError("");
      return;
    }
    // Optimistic: show row immediately, then refresh with full detail (incl. supporting_images)
    setSelectedItem(item);
    setError("");
    api.getSk(item.id)
      .then((full) => setSelectedItem((current: any) => current?.id === full.id ? full : current))
      .catch(() => {
        // Keep optimistic row data if detail fetch fails (permission, etc.)
      });
  };

  const openEdit = (item: any) => {
    const epoch = ++editLoadEpoch.current;
    setLoadingEdit(true);
    setActionTarget(null);
    setKhmtTarget(null);
    setEditTarget(item);
    const raw = item.completion_plan || "";
    setEditForm({
      title: item.title || "",
      content_description: item.content_description || "",
      ...completionFormValues(item),
      completion_plan_raw: raw,
    });
    setError("");
    setNotice("");
    api.getSk(item.id)
      .then((full) => {
        if (epoch !== editLoadEpoch.current || editTargetRef.current?.id !== item.id) return;
        setEditTarget((current: any) => current?.id === item.id ? full : current);
        setEditForm((current) => {
          const nextRaw = full.completion_plan || "";
          return {
            ...current,
            title: full.title || "",
            content_description: full.content_description || "",
            ...completionFormValues(full),
            completion_plan_raw: nextRaw,
          };
        });
      })
      .catch((err) => { if (epoch === editLoadEpoch.current) setError(err.message); })
      .finally(() => { if (epoch === editLoadEpoch.current) setLoadingEdit(false); });
  };

  const openReviewDecision = (item: any) => {
    setEditTarget(null);
    setKhmtTarget(null);
    setActionTarget({
      id: item.id,
      label: item.sk_code || item.title,
      decision: reviewDecisionFromStatus(item.status),
      revision: item.server_revision ?? item.revision ?? 0,
    });
    setActionNote(item.decision_note || "");
    setError("");
    setNotice("");
  };

  const openKhmtAssign = (item: any) => {
    const today = new Date();
    const registration = registrationInfo(item);
    setActionTarget(null);
    setEditTarget(null);
    setKhmtTarget({
      id: item.id,
      label: item.sk_code || item.title,
      month: Number(item.khmt_month || registration.month || today.getMonth() + 1),
      year: Number(item.khmt_year || registration.year || today.getFullYear()),
      revision: item.server_revision ?? item.revision ?? 0,
    });
    setError("");
    setNotice("");
  };

  const handleEditSave = async () => {
    if (!editTarget || savingEdit || loadingEdit) return;
    const planOnly = isPlanOnlyEdit(editTarget);
    const planError = completionPlanError(editForm.completion_done, editForm.completion_plan_date, !planOnly);
    if (planError) {
      setError(planError);
      return;
    }
    setSavingEdit(true);
    setError("");
    setNotice("");
    const wasSubmitted = editTarget.status && editTarget.status !== "Draft";
    const planFields = {
      completion_plan: formatCompletionPlan(editForm.completion_done, editForm.completion_plan_date),
      completion_done: editForm.completion_done,
      completion_date: editForm.completion_plan_date,
    };
    try {
      const updated = await api.updateSkRevision(editTarget.id, planOnly ? planFields : {
        ...planFields,
        content_description: editForm.content_description,
        title: editForm.title,
      }, {
        expectedRevision: editTarget.server_revision ?? editTarget.revision ?? 0,
      });
      setNotice(
        planOnly
          ? "Đã cập nhật kế hoạch hoàn thành. Trạng thái Đồng ý được giữ nguyên."
          : RESUBMIT_ON_EDIT_STATUSES.includes(editTarget.status)
            ? "Đã cập nhật và gửi xét duyệt lại. SK đã quay về hàng Chờ xét duyệt."
          : wasSubmitted
            ? "Đã cập nhật SK. Đầu mối FI và Quản trị đã nhận thông báo để xem xét lại."
            : "Đã cập nhật nội dung SK-CTKT."
      );
      setEditTarget(null);
      setSelectedItem((current: any) => current?.id === updated.id ? { ...current, ...updated } : current);
      reload();
      setMatrixRefreshNonce((n) => n + 1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleAction = () => {
    if (!actionTarget) return;
    if (reviewDecisionRequiresNote(actionTarget.decision) && !actionNote.trim()) {
      setError(`Cần nhập ghi chú khi chọn "${reviewDecisionLabel(actionTarget.decision)}".`);
      return;
    }
    const target = actionTarget;
    api.transitionSk(target.id, target.decision, {
      ...(actionNote.trim() ? { note: actionNote.trim() } : {}),
      expected_revision: target.revision,
    })
      .then((updated) => {
        setNotice(`Đã cập nhật đánh giá: ${reviewDecisionLabel(target.decision)}.`);
        setActionTarget(null);
        setEditTarget(null);
        setKhmtTarget(null);
        setActionNote("");
        reload();
        setMatrixRefreshNonce((n) => n + 1);
        setSelectedItem((current: any) => current?.id === updated.id ? { ...current, ...updated } : current);
        if (selectedItem?.id === target.id) reloadDetail(target.id);
      })
      .catch((err) => setError(err.message));
  };

  const handleAssignKhmt = async () => {
    if (!khmtTarget || assigningKhmt) return;
    setAssigningKhmt(true);
    setError("");
    setNotice("");
    try {
      const updated = await api.assignKhmt(
        khmtTarget.id,
        khmtTarget.month,
        khmtTarget.year,
        khmtTarget.revision,
      );
      setNotice(`Đã ghi nhận ${updated.sk_code || khmtTarget.label} vào KHMT T${khmtTarget.month}/${khmtTarget.year}.`);
      setKhmtTarget(null);
      reload();
      if (selectedItem?.id === khmtTarget.id) reloadDetail(khmtTarget.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssigningKhmt(false);
    }
  };

  const handleAssignKhmtDirect = async (item: any, month: number, year: number) => {
    if (assigningKhmt) return;
    setAssigningKhmt(true);
    setError("");
    setNotice("");
    try {
      const updated = await api.assignKhmt(item.id, month, year, item.server_revision ?? item.revision ?? 0);
      setNotice(`Đã ghi nhận ${updated.sk_code || item.title} vào KHMT T${month}/${year}.`);
      setKhmtTarget(null);
      reload(dashboardYear);
      setMatrixRefreshNonce((n) => n + 1);
      if (selectedItem?.id === item.id) reloadDetail(item.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssigningKhmt(false);
    }
  };

  const handleClearKhmtDirect = async (item: any) => {
    if (assigningKhmt) return;
    setAssigningKhmt(true);
    setError("");
    setNotice("");
    try {
      const updated = await api.clearKhmt(item.id, item.server_revision ?? item.revision ?? 0);
      setNotice(`Đã bỏ ${updated.sk_code || item.title} khỏi KHMT.`);
      setKhmtTarget(null);
      reload(dashboardYear);
      setMatrixRefreshNonce((n) => n + 1);
      if (selectedItem?.id === item.id) reloadDetail(item.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssigningKhmt(false);
    }
  };

  const extractClipboardImageFiles = (event: React.ClipboardEvent): File[] => {
    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const files: File[] = [];
    clipboardItems.forEach((entry, idx) => {
      if (entry.kind === "file" && entry.type.startsWith("image/")) {
        const raw = entry.getAsFile();
        if (!raw) return;
        const ext = (raw.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const named = raw.name && raw.name !== "image.png"
          ? raw
          : new File([raw], `clipboard-${stamp}-${idx + 1}.${ext}`, { type: raw.type || "image/png" });
        files.push(named);
      }
    });
    return files;
  };

  const handleDraftPaste = (event: React.ClipboardEvent) => {
    const pastedImages = extractClipboardImageFiles(event);
    if (pastedImages.length === 0) return;
    event.preventDefault();
    setError("");
    setEvidenceFiles((current) => [...current, ...pastedImages]);
    setNotice(`Đã dán ${pastedImages.length} ảnh từ clipboard vào danh sách đính kèm.`);
  };

  const handleDraftDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDraftDragOver(false);
    const dropped = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
      file.type.startsWith("image/") || /\.(heic|heif|jfif|bmp|tiff?|avif)$/i.test(file.name),
    );
    if (dropped.length === 0) return;
    setError("");
    setEvidenceFiles((current) => [...current, ...dropped]);
    setNotice(`Đã thêm ${dropped.length} ảnh bằng chứng bằng thao tác kéo thả.`);
  };

  const handleEditPaste = (event: React.ClipboardEvent) => {
    if (!editTarget || !canManageEditImages) return;
    const pastedImages = extractClipboardImageFiles(event);
    if (pastedImages.length === 0) return;
    event.preventDefault();
    void uploadImagesForItem(editTarget.id, pastedImages);
  };

  const insertContentTemplate = () => {
    const template = "1. Hiện trạng / Vấn đề:\n- \n\n2. Giải pháp cải tiến:\n- \n\n3. Hiệu quả dự kiến:\n- ";
    setForm((current) => ({
      ...current,
      content_description: current.content_description.trim()
        ? `${current.content_description.trim()}\n\n${template}`
        : template,
    }));
  };

  const handleDraftImageSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setError("");
      setNotice("");
      setEvidenceFiles((current) => [...current, ...files]);
    }
    e.target.value = "";
  };

  const refreshSkAfterImageChange = async (skId: string) => {
    const full = await api.getSk(skId);
    setSelectedItem((current: any) => current?.id === skId ? full : current);
    setEditTarget((current: any) => current?.id === skId ? full : current);
    return full;
  };

  const uploadImagesForItem = async (skId: string, files: File[], stage?: "registration" | "completion") => {
    if (files.length === 0 || uploadingImages) return;
    setUploadingImages(true);
    setError("");
    setNotice("");
    try {
      const batchKey = makeIdempotencyKey(`fi-image:${skId}`);
      // Image uploads share the SK revision. A tiny serialized queue keeps the
      // CAS token current while still bounding the queue to the active form.
      const targetRecord = selectedItem?.id === skId ? selectedItem : editTarget;
      const effectiveStage: "registration" | "completion" =
        stage ?? (EXECUTION_EDITABLE_STATUSES.includes(targetRecord?.status) ? "completion" : "registration");
      let revision = targetRecord?.server_revision ?? targetRecord?.revision ?? 0;
      const results: Array<PromiseSettledResult<any>> = [];
      for (const [index, file] of files.entries()) {
        try {
          const response = await uploadWithRetry(skId, file, `${batchKey}:${index}`, revision, effectiveStage);
          revision = response.server_revision ?? revision + 1;
          results.push({ status: "fulfilled", value: response });
        } catch (reason) {
          results.push({ status: "rejected", reason });
        }
      }
      const failedCount = results.filter((result) => result.status === "rejected").length;
      reload();
      await refreshSkAfterImageChange(skId).catch(() => {});
      if (failedCount > 0) {
        const firstError = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
        setError(`Có ${failedCount}/${files.length} ảnh chưa tải lên được${firstError?.reason?.message ? `: ${firstError.reason.message}` : "."}`);
      } else {
        setNotice(
          effectiveStage === "completion"
            ? `Đã tải lên ${files.length} ảnh bằng chứng hoàn thành.`
            : `Đã tải lên ${files.length} ảnh bằng chứng.`,
        );
      }
    } finally {
      setUploadingImages(false);
    }
  };

  const handleDetailImageSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const skId = selectedItem?.id;
    e.target.value = "";
    if (!skId || files.length === 0) return;
    uploadImagesForItem(skId, files);
  };

  const handleEditImageSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const skId = editTarget?.id;
    e.target.value = "";
    if (!skId || files.length === 0) return;
    uploadImagesForItem(skId, files);
  };

  const handleDeleteImage = (skId: string, imageId: string) => {
    const currentRevision = selectedItem?.server_revision ?? selectedItem?.revision ?? editTarget?.server_revision ?? editTarget?.revision ?? 0;
    api.deleteSkImage(skId, imageId, currentRevision)
      .then(() => {
        reload();
        refreshSkAfterImageChange(skId).catch(() => {});
      })
      .catch((err) => setError(err.message));
  };

  const handleDelete = (item: any) => {
    const id = item?.id;
    if (!id) return;
    const label = item.sk_code || item.title || "SK-CTKT này";
    if (!confirm(`Xác nhận xóa ${label}?`)) return;
    api.deleteSk(id, { expectedRevision: item.server_revision ?? item.revision ?? 0 })
      .then(() => {
        if (selectedItem?.id === id) setSelectedItem(null);
        if (editTarget?.id === id) setEditTarget(null);
        setNotice("Đã xóa hồ sơ SK-CTKT.");
        reload();
        setMatrixRefreshNonce((n) => n + 1);
      })
      .catch((err) => setError(err.message));
  };

  // Form đăng ký luôn hiện cho ai có quyền tạo SK (kể cả FI_Coordinator/Admin).
  const showForm = canRegister;
  // "Sáng kiến của tôi" bám theo tác giả/người đứng tên; "Phiếu tôi đã gửi" bám theo người tạo phiếu.
  const myItems = items.filter((item) => recordAuthorId(item) === currentUserId);
  const sentItems = items.filter((item) => recordSubmitterId(item) === currentUserId && recordAuthorId(item) !== currentUserId);
  const myOwnershipSections = buildOwnershipSections(myItems, "mine");
  const sentOwnershipSections = buildOwnershipSections(sentItems, "sent");
  const userLabelById = useMemo(() => {
    const map = new Map<string, string>();
    authorOptions.forEach((row) => {
      map.set(row.id, row.full_name || row.display_name || row.id);
    });
    allHistoryItems.forEach((item) => {
      const submittedBy = recordSubmitterId(item);
      const authorId = recordAuthorId(item);
      if (submittedBy && item.submitted_by_name) map.set(submittedBy, item.submitted_by_name);
      if (authorId && item.author_name) map.set(authorId, item.author_name);
    });
    map.set(currentUserId, accountAuthorName);
    map.set(SYSTEM_ACTOR_ID, "Hệ thống");
    map.set("deploy-import", "Hệ thống");
    return map;
  }, [accountAuthorName, allHistoryItems, authorOptions, currentUserId]);
  const displayUser = (userId: string | null | undefined) => {
    if (!userId) return "Hệ thống";
    return userLabelById.get(userId) || actorLabel(userId);
  };
  const displaySubmitter = (item: any) => item?.submitted_by_name || displayUser(recordSubmitterId(item));
  // Hàng đợi xét duyệt: tất cả SK đã ngưng nháp + chưa hủy + không phải dữ liệu legacy.
  // FI_Coordinator không thấy SK của chính mình trong queue (tránh tự duyệt).
  const reviewQueueAll = items.filter((item) => {
    if (item.is_historical_import) return false;
    if (item.status === "Draft" || item.status === "Cancelled") return false;
    if (role === FI_COORDINATOR_ROLE && (recordAuthorId(item) === currentUserId || recordSubmitterId(item) === currentUserId)) return false;
    return true;
  });
  const reviewQueueByStatus = reviewQueueAll.filter((item) => {
    if (reviewFilter === "all") return true;
    if (reviewFilter === "reviewed") return REVIEWED_STATUSES.includes(item.status);
    // pending: chờ tay người duyệt — Submitted/NeedMoreInfo (chưa có quyết định)
    return ["Submitted", "NeedMoreInfo"].includes(item.status);
  });
  const reviewTeamCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    reviewQueueByStatus.forEach((item) => {
      if (item.team) counts[item.team] = (counts[item.team] ?? 0) + 1;
    });
    return counts;
  }, [reviewQueueByStatus]);
  const reviewTeamOptions = useMemo(() => {
    const extra = Object.keys(reviewTeamCounts).filter((t) => !FI_TEAMS.includes(t));
    return [...FI_TEAMS, ...extra];
  }, [reviewTeamCounts]);
  const reviewMonthOptions = useMemo(() => {
    const set = new Set<string>();
    reviewQueueByStatus.forEach((item) => {
      const { month, year } = registrationInfo(item);
      if (month && year) set.add(`${year}-${String(month).padStart(2, "0")}`);
    });
    return Array.from(set).sort().reverse();
  }, [reviewQueueByStatus]);
  const reviewQueue = useMemo(() => {
    const term = normalizeAuthorQuery(reviewSearch);
    const tokens = term ? term.split(/\s+/).filter(Boolean) : [];
    return reviewQueueByStatus.filter((item) => {
      if (reviewTeamFilter && item.team !== reviewTeamFilter) return false;
      if (reviewMonthFilter) {
        const { month, year } = registrationInfo(item);
        const key = month && year ? `${year}-${String(month).padStart(2, "0")}` : "";
        if (key !== reviewMonthFilter) return false;
      }
      if (tokens.length > 0) {
        const hay = normalizeAuthorQuery(`${item.sk_code || ""} ${item.title || ""} ${item.author_name || ""} ${item.content_description || ""} ${displayTeam(item.team)}`);
        if (!tokens.every((token) => hay.includes(token))) return false;
      }
      return true;
    });
  }, [reviewQueueByStatus, reviewTeamFilter, reviewMonthFilter, reviewSearch]);
  const reviewCounts = {
    pending: reviewQueueAll.filter((item) => ["Submitted", "NeedMoreInfo"].includes(item.status)).length,
    reviewed: reviewQueueAll.filter((item) => REVIEWED_STATUSES.includes(item.status)).length,
    all: reviewQueueAll.length,
  };
  const selectedImages = Array.isArray(selectedItem?.supporting_images) ? selectedItem.supporting_images : [];
  const selectedHistory = Array.isArray(selectedItem?.status_history) ? selectedItem.status_history : [];
  const canUploadForSelected = selectedItem
    ? canUploadImages(role, currentUserId, selectedItem, editMode, currentTeam)
    : false;
  const selectedActions = selectedItem ? visibleActionsForSk(role, currentUserId, selectedItem, editMode, currentTeam) : [];
  const editImages = Array.isArray(editTarget?.supporting_images) ? editTarget.supporting_images : [];
  const canManageEditImages = editTarget
    ? canUploadImages(role, currentUserId, editTarget, editMode, currentTeam)
    : false;
  const historyItems = allHistoryItems;
  const historyTeamCounts: Record<string, number> = Object.fromEntries((historyMeta?.facets?.teams ?? []).map((row: any) => [row.value, row.count]));
  const historyMonthOptions: Array<[number, number]> = (() => {
    const map = new Map<number, number>();
    (historyMeta?.facets?.months ?? []).forEach((row: any) => map.set(Number(row.value), Number(row.count)));
    historyMonths.forEach((m) => { if (!map.has(m)) map.set(m, 0); });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  })();
  const personFacets = (kind: "authors" | "submitters"): PersonFilterOption[] => (historyMeta?.facets?.[kind] ?? []).map((row: any) => ({...row, nameKey: normalizeAuthorQuery(row.label), searchText: normalizeAuthorQuery(`${row.label} ${row.accountId ?? ""} ${row.team ?? ""}`)}));
  const historyAuthorOptions = useMemo(() => personFacets("authors"), [historyMeta]);
  const historySubmitterOptions = useMemo(() => personFacets("submitters"), [historyMeta]);
  const historyDecisionCounts: Record<HistoryDecisionFilter, number> = {
    approved: historyMeta?.facets?.decisions?.approved ?? historyMeta?.summary?.approved ?? 0,
    rejected: historyMeta?.facets?.decisions?.rejected ?? historyMeta?.summary?.rejected ?? 0,
    deferred: historyMeta?.facets?.decisions?.deferred ?? historyMeta?.summary?.deferred ?? 0,
    pending: historyMeta?.facets?.decisions?.pending ?? historyMeta?.summary?.pending ?? 0,
  };
  const historyKhmtCounts = {
    in: historyMeta?.facets?.khmt?.in ?? historyMeta?.summary?.khmt_considered ?? 0,
    out: historyMeta?.facets?.khmt?.out ?? historyMeta?.summary?.khmt_missing ?? 0,
  };
  const historyKhmtPeriodOptions: Array<[string, {month: number; year: number; count: number}]> = (() => {
    const map = new Map<string, { month: number; year: number; count: number }>();
    (historyMeta?.facets?.periods ?? []).forEach((row: any) => {
      const m = Number(row.month);
      const y = Number(row.year);
      if (m >= 1 && m <= 12 && y >= 2020) {
        map.set(`${y}-${m}`, { month: m, year: y, count: Number(row.count ?? 0) });
      }
    });
    historyKhmtPeriods.forEach((period) => {
      if (!map.has(period)) {
        const [yStr, mStr] = period.split("-");
        const y = Number(yStr);
        const m = Number(mStr);
        if (m >= 1 && m <= 12 && y >= 2020) {
          map.set(period, { month: m, year: y, count: 0 });
        }
      }
    });
    return Array.from(map.entries()).sort(([, a], [, b]) => (b.year - a.year) || (a.month - b.month));
  })();
  const historyKhmtPeriodsByYear = (() => {
    const groups: Array<{ year: number; items: Array<[string, { month: number; year: number; count: number }]> }> = [];
    for (const entry of historyKhmtPeriodOptions) {
      const yr = entry[1].year;
      let group = groups.find((g) => g.year === yr);
      if (!group) {
        group = { year: yr, items: [] };
        groups.push(group);
      }
      group.items.push(entry);
    }
    return groups;
  })();
  const historyKhmtScopeLabel = historyTeams.length === 1
    ? displayTeam(historyTeams[0])
    : historyTeams.length > 1
      ? `${historyTeams.length} đội/tổ`
      : "";
  const historyKhmtChipSummary = (() => {
    if (historyKhmtPeriods.length === 0) return undefined;
    const formatPeriod = (p: string) => {
      const [y, m] = p.split("-");
      return `T${String(Number(m)).padStart(2, "0")}/${y}`;
    };
    const periodLabel = historyKhmtPeriods.length === 1
      ? formatPeriod(historyKhmtPeriods[0])
      : `${historyKhmtPeriods.length} kỳ`;
    return historyKhmt.includes("out") ? `2 mục · ${periodLabel}` : periodLabel;
  })();
  const historyCompletionCounts: Record<HistoryCompletionFilter, number> = {
    done: historyMeta?.summary?.completed_count ?? 0,
    pending: historyMeta?.summary?.not_completed ?? 0,
    auto_done: historyMeta?.summary?.approved_auto_done_count ?? 0,
    paused: historyMeta?.summary?.approved_paused_count ?? 0,
  };
  const ownTeamCode = teamFromAccount && FI_TEAMS.includes(teamFromAccount) ? teamFromAccount : null;
  const isMyTeamInProgressActive = Boolean(
    ownTeamCode
      ? historyTeams.length === 1 &&
        historyTeams[0] === ownTeamCode &&
        historyDecisions.length === 1 &&
        historyDecisions[0] === "approved" &&
        historyCompletion.length === 1 &&
        historyCompletion[0] === "pending"
      : historyTeams.length === 0 &&
        historyDecisions.length === 1 &&
        historyDecisions[0] === "approved" &&
        historyCompletion.length === 1 &&
        historyCompletion[0] === "pending",
  );
  const toggleMyTeamInProgress = () => {
    if (isMyTeamInProgressActive) {
      setHistoryTeams([]);
      setHistoryDecisions([]);
      setHistoryCompletion([]);
    } else {
      setHistoryTeams(ownTeamCode ? [ownTeamCode] : []);
      setHistoryDecisions(["approved"]);
      setHistoryCompletion(["pending"]);
    }
    setSelectedItem(null);
  };
  const historyActiveFilterCount =
    Number(Boolean(historyQuery)) + Number(Boolean(historyYear)) +
    historyTeams.length +
    historyMonths.length +
    historyDecisions.length +
    historyKhmt.length +
    historyKhmtPeriods.length +
    historyCompletion.length +
    historyAuthors.length +
    historySubmitters.length;
  const filteredHistoryItems = historyItems;
  const groupedHistoryItems = filteredHistoryItems.reduce<HistoryMonthGroup[]>((groups, item) => {
    const { month, year } = registrationInfo(item);
    const groupKey = `${year}-${month ?? "unknown"}`;
    const existingGroup = groups.find((group) => group.key === groupKey);
    if (existingGroup) {
      existingGroup.items.push(item);
    } else {
      groups.push({ key: groupKey, month, year, items: [item] });
    }
    return groups;
  }, []);
  const dashboardTeams = Array.isArray(dashboard?.teams) ? dashboard.teams : [];
  const historySummaryTeamRows = historyTeams.length === 0
    ? dashboardTeams
    : dashboardTeams.filter((team: any) => historyTeams.includes(team.team));
  const historyTeamSummary = historyMeta?.summary
    ? {
        ...historyMeta.summary,
        review_passed: historyMeta.summary.approved,
        review_failed: historyMeta.summary.rejected,
        khmt_not_considered: historyMeta.summary.khmt_unassigned_approved ?? historyMeta.summary.khmt_missing,
        khmt_unassigned_approved: historyMeta.summary.khmt_unassigned_approved,
      }
    : aggregateTeamSummaries(historySummaryTeamRows);
  const historyTeamOptions: string[] = [
    ...FI_TEAMS,
    ...Array.from(
      new Set<string>(
        [
          ...(historyMeta?.facets?.teams ?? []).map((row: any) => row?.value),
          ...allHistoryItems.map((item) => item?.team),
        ].filter((team: unknown): team is string => typeof team === "string" && team.length > 0 && !FI_TEAMS.includes(team))
      )
    ).sort((a, b) => displayTeam(a).localeCompare(displayTeam(b), "vi")),
  ];

  const exportHistoryExcel = () => {
    if (exportingHistoryExcel || filteredHistoryItems.length === 0) return;
    setExportingHistoryExcel(true);
    setError("");
    setNotice("");
    api.exportFiReports({
      q: historyQuery || undefined,
      registration_year: historyYear ? Number(historyYear) : undefined,
      matrix_year: historyYear ? Number(historyYear) : dashboardYear,
      teams: historyTeams,
      registration_months: historyMonths,
      decisions: historyDecisions,
      khmt: historyKhmt,
      khmt_periods: historyKhmtPeriods,
      completion: historyCompletion,
      authors: historyAuthors,
      submitters: historySubmitters,
    })
      .then((blob) => {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        saveBlob(blob, `fi-reports-${stamp}.xlsx`);
        setNotice(`Đã xuất ${historyMeta?.total ?? filteredHistoryItems.length} SK-CTKT theo bộ lọc ra Excel.`);
      })
      .catch((err) => setError(err.message))
      .finally(() => setExportingHistoryExcel(false));
  };

  const exportDashboardExcel = (year: number) => {
    if (exportingHistoryExcel) return;
    setExportingHistoryExcel(true);
    setError("");
    setNotice("");
    api.exportFiReports({ matrix_year: year })
      .then((blob) => {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        saveBlob(blob, `fi-khmt-matrix-${year}-${stamp}.xlsx`);
        setNotice(`Đã xuất báo cáo & Ma trận KHMT năm ${year} ra Excel.`);
      })
      .catch((err) => setError(err.message))
      .finally(() => setExportingHistoryExcel(false));
  };

  const renderKhmtControl = (item: any) => {
    const canSelect = (role !== ADMIN_ROLE || editMode) && canSelectKhmtMonth(role, currentUserId, item, currentTeam);
    const considered = isKhmtConsidered(item);
    if (!canSelect) {
      return (
        <span className={`legacy-khmt-pill ${considered ? "success" : "empty"}`}>
          {khmtLabel(item)}
        </span>
      );
    }

    return (
      <span className="legacy-khmt-control">
        <FiKhmtMonthPicker
          item={item}
          khmtMatrix={dashboard?.khmt_matrix ?? null}
          busy={assigningKhmt}
          onAssign={handleAssignKhmtDirect}
          onClear={handleClearKhmtDirect}
        />
      </span>
    );
  };

  const renderReviewDecisionPanel = (item: any) => {
    if (!actionTarget || actionTarget.id !== item.id) return null;
    const currentOption = reviewDecisionOptions.find((option) => option.value === actionTarget.decision);
    const requiresNote = reviewDecisionRequiresNote(actionTarget.decision);
    const alreadyReviewed = REVIEWED_STATUSES.includes(item.status);
    return (
      <section className="fi-inline-review-panel">
        <div className="fi-inline-review-head">
          <div>
            <h3>{alreadyReviewed ? "Sửa lại đánh giá SK-CTKT" : "Đánh giá SK-CTKT"}</h3>
            <p className="muted">
              {actionTarget.label}
              {alreadyReviewed && (
                <>
                  {" · "}
                  <em>Đánh giá hiện tại: {displayStatus(item.status)}</em>
                </>
              )}
            </p>
          </div>
          <span className={`legacy-status-pill ${statusTone(item.status)}`}>{displayHistoryStatus(item)}</span>
        </div>
        {activeTab === "review" && (
          <div className="fi-inline-review-content">
            <strong>{item.title}</strong>
            <p>{item.content_description || "Chưa có mô tả nội dung."}</p>
            <div className="fi-inline-review-content-foot">
              <FiCompletionPill item={item} compact />
              <button className="link-button" onClick={() => showItemDetail(item.id)} type="button">
                Xem ảnh và chi tiết
              </button>
            </div>
          </div>
        )}
        <div className="fi-inline-review-grid">
          <label>
            Kết luận đánh giá
            <select
              value={actionTarget.decision}
              onChange={(e) =>
                setActionTarget({ ...actionTarget, decision: e.target.value as ReviewDecision })
              }
            >
              {reviewDecisionOptionsFor(item).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ghi chú {requiresNote && <span className="required-mark">*</span>}
            <textarea
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
              placeholder={
                requiresNote
                  ? `Nhập lý do "${reviewDecisionLabel(actionTarget.decision)}"...`
                  : "Nhập ghi chú đánh giá (nếu có)..."
              }
              rows={3}
            />
          </label>
        </div>
        {currentOption && <p className="fi-review-helper">{currentOption.helper}</p>}
        {alreadyReviewed && (
          <p className="fi-review-helper" style={{ color: "#0369a1" }}>
            Bạn đang chỉnh sửa quyết định trước đó. Đổi kết luận hoặc ghi chú rồi bấm "Cập nhật" để ghi đè.
          </p>
        )}
        <div className="fi-inline-review-actions">
          <button onClick={handleAction} type="button">
            <ClipboardCheck size={17} />
            {alreadyReviewed ? "Cập nhật đánh giá" : "Lưu đánh giá"}
          </button>
          <button onClick={() => { setActionTarget(null); setActionNote(""); }} type="button">
            Hủy
          </button>
        </div>
        {error && <p className="error" role="alert" tabIndex={-1}>{error}</p>}
      </section>
    );
  };

  const toggleOwnershipList = (listKey: OwnershipListKey) => {
    setExpandedOwnershipLists((current) => ({ ...current, [listKey]: !current[listKey] }));
  };

  const renderOwnershipItems = (
    rows: any[],
    emptyText: string,
    mode: OwnershipMode,
    listKey: OwnershipListKey,
  ) => {
    const expanded = expandedOwnershipLists[listKey];
    const visibleRows = expanded ? rows : rows.slice(0, OWNERSHIP_PREVIEW_LIMIT);
    const hiddenCount = rows.length - visibleRows.length;
    return (
      <div className="list">
      {visibleRows.map((item) => {
        const actions = visibleActionsForSk(role, currentUserId, item, editMode, currentTeam);
        const submitterId = recordSubmitterId(item);
        const authorId = recordAuthorId(item);
        return (
          <div className={`workflow-item ${selectedItem?.id === item.id ? "active-row" : ""}`} key={item.id}>
            <button className="workflow-main" onClick={() => openItem(item.id)} type="button">
              <strong>{item.sk_code}</strong>
              <span>{item.title}</span>
              <small>Tác giả: {item.author_name} · {displayTeam(item.team)}</small>
              {mode === "mine" && submitterId && submitterId !== authorId && (
                <small>Người đăng ký: {displayUser(submitterId)}</small>
              )}
              {mode === "sent" && (
                <small>Người đăng ký: {displaySubmitter(item)}</small>
              )}
              <small>
                {displayStatus(item.status)}
                {item.submitted_at && item.status === "Submitted" && ` · đăng ký ngày ${new Date(item.submitted_at).toLocaleDateString("vi-VN")}`}
                {isKhmtConsidered(item) && ` · ${khmtLabel(item)}`}
              </small>
              {EXECUTION_EDITABLE_STATUSES.includes(item.status) && (
                <div style={{ marginTop: 4 }}>
                  <FiCompletionPill item={item} compact />
                </div>
              )}
            </button>
            <div className="toolbar">
              {actions.includes("updatePlan") && !actions.includes("edit") && (
                <button
                  className="fi-completion-update is-inline"
                  onClick={() => openExecutionModal(item)}
                  title="Cập nhật tình hình thực hiện"
                  type="button"
                >
                  <CheckCircle2 size={15} />
                  Cập nhật tiến độ
                </button>
              )}
              {actions.includes("edit") && (
                <button
                  aria-label={`Sửa ${item.sk_code || item.title}`}
                  title={editActionTitle(item)}
                  onClick={() => openEdit(item)}
                  type="button"
                >
                  <Pencil size={16} />
                </button>
              )}
              {actions.includes("delete") && (
                <button
                  aria-label={`Xóa ${item.sk_code || item.title}`}
                  className="danger-button"
                  title="Xóa SK"
                  onClick={() => handleDelete(item)}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        );
      })}
      {rows.length === 0 && renderEmptyState(emptyText)}
      {rows.length > OWNERSHIP_PREVIEW_LIMIT && (
        <button
          aria-expanded={expanded}
          className="fi-ownership-expand"
          onClick={() => toggleOwnershipList(listKey)}
          type="button"
        >
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {expanded ? "Thu gọn danh sách" : `Xem thêm ${hiddenCount} hồ sơ`}
        </button>
      )}
      </div>
    );
  };

  const fiSnapshotName = fiSnapshotNames[activeTab];
  return (
    <div
      className="content-grid"
      data-snapshot-target="true"
      data-snapshot-name={fiSnapshotName}
    >
      {recoveryWarning && <p role="alert">{recoveryWarning}<button onClick={() => downloadDraft("fi-draft.json", { form, operation })}>Tải bản nháp</button></p>}
      {recovery && <section className="panel wide" role="status">
        <p>Có bản khôi phục FI của tài khoản này.</p>
        <details><summary>Xem bản khôi phục</summary><pre>{JSON.stringify(recovery.data, null, 2)}</pre></details>
        <button onClick={() => {
          setForm(recovery.data.form); setAuthorQuery(recovery.data.form.author_name);
          operationRef.current = recovery.data.operation; setOperation(recovery.data.operation);
          if (recovery.data.operation?.recordId) reloadDetail(recovery.data.operation.recordId);
          setNotice((recovery.data.files ?? []).length ? `Cần chọn lại ảnh: ${recovery.data.files.join(", ")}` : "Đã khôi phục nội dung. Chưa gửi lại.");
          setRecovery(null);
        }}>Khôi phục bản này</button>
        <button onClick={resetRegistration}>Bỏ bản khôi phục này</button>
      </section>}
      {operation && <section className="panel wide" role="status">
        <p>{operation.recordId ? `FI đã tồn tại: ${operation.code ?? operation.recordId}` : "Đang đối soát lần gửi trước. Gửi lại dùng cùng mã thao tác và nội dung đã gửi."}</p>
        <ul>{operation.images.map((entry: any) => <li key={entry.index}>{entry.name}: {entry.status === "done" ? "Đã nhận" : "Chưa nhận / cần chọn lại"}</li>)}</ul>
        <button disabled={creating} onClick={() => void create()}>{operation.recordId ? "Thử lại ảnh chưa gửi" : "Đối soát / gửi lại"}</button>
        {operation.recordId && <button disabled={creating} onClick={resetRegistration}>Bắt đầu hồ sơ mới</button>}
      </section>}
      <input
        ref={draftFileInputRef}
        type="file"
        accept="image/*,.heic,.heif,.jfif,.bmp,.tif,.tiff,.avif"
        multiple
        style={{ display: "none" }}
        onChange={handleDraftImageSelection}
      />
      <input
        ref={detailFileInputRef}
        type="file"
        accept="image/*,.heic,.heif,.jfif,.bmp,.tif,.tiff,.avif"
        multiple
        style={{ display: "none" }}
        onChange={handleDetailImageSelection}
      />
      <input
        ref={editFileInputRef}
        type="file"
        accept="image/*,.heic,.heif,.jfif,.bmp,.tif,.tiff,.avif"
        multiple
        style={{ display: "none" }}
        onChange={handleEditImageSelection}
      />

      {/* Hàng tab được "portal" lên topbar để nằm chung hàng với tiêu đề
          "Luồng SK-CTKT". Khi host chưa sẵn sàng (1 frame đầu lúc mount) thì
          không render để tránh nhấp nháy vị trí. */}
      {tabsHost &&
        createPortal(
          <div className="segmented-control fi-topbar-tabs" role="tablist" aria-label="Sáng kiến FI (SK-CTKT)">
            {canRegister && (
              <button
                aria-selected={activeTab === "register"}
                className={activeTab === "register" ? "active" : ""}
                onClick={() => selectTab("register")}
                role="tab"
                type="button"
              >
                <ClipboardCheck size={16} />
                Đăng ký SK-CTKT
              </button>
            )}
            {canReview && (
              <button
                aria-selected={activeTab === "review"}
                className={activeTab === "review" ? "active" : ""}
                onClick={() => selectTab("review")}
                role="tab"
                type="button"
              >
                <ClipboardList size={16} />
                Xét duyệt SK-CTKT
                {reviewCounts.pending > 0 && (
                  <span className="tab-badge" aria-label={`${reviewCounts.pending} SK đang chờ`}>
                    {reviewCounts.pending}
                  </span>
                )}
              </button>
            )}
            <button
              aria-selected={activeTab === "dashboard"}
              className={activeTab === "dashboard" ? "active" : ""}
              onClick={() => selectTab("dashboard")}
              role="tab"
              type="button"
            >
              <BarChart3 size={16} />
              FI Dashboard
            </button>
            <button
              aria-selected={activeTab === "history"}
              className={activeTab === "history" ? "active" : ""}
              onClick={() => selectTab("history")}
              role="tab"
              type="button"
            >
              <History size={16} />
              Lịch sử FI
            </button>
          </div>,
          tabsHost,
        )}

      {editTarget && (
        <div
          className="fi-edit-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingEdit) setEditTarget(null);
          }}
        >
          <section
            aria-labelledby="fi-edit-modal-title"
            aria-modal="true"
            className="fi-edit-modal"
            onPaste={handleEditPaste}
            role="dialog"
          >
            <div className="fi-edit-modal-head">
              <div className="fi-edit-modal-title">
                <div className="fi-edit-modal-title-row">
                  <h2 id="fi-edit-modal-title">{isPlanOnlyEdit(editTarget) ? "Cập nhật kế hoạch hoàn thành" : "Chỉnh sửa SK-CTKT"}</h2>
                  {editTarget.status && (
                    <span className={`fi-status-pill ${statusTone(editTarget.status)}`}>
                      {displayStatus(editTarget.status)}
                    </span>
                  )}
                </div>
                <p className="fi-edit-modal-meta">
                  <strong>{editTarget.sk_code || "Chưa có mã"}</strong>
                  <span>{displayTeam(editTarget.team)}</span>
                  <span>Tác giả: {editTarget.author_name}</span>
                  <span>Người đăng ký: {displaySubmitter(editTarget)}</span>
                </p>
              </div>
              <button
                aria-label="Đóng chỉnh sửa"
                className="fi-edit-modal-close"
                disabled={savingEdit}
                onClick={() => setEditTarget(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <div className="fi-edit-modal-body">
              {loadingEdit && <p role="status">Đang tải bản hiện tại…</p>}
              {isPlanOnlyEdit(editTarget) ? (
                <div className="fi-edit-modal-alert">
                  <Info size={16} />
                  <span>SK đã được Đồng ý nên chỉ cập nhật được Kế hoạch hoàn thành. Trạng thái giữ nguyên, thay đổi được ghi vào lịch sử.</span>
                </div>
              ) : editTarget.status && editTarget.status !== "Draft" && (
                <div className="fi-edit-modal-alert">
                  <Info size={16} />
                  <span>FI/Admin sẽ nhận thông báo để xem xét lại sau khi lưu.</span>
                </div>
              )}
              {isPlanOnlyEdit(editTarget) ? (
                <div className="fi-edit-readonly-summary">
                  <strong>{editForm.title}</strong>
                  <p>{editForm.content_description}</p>
                </div>
              ) : (
              <>
              <div className="fi-edit-field">
                <label htmlFor="fi-edit-title">Tên SK-CTKT</label>
                <input
                  id="fi-edit-title"
                  disabled={loadingEdit || savingEdit}
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  placeholder="Nhập tên sáng kiến/cải tiến kỹ thuật"
                />
              </div>
              <div className="fi-edit-field fi-edit-content-field">
                <label htmlFor="fi-edit-content">Nội dung đăng ký</label>
                <textarea
                  id="fi-edit-content"
                  disabled={loadingEdit || savingEdit}
                  value={editForm.content_description}
                  onChange={(e) => setEditForm({ ...editForm, content_description: e.target.value })}
                  placeholder="Mô tả hiện trạng, giải pháp, phạm vi áp dụng và hiệu quả dự kiến"
                  rows={10}
                />
              </div>
              </>
              )}
              <CompletionPlanField
                date={editForm.completion_plan_date}
                disabled={loadingEdit || savingEdit}
                done={editForm.completion_done}
                idPrefix="fi-edit-plan"
                onChange={(next) => setEditForm({ ...editForm, completion_done: next.done, completion_plan_date: next.date })}
              />
              {editForm.completion_plan_raw &&
                !parseCompletionPlan(editForm.completion_plan_raw) && (
                  <small className="fi-edit-legacy-note">
                    Kế hoạch cũ: <em>{editForm.completion_plan_raw}</em> · Lưu lại sẽ ghi đè bằng
                    định dạng tháng/năm chuẩn.
                  </small>
                )}
              {!isPlanOnlyEdit(editTarget) && (
              <div className="fi-edit-images-panel">
                <div className="fi-edit-images-head">
                  <div>
                    <strong>Ảnh bằng chứng</strong>
                    <span>{editImages.length > 0 ? `${editImages.length} ảnh hiện có` : "Chưa có ảnh bằng chứng"}</span>
                  </div>
                  {canManageEditImages && (
                    <button
                      type="button"
                      className="fi-edit-image-add"
                      disabled={uploadingImages}
                      onClick={() => editFileInputRef.current?.click()}
                    >
                      <ImagePlus size={16} />
                      {uploadingImages ? "Đang tải..." : "Thêm ảnh"}
                    </button>
                  )}
                </div>
                {editImages.length > 0 ? (
                  <div className="fi-edit-image-grid">
                    {editImages.map((img: any, index: number) => (
                      <div className="image-card fi-edit-image-card" key={img.id}>
                        <AuthenticatedSkImage
                          skId={editTarget.id}
                          image={img}
                          onOpen={() => {
                            setSelectedItem(editTarget);
                            setImagePreviewIndex(index);
                          }}
                        />
                        <small title={img.file_name}>{img.file_name}</small>
                        {canManageEditImages && (
                          <button
                            aria-label={`Xóa ảnh ${img.file_name}`}
                            className="image-card-delete"
                            title="Xóa ảnh"
                            onClick={() => handleDeleteImage(editTarget.id, img.id)}
                            type="button"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="fi-edit-image-empty">
                    <ImageIcon size={18} />
                    <span>Có thể bổ sung ảnh minh chứng hoặc thay ảnh cũ bằng cách xóa rồi thêm ảnh mới.</span>
                  </div>
                )}
              </div>
              )}
              {error && <p className="error" role="alert" tabIndex={-1}>{error}</p>}
            </div>
            <div className="fi-edit-modal-actions">
              <button onClick={handleEditSave} disabled={savingEdit || loadingEdit} type="button">
                <ClipboardCheck size={17} />
                {savingEdit ? "Đang lưu..." : "Lưu cập nhật"}
              </button>
              <button onClick={() => setEditTarget(null)} disabled={savingEdit} type="button">
                Hủy
              </button>
            </div>
          </section>
        </div>
      )}

      {khmtTarget && (
        <section className="panel wide fi-action-panel">
          <h2>Ghi nhận vào KHMT</h2>
          <p className="muted">{khmtTarget.label}</p>
          <div className="form-stack">
            <div className="period-selector fi-registration-period">
              <label htmlFor="fi-khmt-month">Tháng KHMT</label>
              <select
                id="fi-khmt-month"
                value={khmtTarget.month}
                onChange={(e) => setKhmtTarget({ ...khmtTarget, month: Number(e.target.value) })}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>T{month}</option>
                ))}
              </select>
              <input
                aria-label="Năm KHMT"
                max={2100}
                min={2020}
                type="number"
                value={khmtTarget.year}
                onChange={(e) => setKhmtTarget({ ...khmtTarget, year: Number(e.target.value) || new Date().getFullYear() })}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleAssignKhmt} disabled={assigningKhmt} type="button">
                <CalendarDays size={17} />
                {assigningKhmt ? "Đang ghi nhận..." : "Ghi nhận KHMT"}
              </button>
              <button onClick={() => setKhmtTarget(null)} type="button">
                Hủy
              </button>
            </div>
          </div>
          {error && <p className="error" role="alert" tabIndex={-1}>{error}</p>}
          {notice && <p className="success">{notice}</p>}
        </section>
      )}

      {activeTab === "register" && (
        <>
      <div className={`fi-register-layout ${showForm ? "" : "single"}`}>
      {showForm && (
        <section className="panel fi-form-panel" onPaste={handleDraftPaste}>
          <h2>Đăng ký SK-CTKT</h2>
	          <p className="muted" style={{ marginTop: -6, marginBottom: 8 }}>
	            Điền đầy đủ thông tin để gửi sáng kiến/cải tiến kỹ thuật vào quy trình xét duyệt.
	          </p>
	          <div className="form-stack">
	            {canUseAuthorPicker ? (
	              <div className="fi-account-source" aria-label="Thông tin tài khoản đăng ký">
	                <div className="fi-author-cell">
	                  <span>Tác giả</span>
	                  <div
	                    className="fi-author-picker"
	                    onBlur={(event) => {
	                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
	                        commitAuthorQuery();
	                      }
	                    }}
	                  >
	                    <UserRound size={15} className="fi-author-picker-icon" aria-hidden="true" />
	                    <input
	                      id="fi-author-name"
	                      role="combobox"
	                      aria-expanded={authorPickerOpen}
	                      aria-controls="fi-author-list"
	                      aria-autocomplete="list"
	                      autoComplete="off"
	                      placeholder="Nhập tên hoặc mã tài khoản để tìm…"
	                      value={authorPickerOpen ? authorQuery : form.author_name}
	                      onFocus={(event) => {
	                        setAuthorPickerOpen(true);
	                        setAuthorQuery(form.author_name);
	                        event.target.select();
	                      }}
	                      onChange={(event) => {
	                        setAuthorPickerOpen(true);
	                        setAuthorQuery(event.target.value);
	                      }}
	                      onKeyDown={(event) => {
	                        if (event.key === "Escape") {
	                          setAuthorQuery(form.author_name);
	                          setAuthorPickerOpen(false);
	                        } else if (event.key === "Enter") {
	                          // Chỉ "ăn" khi gõ đủ mã tài khoản / đúng họ tên (commitAuthorQuery tự
	                          // kiểm tra). Muốn chọn từ gợi ý thì bấm trực tiếp vào danh sách.
	                          event.preventDefault();
	                          commitAuthorQuery();
	                        } else if (event.key === "ArrowDown" && !authorPickerOpen) {
	                          setAuthorPickerOpen(true);
	                        }
	                      }}
	                    />
	                    {(authorPickerOpen ? authorQuery : form.author_name) && (
	                      <button
	                        type="button"
	                        className="fi-author-clear"
	                        title="Xóa tên"
	                        tabIndex={-1}
	                        onMouseDown={(event) => event.preventDefault()}
	                        onClick={() => {
	                          setForm((current) => ({ ...current, author_name: "", author_user_id: "", team: accountTeam ?? current.team }));
	                          setAuthorQuery("");
	                          setAuthorPickerOpen(true);
	                        }}
	                      >
	                        <X size={14} />
	                      </button>
	                    )}
	                    {authorPickerOpen && (
	                      <div id="fi-author-list" className="fi-author-list" role="listbox" aria-label="Danh sách tác giả">
	                        {filteredAuthors.length > 0 ? (
	                          filteredAuthors.map((row) => (
	                            <button
	                              key={row.id}
	                              type="button"
	                              role="option"
	                              aria-selected={normalizeAuthorQuery(form.author_name) === normalizeAuthorQuery(row.full_name)}
	                              onMouseDown={(event) => event.preventDefault()}
	                              onClick={() => chooseAuthor(row)}
	                            >
	                              <strong>
	                                {row.full_name}
	                                {row.id === currentUserId && <span className="fi-author-self-badge">Bạn</span>}
	                              </strong>
	                              <span>
	                                <span className="fi-author-acct">{row.id}</span>
	                                {displayTeam(row.team) ? ` · ${displayTeam(row.team)}` : ""}
	                              </span>
	                            </button>
	                          ))
	                        ) : (
	                          <div className="fi-author-empty">
	                            {authorQuery.trim() ? (
	                              <>Không tìm thấy ai khớp “<strong>{authorQuery.trim()}</strong>”. Thử nhập đủ họ tên hoặc mã tài khoản.</>
	                            ) : (
	                              "Không có nhân sự để chọn."
	                            )}
	                          </div>
	                        )}
	                      </div>
	                    )}
	                  </div>
	                  {isProxyAuthor && (
	                    <small className="fi-author-proxy">
	                      <Info size={13} aria-hidden="true" />
	                      <span>Đang đăng ký giúp · người gửi: <strong>{registrarName}</strong></span>
	                      <button type="button" onClick={resetAuthorSelection}>
                          {AUTHOR_ROLES.includes(role) ? "Chọn lại tôi" : "Chọn lại"}
                        </button>
	                    </small>
	                  )}
	                </div>
	                <div>
	                  <span>Đội/tổ tác giả</span>
	                  <strong>{displayTeam(form.team) || "Chưa gán đội/tổ"}</strong>
	                </div>
	              </div>
	            ) : (
	              <>
	                <label htmlFor="fi-author-name">Tác giả <span style={{ color: "#dc2626" }}>*</span></label>
	                <input
	                  id="fi-author-name"
	                  placeholder="Họ tên người đăng ký, ví dụ: Nguyễn Văn A"
	                  value={form.author_name}
	                  onChange={(e) => setForm({ ...form, author_name: e.target.value })}
	                />
	                <label htmlFor="fi-team-input">Đội/tổ</label>
	                <select id="fi-team-input" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
	                  {FI_TEAMS.map((team) => (
	                    <option key={team}>{team}</option>
	                  ))}
	                </select>
	              </>
	            )}
            <div className="period-selector fi-registration-period with-label">
              <label htmlFor="fi-registration-month">Tháng đăng ký</label>
              <select
                id="fi-registration-month"
                value={form.registration_month}
                onChange={(e) => setForm({ ...form, registration_month: Number(e.target.value) })}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>T{month}</option>
                ))}
              </select>
              <input
                aria-label="Năm đăng ký"
                max={2100}
                min={2020}
                type="number"
                value={form.registration_year}
                onChange={(e) => setForm({ ...form, registration_year: Number(e.target.value) || new Date().getFullYear() })}
              />
            </div>
            <label htmlFor="fi-title">Tên SK-CTKT <span style={{ color: "#dc2626" }}>*</span></label>
            <input
              id="fi-title"
              className="fi-title-input"
              placeholder="Vd: Cải tiến quy trình kiểm tra thiết bị"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <div className="fi-content-label-row">
              <label htmlFor="fi-content">Nội dung đăng ký <span style={{ color: "#dc2626" }}>*</span></label>
              <button
                type="button"
                className="fi-template-btn"
                onClick={insertContentTemplate}
                title="Chèn dàn ý Hiện trạng / Giải pháp / Hiệu quả"
              >
                <Sparkles size={14} />
                Chèn mẫu gợi ý
              </button>
            </div>
            <textarea
              id="fi-content"
              className="fi-content-input"
              placeholder="Mô tả hiện trạng, giải pháp và hiệu quả dự kiến..."
              rows={9}
              value={form.content_description}
              onChange={(e) => setForm({ ...form, content_description: e.target.value })}
            />
            <CompletionPlanField
              date={form.completion_plan_date}
              done={form.completion_done}
              idPrefix="fi-plan"
              onChange={(next) => setForm({ ...form, completion_done: next.done, completion_plan_date: next.date })}
            />
            <label>
              Ảnh bằng chứng FI <span className="muted">(tùy chọn — có thể dán Ctrl+V từ Zalo / Snipping Tool hoặc kéo thả ảnh vào đây)</span>
            </label>
            <div
              className={`fi-dropzone ${draftDragOver ? "is-drag-over" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDraftDragOver(true); }}
              onDragLeave={() => setDraftDragOver(false)}
              onDrop={handleDraftDrop}
            >
              <button type="button" onClick={() => draftFileInputRef.current?.click()}>
                <ImagePlus size={16} />
                Chọn ảnh
              </button>
              <span className="fi-dropzone-hint">hoặc kéo thả ảnh vào khung / nhấn Ctrl+V để dán ảnh chụp màn hình</span>
            </div>
            {evidenceFiles.length > 0 && (
              <div className="evidence-file-list">
                <small className="muted">{evidenceFiles.length} ảnh sẽ được tải lên sau khi đăng ký xét duyệt.</small>
                {evidenceFiles.map((file, index) => (
                  <div className="evidence-file-row" key={`${file.name}-${file.lastModified}-${index}`}>
                    <span>{file.name}</span>
                    <button
                      title="Xóa file đã chọn"
                      type="button"
                      onClick={() => setEvidenceFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="fi-register-submit" type="button" onClick={create} disabled={creating}>
              <ClipboardCheck size={17} />
              {creating ? "Đang đăng ký xét duyệt..." : "Đăng ký xét duyệt"}
            </button>
          </div>
          {error && <p className="error" role="alert" tabIndex={-1}>{error}</p>}
          {notice && <p className="success">{notice}</p>}
        </section>
      )}

      <section className="panel fi-processing-panel">
        <div className="panel-header">
          <h2>Sáng kiến của tôi</h2>
          <button aria-label="Tải lại danh sách" disabled={dashboardLoading} onClick={() => reload()} title="Tải lại danh sách" type="button">
            <RefreshCw size={17} className={dashboardLoading ? "icon-spin" : undefined} />
          </button>
        </div>
        <p className="muted" style={{ marginTop: -4, marginBottom: 10 }}>
          Chỉ hiển thị hồ sơ đang chờ xử lý và sáng kiến đã duyệt chưa hoàn tất. Các hồ sơ đã có kết quả khác vẫn được lưu đầy đủ trong Lịch sử FI.
        </p>
        {error && <p className="error" role="alert" tabIndex={-1}>{error}</p>}
        <div className="fi-list-block">
          <div className="fi-list-block-head fi-ownership-group-head">
            <h3>
              <Clock3 size={16} />
              Đang chờ xử lý
              <span className="fi-ownership-count">{myOwnershipSections.pending.length}</span>
            </h3>
          </div>
          {renderOwnershipItems(
            myOwnershipSections.pending,
            "Bạn không có sáng kiến nào đang chờ xử lý.",
            "mine",
            "minePending",
          )}
        </div>
        {myOwnershipSections.implementation.length > 0 && (
          <div className="fi-list-block fi-implementation-block">
            <div className="fi-list-block-head fi-ownership-group-head">
              <div>
                <h3>
                  <CheckCircle2 size={16} />
                  Đã duyệt – đang thực hiện
                  <span className="fi-ownership-count success">{myOwnershipSections.implementation.length}</span>
                </h3>
                <p className="muted">Theo dõi đến khi sáng kiến được ghi nhận hoàn tất.</p>
              </div>
            </div>
            {renderOwnershipItems(
              myOwnershipSections.implementation,
              "Bạn chưa có sáng kiến nào đang thực hiện.",
              "mine",
              "mineImplementation",
            )}
          </div>
        )}
        {myOwnershipSections.history.length > 0 && (
          <button className="fi-ownership-history-link" onClick={() => openOwnershipHistory("mine")} type="button">
            <History size={16} />
            <span>
              <strong>{myOwnershipSections.history.length} hồ sơ đã có kết quả</strong>
              <small>Xem toàn bộ hồ sơ của tôi trong Lịch sử FI</small>
            </span>
            <ChevronRight size={16} />
          </button>
        )}
        <div className="fi-list-block fi-sent-block">
          <div className="fi-list-block-head fi-ownership-group-head">
            <div>
              <h3>
                <Send size={16} />
                Phiếu tôi đã gửi
                <span className="fi-ownership-count">
                  {sentOwnershipSections.pending.length + sentOwnershipSections.implementation.length}
                </span>
              </h3>
              <p className="muted">Hiển thị phiếu đăng ký hộ đang chờ xử lý và đã duyệt nhưng chưa hoàn tất.</p>
            </div>
          </div>
          {renderOwnershipItems(
            sentOwnershipSections.pending,
            "Bạn không có phiếu đăng ký hộ nào đang chờ xử lý.",
            "sent",
            "sentPending",
          )}
          {sentOwnershipSections.implementation.length > 0 && (
            <div className="fi-list-block fi-implementation-block fi-sent-implementation-block">
              <div className="fi-list-block-head fi-ownership-group-head">
                <div>
                  <h3>
                    <CheckCircle2 size={15} />
                    Phiếu gửi hộ đã duyệt – đang thực hiện
                    <span className="fi-ownership-count success">{sentOwnershipSections.implementation.length}</span>
                  </h3>
                  <p className="muted">Tổ trưởng/người gửi hộ có thể theo dõi và cập nhật tiến độ cho đến khi hoàn tất.</p>
                </div>
              </div>
              {renderOwnershipItems(
                sentOwnershipSections.implementation,
                "Không có phiếu gửi hộ nào đang thực hiện.",
                "sent",
                "sentImplementation",
              )}
            </div>
          )}
          {sentOwnershipSections.history.length > 0 && (
            <button className="fi-ownership-history-link compact" onClick={() => openOwnershipHistory("sent")} type="button">
              <History size={16} />
              <span>
                <strong>{sentOwnershipSections.history.length} phiếu đã có kết quả</strong>
                <small>Xem toàn bộ phiếu tôi đã gửi trong Lịch sử FI</small>
              </span>
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      </section>
      </div>
        </>
      )}

      {activeTab === "review" && canReview && (
        <section className="panel wide fi-review-panel">
          <div className="panel-header">
            <div>
              <h2>Xét duyệt SK-CTKT</h2>
              <p className="muted">
                {role === FI_COORDINATOR_ROLE
                  ? "SK của 4 đội/tổ chờ Đầu mối FI xét duyệt. SK do chính bạn đăng ký sẽ do Admin xét duyệt."
                  : "Toàn bộ SK đang trong luồng xét duyệt. Admin có thể xem & ghi đè quyết định nếu cần."}
              </p>
            </div>
            <button aria-label="Tải lại hàng đợi xét duyệt" disabled={dashboardLoading} onClick={() => reload()} title="Tải lại hàng đợi xét duyệt" type="button">
              <RefreshCw size={17} className={dashboardLoading ? "icon-spin" : undefined} />
            </button>
          </div>
          <div className="fi-review-filter segmented-control" role="tablist" aria-label="Bộ lọc xét duyệt">
            <button
              aria-selected={reviewFilter === "pending"}
              className={reviewFilter === "pending" ? "active" : ""}
              onClick={() => setReviewFilter("pending")}
              type="button"
            >
              <Clock3 size={14} />
              Chờ xét duyệt
              <span className="tab-badge">{reviewCounts.pending}</span>
            </button>
            <button
              aria-selected={reviewFilter === "reviewed"}
              className={reviewFilter === "reviewed" ? "active" : ""}
              onClick={() => setReviewFilter("reviewed")}
              type="button"
            >
              <CheckCircle2 size={14} />
              Đã đánh giá
              <span className="tab-badge">{reviewCounts.reviewed}</span>
            </button>
            <button
              aria-selected={reviewFilter === "all"}
              className={reviewFilter === "all" ? "active" : ""}
              onClick={() => setReviewFilter("all")}
              type="button"
            >
              <ListChecks size={14} />
              Tất cả
              <span className="tab-badge">{reviewCounts.all}</span>
            </button>
          </div>
          <div className="fi-review-filters-bar" role="group" aria-label="Lọc nhanh hàng đợi xét duyệt">
            <label className="fi-review-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={reviewSearch}
                onChange={(event) => setReviewSearch(event.target.value)}
                placeholder="Tìm theo mã SK, tiêu đề, tác giả..."
                aria-label="Tìm trong hàng đợi xét duyệt"
              />
              {reviewSearch && (
                <button
                  type="button"
                  className="fi-search-clear-btn"
                  aria-label="Xóa từ khóa tìm kiếm"
                  onClick={() => setReviewSearch("")}
                >
                  <X size={13} />
                </button>
              )}
            </label>
            <div className="fi-review-team-chips" role="group" aria-label="Lọc theo đội/tổ">
              <button
                type="button"
                className={reviewTeamFilter === "" ? "is-active" : ""}
                onClick={() => setReviewTeamFilter("")}
              >
                Tất cả đội
                <span>{reviewQueueByStatus.length}</span>
              </button>
              {reviewTeamOptions.map((teamKey) => (
                <button
                  key={teamKey}
                  type="button"
                  className={reviewTeamFilter === teamKey ? "is-active" : ""}
                  onClick={() => setReviewTeamFilter(reviewTeamFilter === teamKey ? "" : teamKey)}
                >
                  {displayTeam(teamKey)}
                  <span>{reviewTeamCounts[teamKey] ?? 0}</span>
                </button>
              ))}
            </div>
            {reviewMonthOptions.length > 0 && (
              <label className="fi-review-month-select">
                <CalendarDays size={14} aria-hidden="true" />
                <select
                  aria-label="Lọc theo tháng đăng ký"
                  value={reviewMonthFilter}
                  onChange={(event) => setReviewMonthFilter(event.target.value)}
                >
                  <option value="">Mọi tháng ĐK</option>
                  {reviewMonthOptions.map((ym) => {
                    const [yr, mo] = ym.split("-");
                    return <option key={ym} value={ym}>T{Number(mo)}/{yr}</option>;
                  })}
                </select>
              </label>
            )}
            {(reviewSearch || reviewTeamFilter || reviewMonthFilter) && (
              <button
                type="button"
                className="fi-review-clear-filters"
                onClick={() => {
                  setReviewSearch("");
                  setReviewTeamFilter("");
                  setReviewMonthFilter("");
                }}
              >
                <X size={13} />
                Xóa lọc ({reviewQueue.length}/{reviewQueueByStatus.length})
              </button>
            )}
          </div>
          {error && <p className="error" role="alert" tabIndex={-1}>{error}</p>}
          {legacyPendingCount > 0 ? (
            <div className="warning-inline fi-legacy-pending-note" role="note">
              <span>
                Còn {legacyPendingCount} SK nhập từ dữ liệu cũ đang chờ xét duyệt. Các hồ sơ này được xử lý ở tab Lịch sử FI
                (bật Chỉnh sửa để đánh giá).
              </span>
              <button className="link-button" onClick={() => void selectTab("history")} type="button">Mở Lịch sử FI</button>
            </div>
          ) : null}
          <div className="list">
            {reviewQueue.map((item) => {
              const actions = visibleActionsForSk(role, currentUserId, item, editMode, currentTeam);
              const alreadyReviewed = REVIEWED_STATUSES.includes(item.status);
              const isReviewOpen = actionTarget?.id === item.id;
              return (
                <div
                  className={`workflow-item fi-review-item ${selectedItem?.id === item.id ? "active-row" : ""} ${isReviewOpen ? "review-open" : ""}`}
                  key={item.id}
                >
                  <button className="workflow-main fi-review-main" onClick={() => openItem(item.id)} type="button">
                    <span className="fi-review-code">{item.sk_code}</span>
                    <strong className="fi-review-title">{item.title}</strong>
                    <span className="fi-review-meta">
                      <UserRound size={14} />
                      Tác giả: {item.author_name} · Người đăng ký: {displaySubmitter(item)} · {displayTeam(item.team)}
                    </span>
                    <span className="fi-review-state-line">
                      <span className={`fi-status-pill ${statusTone(item.status)}`}>
                        {displayStatus(item.status)}
                      </span>
                      {item.submitted_at && (
                        <span className="fi-review-submitted">
                          đăng ký ngày {new Date(item.submitted_at).toLocaleDateString("vi-VN")}
                        </span>
                      )}
                      {isKhmtConsidered(item) && <span className="fi-review-khmt">{khmtLabel(item)}</span>}
                    </span>
                  </button>
                  <div className="toolbar fi-review-toolbar">
                    {actions.includes("reviewDecision") && (
                      <button
                        className="fi-review-command"
                        title={alreadyReviewed ? "Sửa lại đánh giá của bạn" : "Đánh giá SK"}
                        onClick={() => openReviewDecision(item)}
                        type="button"
                      >
                        <ClipboardCheck size={16} />
                        <span>{alreadyReviewed ? "Sửa đánh giá" : "Đánh giá"}</span>
                      </button>
                    )}
                    {actions.includes("assignKhmt") && (
                      <button title="Ghi nhận vào KHMT" onClick={() => openKhmtAssign(item)} type="button">
                        <CalendarDays size={16} />
                      </button>
                    )}
                    {actions.includes("delete") && (
                      <button
                        aria-label={`Xóa ${item.sk_code || item.title}`}
                        className="danger-button"
                        title="Xóa SK"
                        onClick={() => handleDelete(item)}
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  {selectedItem?.id !== item.id && renderReviewDecisionPanel(item)}
                </div>
              );
            })}
            {reviewQueue.length === 0 &&
              renderEmptyState(
                reviewSearch || reviewTeamFilter || reviewMonthFilter
                  ? "Không có SK nào khớp bộ lọc đang chọn."
                  : reviewFilter === "pending"
                  ? "Không có SK nào đang chờ xét duyệt."
                  : reviewFilter === "reviewed"
                  ? "Chưa có SK nào được đánh giá."
                  : "Hàng đợi đang trống."
              )
            }
          </div>
        </section>
      )}

      {activeTab !== "history" && selectedItem && (
        <FiDetailDrawer
          item={selectedItem}
          statusLabel={displayStatus(selectedItem.status)}
          statusToneClass={statusTone(selectedItem.status)}
          submitterLabel={displaySubmitter(selectedItem)}
          registrationLabel={registrationMonthLabel(selectedItem)}
          khmtText={khmtLabel(selectedItem)}
          canSelectKhmt={
            (role !== ADMIN_ROLE || editMode) &&
            canSelectKhmtMonth(role, currentUserId, selectedItem, currentTeam)
          }
          khmtBusy={assigningKhmt}
          khmtMatrix={dashboard?.khmt_matrix ?? null}
          actions={selectedActions}
          isPlanOnly={isPlanOnlyEdit(selectedItem)}
          editTitle={editActionTitle(selectedItem)}
          canUploadImages={canUploadForSelected}
          uploadingImages={uploadingImages}
          images={selectedImages}
          historyEntries={selectedHistory}
          completionBand={
            <FiExecutionBand
              item={selectedItem}
              canUpdate={canUpdateExecution(role, currentUserId, currentTeam, selectedItem, editMode)}
              confirmingAutoDone={confirmingAutoDoneId === selectedItem.id}
              onUpdate={() => openExecutionModal(selectedItem)}
              onQuickConfirm={() => void handleQuickConfirmAutoDone(selectedItem)}
              onQuickExtend={() => openExecutionModal(selectedItem, "in_progress")}
              hint={executionBlockedHint(role, currentUserId, currentTeam, selectedItem, editMode)}
              actorName={displayUser}
            />
          }
          reviewPanel={renderReviewDecisionPanel(selectedItem)}
          renderImageCard={(img, index) => {
            const allowDeleteImg = canDeleteSkImage(role, currentUserId, currentTeam, selectedItem, img, editMode);
            return (
              <div className="image-card" key={img.id}>
                <AuthenticatedSkImage
                  skId={selectedItem.id}
                  image={img}
                  onOpen={() => setImagePreviewIndex(index)}
                />
                <small title={img.file_name}>{img.file_name}</small>
                {allowDeleteImg && (
                  <button
                    aria-label={`Xóa ảnh ${img.file_name}`}
                    className="image-card-delete"
                    title="Xóa ảnh"
                    onClick={() => handleDeleteImage(selectedItem.id, img.id)}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          }}
          historyActionLabel={historyActionLabel}
          actorLabel={displayUser}
          historyDetail={historyDetail}
          formatHistoryTime={formatHistoryTime}
          onClose={() => {
            setSelectedItem(null);
            if (actionTarget?.id === selectedItem.id) setActionTarget(null);
          }}
          onEdit={() => openEdit(selectedItem)}
          onDelete={() => handleDelete(selectedItem)}
          onReview={() => openReviewDecision(selectedItem)}
          onTriggerImageUpload={() => detailFileInputRef.current?.click()}
          onAssignKhmt={handleAssignKhmtDirect}
          onClearKhmt={handleClearKhmtDirect}
          suspended={imagePreviewIndex !== null || Boolean(editTarget) || Boolean(planTarget) || Boolean(khmtTarget)}
        />
      )}

      {activeTab === "dashboard" && (
        <>
          <FiDashboardView
            dashboard={dashboard}
            loading={dashboardLoading}
            error={error}
            selectedYear={dashboardYear}
            role={role}
            currentTeam={currentTeam}
            activeSelection={matrixDrawer}
            exportingExcel={exportingHistoryExcel}
            canReview={canReview}
            onYearChange={(year) => setDashboardYear(year)}
            onReload={() => reload(dashboardYear)}
            onExportExcel={(year) => exportDashboardExcel(year)}
            onSelectMatrix={(selection) => setMatrixDrawer(selection)}
            onJumpToHistory={(filters) => void jumpToHistoryWithFilters(filters)}
            onJumpToReview={canReview ? () => void jumpToReviewForTeam() : undefined}
          />
          <FiMatrixCellDrawer
            selection={matrixDrawer}
            role={role}
            currentUserId={currentUserId}
            currentTeam={currentTeam}
            editMode={editMode}
            khmtMatrix={dashboard?.khmt_matrix ?? null}
            suspended={Boolean(selectedItem) || Boolean(planTarget)}
            refreshNonce={matrixRefreshNonce}
            onClose={() => setMatrixDrawer(null)}
            onOpenDetail={(item) => showItemDetail(item.id)}
            onUpdateExecution={(item) => openExecutionModal(item)}
            onOpenInHistory={(filters) => void jumpToHistoryWithFilters(filters)}
            onOpenReviewForTeam={canReview ? (team) => void jumpToReviewForTeam(team) : undefined}
            onDataChanged={() => reload(dashboardYear)}
          />
        </>
      )}

      {activeTab === "history" && (
      <section className="panel wide legacy-sk-panel fi-history-panel" ref={historyPanelRef}>
        <div className="legacy-sticky-controls fi-history-controls">
          <button
            type="button"
            className="fi-history-filter-toggle"
            aria-expanded={historyFiltersOpen}
            aria-controls="fi-history-toolbar"
            onClick={() => setHistoryFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={15} />
            <span>Bộ lọc{historyActiveFilterCount > 0 ? ` (${historyActiveFilterCount})` : ""}</span>
            <small>{historyMeta?.total ?? historyItems.length} SK-CTKT</small>
            <ChevronDown size={15} className="fi-history-filter-toggle-icon" />
          </button>
          <div
            id="fi-history-toolbar"
            className={`fi-history-toolbar ${historyFiltersOpen ? "" : "is-collapsed"}`}
            role="group"
            aria-label="Bộ lọc lịch sử FI"
          >
            <div className="fi-history-toolbar-main">
              <label className={`fi-history-search ${historyQuery ? "is-active" : ""}`}>
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Tìm kiếm mã SK, tên sáng kiến, nội dung, tác giả"
                  placeholder="Tìm mã SK, tên, nội dung, tác giả..."
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                />
                {historyQuery && (
                  <button
                    type="button"
                    className="fi-search-clear-btn"
                    aria-label="Xóa từ khóa tìm kiếm"
                    onClick={() => setHistoryQuery("")}
                  >
                    <X size={13} />
                  </button>
                )}
              </label>
              <label className={`fi-history-select-chip ${historyYear ? "is-active" : ""}`}>
                <CalendarDays size={14} aria-hidden="true" />
                <span>Năm</span>
                <select aria-label="Năm đăng ký" value={historyYear} onChange={(event) => setHistoryYear(event.target.value)}>
                  <option value="">Tất cả</option>
                  {Array.from({ length: new Date().getFullYear() - 2019 }, (_, index) => new Date().getFullYear() - index).map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>
              <div className="fi-history-toolbar-tail">
                {historyActiveFilterCount > 0 && (
                  <button
                    type="button"
                    className="fi-history-filter-reset"
                    onClick={resetHistoryFilters}
                    title="Xóa toàn bộ bộ lọc"
                  >
                    <X size={13} />
                    Xóa lọc
                    <span className="fi-history-filter-reset-count">{historyActiveFilterCount}</span>
                  </button>
                )}
                <span className="fi-history-toolbar-count" aria-live="polite">
                  {historyActiveFilterCount > 0 ? (
                    <>
                      Hiển thị <strong>{filteredHistoryItems.length}</strong>/{historyMeta?.total ?? historyItems.length}
                    </>
                  ) : (
                    <>
                      <strong>{historyMeta?.total ?? historyItems.length}</strong> SK-CTKT
                    </>
                  )}
                </span>
                <button
                  aria-label="Xuất Excel theo bộ lọc hiện tại"
                  className="fi-history-reload fi-history-export-btn"
                  disabled={exportingHistoryExcel || filteredHistoryItems.length === 0}
                  onClick={exportHistoryExcel}
                  title={filteredHistoryItems.length === 0 ? "Không có dữ liệu để xuất" : "Xuất Excel theo bộ lọc hiện tại"}
                  type="button"
                >
                  <FileDown size={15} />
                  <span>{exportingHistoryExcel ? "Đang xuất..." : "Xuất Excel"}</span>
                </button>
                <button
                  aria-label="Tải lại lịch sử FI"
                  className="fi-history-reload"
                  disabled={dashboardLoading}
                  onClick={() => reload()}
                  title="Tải lại lịch sử FI"
                  type="button"
                >
                  <RefreshCw size={16} className={dashboardLoading ? "icon-spin" : undefined} />
                </button>
              </div>
            </div>

            <div className="fi-history-toolbar-filters">
              <button
                type="button"
                className={`fi-history-quick-chip ${isMyTeamInProgressActive ? "is-active" : ""}`}
                aria-pressed={isMyTeamInProgressActive}
                onClick={toggleMyTeamInProgress}
                title={
                  ownTeamCode
                    ? `Lọc nhanh SK đã đồng ý đang triển khai của đội ${displayTeam(ownTeamCode)}`
                    : "Lọc nhanh toàn bộ SK đã đồng ý chưa hoàn thành"
                }
              >
                <Clock3 size={13} />
                {ownTeamCode ? `Đang thực hiện đội ${displayTeam(ownTeamCode)}` : "SK duyệt chưa xong"}
              </button>
              <FilterChip<string>
                label="Đội/tổ"
                icon={<Users2 size={14} />}
                options={historyTeamOptions.map((team) => ({
                  value: team,
                  label: displayTeam(team),
                  count: historyTeamCounts[team] ?? 0,
                }))}
                selected={historyTeams}
                onChange={selectHistoryTeams}
                emptyLabel="Tất cả"
              />
              <FilterChip<number>
                label="Tháng ĐK"
                icon={<CalendarDays size={14} />}
                options={historyMonthOptions.map(([month, count]) => ({
                  value: month,
                  label: `T${month}`,
                  count,
                }))}
                selected={historyMonths}
                onChange={changeHistoryMonths}
                emptyLabel="Tất cả"
              />
              <FilterChip<HistoryKhmtFilter>
                label="KHMT"
                icon={<Flag size={14} />}
                options={historyKhmtFilterOptions.map((option) => ({
                  ...option,
                  count: historyKhmtCounts[option.value],
                }))}
                selected={historyKhmt}
                onChange={changeHistoryKhmt}
                emptyLabel="Tất cả"
                summary={historyKhmtChipSummary}
                footer={(
                  <div className="fi-filter-subsection">
                    <div className="fi-filter-subsection-head">
                      <span>
                        Kỳ vào KHMT
                        {historyKhmtScopeLabel && <em className="fi-filter-scope-tag">{historyKhmtScopeLabel}</em>}
                      </span>
                      {historyKhmtPeriods.length > 0 && (
                        <button type="button" onClick={() => changeHistoryKhmtPeriods([])}>Bỏ chọn kỳ</button>
                      )}
                    </div>
                    {historyKhmtPeriodsByYear.length > 0 ? (
                      <div className="fi-filter-period-groups">
                        {historyKhmtPeriodsByYear.map((group) => (
                          <div key={group.year} className="fi-filter-period-year-group">
                            <div className="fi-filter-period-year-label">Năm {group.year}</div>
                            <div className="fi-filter-month-grid" role="group" aria-label={`Kỳ vào KHMT năm ${group.year}`}>
                              {group.items.map(([period, { month, year, count }]) => {
                                const checked = historyKhmtPeriods.includes(period);
                                return (
                                  <button
                                    type="button"
                                    className={[checked ? "checked" : "", count === 0 ? "is-empty" : ""].filter(Boolean).join(" ")}
                                    aria-pressed={checked}
                                    key={period}
                                    title={`KHMT T${month}/${year}: ${count} SK`}
                                    onClick={() => changeHistoryKhmtPeriods(
                                      checked
                                        ? historyKhmtPeriods.filter((value) => value !== period)
                                        : [...historyKhmtPeriods, period],
                                    )}
                                  >
                                    <span>{`T${month}`}</span>
                                    <small>{count}</small>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="fi-filter-subsection-empty">Chưa có kỳ KHMT phù hợp bộ lọc.</p>
                    )}
                  </div>
                )}
              />
              <FilterChip<HistoryDecisionFilter>
                label="Kết luận"
                icon={<ClipboardCheck size={14} />}
                options={historyDecisionFilterOptions.map((option) => ({
                  ...option,
                  count: historyDecisionCounts[option.value],
                }))}
                selected={historyDecisions}
                onChange={changeHistoryDecisions}
                emptyLabel="Tất cả"
              />
              <FilterChip<HistoryCompletionFilter>
                label="Hoàn thành"
                icon={<CheckCircle2 size={14} />}
                align="right"
                options={historyCompletionFilterOptions.map((option) => ({
                  ...option,
                  count: historyCompletionCounts[option.value],
                }))}
                selected={historyCompletion}
                onChange={changeHistoryCompletion}
                emptyLabel="Tất cả"
              />
              <PersonFilterCombobox
                label="Tác giả"
                icon={<UserRound size={14} />}
                align="right"
                options={historyAuthorOptions}
                selected={historyAuthors}
                onChange={changeHistoryAuthors}
              />
              <PersonFilterCombobox
                label="Người ĐK"
                icon={<Users2 size={14} />}
                align="right"
                options={historySubmitterOptions}
                selected={historySubmitters}
                onChange={changeHistorySubmitters}
              />
            </div>
          </div>
          {historyTeamSummary && (() => {
            // Use disjunctive decision facet counts so selecting one decision card
            // does not zero out the other 3 decision cards.
            const facetDecisions = historyMeta?.facets?.decisions;
            const passed = facetDecisions?.approved ?? reviewPassedCount(historyTeamSummary);
            const failed = facetDecisions?.rejected ?? reviewFailedCount(historyTeamSummary);
            const deferred = facetDecisions?.deferred ?? (historyTeamSummary.deferred ?? 0);
            const pending = facetDecisions?.pending ?? (historyTeamSummary.pending ?? 0);
            const khmtConsidered = historyTeamSummary.khmt_considered ?? 0;
            const unassignedApproved = khmtUnassignedApprovedCount(historyTeamSummary);
            const hasApprovedExec = historyTeamSummary.approved_completed_count !== undefined;
            const approvedInScope = reviewPassedCount(historyTeamSummary);
            const completed = hasApprovedExec
              ? Number(historyTeamSummary.approved_completed_count ?? 0)
              : Number(historyTeamSummary.completed_count ?? historyTeamSummary.completed ?? 0);
            const notCompleted = hasApprovedExec
              ? Number(historyTeamSummary.approved_in_progress_count ?? 0) + Number(historyTeamSummary.approved_paused_count ?? 0)
              : Number(historyTeamSummary.not_completed ?? 0);
            const totalForRate = historyTeamSummary.total ?? 0;
            const totalAllDecisions = facetDecisions
              ? passed + failed + deferred + pending
              : totalForRate;
            return (
              <div className={`fi-history-summary ${historyFiltersOpen ? "" : "is-collapsed"}`} role="group" aria-label="Tóm tắt — nhấn để lọc nhanh">
                <button
                  type="button"
                  className={`fi-history-stat tone-total is-quickfilter ${historyActiveFilterCount === 0 ? "is-active" : ""}`}
                  onClick={resetHistoryFilters}
                  aria-pressed={historyActiveFilterCount === 0}
                  title="Hiển thị tất cả SK-CTKT"
                >
                  <span>Tổng SK</span>
                  <strong>{formatCount(totalForRate)}</strong>
                  <small>{formatCount(passed)} đồng ý · {formatCount(pending)} chờ duyệt</small>
                </button>
                <button
                  type="button"
                  className={`fi-history-stat tone-success is-quickfilter ${isOnlyHistoryDecision("approved") ? "is-active" : ""} ${passed === 0 && !isOnlyHistoryDecision("approved") ? "is-zero" : ""}`}
                  onClick={() => toggleHistoryDecision("approved")}
                  aria-pressed={isOnlyHistoryDecision("approved")}
                  title="Lọc các SK đã xét đồng ý"
                >
                  <span>Đã xét đồng ý</span>
                  <strong>{formatCount(passed)}</strong>
                  <small>{percent(passed, totalAllDecisions)}%</small>
                </button>
                <button
                  type="button"
                  className={`fi-history-stat tone-danger is-quickfilter ${isOnlyHistoryDecision("rejected") ? "is-active" : ""} ${failed === 0 && !isOnlyHistoryDecision("rejected") ? "is-zero" : ""}`}
                  onClick={() => toggleHistoryDecision("rejected")}
                  aria-pressed={isOnlyHistoryDecision("rejected")}
                  title="Lọc các SK đã xét không đồng ý"
                >
                  <span>Không đồng ý</span>
                  <strong>{formatCount(failed)}</strong>
                </button>
                <button
                  type="button"
                  className={`fi-history-stat tone-warning is-quickfilter ${isOnlyHistoryDecision("deferred") ? "is-active" : ""} ${deferred === 0 && !isOnlyHistoryDecision("deferred") ? "is-zero" : ""}`}
                  onClick={() => toggleHistoryDecision("deferred")}
                  aria-pressed={isOnlyHistoryDecision("deferred")}
                  title="Lọc các SK xem xét sau"
                >
                  <span>Xem xét sau</span>
                  <strong>{formatCount(deferred)}</strong>
                </button>
                <button
                  type="button"
                  className={`fi-history-stat tone-neutral is-quickfilter ${isOnlyHistoryDecision("pending") ? "is-active" : ""} ${pending === 0 && !isOnlyHistoryDecision("pending") ? "is-zero" : ""}`}
                  onClick={() => toggleHistoryDecision("pending")}
                  aria-pressed={isOnlyHistoryDecision("pending")}
                  title="Lọc các SK chưa duyệt"
                >
                  <span>Chưa duyệt</span>
                  <strong>{formatCount(pending)}</strong>
                </button>
                <button
                  type="button"
                  className={`fi-history-stat tone-info is-quickfilter ${isOnlyHistoryKhmt("in") ? "is-active" : ""} ${khmtConsidered === 0 && !isOnlyHistoryKhmt("in") ? "is-zero" : ""}`}
                  onClick={() => toggleHistoryKhmt("in")}
                  aria-pressed={isOnlyHistoryKhmt("in")}
                  title="Lọc các SK đã vào KHMT"
                >
                  <span>Đã vào KHMT</span>
                  <strong>{formatCount(khmtConsidered)}</strong>
                  <small>{formatCount(unassignedApproved)} SK đạt chưa vào</small>
                </button>
                <button
                  type="button"
                  className={`fi-history-stat tone-completion is-quickfilter ${isOnlyHistoryCompletion("done") ? "is-active" : ""} ${completed === 0 && !isOnlyHistoryCompletion("done") ? "is-zero" : ""}`}
                  onClick={() => toggleHistoryCompletion("done")}
                  aria-pressed={isOnlyHistoryCompletion("done")}
                  title="Lọc các SK đã hoàn thành"
                >
                  <span>Hoàn thành</span>
                  <strong>
                    {hasApprovedExec ? `${formatCount(completed)}/${formatCount(approvedInScope)}` : formatCount(completed)}
                  </strong>
                  <small>{formatCount(notCompleted)} chưa xong</small>
                </button>
              </div>
            );
          })()}
        </div>
        <div className="legacy-list">
          {groupedHistoryItems.map((group) => (
            <div
              className={`legacy-month-group ${group.month ? `month-tone-${group.month}` : "month-tone-unknown"}`}
              key={group.key}
            >
              <div className="legacy-month-sticky-head">
                <div className="legacy-month-heading">
                  <div className="legacy-month-title">
                    <span className="legacy-month-badge">{group.month ? `T${group.month}` : "?"}</span>
                    <div>
                      <h3>{group.month ? `T${group.month}/${group.year}` : "Chưa rõ tháng"}</h3>
                      <small>Tháng đăng ký</small>
                    </div>
                  </div>
                  <span className="legacy-month-count">{group.items.length} SK-CTKT</span>
                </div>
                <div className="legacy-row-column-labels" aria-hidden="true">
                  <span />
                  <div className="legacy-row-column-label-side">
                    <span className="tone-period">Thời gian ĐK</span>
                    <span className="tone-decision">Kết luận xét duyệt</span>
                    <span className="tone-khmt">KHMT</span>
                    <span />
                  </div>
                </div>
              </div>
              {group.items.map((item) => {
                const isOpen = selectedItem?.id === item.id;
                const actions = visibleActionsForSk(role, currentUserId, item, editMode, currentTeam);
                const detail: any = isOpen ? (selectedItem ?? item) : item;
                const detailImages = Array.isArray(detail.supporting_images) ? detail.supporting_images : [];
                const isHistorical = Boolean(detail.is_historical_import);
                return (
                <div className="legacy-record" key={item.id}>
                  <div className={`legacy-row ${isOpen ? "active-row" : ""}`}>
                    <button
                      aria-expanded={isOpen}
                      className="legacy-row-main legacy-row-toggle"
                      onClick={() => openHistoryItem(item)}
                      type="button"
                    >
                      <div className="legacy-row-head">
                        {item.sk_code && <span className="legacy-row-code">{item.sk_code}</span>}
                        {item.team && <span className="legacy-row-team">{displayTeam(item.team)}</span>}
                        <strong>{item.title}</strong>
                      </div>
                      <div className="legacy-row-subtitle">
                        <span>Tác giả: <strong>{item.author_name}</strong></span>
                        {displaySubmitter(item) !== item.author_name && (
                          <span>Đăng ký hộ: {displaySubmitter(item)}</span>
                        )}
                      </div>
                      <div className="legacy-row-meta">
                        <FiCompletionPill item={item} compact />
                        {isKhmtConsidered(item) && (
                          <small className="legacy-row-meta-khmt-mobile">{khmtLabel(item)}</small>
                        )}
                      </div>
                    </button>
                    <div className="legacy-row-side">
                      <span className="legacy-period-pill">{registrationMonthLabel(item)}</span>
                      {(() => {
                        const badge = historyDecisionBadge(item);
                        return <span className={`legacy-status-pill ${badge.tone}`}>{badge.label}</span>;
                      })()}
                      {renderKhmtControl(item)}
                      <div className="legacy-row-controls">
                        {EXECUTION_EDITABLE_STATUSES.includes(item.status) &&
                          canUpdateExecution(role, currentUserId, currentTeam, item, editMode) && (
                            <button
                              className="fi-drawer-exec-btn"
                              title="Cập nhật tình hình thực hiện"
                              onClick={() => openExecutionModal(item)}
                              type="button"
                            >
                              <CheckCircle2 size={14} />
                              <span>Tiến độ</span>
                            </button>
                          )}
                        {actions.includes("edit") && (
                          <button
                            aria-label={`Sửa ${item.sk_code || item.title}`}
                            className="legacy-icon-action"
                            title={editActionTitle(item)}
                            onClick={() => openEdit(item)}
                            type="button"
                          >
                            <Pencil size={15} />
                          </button>
                        )}
                        {actions.includes("reviewDecision") && (
                          <button
                            className="legacy-row-action legacy-review-action"
                            title="Đánh giá"
                            onClick={() => openReviewDecision(item)}
                            type="button"
                          >
                            <ClipboardCheck size={15} />
                            <span>Đánh giá</span>
                          </button>
                        )}
                        {actions.includes("delete") && (
                          <button
                            aria-label={`Xóa ${item.sk_code || item.title}`}
                            className="legacy-icon-action danger-button"
                            title="Xóa SK khỏi hệ thống"
                            onClick={() => handleDelete(item)}
                            type="button"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                        <button className="legacy-row-action" onClick={() => openHistoryItem(item)} type="button">
                          {isOpen ? "Thu gọn" : "Xem chi tiết"}
                        </button>
                      </div>
                    </div>
                  </div>
                  {renderReviewDecisionPanel(item)}
                  {isOpen && (
                    <div className="legacy-inline-detail">
                      <div className="detail-grid">
                        <div>
                          <span>Tác giả</span>
                          <strong>{detail.author_name}</strong>
                        </div>
                        <div>
                          <span>Người đăng ký</span>
                          <strong>{displaySubmitter(detail)}</strong>
                        </div>
                        <div>
                          <span>Trạng thái</span>
                          <strong>{displayHistoryStatus(detail)}</strong>
                        </div>
                        <div>
                          <span>Tháng đăng ký</span>
                          <strong>{registrationMonthLabel(detail)}</strong>
                        </div>
                        <div>
                          <span>Xét vào KHMT</span>
                          <strong>{khmtLabel(detail)}</strong>
                        </div>
                      </div>
                      <FiExecutionBand
                        item={detail}
                        canUpdate={canUpdateExecution(role, currentUserId, currentTeam, detail, editMode)}
                        confirmingAutoDone={confirmingAutoDoneId === detail.id}
                        onUpdate={() => openExecutionModal(detail)}
                        onQuickConfirm={() => void handleQuickConfirmAutoDone(detail)}
                        onQuickExtend={() => openExecutionModal(detail, "in_progress")}
                        hint={executionBlockedHint(role, currentUserId, currentTeam, detail, editMode)}
                        actorName={displayUser}
                      />
                      <div className="legacy-expanded-content">
                        <section>
                          <span>Nội dung đăng ký</span>
                          <p>{detail.content_description || "Chưa có mô tả nội dung."}</p>
                        </section>
                        {(detail.fi_coordinator_comments || detail.bm01_raw_conclusion) && (
                          <section className="legacy-review-note">
                            <span>Xét duyệt</span>
                            <p>{detail.fi_coordinator_comments || detail.bm01_raw_conclusion}</p>
                          </section>
                        )}
                        {detail.workshop_leader_conclusion && (
                          <section>
                            <span>Kết luận LĐX (dữ liệu cũ)</span>
                            <p>{detail.workshop_leader_conclusion}</p>
                          </section>
                        )}
                        {detail.decision_note && (
                          <section className="legacy-review-note">
                            <span>Ghi chú đánh giá</span>
                            <p>{detail.decision_note}</p>
                          </section>
                        )}
                        {planUpdateHistory(detail).length > 0 && (
                          <section className="legacy-plan-history">
                            <span>Lịch sử cập nhật tình hình thực hiện</span>
                            <ul>
                              {planUpdateHistory(detail).map((history: any, index: number) => (
                                <li key={`${history.changed_at}-${index}`}>
                                  <time>{formatHistoryTime(history.changed_at)}</time>
                                  {" · "}
                                  {displayUser(history.changed_by)}
                                  {": "}
                                  {historyDetail(history)?.text}
                                </li>
                              ))}
                            </ul>
                          </section>
                        )}
                      </div>
                      {(() => {
                        const isApprovedItem = EXECUTION_EDITABLE_STATUSES.includes(detail.status);
                        const canUploadHere = canUploadImages(role, currentUserId, detail, editMode, currentTeam);
                        const staged = splitImagesByStage(detailImages);
                        const idxById = new Map<string, number>();
                        detailImages.forEach((img: any, idx: number) => idxById.set(String(img.id), idx));
                        const renderThumb = (img: any) => {
                          const canDel = canDeleteSkImage(role, currentUserId, currentTeam, detail, img, editMode);
                          return (
                            <div key={img.id} className="legacy-evidence-thumb image-card" title={img.file_name}>
                              <AuthenticatedSkImage
                                skId={detail.id}
                                image={img}
                                onOpen={() => {
                                  setSelectedItem(detail);
                                  setImagePreviewIndex(idxById.get(String(img.id)) ?? 0);
                                }}
                              />
                              {canDel && (
                                <button
                                  aria-label={`Xóa ảnh ${img.file_name}`}
                                  className="image-card-delete"
                                  title="Xóa ảnh"
                                  onClick={() => handleDeleteImage(detail.id, img.id)}
                                  type="button"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          );
                        };

                        return (
                          <div className="legacy-evidence">
                            <div className="legacy-evidence-head">
                              <span className="legacy-evidence-title">
                                <ImageIcon size={15} />
                                Ảnh bằng chứng
                                {detailImages.length > 0 && <em>({detailImages.length})</em>}
                              </span>
                              {!isApprovedItem && isHistorical && detailImages.length === 0 && (
                                <small className="muted"><Info size={13} /> Chưa có ảnh minh chứng.</small>
                              )}
                            </div>
                            {isApprovedItem ? (
                              <div className="fi-evidence-stages">
                                {staged.registration.length > 0 && (
                                  <div className="fi-evidence-stage-group">
                                    <div className="fi-evidence-stage-head">
                                      <span className="fi-evidence-stage-title">
                                        Ảnh đăng ký <em>({staged.registration.length})</em>
                                      </span>
                                    </div>
                                    <div className="legacy-evidence-grid">
                                      {staged.registration.map(renderThumb)}
                                    </div>
                                  </div>
                                )}
                                <div className="fi-evidence-stage-group is-completion">
                                  <div className="fi-evidence-stage-head">
                                    <span className="fi-evidence-stage-title">
                                      Ảnh hoàn thành <em>({staged.completion.length})</em>
                                    </span>
                                    {canUploadHere && (
                                      <button
                                        type="button"
                                        className="fi-evidence-upload-btn"
                                        disabled={uploadingImages}
                                        onClick={() => {
                                          setSelectedItem(detail);
                                          detailFileInputRef.current?.click();
                                        }}
                                      >
                                        <ImagePlus size={14} />
                                        {uploadingImages ? "Đang tải..." : "Thêm ảnh hoàn thành"}
                                      </button>
                                    )}
                                  </div>
                                  {staged.completion.length > 0 ? (
                                    <div className="legacy-evidence-grid">
                                      {staged.completion.map(renderThumb)}
                                    </div>
                                  ) : (
                                    <div className="legacy-evidence-empty">
                                      <ImageIcon size={18} />
                                      <span>Chưa có ảnh bằng chứng hoàn thành cho SK này.</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : detailImages.length > 0 ? (
                              <div className="legacy-evidence-grid">
                                {detailImages.map(renderThumb)}
                              </div>
                            ) : (
                              !isHistorical && (
                                <div className="legacy-evidence-empty">
                                  <ImageIcon size={20} />
                                  <span>Chưa có ảnh bằng chứng cho SK này.</span>
                                </div>
                              )
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          ))}
          {!dashboardLoading && !error && historyItems.length === 0 && <div role="status">
            {renderEmptyState(historyActiveFilterCount > 0 ? `Không có kết quả phù hợp với ${historyActiveFilterCount} bộ lọc đang áp dụng.` : "Chưa có FI nào.")}
            {historyActiveFilterCount > 0 && <button type="button" onClick={resetHistoryFilters}>Xóa bộ lọc</button>}
          </div>}
        </div>
        {historyMeta && historyMeta.total > 0 && (
          <div className="fi-history-footer" role="navigation" aria-label="Phân trang lịch sử FI">
            <span className="fi-history-range">
              Hiển thị <strong>{(historyMeta.page - 1) * historyPageSize + 1}–{Math.min(historyMeta.page * historyPageSize, historyMeta.total)}</strong>
              {" "}/ {historyMeta.total} SK-CTKT
            </span>
            <label className="fi-history-page-size">
              <span>Số dòng mỗi trang</span>
              <select
                value={historyPageSize}
                onChange={(event) => {
                  setHistoryPageSize(Number(event.target.value) as 25 | 50);
                  goToHistoryPage(1);
                }}
                aria-label="Số dòng lịch sử FI mỗi trang"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
            {historyMeta.total_pages > 1 && (
              <div className="fi-history-pager">
                <button
                  type="button"
                  className="fi-history-reload"
                  disabled={historyPage <= 1 || dashboardLoading}
                  onClick={() => goToHistoryPage(Math.max(1, historyPage - 1))}
                >
                  <ChevronLeft size={16} /> Trước
                </button>
                <span>Trang {historyMeta.page}/{historyMeta.total_pages}</span>
                <button
                  type="button"
                  className="fi-history-reload"
                  disabled={!historyMeta.has_next || dashboardLoading}
                  onClick={() => goToHistoryPage(historyPage + 1)}
                >
                  Sau <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {planTarget && (
        <FiExecutionUpdateModal
          item={planTarget.item}
          initialStatus={planTarget.initialStatus}
          canUploadImages={canUploadCompletionImages(role, currentUserId, currentTeam, planTarget.item, editMode)}
          onClose={() => setPlanTarget(null)}
          onSaved={(updated, message) => {
            setPlanTarget(null);
            setSelectedItem((current: any) => (current?.id === updated.id ? { ...current, ...updated } : current));
            setNotice(message);
            reload();
            setMatrixRefreshNonce((n) => n + 1);
          }}
        />
      )}

      {/* Global image viewer — works from both Register and History tabs */}
      {imagePreviewIndex !== null && selectedItem && selectedImages[imagePreviewIndex] && (
        <SkImageViewer
          canDelete={canDeleteSkImage(
            role,
            currentUserId,
            currentTeam,
            selectedItem,
            selectedImages[imagePreviewIndex],
            editMode,
          )}
          images={selectedImages}
          index={imagePreviewIndex}
          onClose={() => setImagePreviewIndex(null)}
          onDelete={(imageId) => handleDeleteImage(selectedItem.id, imageId)}
          onIndexChange={setImagePreviewIndex}
          skId={selectedItem.id}
        />
      )}
    </div>
  );
}
