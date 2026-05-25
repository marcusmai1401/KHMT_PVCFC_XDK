import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Flag,
  History,
  Image as ImageIcon,
  ImagePlus,
  Info,
  ListChecks,
  PauseCircle,
  Pencil,
  PieChart,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Users2,
  UserRound,
  X,
} from "lucide-react";
import { api } from "../../api/client";

const TEAM_ROLE = "Team_Account";
const STAFF_ROLE = "Staff";
const FI_COORDINATOR_ROLE = "FI_Coordinator";
const ADMIN_ROLE = "Admin";
// FI_Coordinator (Phạm Thanh Quyền) cũng là tác giả cho team TBHTĐK,
// không chỉ là người xét duyệt.
const AUTHOR_ROLES = [TEAM_ROLE, STAFF_ROLE, FI_COORDINATOR_ROLE];
const FI_TEAMS = ["TBCH", "TBĐL", "TBHTĐK", "TCĐK"];
const REVIEWER_ROLES = [ADMIN_ROLE, FI_COORDINATOR_ROLE];
const REVIEW_DECISION_STATUSES = ["Submitted", "Reviewed", "Deferred", "Approved", "Rejected"];
const REVIEWED_STATUSES = ["Approved", "Rejected", "Deferred", "Reviewed"];
// Sau khi đã được gửi duyệt, tác giả vẫn được sửa nội dung (trừ Completed/Cancelled).
// Edit này sẽ kích hoạt noti SK_CONTENT_EDITED để FI/Admin xét duyệt lại.
const AUTHOR_EDITABLE_STATUSES = [
  "Draft",
  "NeedMoreInfo",
  "Submitted",
  "Reviewed",
  "Approved",
  "Rejected",
  "Deferred",
];
const KHMT_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const KHMT_ASSIGNABLE_STATUSES = ["Approved", "Completed"];

const statusLabels: Record<string, string> = {
  Draft: "Chưa gửi duyệt",
  Submitted: "Chờ xét duyệt",
  NeedMoreInfo: "Cần bổ sung",
  Reviewed: "Đã xem xét",
  Approved: "Đã phê duyệt",
  Rejected: "Từ chối",
  Deferred: "Xem xét sau",
  Cancelled: "Đã hủy",
  Completed: "Hoàn tất",
};

const importedStatusLabels: Record<string, string> = {
  Approved: "Đồng ý",
  Submitted: "Chờ xét duyệt",
  Rejected: "Không đồng ý",
  Deferred: "Xem xét sau",
  Completed: "Hoàn tất",
};

type FITab = "register" | "review" | "history" | "dashboard";
type ReviewQueueFilter = "pending" | "reviewed" | "all";
type HistoryMonthGroup = { key: string; month: number | null; year: number; items: any[] };
type ReviewDecision = "approve" | "defer" | "reject";

const reviewDecisionOptions: Array<{ value: ReviewDecision; label: string; helper: string }> = [
  { value: "approve", label: "Đồng ý", helper: "Ghi nhận SK đạt yêu cầu xét duyệt." },
  { value: "defer", label: "Xem xét sau", helper: "Giữ lại để đánh giá tiếp hoặc cần thêm cơ sở." },
  { value: "reject", label: "Không đồng ý", helper: "Không đưa SK vào luồng thực hiện." },
];

function displayStatus(value: string) {
  return statusLabels[value] ?? value;
}

function displayImportedStatus(value: string) {
  return importedStatusLabels[value] ?? displayStatus(value);
}

function displayHistoryStatus(item: any) {
  return item.is_historical_import ? displayImportedStatus(item.status) : displayStatus(item.status);
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
  return value === "defer" || value === "reject";
}

function parseCompletionPlan(value: string | null | undefined): { month: number; year: number } | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  // Hỗ trợ các dạng: "T6/2026", "06/2026", "6-2026", "T6 / 2026"
  const match = trimmed.match(/^T?\s*(\d{1,2})\s*[/-]\s*(\d{4})$/i);
  if (match) {
    const month = Number(match[1]);
    const year = Number(match[2]);
    if (month >= 1 && month <= 12 && year >= 2020 && year <= 2100) {
      return { month, year };
    }
  }
  return null;
}

function formatCompletionPlan(month: number, year: number): string {
  return `T${month}/${year}`;
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

function historyActionLabel(history: any) {
  if (!history.from_status && history.to_status === "Draft") return "Ghi nhận đăng ký";
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
    "historical-import": "Dữ liệu lịch sử",
  };
  return labels[actor] ?? actor;
}

function historyDetail(history: any) {
  const reason = typeof history.reason === "string" ? history.reason.trim() : "";
  const comments = typeof history.comments === "string" ? history.comments.trim() : "";
  const structuredComments = typeof history.comments === "object" && history.comments !== null ? history.comments : null;
  if (reason === "web_registration") {
    return { label: "Nguồn ghi nhận", text: "Đăng ký trên hệ thống" };
  }
  if (reason === "khmt_assignment" || reason === "khmt_legacy_note") {
    const month = structuredComments?.khmt_month;
    const year = structuredComments?.khmt_year;
    return { label: "KHMT", text: month && year ? `Đã xem xét vào KHMT T${month}/${year}` : "Đã xem xét vào KHMT" };
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

function khmtAssignmentYear(item: any) {
  const registration = registrationInfo(item);
  return Number(item?.khmt_year || registration.year || new Date().getFullYear());
}

export function canSelectKhmtMonth(role: string, currentUserId: string, item: any, currentTeam?: string | null) {
  if (!KHMT_ASSIGNABLE_STATUSES.includes(item?.status)) return false;
  if (role === "Admin") return true;
  if (role !== TEAM_ROLE) return false;
  const ownerTeam = currentTeam ?? currentUserId;
  return FI_TEAMS.includes(ownerTeam) && item?.team === ownerTeam;
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

export function visibleActionsForSk(role: string, currentUserId: string, item: any): string[] {
  const actions: string[] = [];
  const reviewableStatuses = REVIEW_DECISION_STATUSES;
  const isAuthor = AUTHOR_ROLES.includes(role);
  const isOwnAuthor = item.author_user_id === currentUserId;
  // Tác giả được sửa nội dung trong toàn bộ vòng đời của SK (kể cả sau khi
  // đã đánh giá) miễn là chưa hoàn tất/hủy và không phải dữ liệu legacy.
  // Sau khi sửa, FI/Admin sẽ nhận noti SK_CONTENT_EDITED để xét duyệt lại.
  const canEdit = isOwnAuthor && !item.is_historical_import && AUTHOR_EDITABLE_STATUSES.includes(item.status);
  const canSubmit =
    !item.is_historical_import &&
    (role === ADMIN_ROLE || (isAuthor && isOwnAuthor)) &&
    ["Draft", "NeedMoreInfo"].includes(item.status);
  // FI_Coordinator không được xét duyệt SK do chính mình đăng ký (xung đột lợi ích).
  const canReviewDecision =
    REVIEWER_ROLES.includes(role) &&
    reviewableStatuses.includes(item.status) &&
    !(role === FI_COORDINATOR_ROLE && item.author_user_id === currentUserId);
  const canAssign =
    !item.is_historical_import &&
    role === ADMIN_ROLE &&
    ["Approved", "Completed"].includes(item.status);
  const canDelete =
    !item.is_historical_import &&
    (role === ADMIN_ROLE || (isAuthor && isOwnAuthor && item.status === "Draft"));
  if (canEdit) actions.push("edit");
  if (canSubmit) actions.push("submit");
  if (canReviewDecision) actions.push("reviewDecision");
  if (canAssign) actions.push("assignKhmt");
  if (canDelete) actions.push("delete");
  return actions;
}

const isReviewerRole = (role: string) => REVIEWER_ROLES.includes(role);

function canUploadImages(role: string, currentUserId: string, item: any) {
  if (item.is_historical_import) return false;
  return (
    role === ADMIN_ROLE ||
    (AUTHOR_ROLES.includes(role) && item.author_user_id === currentUserId && ["Draft", "NeedMoreInfo"].includes(item.status))
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
          <strong>{image.file_name}</strong>
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
            <button title="Đóng" type="button" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="image-viewer-stage">
          {hasMultiple ? (
            <button className="image-viewer-nav" onClick={previous} title="Ảnh trước" type="button">
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
            <button className="image-viewer-nav" onClick={next} title="Ảnh sau" type="button">
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

type StatusSlice = { key: string; label: string; value: number; color: string; tone: string };
type TeamProgress = {
  team: string;
  total: number;
  approved: number;
  deferred: number;
  pending: number;
  rejected: number;
  khmt: number;
  khmtRate: number;
};
type MonthlyTrend = { key: string; label: string; count: number; year: number; month: number };

function buildStatusSlices(totals: Record<string, any>): StatusSlice[] {
  const approved = reviewPassedCount(totals);
  const completed = Number(totals.completed_count ?? totals.completed ?? 0);
  const pureApproved = Math.max(0, approved - completed);
  const deferred = Number(totals.deferred ?? 0);
  const pending = Number(totals.pending ?? 0);
  const rejected = reviewFailedCount(totals) + Number(totals.cancelled ?? 0);
  return [
    { key: "completed", label: "Hoàn tất", value: completed, color: "#16a34a", tone: "success" },
    { key: "approved", label: "Đã xét đạt", value: pureApproved, color: "#22c55e", tone: "approved" },
    { key: "pending", label: "Chờ xét duyệt", value: pending, color: "#2563eb", tone: "info" },
    { key: "deferred", label: "Xem xét sau", value: deferred, color: "#f59e0b", tone: "warning" },
    { key: "rejected", label: "Đã xét không đạt/Hủy", value: rejected, color: "#ef4444", tone: "danger" },
  ].filter((slice) => slice.value > 0);
}

function buildTeamProgress(teams: any[]): TeamProgress[] {
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

function buildMonthlyTrend(months: any[]): MonthlyTrend[] {
  return months
    .map((m) => ({
      key: `${m.year}-${m.month}`,
      label: `T${m.month}/${m.year}`,
      count: Number(m.count ?? 0),
      year: Number(m.year),
      month: Number(m.month),
    }))
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number, innerR: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function StatusDonutChart({ slices, total }: { slices: StatusSlice[]; total: number }) {
  const safeTotal = slices.reduce((sum, slice) => sum + slice.value, 0);
  let cumulative = 0;
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 78;
  const innerRadius = 50;
  if (safeTotal === 0) {
    return (
      <div className="fi-chart-empty">
        <PieChart size={28} />
        <span>Chưa có dữ liệu trạng thái</span>
      </div>
    );
  }
  return (
    <div className="fi-donut">
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height={size} role="img" aria-label="Phân bố trạng thái">
        {slices.length === 1 ? (
          <>
            <circle cx={cx} cy={cy} r={radius} fill={slices[0].color} />
            <circle cx={cx} cy={cy} r={innerRadius} fill="#ffffff" />
          </>
        ) : (
          slices.map((slice) => {
            const startAngle = (cumulative / safeTotal) * 360;
            cumulative += slice.value;
            const endAngle = (cumulative / safeTotal) * 360;
            return (
              <path
                key={slice.key}
                d={describeArc(cx, cy, radius, startAngle, endAngle, innerRadius)}
                fill={slice.color}
              >
                <title>{`${slice.label}: ${slice.value} (${Math.round((slice.value / safeTotal) * 100)}%)`}</title>
              </path>
            );
          })
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fi-donut-total">{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="fi-donut-label">SK-CTKT</text>
      </svg>
      <ul className="fi-donut-legend">
        {slices.map((slice) => (
          <li key={slice.key}>
            <span className="fi-donut-swatch" style={{ background: slice.color }} aria-hidden="true" />
            <span className="fi-donut-name">{slice.label}</span>
            <strong>{slice.value}</strong>
            <small>{safeTotal ? Math.round((slice.value / safeTotal) * 100) : 0}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TeamProgressBars({ teams }: { teams: TeamProgress[] }) {
  if (teams.length === 0) {
    return (
      <div className="fi-chart-empty">
        <Users2 size={28} />
        <span>Chưa có dữ liệu đội/tổ</span>
      </div>
    );
  }
  const maxTotal = Math.max(1, ...teams.map((team) => team.total));
  return (
    <div className="fi-team-bars">
      {teams.map((team) => {
        const widthPct = (team.total / maxTotal) * 100;
        const approvedPct = team.total ? (team.approved / team.total) * 100 : 0;
        const deferredPct = team.total ? (team.deferred / team.total) * 100 : 0;
        const pendingPct = team.total ? (team.pending / team.total) * 100 : 0;
        const rejectedPct = team.total ? (team.rejected / team.total) * 100 : 0;
        return (
          <div className="fi-team-row" key={team.team}>
            <div className="fi-team-meta">
              <strong>{team.team}</strong>
              <small>{team.total} SK · KHMT {team.khmt} ({team.khmtRate}%)</small>
            </div>
            <div className="fi-team-track" title={`Tổng ${team.total} SK`}>
              <div className="fi-team-fill" style={{ width: `${widthPct}%` }}>
                {team.approved > 0 && (
                  <span
                    className="fi-team-seg approved"
                    style={{ width: `${approvedPct}%` }}
                    title={`Đã xét đạt: ${team.approved}`}
                  />
                )}
                {team.deferred > 0 && (
                  <span
                    className="fi-team-seg deferred"
                    style={{ width: `${deferredPct}%` }}
                    title={`Xem xét sau: ${team.deferred}`}
                  />
                )}
                {team.pending > 0 && (
                  <span
                    className="fi-team-seg pending"
                    style={{ width: `${pendingPct}%` }}
                    title={`Chờ xét duyệt: ${team.pending}`}
                  />
                )}
                {team.rejected > 0 && (
                  <span
                    className="fi-team-seg rejected"
                    style={{ width: `${rejectedPct}%` }}
                    title={`Đã xét không đạt/Hủy: ${team.rejected}`}
                  />
                )}
              </div>
            </div>
            <div className="fi-team-numbers">
              <span className="fi-team-num approved">{team.approved}</span>
              <span className="fi-team-num deferred">{team.deferred}</span>
              <span className="fi-team-num pending">{team.pending}</span>
              <span className="fi-team-num rejected">{team.rejected}</span>
            </div>
          </div>
        );
      })}
      <div className="fi-team-legend" aria-hidden="true">
        <span><i className="fi-swatch approved" /> Đã xét đạt</span>
        <span><i className="fi-swatch deferred" /> Xem xét sau</span>
        <span><i className="fi-swatch pending" /> Chờ xét duyệt</span>
        <span><i className="fi-swatch rejected" /> Đã xét không đạt/Hủy</span>
      </div>
    </div>
  );
}

function MonthlyTrendChart({ months }: { months: MonthlyTrend[] }) {
  if (months.length === 0) {
    return (
      <div className="fi-chart-empty">
        <TrendingUp size={28} />
        <span>Chưa có SK nào được xét vào KHMT</span>
      </div>
    );
  }
  const maxCount = Math.max(1, ...months.map((m) => m.count));
  const width = Math.max(360, months.length * 80);
  const height = 220;
  const padding = { top: 24, right: 16, bottom: 36, left: 32 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const barGap = 14;
  const barWidth = Math.max(28, (innerW - barGap * (months.length - 1)) / months.length);
  const total = months.reduce((sum, m) => sum + m.count, 0);
  return (
    <div className="fi-trend">
      <div className="fi-trend-meta">
        <span>Tổng KHMT</span>
        <strong>{total}</strong>
        <small>trên {months.length} tháng</small>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="KHMT theo tháng">
        {[0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + innerH * (1 - ratio);
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray="3 3"
              />
              <text x={padding.left - 6} y={y + 4} fontSize="10" fill="#64748b" textAnchor="end">
                {Math.round(maxCount * ratio)}
              </text>
            </g>
          );
        })}
        {months.map((month, index) => {
          const barH = (month.count / maxCount) * innerH;
          const x = padding.left + index * (barWidth + barGap);
          const y = padding.top + (innerH - barH);
          return (
            <g key={month.key}>
              <defs>
                <linearGradient id={`grad-${month.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" />
                  <stop offset="100%" stopColor="#2563eb" />
                </linearGradient>
              </defs>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={6}
                fill={`url(#grad-${month.key})`}
              >
                <title>{`${month.label}: ${month.count} SK vào KHMT`}</title>
              </rect>
              <text
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill="#0f172a"
              >
                {month.count}
              </text>
              <text
                x={x + barWidth / 2}
                y={height - 12}
                textAnchor="middle"
                fontSize="11"
                fill="#475569"
              >
                {month.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function FIWorkspace({
  role,
  currentUserId,
  currentTeam,
  displayName,
}: {
  role: string;
  currentUserId: string;
  currentTeam?: string | null;
  displayName?: string | null;
}) {
  const teamFromAccount = currentTeam ?? (AUTHOR_ROLES.includes(role) ? currentUserId : null);
  const isLockedToTeam = AUTHOR_ROLES.includes(role) && teamFromAccount && FI_TEAMS.includes(teamFromAccount);
  const defaultHistoryTeam = teamFromAccount && FI_TEAMS.includes(teamFromAccount) ? teamFromAccount : "TBCH";
  const defaultFormTeam = isLockedToTeam && teamFromAccount ? teamFromAccount : "TBCH";
  const defaultAuthorName = AUTHOR_ROLES.includes(role)
    ? (typeof displayName === "string" && displayName.includes(" - ") ? displayName.split(" - ")[0] : displayName ?? "")
    : "";
  const accountAuthorName = defaultAuthorName || currentUserId;
  const accountTeam = AUTHOR_ROLES.includes(role) ? teamFromAccount : null;
  const canRegister = AUTHOR_ROLES.includes(role) || role === ADMIN_ROLE;
  const canReview = REVIEWER_ROLES.includes(role);
  const defaultTab: FITab = canRegister ? "register" : canReview ? "review" : "dashboard";
  const [items, setItems] = useState<any[]>([]);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [historyTeam, setHistoryTeam] = useState(defaultHistoryTeam);
  const [historyMonths, setHistoryMonths] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<FITab>(defaultTab);
  const [reviewFilter, setReviewFilter] = useState<ReviewQueueFilter>("pending");
  const [form, setForm] = useState(() => {
    const today = new Date();
    return {
      author_name: defaultAuthorName,
      team: defaultFormTeam,
      title: "",
      content_description: "",
      // Mặc định kế hoạch hoàn thành = tháng đăng ký + 1 tháng (cùng năm); user có thể đổi.
      completion_plan_month: ((today.getMonth() + 1) % 12) + 1,
      completion_plan_year: today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear(),
      registration_month: today.getMonth() + 1,
      registration_year: today.getFullYear(),
    };
  });
  const [error, setError] = useState("");
  const [actionTarget, setActionTarget] = useState<{ id: string; label: string; decision: ReviewDecision } | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    content_description: "",
    completion_plan_month: 1,
    completion_plan_year: 2026,
    completion_plan_raw: "" as string,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [khmtTarget, setKhmtTarget] = useState<{ id: string; label: string; month: number; year: number } | null>(null);
  const [assigningKhmt, setAssigningKhmt] = useState(false);
  const draftFileInputRef = useRef<HTMLInputElement>(null);
  const detailFileInputRef = useRef<HTMLInputElement>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  const reload = () => {
    setDashboardLoading(true);
    Promise.all([api.listSk(), api.publicSk({ team: historyTeam }), api.fiDashboard()])
      .then(([privateList, historyList, dashboardData]) => {
        setItems(privateList.filter((item) => !item.is_historical_import));
        setHistoryItems(historyList.filter((item) => item.team === historyTeam));
        setDashboard(dashboardData);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setDashboardLoading(false));
  };

  useEffect(() => {
    reload();
  }, [role, historyTeam]);

  useEffect(() => {
    if (!AUTHOR_ROLES.includes(role)) return;
    setForm((current) => ({
      ...current,
      author_name: accountAuthorName,
      team: accountTeam ?? current.team,
    }));
  }, [role, accountAuthorName, accountTeam]);

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
    if (creating) return;
    // Client-side validation: prevent submitting empty registrations.
    const missing: string[] = [];
    const authorName = AUTHOR_ROLES.includes(role) ? accountAuthorName : form.author_name;
    const team = AUTHOR_ROLES.includes(role) ? accountTeam : form.team;
    if (!authorName.trim()) missing.push("Tác giả");
    if (!team?.trim()) missing.push("Đội/tổ trên tài khoản");
    if (!form.title.trim()) missing.push("Tên SK-CTKT");
    if (!form.content_description.trim()) missing.push("Nội dung đăng ký");
    if (missing.length > 0) {
      setError(`Vui lòng nhập: ${missing.join(", ")}.`);
      setNotice("");
      return;
    }
    // Build payload: gửi backend dạng string "T6/2026" để đồng nhất với dữ liệu cũ
    // (cột completion_plan vẫn là free text).
    const completionPlan = formatCompletionPlan(form.completion_plan_month, form.completion_plan_year);
    const basePayload = {
      author_name: form.author_name,
      team: form.team,
      title: form.title,
      content_description: form.content_description,
      completion_plan: completionPlan,
      registration_month: form.registration_month,
      registration_year: form.registration_year,
    };
    const payload = AUTHOR_ROLES.includes(role)
      ? { ...basePayload, author_name: authorName, team }
      : basePayload;
    const filesToUpload = [...evidenceFiles];
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const created = await api.createSk(payload);
      const uploadResults = await Promise.allSettled(
        filesToUpload.map((file) => api.uploadSkImage(created.id, file))
      );
      const failedFiles = filesToUpload.filter((_, index) => uploadResults[index].status === "rejected");
      setEvidenceFiles(failedFiles);
      reload();
      reloadDetail(created.id);
      if (failedFiles.length > 0) {
        setError(`Đã lưu đăng ký nhưng ${failedFiles.length}/${filesToUpload.length} ảnh chưa tải lên được. Có thể thử tải lại trong phần chi tiết hồ sơ.`);
      } else {
        setNotice(filesToUpload.length > 0 ? `Đã lưu đăng ký và tải lên ${filesToUpload.length} ảnh bằng chứng.` : "Đã lưu đăng ký.");
        // Reset form for next entry after successful save
        const today = new Date();
        setForm((current) => ({
          ...current,
          author_name: AUTHOR_ROLES.includes(role) ? authorName : "",
          team: AUTHOR_ROLES.includes(role) ? team ?? current.team : current.team,
          title: "",
          content_description: "",
          completion_plan_month: ((today.getMonth() + 1) % 12) + 1,
          completion_plan_year: today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear(),
        }));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const transition = (id: string, action: string, payload: any = {}) => {
    api.transitionSk(id, action, payload)
      .then(() => {
        reload();
        if (selectedItem?.id === id) reloadDetail(id);
      })
      .catch((err) => setError(err.message));
  };

  const openItem = (id: string) => {
    if (selectedItem?.id === id) {
      setSelectedItem(null);
      setError("");
      return;
    }
    api.getSk(id)
      .then((item) => {
        setSelectedItem(item);
        setError("");
      })
      .catch((err) => setError(err.message));
  };

  const selectTab = (tab: FITab) => {
    setActiveTab(tab);
    setActionTarget(null);
    setEditTarget(null);
    setKhmtTarget(null);
    setSelectedItem(null);
  };

  const selectHistoryTeam = (team: string) => {
    setHistoryTeam(team);
    setHistoryMonths([]);
    setSelectedItem(null);
  };

  const toggleHistoryMonth = (month: number) => {
    setHistoryMonths((current) =>
      current.includes(month)
        ? current.filter((value) => value !== month)
        : [...current, month].sort((a, b) => b - a)
    );
    setSelectedItem(null);
  };

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
    setActionTarget(null);
    setKhmtTarget(null);
    setEditTarget(item);
    const raw = item.completion_plan || "";
    const parsed = parseCompletionPlan(raw);
    const today = new Date();
    setEditForm({
      title: item.title || "",
      content_description: item.content_description || "",
      completion_plan_month: parsed?.month ?? today.getMonth() + 1,
      completion_plan_year: parsed?.year ?? today.getFullYear(),
      completion_plan_raw: raw,
    });
    setError("");
    setNotice("");
  };

  const openReviewDecision = (item: any) => {
    setEditTarget(null);
    setKhmtTarget(null);
    setActionTarget({
      id: item.id,
      label: item.sk_code || item.title,
      decision: reviewDecisionFromStatus(item.status),
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
    });
    setError("");
    setNotice("");
  };

  const handleEditSave = async () => {
    if (!editTarget || savingEdit) return;
    setSavingEdit(true);
    setError("");
    setNotice("");
    const wasSubmitted = editTarget.status && editTarget.status !== "Draft";
    try {
      const updated = await api.updateSk(editTarget.id, {
        content_description: editForm.content_description,
        completion_plan: formatCompletionPlan(editForm.completion_plan_month, editForm.completion_plan_year),
        title: editForm.title,
      });
      setNotice(
        wasSubmitted
          ? "Đã cập nhật SK. Đầu mối FI và Quản trị đã nhận thông báo để xem xét lại."
          : "Đã cập nhật nội dung SK-CTKT."
      );
      setEditTarget(null);
      setSelectedItem((current: any) => current?.id === updated.id ? { ...current, ...updated } : current);
      reload();
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
    api.transitionSk(target.id, target.decision, actionNote.trim() ? { note: actionNote.trim() } : {})
      .then((updated) => {
        setNotice(`Đã cập nhật đánh giá: ${reviewDecisionLabel(target.decision)}.`);
        setActionTarget(null);
        setEditTarget(null);
        setKhmtTarget(null);
        setActionNote("");
        reload();
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
      const updated = await api.assignKhmt(khmtTarget.id, khmtTarget.month, khmtTarget.year);
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

  const handleKhmtMonthSelect = async (item: any, value: string) => {
    const month = Number(value);
    if (!Number.isFinite(month) || month < 1 || month > 12 || assigningKhmt) return;
    const year = khmtAssignmentYear(item);
    setAssigningKhmt(true);
    setError("");
    setNotice("");
    try {
      const updated = await api.assignKhmt(item.id, month, year);
      setNotice(`Đã ghi nhận ${updated.sk_code || item.title} vào KHMT T${month}/${year}.`);
      setKhmtTarget(null);
      reload();
      if (selectedItem?.id === item.id) reloadDetail(item.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssigningKhmt(false);
    }
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

  const uploadImagesForItem = async (skId: string, files: File[]) => {
    if (files.length === 0 || uploadingImages) return;
    setUploadingImages(true);
    setError("");
    setNotice("");
    try {
      const results = await Promise.allSettled(files.map((file) => api.uploadSkImage(skId, file)));
      const failedCount = results.filter((result) => result.status === "rejected").length;
      reload();
      reloadDetail(skId);
      if (failedCount > 0) {
        const firstError = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
        setError(`Có ${failedCount}/${files.length} ảnh chưa tải lên được${firstError?.reason?.message ? `: ${firstError.reason.message}` : "."}`);
      } else {
        setNotice(`Đã tải lên ${files.length} ảnh bằng chứng.`);
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

  const handleDeleteImage = (skId: string, imageId: string) => {
    api.deleteSkImage(skId, imageId)
      .then(() => {
        if (selectedItem?.id === skId) reloadDetail(skId);
      })
      .catch((err) => setError(err.message));
  };

  const handleDelete = (id: string) => {
    if (!confirm("Xác nhận xóa SK-CTKT này?")) return;
    api.deleteSk(id)
      .then(() => {
        if (selectedItem?.id === id) setSelectedItem(null);
        setNotice("Đã xóa hồ sơ SK-CTKT.");
        reload();
      })
      .catch((err) => setError(err.message));
  };

  // Form đăng ký luôn hiện cho ai có quyền tạo SK (kể cả FI_Coordinator/Admin).
  const showForm = canRegister;
  // "Đăng ký SK-CTKT" giờ chỉ hiển thị SK do user hiện tại đăng ký (cho mọi role).
  // Admin vẫn thấy tất cả ở tab "Xét duyệt".
  const myItems = items.filter((item) =>
    role === ADMIN_ROLE ? item.author_user_id === currentUserId : item.author_user_id === currentUserId
  );
  // Hàng đợi xét duyệt: tất cả SK đã ngưng nháp + chưa hủy + không phải dữ liệu legacy.
  // FI_Coordinator không thấy SK của chính mình trong queue (tránh tự duyệt).
  const reviewQueueAll = items.filter((item) => {
    if (item.is_historical_import) return false;
    if (item.status === "Draft" || item.status === "Cancelled") return false;
    if (role === FI_COORDINATOR_ROLE && item.author_user_id === currentUserId) return false;
    return true;
  });
  const reviewQueue = reviewQueueAll.filter((item) => {
    if (reviewFilter === "all") return true;
    if (reviewFilter === "reviewed") return REVIEWED_STATUSES.includes(item.status);
    // pending: chờ tay người duyệt — Submitted/NeedMoreInfo (chưa có quyết định)
    return ["Submitted", "NeedMoreInfo"].includes(item.status);
  });
  const reviewCounts = {
    pending: reviewQueueAll.filter((item) => ["Submitted", "NeedMoreInfo"].includes(item.status)).length,
    reviewed: reviewQueueAll.filter((item) => REVIEWED_STATUSES.includes(item.status)).length,
    all: reviewQueueAll.length,
  };
  const selectedImages = Array.isArray(selectedItem?.supporting_images) ? selectedItem.supporting_images : [];
  const selectedHistory = Array.isArray(selectedItem?.status_history) ? selectedItem.status_history : [];
  const canUploadForSelected = selectedItem ? canUploadImages(role, currentUserId, selectedItem) : false;
  const historyMonthCounts = historyItems.reduce<Map<number, number>>((monthCounts, item) => {
    const month = registrationMonthValue(item);
    if (month) monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    return monthCounts;
  }, new Map<number, number>());
  const historyMonthOptions = Array.from(historyMonthCounts.entries()).sort((a, b) => b[0] - a[0]);
  const selectedHistoryMonthSet = new Set(historyMonths);
  const filteredHistoryItems = historyItems
    .filter((item) => historyMonths.length === 0 || selectedHistoryMonthSet.has(registrationMonthValue(item) ?? -1))
    .sort((a, b) =>
      (registrationMonthValue(b) ?? 0) - (registrationMonthValue(a) ?? 0) ||
      (a.bm01_source_row ?? 0) - (b.bm01_source_row ?? 0)
    );
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
  const dashboardTotals = dashboard?.totals ?? {};
  const dashboardTeams = Array.isArray(dashboard?.teams) ? dashboard.teams : [];
  const dashboardKhmtMonths = Array.isArray(dashboard?.khmt_by_month) ? dashboard.khmt_by_month : [];
  const dashboardTotalCount = Number(dashboardTotals.total ?? 0);
  const dashboardApprovedCount = reviewPassedCount(dashboardTotals);
  const dashboardKhmtCount = Number(dashboardTotals.khmt_considered ?? 0);
  const dashboardCompletedCount = Number(dashboardTotals.completed_count ?? dashboardTotals.completed ?? 0);
  const dashboardPendingCount = Number(dashboardTotals.pending ?? 0);
  const dashboardDeferredCount = Number(dashboardTotals.deferred ?? 0);
  const dashboardReviewFailedCount = reviewFailedCount(dashboardTotals);
  const statusSlices = useMemo(() => buildStatusSlices(dashboardTotals), [dashboardTotals]);
  const teamProgress = useMemo(() => buildTeamProgress(dashboardTeams), [dashboardTeams]);
  const monthlyTrend = useMemo(() => buildMonthlyTrend(dashboardKhmtMonths), [dashboardKhmtMonths]);
  const approvalRate = dashboardTotalCount
    ? Math.round((dashboardApprovedCount / dashboardTotalCount) * 100)
    : 0;
  const khmtRate = dashboardApprovedCount
    ? Math.round((dashboardKhmtCount / dashboardApprovedCount) * 100)
    : 0;
  const historyTeamSummary = dashboardTeams.find((team: any) => team.team === historyTeam);
  const historyTeamOptions = FI_TEAMS;

  const renderMetricPair = (
    primary: number | undefined,
    secondaryText: string,
    className = ""
  ) => (
    <span className={`metric-pair ${className}`}>
      <strong>{formatCount(primary)}</strong>
      <small>{secondaryText}</small>
    </span>
  );

  const renderKhmtMetric = (considered: number | undefined, missing: number | undefined) => (
    <span className="metric-pair cell-khmt">
      <strong>Đã vào {formatCount(considered)}</strong>
      <small>{formatCount(missing)} chưa vào</small>
    </span>
  );

  const renderKhmtControl = (item: any) => {
    const canSelect = canSelectKhmtMonth(role, currentUserId, item, currentTeam);
    const considered = isKhmtConsidered(item);
    if (!canSelect) {
      return (
        <span className={`legacy-khmt-pill ${considered ? "success" : "empty"}`}>
          {khmtLabel(item)}
        </span>
      );
    }

    const year = khmtAssignmentYear(item);
    return (
      <select
        aria-label={`Chọn tháng KHMT cho ${item.title}`}
        className={`legacy-khmt-select ${considered ? "success" : "empty"}`}
        disabled={assigningKhmt}
        onChange={(event) => handleKhmtMonthSelect(item, event.target.value)}
        title={`Chọn tháng KHMT năm ${year}`}
        value={considered && item.khmt_month ? String(item.khmt_month) : ""}
      >
        <option value="" disabled>
          Chưa vào KHMT
        </option>
        {KHMT_MONTHS.map((month) => (
          <option key={month} value={month}>
            {`T${month}/${year}`}
          </option>
        ))}
      </select>
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
        <div className="fi-inline-review-grid">
          <label>
            Kết luận đánh giá
            <select
              value={actionTarget.decision}
              onChange={(e) =>
                setActionTarget({ ...actionTarget, decision: e.target.value as ReviewDecision })
              }
            >
              {reviewDecisionOptions.map((option) => (
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
        {error && <p className="error">{error}</p>}
      </section>
    );
  };

  return (
    <div className="content-grid">
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

      <div className="fi-workspace-tabs" role="tablist" aria-label="Luồng SK-CTKT">
        <div className="segmented-control">
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
        </div>
      </div>

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
            role="dialog"
          >
            <div className="fi-edit-modal-head">
              <div>
                <h2 id="fi-edit-modal-title">Chỉnh sửa SK-CTKT</h2>
                <p className="muted">
                  {editTarget.sk_code || editTarget.title} · {editTarget.team}
                  {editTarget.status && editTarget.status !== "Draft" && (
                    <>
                      {" · "}
                      <em>FI/Admin sẽ nhận thông báo để xét duyệt lại sau khi lưu.</em>
                    </>
                  )}
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
              <label htmlFor="fi-edit-title">Tên SK-CTKT</label>
              <input
                id="fi-edit-title"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              />
              <label htmlFor="fi-edit-content">Nội dung đăng ký</label>
              <textarea
                id="fi-edit-content"
                value={editForm.content_description}
                onChange={(e) => setEditForm({ ...editForm, content_description: e.target.value })}
                rows={9}
              />
              <label htmlFor="fi-edit-plan-month">Kế hoạch hoàn thành</label>
              <div className="period-selector fi-registration-period">
                <select
                  id="fi-edit-plan-month"
                  value={editForm.completion_plan_month}
                  onChange={(e) =>
                    setEditForm({ ...editForm, completion_plan_month: Number(e.target.value) })
                  }
                  aria-label="Tháng hoàn thành"
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <option key={month} value={month}>T{month}</option>
                  ))}
                </select>
                <input
                  aria-label="Năm hoàn thành"
                  max={2100}
                  min={2020}
                  type="number"
                  value={editForm.completion_plan_year}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      completion_plan_year: Number(e.target.value) || new Date().getFullYear(),
                    })
                  }
                />
              </div>
              {editForm.completion_plan_raw &&
                !parseCompletionPlan(editForm.completion_plan_raw) && (
                  <small className="muted">
                    Kế hoạch cũ: <em>{editForm.completion_plan_raw}</em> · Lưu lại sẽ ghi đè bằng
                    định dạng tháng/năm chuẩn.
                  </small>
                )}
              {error && <p className="error">{error}</p>}
            </div>
            <div className="fi-edit-modal-actions">
              <button onClick={handleEditSave} disabled={savingEdit} type="button">
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
          {error && <p className="error">{error}</p>}
          {notice && <p className="success">{notice}</p>}
        </section>
      )}

      {activeTab === "register" && (
        <>
      <div className={`fi-register-layout ${showForm ? "" : "single"}`}>
      {showForm && (
        <section className="panel fi-form-panel">
          <h2>Đăng ký SK-CTKT</h2>
	          <p className="muted" style={{ marginTop: -6, marginBottom: 8 }}>
	            Điền đầy đủ thông tin để gửi sáng kiến/cải tiến kỹ thuật vào quy trình xét duyệt.
	          </p>
	          <div className="form-stack">
	            {AUTHOR_ROLES.includes(role) ? (
	              <div className="fi-account-source" aria-label="Thông tin tài khoản đăng ký">
	                <div>
	                  <span>Người đăng ký</span>
	                  <strong>{accountAuthorName}</strong>
	                </div>
	                <div>
	                  <span>Đội/tổ</span>
	                  <strong>{accountTeam || "Chưa gán đội/tổ"}</strong>
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
              placeholder="Vd: Cải tiến quy trình kiểm tra thiết bị"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <label htmlFor="fi-content">Nội dung đăng ký <span style={{ color: "#dc2626" }}>*</span></label>
            <textarea
              id="fi-content"
              placeholder="Mô tả hiện trạng, giải pháp và hiệu quả dự kiến..."
              rows={4}
              value={form.content_description}
              onChange={(e) => setForm({ ...form, content_description: e.target.value })}
            />
            <label htmlFor="fi-plan-month">Kế hoạch hoàn thành</label>
            <div className="period-selector fi-registration-period">
              <select
                id="fi-plan-month"
                value={form.completion_plan_month}
                onChange={(e) => setForm({ ...form, completion_plan_month: Number(e.target.value) })}
                aria-label="Tháng hoàn thành"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>T{month}</option>
                ))}
              </select>
              <input
                aria-label="Năm hoàn thành"
                max={2100}
                min={2020}
                type="number"
                value={form.completion_plan_year}
                onChange={(e) =>
                  setForm({
                    ...form,
                    completion_plan_year: Number(e.target.value) || new Date().getFullYear(),
                  })
                }
              />
            </div>
            <label>
              Ảnh bằng chứng FI <span className="muted">(tùy chọn — có thể thêm sau khi lưu)</span>
            </label>
            <button type="button" onClick={() => draftFileInputRef.current?.click()}>
              <ImagePlus size={16} />
              Chọn ảnh
            </button>
            {evidenceFiles.length > 0 && (
              <div className="evidence-file-list">
                <small className="muted">{evidenceFiles.length} ảnh sẽ được tải lên sau khi lưu đăng ký.</small>
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
            <button type="button" onClick={create} disabled={creating}>
              <ClipboardCheck size={17} />
              {creating ? "Đang lưu đăng ký..." : "Lưu đăng ký"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {notice && <p className="success">{notice}</p>}
        </section>
      )}

      <section className="panel fi-processing-panel">
        <div className="panel-header">
          <h2>Sáng kiến của tôi</h2>
          <button onClick={reload} title="Tải lại danh sách">
            <RefreshCw size={17} />
          </button>
        </div>
        <p className="muted" style={{ marginTop: -4, marginBottom: 10 }}>
          Danh sách SK-CTKT do bạn đứng tên đăng ký. Sau khi gửi duyệt, bạn vẫn được sửa nội dung;
          khi sửa, đầu mối FI và Quản trị sẽ nhận thông báo để xem xét lại.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="list">
          {myItems.map((item) => {
            const actions = visibleActionsForSk(role, currentUserId, item);
            const editedAfterSubmit = item.status !== "Draft" && AUTHOR_EDITABLE_STATUSES.includes(item.status);
            return (
              <div className={`workflow-item ${selectedItem?.id === item.id ? "active-row" : ""}`} key={item.id}>
                <button className="workflow-main" onClick={() => openItem(item.id)} type="button">
                  <strong>{item.sk_code}</strong>
                  <span>{item.title}</span>
                  <small>{item.author_name} · {item.team}</small>
                  <small>
                    {displayStatus(item.status)}
                    {item.submitted_at && item.status === "Submitted" && ` · gửi ${new Date(item.submitted_at).toLocaleDateString("vi-VN")}`}
                    {isKhmtConsidered(item) && ` · ${khmtLabel(item)}`}
                  </small>
                </button>
                <div className="toolbar">
                  {actions.includes("edit") && (
                    <button
                      title={editedAfterSubmit ? "Chỉnh sửa (sẽ gửi noti xét duyệt lại)" : "Chỉnh sửa nội dung/kế hoạch"}
                      onClick={() => openEdit(item)}
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {actions.includes("submit") && (
                    <button title="Gửi duyệt" onClick={() => transition(item.id, "submit")}>
                      <Send size={16} />
                    </button>
                  )}
                  {actions.includes("delete") && (
                    <button title="Xóa SK" onClick={() => handleDelete(item.id)}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {myItems.length === 0 && <p className="muted">Bạn chưa có SK-CTKT nào. Hãy điền form bên trái để đăng ký.</p>}
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
            <button onClick={reload} title="Tải lại hàng đợi xét duyệt">
              <RefreshCw size={17} />
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
          {error && <p className="error">{error}</p>}
          <div className="list">
            {reviewQueue.map((item) => {
              const actions = visibleActionsForSk(role, currentUserId, item);
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
                      {item.author_name} · {item.team}
                    </span>
                    <span className="fi-review-state-line">
                      <span className={`fi-status-pill ${statusTone(item.status)}`}>
                        {displayStatus(item.status)}
                      </span>
                      {item.submitted_at && (
                        <span className="fi-review-submitted">
                          gửi {new Date(item.submitted_at).toLocaleDateString("vi-VN")}
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
                      <button title="Xóa SK" onClick={() => handleDelete(item.id)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  {renderReviewDecisionPanel(item)}
                </div>
              );
            })}
            {reviewQueue.length === 0 && (
              <p className="muted">
                {reviewFilter === "pending"
                  ? "Không có SK nào đang chờ xét duyệt."
                  : reviewFilter === "reviewed"
                  ? "Chưa có SK nào được đánh giá."
                  : "Hàng đợi đang trống."}
              </p>
            )}
          </div>
        </section>
      )}

      {(activeTab === "register" || activeTab === "review") && selectedItem && !selectedItem.is_historical_import && (
        <section className="panel wide fi-detail-card">
          <div className="fi-detail-header">
            <div className="fi-detail-title">
              <div className="fi-detail-code-line">
                <h2>{selectedItem.sk_code}</h2>
                <span className={`fi-status-pill ${statusTone(selectedItem.status)}`}>
                  {displayStatus(selectedItem.status)}
                </span>
              </div>
              <p>{selectedItem.team}</p>
            </div>
            <div className="fi-detail-actions">
            {visibleActionsForSk(role, currentUserId, selectedItem).includes("edit") && (
              <button
                className="fi-detail-action"
                title="Chỉnh sửa nội dung/kế hoạch"
                type="button"
                onClick={() => openEdit(selectedItem)}
              >
                <Pencil size={17} />
                Chỉnh sửa
              </button>
            )}
            {canUploadForSelected && (
              <button
                className="fi-detail-action"
                title="Tải ảnh bằng chứng"
                type="button"
                disabled={uploadingImages}
                onClick={() => detailFileInputRef.current?.click()}
              >
                <ImagePlus size={17} />
                {uploadingImages ? "Đang tải..." : "Thêm ảnh"}
              </button>
            )}
              <button
                className="fi-detail-action secondary"
                title="Thu gọn chi tiết"
                type="button"
                onClick={() => setSelectedItem(null)}
              >
                <ChevronUp size={17} />
                Thu gọn
              </button>
            </div>
          </div>

          <div className="fi-detail-meta">
            <div className="fi-meta-item">
              <UserRound size={17} />
              <span>Tác giả</span>
              <strong>{selectedItem.author_name}</strong>
            </div>
            <div className="fi-meta-item">
              <CalendarDays size={17} />
              <span>Tháng đăng ký</span>
              <strong>{registrationMonthLabel(selectedItem)}</strong>
            </div>
            <div className="fi-meta-item">
              <Flag size={17} />
              <span>Kế hoạch hoàn thành</span>
              <strong>{selectedItem.completion_plan}</strong>
            </div>
            <div className="fi-meta-item">
              <ClipboardCheck size={17} />
              <span>KHMT</span>
              <strong>{khmtLabel(selectedItem)}</strong>
            </div>
          </div>

          <div className="fi-detail-content">
            <div className="fi-content-section primary">
              <span className="fi-section-label">Tên SK-CTKT</span>
              <h3>{selectedItem.title}</h3>
              <span className="fi-section-label">Nội dung đăng ký</span>
              <p>{selectedItem.content_description || "Chưa có mô tả nội dung."}</p>
            </div>
            {(selectedItem.fi_coordinator_comments || selectedItem.workshop_leader_conclusion || selectedItem.decision_note) && (
              <div className="fi-content-section notes">
                <h3>Ghi chú và kết luận</h3>
                {selectedItem.fi_coordinator_comments && (
                  <div>
                    <span>Nhận xét FI</span>
                    <p>{selectedItem.fi_coordinator_comments}</p>
                  </div>
                )}
                {selectedItem.workshop_leader_conclusion && (
                  <div>
                    <span>Kết luận LĐX</span>
                    <p>{selectedItem.workshop_leader_conclusion}</p>
                  </div>
                )}
                {selectedItem.decision_note && (
                  <div>
                    <span>Ghi chú quyết định</span>
                    <p>{selectedItem.decision_note}</p>
                  </div>
                )}
              </div>
            )}
            {selectedHistory.length > 0 && (
              <div className="fi-content-section timeline">
                <div className="fi-section-heading">
                  <History size={17} />
                  <h3>Lịch sử xử lý</h3>
                </div>
                <div className="fi-timeline">
                  {selectedHistory.map((history: any, index: number) => {
                    const detail = historyDetail(history);
                    const time = formatHistoryTime(history.changed_at);
                    return (
                      <div className="fi-timeline-item" key={`${history.changed_at}-${index}`}>
                        <span className="fi-timeline-dot" />
                        <div>
                          <div className="fi-timeline-row">
                            <strong>{historyActionLabel(history)}</strong>
                            {time && <time>{time}</time>}
                          </div>
                          <p className="fi-timeline-actor">
                            <span>Người thực hiện</span>
                            <strong>{actorLabel(history.changed_by)}</strong>
                          </p>
                          {detail && (
                            <div className="fi-timeline-note">
                              <span>{detail.label}</span>
                              <p>{detail.text}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {(selectedImages.length > 0 || canUploadForSelected) && (
            <div className="image-list">
              <h3>Ảnh bằng chứng ({selectedImages.length})</h3>
              {selectedImages.length === 0 && (
                <div className="image-empty">
                  <span>Chưa có ảnh bằng chứng.</span>
                  {canUploadForSelected && (
                    <button type="button" onClick={() => detailFileInputRef.current?.click()} disabled={uploadingImages}>
                      <ImagePlus size={16} />
                      {uploadingImages ? "Đang tải..." : "Thêm ảnh"}
                    </button>
                  )}
                </div>
              )}
              <div className="image-card-grid">
                {selectedImages.map((img: any, index: number) => (
                  <div className="image-card" key={img.id}>
                    <AuthenticatedSkImage skId={selectedItem.id} image={img} onOpen={() => setImagePreviewIndex(index)} />
                    <small title={img.file_name}>{img.file_name}</small>
                    {canUploadForSelected && (
                      <button
                        className="image-card-delete"
                        title="Xóa ảnh"
                        onClick={() => handleDeleteImage(selectedItem.id, img.id)}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === "dashboard" && (
        <section className="wide fi-dashboard-shell">
          <div className="fi-dashboard-hero">
            <div className="fi-dashboard-hero-text">
              <div className="fi-dashboard-hero-title">
                <Sparkles size={20} />
                <h2>FI Dashboard</h2>
              </div>
              <p>Bức tranh toàn cảnh về SK-CTKT của 4 đội/tổ — trạng thái xử lý, KHMT đã ghi nhận và xu hướng theo tháng.</p>
              <div className="fi-dashboard-hero-stats">
                <span>
                  <CheckCircle2 size={14} /> {approvalRate}% đã xét đạt
                </span>
                <span>
                  <CalendarDays size={14} /> {khmtRate}% SK đạt đã vào KHMT
                </span>
                <span>
                  <Clock3 size={14} /> Cập nhật {dashboard?.generated_at ? formatHistoryTime(dashboard.generated_at) : "—"}
                </span>
              </div>
            </div>
            <button className="fi-dashboard-refresh" onClick={reload} title="Tải lại FI Dashboard" type="button">
              <RefreshCw size={17} />
              Tải lại
            </button>
          </div>

          {dashboardLoading && <p className="muted">Đang tải FI Dashboard...</p>}
          {error && <p className="error">{error}</p>}

          <div className="fi-dashboard-kpis">
            <div className="fi-dashboard-kpi total">
              <div className="fi-dashboard-kpi-icon"><ClipboardList size={20} /></div>
              <span>Tổng SK</span>
              <strong>{formatCount(dashboardTotalCount)}</strong>
              <small>{formatCount(dashboardTotals.current)} hiện hành · {formatCount(dashboardTotals.historical)} lịch sử</small>
            </div>
            <div className="fi-dashboard-kpi success">
              <div className="fi-dashboard-kpi-icon"><CheckCircle2 size={20} /></div>
              <span>Đã xét đạt</span>
              <strong>{formatCount(dashboardApprovedCount)}</strong>
              <small>{approvalRate}% tổng SK</small>
              <div className="fi-kpi-bar"><div className="fi-kpi-bar-fill success" style={{ width: `${approvalRate}%` }} /></div>
            </div>
            <div className="fi-dashboard-kpi warning">
              <div className="fi-dashboard-kpi-icon"><PauseCircle size={20} /></div>
              <span>Xem xét sau</span>
              <strong>{formatCount(dashboardDeferredCount)}</strong>
              <small>{formatCount(dashboardPendingCount)} SK chưa duyệt</small>
            </div>
            <div className="fi-dashboard-kpi info">
              <div className="fi-dashboard-kpi-icon"><CalendarDays size={20} /></div>
              <span>Đã vào KHMT</span>
              <strong>{formatCount(dashboardKhmtCount)}</strong>
              <small>{formatCount(khmtMissingCount(dashboardTotals))} SK đạt chưa vào KHMT</small>
              <div className="fi-kpi-bar"><div className="fi-kpi-bar-fill info" style={{ width: `${khmtRate}%` }} /></div>
            </div>
            <div className="fi-dashboard-kpi neutral">
              <div className="fi-dashboard-kpi-icon"><Flag size={20} /></div>
              <span>Hoàn tất</span>
              <strong>{formatCount(dashboardCompletedCount)}</strong>
              <small>{formatCount(dashboardTotals.not_completed)} SK chưa xong</small>
            </div>
          </div>

          <div className="fi-dashboard-chart-row">
            <div className="fi-dashboard-card">
              <div className="fi-dashboard-section-title">
                <PieChart size={17} />
                <h3>Phân bố trạng thái</h3>
                <small className="muted">{dashboardTotalCount} SK</small>
              </div>
              <StatusDonutChart slices={statusSlices} total={dashboardTotalCount} />
            </div>
            <div className="fi-dashboard-card fi-team-card">
              <div className="fi-dashboard-section-title">
                <Users2 size={17} />
                <h3>So sánh giữa các đội/tổ</h3>
                <small className="muted">độ dài thanh tỉ lệ với tổng SK</small>
              </div>
              <TeamProgressBars teams={teamProgress} />
            </div>
          </div>

          <div className="fi-dashboard-card">
            <div className="fi-dashboard-section-title">
              <TrendingUp size={17} />
              <h3>Xu hướng KHMT theo tháng</h3>
              <small className="muted">Số SK đã được ghi nhận vào KHMT</small>
            </div>
            <MonthlyTrendChart months={monthlyTrend} />
          </div>

          <div className="fi-dashboard-main">
            <div className="fi-dashboard-table-wrap">
              <div className="fi-dashboard-section-title">
                <ListChecks size={17} />
                <h3>Chi tiết theo đội/tổ</h3>
              </div>
              <table className="fi-dashboard-table">
                <thead>
                  <tr>
                    <th>Đội/tổ</th>
                    <th>Tổng</th>
                    <th>Đã xét đạt</th>
                    <th>Đã xét không đạt</th>
                    <th>Xem xét sau</th>
                    <th>Chưa duyệt</th>
                    <th>KHMT</th>
                    <th>Hoàn thành</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardTeams.map((team: any) => {
                    const teamPassed = reviewPassedCount(team);
                    const teamFailed = reviewFailedCount(team);
                    const teamKhmtMissing = khmtMissingCount(team);
                    const teamApprovalRate = team.total ? Math.round((teamPassed / team.total) * 100) : 0;
                    return (
                      <tr key={team.team}>
                        <td>
                          <strong>{team.team}</strong>
                          <small>{formatCount(team.current)} hiện hành · {formatCount(team.historical)} lịch sử</small>
                        </td>
                        <td>{formatCount(team.total)}</td>
                        <td>
                          {renderMetricPair(teamPassed, `(${teamApprovalRate}%)`, "cell-approved")}
                        </td>
                        <td>{formatCount(teamFailed)}</td>
                        <td>{formatCount(team.deferred)}</td>
                        <td>{formatCount(team.pending)}</td>
                        <td>{renderKhmtMetric(team.khmt_considered, teamKhmtMissing)}</td>
                        <td>
                          {renderMetricPair(team.completed_count ?? team.completed, `/ ${formatCount(team.not_completed)} chưa xong`)}
                        </td>
                      </tr>
                    );
                  })}
                  {dashboardTeams.length === 0 && (
                    <tr>
                      <td colSpan={8}>Chưa có dữ liệu FI.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="fi-dashboard-side">
              <div className="fi-dashboard-block">
                <div className="fi-dashboard-section-title">
                  <CalendarDays size={17} />
                  <h3>KHMT theo tháng</h3>
                </div>
                <div className="fi-khmt-month-grid">
                  {dashboardKhmtMonths.map((month: any) => (
                    <div className="fi-khmt-month" key={`${month.year}-${month.month}`}>
                      <span>T{month.month}/{month.year}</span>
                      <strong>{formatCount(month.count)}</strong>
                    </div>
                  ))}
                  {dashboardKhmtMonths.length === 0 && <p className="muted">Chưa có SK nào được xét vào KHMT.</p>}
                </div>
              </div>
              <div className="fi-dashboard-block">
                <div className="fi-dashboard-section-title">
                  <Clock3 size={17} />
                  <h3>Tóm tắt trạng thái</h3>
                </div>
                <div className="fi-dashboard-status-list">
                  <div>
                    <span><i className="fi-swatch approved" /> Đã xét đạt</span>
                    <strong>{formatCount(dashboardApprovedCount)}</strong>
                  </div>
                  <div>
                    <span><i className="fi-swatch deferred" /> Xem xét sau</span>
                    <strong>{formatCount(dashboardDeferredCount)}</strong>
                  </div>
                  <div>
                    <span><i className="fi-swatch pending" /> Chưa duyệt</span>
                    <strong>{formatCount(dashboardPendingCount)}</strong>
                  </div>
                  <div>
                    <span><i className="fi-swatch rejected" /> Đã xét không đạt</span>
                    <strong>{formatCount(dashboardReviewFailedCount)}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === "history" && (
      <section className="panel wide legacy-sk-panel">
        <div className="legacy-sticky-controls">
          <div className="panel-header">
            <div>
              <h2>Lịch sử FI</h2>
              <p className="muted">{historyTeam} · {historyItems.length} SK-CTKT đã ghi nhận</p>
            </div>
            <div className="toolbar">
              <div className="segmented-control legacy-team-picker" aria-label="Chọn đội/tổ">
                {historyTeamOptions.map((team) => (
                  <button
                    className={historyTeam === team ? "active" : ""}
                    key={team}
                    onClick={() => selectHistoryTeam(team)}
                    type="button"
                  >
                    {team}
                  </button>
                ))}
              </div>
              <button onClick={reload} title="Tải lại lịch sử FI">
                <RefreshCw size={17} />
              </button>
            </div>
          </div>
          <div className="legacy-filter-tier" aria-label="Lọc lịch sử FI">
            <div className="legacy-filter-controls">
              <div className="legacy-filter-line">
                <span className="filter-label">Đội/tổ</span>
                <strong>{historyTeam}</strong>
              </div>
              <div className="legacy-filter-line">
                <span className="filter-label">Tháng</span>
                <div className="legacy-month-ticks">
                  <button
                    className={historyMonths.length === 0 ? "active" : ""}
                    onClick={() => {
                      setHistoryMonths([]);
                      setSelectedItem(null);
                    }}
                    type="button"
                  >
                    <span className="tick-box" aria-hidden="true">{historyMonths.length === 0 ? "✓" : ""}</span>
                    Tất cả
                    <small>{historyItems.length}</small>
                  </button>
                  {historyMonthOptions.map(([month, count]) => {
                    const active = historyMonths.includes(month);
                    return (
                      <button
                        className={active ? "active" : ""}
                        key={month}
                        onClick={() => toggleHistoryMonth(month)}
                        type="button"
                      >
                        <span className="tick-box" aria-hidden="true">{active ? "✓" : ""}</span>
                        T{month}
                        <small>{count}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
	            {historyTeamSummary && (
	              <div className="legacy-team-summary">
	                <table className="fi-dashboard-table compact">
	                  <thead>
	                    <tr>
	                      <th>Đội/tổ</th>
	                      <th>Tổng</th>
	                      <th>Đã xét đạt</th>
	                      <th>Đã xét không đạt</th>
	                      <th>Xem xét sau</th>
	                      <th>Chưa duyệt</th>
	                      <th>KHMT</th>
                      <th>Hoàn thành</th>
                    </tr>
                  </thead>
                  <tbody>
	                    <tr>
	                      {(() => {
	                        const passed = reviewPassedCount(historyTeamSummary);
	                        const failed = reviewFailedCount(historyTeamSummary);
	                        const khmtMissing = khmtMissingCount(historyTeamSummary);
	                        return (
	                          <>
		                      <td>
		                        <strong>{historyTeamSummary.team}</strong>
		                        <small>{formatCount(historyTeamSummary.current)} hiện hành · {formatCount(historyTeamSummary.historical)} lịch sử</small>
		                      </td>
		                      <td>{formatCount(historyTeamSummary.total)}</td>
		                      <td>{renderMetricPair(passed, `(${percent(passed, historyTeamSummary.total)}%)`, "cell-approved")}</td>
		                      <td>{formatCount(failed)}</td>
		                      <td>{formatCount(historyTeamSummary.deferred)}</td>
		                      <td>{formatCount(historyTeamSummary.pending)}</td>
		                      <td>{renderKhmtMetric(historyTeamSummary.khmt_considered, khmtMissing)}</td>
		                      <td>{renderMetricPair(historyTeamSummary.completed_count ?? historyTeamSummary.completed, `/ ${formatCount(historyTeamSummary.not_completed)} chưa xong`)}</td>
	                          </>
	                        );
	                      })()}
	                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="legacy-column-heading" aria-hidden="true">
            <span>Kết luận LĐX</span>
            <span>KHMT</span>
          </div>
        </div>
        <div className="legacy-list">
          {groupedHistoryItems.map((group) => (
            <div className="legacy-month-group" key={group.key}>
              <div className="legacy-month-heading">
                <h3>{group.month ? `T${group.month}/${group.year}` : "Chưa rõ tháng"}</h3>
                <span>{group.items.length} SK-CTKT</span>
              </div>
              {group.items.map((item) => {
                const isOpen = selectedItem?.id === item.id;
                const actions = visibleActionsForSk(role, currentUserId, item);
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
                        <strong>{item.title}</strong>
                      </div>
                      <div className="legacy-row-subtitle">
                        <span>{item.author_name}</span>
                      </div>
                      <div className="legacy-row-meta">
                        <small>Kế hoạch: {item.completion_plan || "Chưa ghi"}</small>
                        {isKhmtConsidered(item) && <small>{khmtLabel(item)}</small>}
                      </div>
                    </button>
                    <div className="legacy-row-side">
                      <span className="legacy-period-pill">{registrationMonthLabel(item)}</span>
                      <span className={`legacy-status-pill ${statusTone(item.status)}`}>{displayHistoryStatus(item)}</span>
                      {renderKhmtControl(item)}
                      <div className="legacy-row-controls">
                        {actions.includes("edit") && (
                          <button
                            className="legacy-icon-action"
                            title="Chỉnh sửa nội dung/kế hoạch"
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
                          <span>Kế hoạch hoàn thành</span>
                          <strong>{detail.completion_plan || "Chưa ghi"}</strong>
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
                            <span>Kết luận LĐX</span>
                            <p>{detail.workshop_leader_conclusion}</p>
                          </section>
                        )}
                        <section className={isKhmtConsidered(detail) ? "legacy-khmt-note" : ""}>
                          <span>Đã xem xét vào KHMT</span>
                          <p>{khmtLabel(detail)}</p>
                        </section>
                      </div>
                      <div className="legacy-evidence">
                        <div className="legacy-evidence-head">
                          <span className="legacy-evidence-title">
                            <ImageIcon size={15} />
                            Ảnh bằng chứng
                            {detailImages.length > 0 && <em>({detailImages.length})</em>}
                          </span>
                          {isHistorical && detailImages.length === 0 && (
                            <small className="muted"><Info size={13} /> Dữ liệu nhập từ Excel — không có ảnh minh chứng.</small>
                          )}
                        </div>
                        {detailImages.length > 0 ? (
                          <div className="legacy-evidence-grid">
                            {detailImages.map((img: any, idx: number) => (
                              <div
                                key={img.id}
                                className="legacy-evidence-thumb"
                                title={img.file_name}
                              >
                                <AuthenticatedSkImage
                                  skId={detail.id}
                                  image={img}
                                  onOpen={() => {
                                    setSelectedItem(detail);
                                    setImagePreviewIndex(idx);
                                  }}
                                />
                              </div>
                            ))}
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
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          ))}
          {historyItems.length === 0 && <p className="muted">Không có FI cho đội {historyTeam}.</p>}
          {historyItems.length > 0 && filteredHistoryItems.length === 0 && (
            <p className="muted">Không có FI cho tháng đang chọn.</p>
          )}
        </div>
      </section>
      )}

      {/* Global image viewer — works from both Register and History tabs */}
      {imagePreviewIndex !== null && selectedItem && selectedImages[imagePreviewIndex] && (
        <SkImageViewer
          canDelete={canUploadForSelected}
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
