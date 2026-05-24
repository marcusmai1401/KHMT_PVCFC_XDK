import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Check,
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
  XCircle,
} from "lucide-react";
import { api } from "../../api/client";

const TEAM_ROLE = "Team_Account";
const FI_TEAMS = ["TBCH", "TBĐL", "TBHTĐK", "TCĐK"];
const REVIEWER_ROLES = ["Admin", "FI_Coordinator", "Workshop_Leader"];
const REVIEWABLE_STATUSES = ["Submitted", "Reviewed", "Deferred"];

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

type FITab = "register" | "history" | "dashboard";
type HistoryMonthGroup = { key: string; month: number | null; year: number; items: any[] };

function displayStatus(value: string) {
  return statusLabels[value] ?? value;
}

function displayImportedStatus(value: string) {
  return importedStatusLabels[value] ?? displayStatus(value);
}

function displayHistoryStatus(item: any) {
  return item.is_historical_import ? displayImportedStatus(item.status) : displayStatus(item.status);
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

function formatCount(value: number | undefined) {
  return new Intl.NumberFormat("vi-VN").format(value ?? 0);
}

function percent(value: number | undefined, total: number | undefined) {
  if (!total) return 0;
  return Math.round(((value ?? 0) / total) * 100);
}

export function visibleActionsForSk(role: string, currentUserId: string, item: any): string[] {
  const actions: string[] = [];
  const reviewableStatuses = item.is_historical_import ? ["Submitted", "Deferred"] : REVIEWABLE_STATUSES;
  const visibleToTeamAccount = item.author_user_id === currentUserId || (typeof item.status === "string" && item.status !== "Draft");
  const canEdit =
    REVIEWER_ROLES.includes(role) ||
    (role === TEAM_ROLE && visibleToTeamAccount);
  const canSubmit =
    !item.is_historical_import &&
    (role === "Admin" || (role === TEAM_ROLE && item.author_user_id === currentUserId)) &&
    ["Draft", "NeedMoreInfo"].includes(item.status);
  const canApprove = REVIEWER_ROLES.includes(role) && reviewableStatuses.includes(item.status);
  const canReject = REVIEWER_ROLES.includes(role) && reviewableStatuses.includes(item.status);
  const canAssign = !item.is_historical_import && role === "Admin" && ["Approved", "Completed"].includes(item.status);
  const canDelete =
    !item.is_historical_import &&
    (role === "Admin" ||
      (role === TEAM_ROLE && item.author_user_id === currentUserId && item.status === "Draft"));
  if (canEdit) actions.push("edit");
  if (canSubmit) actions.push("submit");
  if (canApprove) actions.push("approve");
  if (canReject) actions.push("reject");
  if (canAssign) actions.push("assignKhmt");
  if (canDelete) actions.push("delete");
  return actions;
}

const isReviewerRole = (role: string) => ["FI_Coordinator", "Workshop_Leader"].includes(role);

function canUploadImages(role: string, currentUserId: string, item: any) {
  if (item.is_historical_import) return false;
  return (
    role === "Admin" ||
    (role === TEAM_ROLE && item.author_user_id === currentUserId && ["Draft", "NeedMoreInfo"].includes(item.status))
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
  const approved = Number(totals.approved ?? 0);
  const completed = Number(totals.completed_count ?? totals.completed ?? 0);
  const pureApproved = Math.max(0, approved - completed);
  const deferred = Number(totals.deferred ?? 0);
  const pending = Number(totals.pending ?? 0);
  const rejected = Number(totals.rejected ?? 0) + Number(totals.cancelled ?? 0);
  return [
    { key: "completed", label: "Hoàn tất", value: completed, color: "#16a34a", tone: "success" },
    { key: "approved", label: "Đã duyệt", value: pureApproved, color: "#22c55e", tone: "approved" },
    { key: "pending", label: "Chờ xét duyệt", value: pending, color: "#2563eb", tone: "info" },
    { key: "deferred", label: "Xem xét sau", value: deferred, color: "#f59e0b", tone: "warning" },
    { key: "rejected", label: "Từ chối/Hủy", value: rejected, color: "#ef4444", tone: "danger" },
  ].filter((slice) => slice.value > 0);
}

function buildTeamProgress(teams: any[]): TeamProgress[] {
  return teams.map((team) => {
    const total = Number(team.total ?? 0);
    const approved =
      Number(team.approved ?? 0); // includes completed per backend bucket
    const deferred = Number(team.deferred ?? 0);
    const pending = Number(team.pending ?? 0);
    const rejected = Number(team.rejected ?? 0) + Number(team.cancelled ?? 0);
    const khmt = Number(team.khmt_considered ?? 0);
    const khmtRate = total ? Math.round((khmt / total) * 100) : 0;
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
                    title={`Đã duyệt: ${team.approved}`}
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
                    title={`Từ chối/Hủy: ${team.rejected}`}
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
        <span><i className="fi-swatch approved" /> Đã duyệt</span>
        <span><i className="fi-swatch deferred" /> Xem xét sau</span>
        <span><i className="fi-swatch pending" /> Chờ xét duyệt</span>
        <span><i className="fi-swatch rejected" /> Từ chối/Hủy</span>
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

export function FIWorkspace({ role, currentUserId }: { role: string; currentUserId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [historyTeam, setHistoryTeam] = useState("TBCH");
  const [historyMonths, setHistoryMonths] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<FITab>("register");
  const [form, setForm] = useState(() => {
    const today = new Date();
    return {
      author_name: "",
      team: "TBCH",
      title: "",
      content_description: "",
      completion_plan: "",
      registration_month: today.getMonth() + 1,
      registration_year: today.getFullYear(),
    };
  });
  const [error, setError] = useState("");
  const [actionTarget, setActionTarget] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editForm, setEditForm] = useState({ content_description: "", completion_plan: "" });
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
    setImagePreviewIndex(null);
  }, [selectedItem?.id]);

  const reloadDetail = (id: string) => {
    api.getSk(id).then(setSelectedItem).catch((err) => setError(err.message));
  };

  const create = async () => {
    if (creating) return;
    // Client-side validation: prevent submitting empty registrations.
    const missing: string[] = [];
    if (!form.author_name.trim()) missing.push("Tác giả");
    if (!form.title.trim()) missing.push("Tên SK-CTKT");
    if (!form.content_description.trim()) missing.push("Nội dung đăng ký");
    if (missing.length > 0) {
      setError(`Vui lòng nhập: ${missing.join(", ")}.`);
      setNotice("");
      return;
    }
    const payload = role === TEAM_ROLE ? { ...form, team: currentUserId } : form;
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
        setForm((current) => ({
          ...current,
          author_name: "",
          title: "",
          content_description: "",
          completion_plan: "",
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
    setEditForm({
      content_description: item.content_description || "",
      completion_plan: item.completion_plan || "",
    });
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
    try {
      const updated = await api.updateSk(editTarget.id, {
        content_description: editForm.content_description,
        completion_plan: editForm.completion_plan,
      });
      setNotice("Đã cập nhật nội dung và kế hoạch thực hiện.");
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
    if (actionTarget.action === "reject" && !actionNote.trim()) {
      setError("Cần nhập lý do từ chối");
      return;
    }
    transition(actionTarget.id, actionTarget.action, actionNote.trim() ? { note: actionNote } : {});
    setActionTarget(null);
    setEditTarget(null);
    setKhmtTarget(null);
    setActionNote("");
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

  const showForm = !isReviewerRole(role);
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
  const dashboardApprovedCount = Number(dashboardTotals.approved ?? 0);
  const dashboardKhmtCount = Number(dashboardTotals.khmt_considered ?? 0);
  const dashboardCompletedCount = Number(dashboardTotals.completed_count ?? dashboardTotals.completed ?? 0);
  const dashboardPendingCount = Number(dashboardTotals.pending ?? 0);
  const dashboardDeferredCount = Number(dashboardTotals.deferred ?? 0);
  const dashboardRejectedCount = Number(dashboardTotals.rejected ?? 0) + Number(dashboardTotals.cancelled ?? 0);
  const statusSlices = useMemo(() => buildStatusSlices(dashboardTotals), [dashboardTotals]);
  const teamProgress = useMemo(() => buildTeamProgress(dashboardTeams), [dashboardTeams]);
  const monthlyTrend = useMemo(() => buildMonthlyTrend(dashboardKhmtMonths), [dashboardKhmtMonths]);
  const approvalRate = dashboardTotalCount
    ? Math.round((dashboardApprovedCount / dashboardTotalCount) * 100)
    : 0;
  const khmtRate = dashboardTotalCount
    ? Math.round((dashboardKhmtCount / dashboardTotalCount) * 100)
    : 0;

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

      {actionTarget && (
        <section className="panel wide fi-action-panel">
          <h2>{actionTarget.action === "approve" ? "Phê duyệt SK-CTKT" : "Từ chối SK-CTKT"}</h2>
          <div className="form-stack">
            <label>
              Ghi chú {actionTarget.action === "reject" && <span style={{ color: "red" }}>*</span>}
              {actionTarget.action === "approve" && <span className="muted"> (tùy chọn)</span>}
            </label>
            <textarea
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
              placeholder={actionTarget.action === "approve" ? "Nhập ghi chú (nếu có)..." : "Nhập lý do từ chối..."}
              rows={3}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleAction}>
                {actionTarget.action === "approve" ? <Check size={17} /> : <XCircle size={17} />}
                {actionTarget.action === "approve" ? "Xác nhận phê duyệt" : "Xác nhận từ chối"}
              </button>
              <button onClick={() => { setActionTarget(null); setActionNote(""); }}>
                Hủy
              </button>
            </div>
          </div>
        </section>
      )}

      {editTarget && (
        <section className="panel wide fi-action-panel">
          <h2>Chỉnh sửa nội dung/kế hoạch thực hiện</h2>
          <p className="muted">{editTarget.sk_code || editTarget.title} · {editTarget.team}</p>
          <div className="form-stack">
            <label>Nội dung đăng ký</label>
            <textarea
              value={editForm.content_description}
              onChange={(e) => setEditForm({ ...editForm, content_description: e.target.value })}
              rows={4}
            />
            <label>Kế hoạch thực hiện</label>
            <input
              value={editForm.completion_plan}
              onChange={(e) => setEditForm({ ...editForm, completion_plan: e.target.value })}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleEditSave} disabled={savingEdit} type="button">
                <ClipboardCheck size={17} />
                {savingEdit ? "Đang lưu..." : "Lưu cập nhật"}
              </button>
              <button onClick={() => setEditTarget(null)} type="button">
                Hủy
              </button>
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          {notice && <p className="success">{notice}</p>}
        </section>
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
            <label htmlFor="fi-author-name">Tác giả <span style={{ color: "#dc2626" }}>*</span></label>
            <input
              id="fi-author-name"
              placeholder="Họ tên người đăng ký, ví dụ: Nguyễn Văn A"
              value={form.author_name}
              onChange={(e) => setForm({ ...form, author_name: e.target.value })}
            />
            <label htmlFor="fi-team-input">Đội/tổ</label>
            {role === TEAM_ROLE ? (
              <input id="fi-team-input" value={currentUserId} readOnly aria-label="Đội/tổ" />
            ) : (
              <select id="fi-team-input" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
                {FI_TEAMS.map((team) => (
                  <option key={team}>{team}</option>
                ))}
              </select>
            )}
            <div className="period-selector fi-registration-period">
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
            <label htmlFor="fi-plan">Kế hoạch hoàn thành</label>
            <input
              id="fi-plan"
              placeholder="Vd: T6/2026 hoặc Quý 3/2026"
              value={form.completion_plan}
              onChange={(e) => setForm({ ...form, completion_plan: e.target.value })}
            />
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
          <h2>Danh sách xử lý</h2>
          <button onClick={reload} title="Tải lại danh sách">
            <RefreshCw size={17} />
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="list">
          {items.map((item) => {
            const actions = visibleActionsForSk(role, currentUserId, item);
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
                    <button title="Chỉnh sửa nội dung/kế hoạch" onClick={() => openEdit(item)}>
                      <Pencil size={16} />
                    </button>
                  )}
                  {actions.includes("submit") && (
                    <button title="Gửi duyệt" onClick={() => transition(item.id, "submit")}>
                      <Send size={16} />
                    </button>
                  )}
                  {actions.includes("approve") && (
                    <button title="Phê duyệt" onClick={() => { setActionTarget({ id: item.id, action: "approve" }); setActionNote(""); }}>
                      <Check size={16} />
                    </button>
                  )}
                  {actions.includes("reject") && (
                    <button title="Từ chối" onClick={() => { setActionTarget({ id: item.id, action: "reject" }); setActionNote(""); }}>
                      <XCircle size={16} />
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
              </div>
            );
          })}
          {items.length === 0 && <p className="muted">Không có SK nào cần xử lý.</p>}
        </div>
      </section>
      </div>

      {selectedItem && !selectedItem.is_historical_import && (
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

        </>
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
                  <CheckCircle2 size={14} /> {approvalRate}% được duyệt
                </span>
                <span>
                  <CalendarDays size={14} /> {khmtRate}% đã vào KHMT
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
              <span>Đã duyệt</span>
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
              <small>{formatCount(dashboardTotals.khmt_not_considered)} SK chưa vào KHMT</small>
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
                    <th>Đã duyệt</th>
                    <th>Xem xét sau</th>
                    <th>Chưa duyệt</th>
                    <th>KHMT</th>
                    <th>Hoàn thành</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardTeams.map((team: any) => {
                    const teamApprovalRate = team.total ? Math.round(((team.approved ?? 0) / team.total) * 100) : 0;
                    return (
                      <tr key={team.team}>
                        <td>
                          <strong>{team.team}</strong>
                          <small>{formatCount(team.current)} hiện hành · {formatCount(team.historical)} lịch sử</small>
                        </td>
                        <td>{formatCount(team.total)}</td>
                        <td>
                          <strong className="cell-approved">{formatCount(team.approved)}</strong>
                          <small>{teamApprovalRate}%</small>
                        </td>
                        <td>{formatCount(team.deferred)}</td>
                        <td>{formatCount(team.pending)}</td>
                        <td>
                          <strong className="cell-khmt">{formatCount(team.khmt_considered)}</strong>
                          <small>{formatCount(team.khmt_not_considered)} chưa vào</small>
                        </td>
                        <td>
                          <strong>{formatCount(team.completed_count ?? team.completed)}</strong>
                          <small>{formatCount(team.not_completed)} chưa xong</small>
                        </td>
                      </tr>
                    );
                  })}
                  {dashboardTeams.length === 0 && (
                    <tr>
                      <td colSpan={7}>Chưa có dữ liệu FI.</td>
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
                    <span><i className="fi-swatch approved" /> Đã duyệt</span>
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
                    <span><i className="fi-swatch rejected" /> Từ chối/Hủy</span>
                    <strong>{formatCount(dashboardRejectedCount)}</strong>
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
                {FI_TEAMS.map((team) => (
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
          <div className="legacy-column-heading" aria-hidden="true">
            <span>Kết luận</span>
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
                      <span className={`legacy-khmt-pill ${isKhmtConsidered(item) ? "success" : "empty"}`}>
                        {khmtLabel(item)}
                      </span>
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
                        {actions.includes("approve") && (
                          <button
                            className="legacy-icon-action"
                            title="Phê duyệt"
                            onClick={() => { setActionTarget({ id: item.id, action: "approve" }); setActionNote(""); }}
                            type="button"
                          >
                            <Check size={15} />
                          </button>
                        )}
                        {actions.includes("reject") && (
                          <button
                            className="legacy-icon-action"
                            title="Từ chối"
                            onClick={() => { setActionTarget({ id: item.id, action: "reject" }); setActionNote(""); }}
                            type="button"
                          >
                            <XCircle size={15} />
                          </button>
                        )}
                        <button className="legacy-row-action" onClick={() => openHistoryItem(item)} type="button">
                          {isOpen ? "Thu gọn" : "Xem chi tiết"}
                        </button>
                      </div>
                    </div>
                  </div>
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
                              <button
                                key={img.id}
                                className="legacy-evidence-thumb"
                                type="button"
                                onClick={() => {
                                  setSelectedItem(detail);
                                  setImagePreviewIndex(idx);
                                }}
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
                              </button>
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
