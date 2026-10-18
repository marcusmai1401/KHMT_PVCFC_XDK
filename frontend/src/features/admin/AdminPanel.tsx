import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  Eye,
  FileText,
  KeyRound,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Unlock,
  UserRound,
  Users2,
  X,
} from "lucide-react";
import { api } from "../../api/client";
import { displayTeam, isKhmtConsidered, khmtLabel } from "../fi/FIWorkspace";

type AdminTab = "fi" | "khmt-fi" | "accounts";

const adminTabs: Array<{ value: AdminTab; label: string; icon: typeof FileText; helper: string }> = [
  { value: "fi", label: "FI", icon: FileText, helper: "SK-CTKT" },
  { value: "khmt-fi", label: "Chốt KHMT & FI", icon: CalendarCheck, helper: "Theo tháng" },
  { value: "accounts", label: "Tài khoản", icon: Users2, helper: "Login & pass" },
];

const MONTHLY_ASSESSMENTS = [
  "Hoàn thành xuất sắc nhiệm vụ",
  "Hoàn thành tốt nhiệm vụ",
  "Hoàn thành nhiệm vụ",
  "Không hoàn thành nhiệm vụ",
];

const FI_QUOTA_BY_ASSESSMENT: Record<string, number> = {
  "Hoàn thành xuất sắc nhiệm vụ": 3,
  "Hoàn thành tốt nhiệm vụ": 3,
  "Hoàn thành nhiệm vụ": 1,
  "Không hoàn thành nhiệm vụ": 0,
};

type KhmtFiPreview = {
  team: string;
  month: number;
  year: number;
  report_revision?: number;
  report?: { revision?: number } | null;
  fi_team_revision?: number;
  plan_hash?: string;
  assessment: string;
  required_count: number;
  currently_assigned_count: number;
  unassigned_pool_count: number;
  available_count: number;
  shortage_count: number;
  can_finalize: boolean;
  selected_records: Array<{
    id: string;
    sk_code: string;
    title: string;
    author_name: string;
    approved_at: string | null;
    already_assigned: boolean;
  }>;
  to_release_sk_ids: string[];
};

const roleLabels: Record<string, string> = {
  Admin: "Quản trị",
  Workshop_Leader: "Lãnh đạo Xưởng",
  FI_Coordinator: "Đầu mối FI",
  Team_Account: "Tài khoản đội/tổ",
  Staff: "Nhân viên",
};

const statusLabels: Record<string, string> = {
  Draft: "Bản nháp",
  Submitted: "Chờ xét duyệt",
  NeedMoreInfo: "Cần bổ sung",
  Reviewed: "Đã xem xét",
  Approved: "Đồng ý",
  Rejected: "Không đồng ý",
  Deferred: "Xem xét sau",
  Cancelled: "Đã hủy",
  Completed: "Hoàn tất",
};

const statusOrder = ["Draft", "Submitted", "NeedMoreInfo", "Reviewed", "Approved", "Deferred", "Rejected", "Cancelled", "Completed"];

function displayRole(value: string | null | undefined) {
  if (!value) return "Chưa rõ";
  return roleLabels[value] ?? value;
}

function displayStatus(value: string | null | undefined) {
  if (!value) return "Chưa rõ";
  return statusLabels[value] ?? value;
}

function statusTone(value: string | null | undefined) {
  if (value === "Approved" || value === "Completed") return "success";
  if (value === "Rejected" || value === "Cancelled") return "danger";
  if (value === "Deferred" || value === "NeedMoreInfo") return "warning";
  if (value === "Submitted" || value === "Reviewed") return "info";
  return "neutral";
}

function actionLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    login: "Đăng nhập",
    change_password: "Đổi mật khẩu",
    create: "Tạo tài khoản",
    update_role: "Cập nhật quyền",
    save_draft: "Lưu nháp OKR",
    submit: "Gửi OKR",
    upload: "Upload báo cáo",
  };
  return value ? labels[value] ?? value : "Chưa có";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Chưa ghi";
  const normalized = String(value).includes("T") ? String(value) : String(value).replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatRegistration(item: any) {
  const history = Array.isArray(item.status_history) ? item.status_history : [];
  const comments = history[0]?.comments;
  const month = Number(comments?.registration_month);
  const year = Number(comments?.registration_year);
  if (Number.isFinite(month) && month >= 1 && month <= 12 && Number.isFinite(year)) {
    return `T${month}/${year}`;
  }
  if (item.created_at) {
    const date = new Date(String(item.created_at).replace(" ", "T"));
    if (!Number.isNaN(date.getTime())) return `T${date.getMonth() + 1}/${date.getFullYear()}`;
  }
  return "Chưa rõ";
}

function compareFiRows(left: any, right: any) {
  const leftTime = new Date(String(left.created_at ?? "").replace(" ", "T")).getTime() || 0;
  const rightTime = new Date(String(right.created_at ?? "").replace(" ", "T")).getTime() || 0;
  return rightTime - leftTime || Number(left.bm01_source_row ?? 0) - Number(right.bm01_source_row ?? 0);
}

function historyActionLabel(entry: any) {
  if (!entry?.from_status && entry?.to_status === "Draft") return "Ghi nhận đăng ký";
  if (!entry?.from_status) return displayStatus(entry?.to_status);
  return `${displayStatus(entry.from_status)} -> ${displayStatus(entry.to_status)}`;
}

function latestByTime(rows: any[]) {
  return [...rows].sort((a, b) => {
    const left = new Date(String(a?.created_at ?? "").replace(" ", "T")).getTime() || 0;
    const right = new Date(String(b?.created_at ?? "").replace(" ", "T")).getTime() || 0;
    return right - left;
  })[0];
}

export function AdminPanel() {
  const [activeTab, setActiveTab] = useState<AdminTab>("fi");
  const [fiRows, setFiRows] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountRoleFilter, setAccountRoleFilter] = useState("all");
  const [accountTeamFilter, setAccountTeamFilter] = useState("all");
  const [accountStatusFilter, setAccountStatusFilter] = useState("all");
  const [accountPasswordFilter, setAccountPasswordFilter] = useState("all");
  const [accountLoginFilter, setAccountLoginFilter] = useState("all");
  const [accountActivityFilter, setAccountActivityFilter] = useState("all");
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ userId: string; password: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [khmtMonth, setKhmtMonth] = useState(() => new Date().getMonth() + 1);
  const [khmtYear, setKhmtYear] = useState(() => new Date().getFullYear());
  const [khmtRows, setKhmtRows] = useState<any[]>([]);
  const [khmtAssessments, setKhmtAssessments] = useState<Record<string, string>>({});
  const [khmtLoading, setKhmtLoading] = useState(false);
  const [khmtBusyTeam, setKhmtBusyTeam] = useState<string | null>(null);
  const [khmtPreview, setKhmtPreview] = useState<KhmtFiPreview | null>(null);
  const [khmtReason, setKhmtReason] = useState("");

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.fiReports(),
      api.fiDashboard(),
      api.adminUsers(),
      api.auditLog({ entity_type: "Account" }),
    ])
      .then(([rows, dashboardData, userRows, logs]) => {
        setFiRows([...rows].sort(compareFiRows));
        setDashboard(dashboardData);
        setUsers([...userRows].sort((a, b) => String(a.id).localeCompare(String(b.id), "vi")));
        setAuditRows(logs);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  const loadKhmtOverview = (clearError = true) => {
    setKhmtLoading(true);
    api.adminKhmtFiOverview(khmtMonth, khmtYear)
      .then((rows) => {
        setKhmtRows(rows);
        setKhmtAssessments(Object.fromEntries(
          rows.map((row: any) => [row.team, row.assessment || "Hoàn thành nhiệm vụ"]),
        ));
        setKhmtPreview(null);
        if (clearError) setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setKhmtLoading(false));
  };

  useEffect(() => {
    if (activeTab === "khmt-fi") loadKhmtOverview();
  }, [activeTab, khmtMonth, khmtYear]);

  const openKhmtPreview = (row: any) => {
    if (!row.has_report) {
      setError(`${displayTeam(row.team)} chưa có báo cáo OKR cho T${khmtMonth}/${khmtYear}.`);
      return;
    }
    const assessment = khmtAssessments[row.team] || row.assessment;
    if (!assessment) {
      setError(`Hãy chọn mức đánh giá cho ${displayTeam(row.team)} trước khi xem trước.`);
      return;
    }
    setKhmtBusyTeam(row.team);
    setError("");
    api.adminKhmtFiPreview(row.team, khmtMonth, khmtYear, assessment)
      .then((preview) => {
        setKhmtPreview(preview);
        setKhmtReason(`Chốt KHMT tháng ${khmtMonth}/${khmtYear} · ${displayTeam(row.team)}`);
      })
      .catch((err) => setError(err.message))
      .finally(() => setKhmtBusyTeam(null));
  };

  const finalizeKhmt = () => {
    if (!khmtPreview || !khmtReason.trim() || !khmtPreview.can_finalize || khmtBusyTeam) return;
    setKhmtBusyTeam(khmtPreview.team);
    setError("");
    const assessment = khmtAssessments[khmtPreview.team] || khmtPreview.assessment;
    api.adminKhmtFiFinalize(khmtPreview.team, khmtMonth, khmtYear, khmtReason.trim(), assessment, {
      expectedRevision: khmtPreview.report_revision ?? khmtPreview.report?.revision ?? 0,
      expectedFiTeamRevision: khmtPreview.fi_team_revision,
      expectedPlanHash: khmtPreview.plan_hash,
    })
      .then(() => {
        setKhmtPreview(null);
        setKhmtReason("");
        setError(`Đã chốt ${displayTeam(khmtPreview.team)} và phân bổ ${khmtPreview.required_count} FI cho T${khmtMonth}/${khmtYear}.`);
        loadKhmtOverview(false);
      })
      .catch((err) => setError(err.message))
      .finally(() => setKhmtBusyTeam(null));
  };

  const unlockKhmt = (row: any) => {
    const reason = window.prompt(`Lý do mở chốt ${displayTeam(row.team)} — T${khmtMonth}/${khmtYear}`);
    if (!reason?.trim()) return;
    setKhmtBusyTeam(row.team);
    setError("");
    api.adminKhmtFiUnlock(row.team, khmtMonth, khmtYear, reason.trim(), {
      expectedRevision: row.report_revision ?? row.report?.revision ?? 0,
    })
      .then(() => {
        setError(`Đã mở chốt ${displayTeam(row.team)}. Phân bổ hiện tại được giữ cho tới lần chốt lại.`);
        loadKhmtOverview(false);
      })
      .catch((err) => setError(err.message))
      .finally(() => setKhmtBusyTeam(null));
  };

  const handleResetPassword = (user: any) => {
    const label = user.display_name || user.full_name || user.id;
    const confirmed = window.confirm(
      `Reset mật khẩu cho "${label}" (${user.id})?\n\n` +
        "Hệ thống sẽ đặt lại mật khẩu mặc định và buộc người dùng đổi mật khẩu " +
        "ngay khi đăng nhập lần kế tiếp.",
    );
    if (!confirmed) return;
    setResetBusyId(user.id);
    setError("");
    setResetResult(null);
    api
      .adminResetUserPassword(user.id)
      .then((res) => {
        setResetResult({ userId: user.id, password: res.temporary_password });
        reload();
      })
      .catch((err) => setError(err.message))
      .finally(() => setResetBusyId(null));
  };

  const teams = useMemo(
    () => Array.from(new Set(fiRows.map((row) => row.team).filter(Boolean))).sort((a, b) => displayTeam(a).localeCompare(displayTeam(b), "vi")),
    [fiRows],
  );

  const statuses = useMemo(() => {
    const present = new Set(fiRows.map((row) => row.status).filter(Boolean));
    return [
      ...statusOrder.filter((status) => present.has(status)),
      ...Array.from(present).filter((status) => !statusOrder.includes(status)).sort(),
    ];
  }, [fiRows]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return fiRows.filter((row) => {
      if (teamFilter !== "all" && row.team !== teamFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!keyword) return true;
      const haystack = [
        row.sk_code,
        row.title,
        row.author_name,
        row.author_user_id,
        row.team,
        row.content_description,
        row.completion_plan,
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [fiRows, search, teamFilter, statusFilter]);

  const accountActivityRows = useMemo(() => {
    return users
      .map((user) => {
        const relatedLogs = auditRows.filter((row) => row.actor === user.id || (row.entity_type === "Account" && row.entity_id === user.id));
        const loginLog = latestByTime(relatedLogs.filter((row) => row.action === "login"));
        const passwordLog = latestByTime(relatedLogs.filter((row) => row.action === "change_password"));
        const latestLog = latestByTime(relatedLogs);
        return { user, relatedLogs, loginLog, passwordLog, latestLog };
      });
  }, [users, auditRows]);

  const accountRoleOptions = useMemo(() => {
    return Array.from(new Set(users.map((user) => user.role).filter(Boolean)))
      .sort((a, b) => displayRole(a).localeCompare(displayRole(b), "vi"));
  }, [users]);

  const accountTeamOptions = useMemo(() => {
    return Array.from(new Set(users.map((user) => user.team || "__none")))
      .sort((a, b) => displayTeam(a === "__none" ? null : a).localeCompare(displayTeam(b === "__none" ? null : b), "vi"));
  }, [users]);

  const accountActivityOptions = useMemo(() => {
    return Array.from(new Set(accountActivityRows.map((row) => row.latestLog?.action).filter(Boolean)))
      .sort((a, b) => actionLabel(a).localeCompare(actionLabel(b), "vi"));
  }, [accountActivityRows]);

  const accountRows = useMemo(() => {
    const keyword = accountSearch.trim().toLowerCase();
    return accountActivityRows.filter(({ user, loginLog, latestLog }) => {
      const userTeam = user.team || "__none";
      if (accountRoleFilter !== "all" && user.role !== accountRoleFilter) return false;
      if (accountTeamFilter !== "all" && userTeam !== accountTeamFilter) return false;
      if (accountStatusFilter === "active" && !user.is_active) return false;
      if (accountStatusFilter === "locked" && user.is_active) return false;
      if (accountPasswordFilter === "changed" && user.must_change_password) return false;
      if (accountPasswordFilter === "pending" && !user.must_change_password) return false;
      if (accountLoginFilter === "has_login" && !loginLog) return false;
      if (accountLoginFilter === "no_login" && loginLog) return false;
      if (accountActivityFilter === "no_activity" && latestLog) return false;
      if (accountActivityFilter !== "all" && accountActivityFilter !== "no_activity" && latestLog?.action !== accountActivityFilter) return false;
      if (!keyword) return true;
      const haystack = [
        user.id,
        user.display_name,
        user.full_name,
        user.role,
        user.team,
        loginLog?.created_at,
        latestLog?.action,
        actionLabel(latestLog?.action),
        latestLog?.created_at,
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [
    accountActivityRows,
    accountActivityFilter,
    accountLoginFilter,
    accountPasswordFilter,
    accountRoleFilter,
    accountSearch,
    accountStatusFilter,
    accountTeamFilter,
  ]);

  const totals = dashboard?.totals ?? {};
  const approvedCount = Number(totals.review_passed ?? fiRows.filter((row) => ["Approved", "Completed"].includes(row.status)).length);
  const pendingCount = Number(totals.pending ?? fiRows.filter((row) => ["Submitted", "NeedMoreInfo", "Reviewed"].includes(row.status)).length);
  const khmtCount = Number(totals.khmt_considered ?? fiRows.filter(isKhmtConsidered).length);
  const activeUsers = users.filter((user) => user.is_active).length;
  const changedPasswordCount = users.filter((user) => !user.must_change_password).length;
  const loggedInCount = accountActivityRows.filter((row) => Boolean(row.loginLog)).length;
  const readyAccountCount = accountActivityRows.filter((row) => Boolean(row.loginLog) && !row.user.must_change_password).length;

  const renderFiTab = () => (
    <>
      <div className="admin-fi-kpis">
        <div className="admin-fi-kpi">
          <Database size={18} />
          <span>Tổng SK</span>
          <strong>{fiRows.length}</strong>
          <small>Tất cả hồ sơ FI đang có dữ liệu</small>
        </div>
        <div className="admin-fi-kpi current">
          <ShieldCheck size={18} />
          <span>Đã xét đạt</span>
          <strong>{approvedCount}</strong>
          <small>{khmtCount} hồ sơ đã vào KHMT</small>
        </div>
        <div className="admin-fi-kpi">
          <Clock3 size={18} />
          <span>Chờ xử lý</span>
          <strong>{pendingCount}</strong>
          <small>Cần tiếp tục xét duyệt</small>
        </div>
        <div className="admin-fi-kpi">
          <CheckCircle2 size={18} />
          <span>Đã vào KHMT</span>
          <strong>{khmtCount}</strong>
          <small>{pendingCount} hồ sơ còn chờ xử lý</small>
        </div>
      </div>

      <div className="admin-fi-controls">
        <label className="admin-filter-field">
          Đội/tổ
          <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
            <option value="all">Tất cả</option>
            {teams.map((team) => (
              <option key={team} value={team}>{displayTeam(team)}</option>
            ))}
          </select>
        </label>
        <label className="admin-filter-field">
          Trạng thái
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Tất cả</option>
            {statuses.map((status) => (
              <option key={status} value={status}>{displayStatus(status)}</option>
            ))}
          </select>
        </label>
        <label className="admin-search-field">
          <Search size={15} />
          <input
            placeholder="Tìm mã, tên SK, người đăng ký, nội dung..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="admin-fi-table-wrap">
        <table className="admin-fi-table">
          <thead>
            <tr>
              <th>Mã SK</th>
              <th>Tên SK-CTKT</th>
              <th>Người đăng ký</th>
              <th>Đội/tổ</th>
              <th>Tháng đăng ký</th>
              <th>Thời điểm tạo</th>
              <th>Kết luận</th>
              <th>KHMT</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const expanded = expandedId === row.id;
              const history = Array.isArray(row.status_history) ? row.status_history : [];
              return (
                <Fragment key={row.id}>
                  <tr>
                    <td><strong>{row.sk_code}</strong></td>
                    <td className="admin-fi-title-cell">{row.title}</td>
                    <td>
                      <span className="admin-person">
                        <UserRound size={14} />
                        <span>
                          <strong>{row.author_name}</strong>
                          <small>{row.author_user_id}</small>
                        </span>
                      </span>
                    </td>
                    <td>{displayTeam(row.team)}</td>
                    <td>{formatRegistration(row)}</td>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>
                      <span className={`admin-status-pill ${statusTone(row.status)}`}>{displayStatus(row.status)}</span>
                    </td>
                    <td>
                      <span className={`admin-khmt-pill ${isKhmtConsidered(row) ? "success" : "empty"}`}>
                        {khmtLabel(row)}
                      </span>
                    </td>
                    <td>
                      <button
                        aria-expanded={expanded}
                        className="admin-detail-button"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                        type="button"
                      >
                        <FileText size={15} />
                        {expanded ? "Đóng" : "Mở"}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="admin-detail-row">
                      <td colSpan={9}>
                        <div className="admin-fi-detail">
                          <div className="admin-fi-detail-grid">
                            <div>
                              <span>ID</span>
                              <strong>{row.id}</strong>
                            </div>
                            <div>
                              <span>Người tạo</span>
                              <strong>{row.author_user_id}</strong>
                            </div>
                            <div>
                              <span>Gửi duyệt</span>
                              <strong>{formatDateTime(row.submitted_at)}</strong>
                            </div>
                            <div>
                              <span>Xét duyệt</span>
                              <strong>{formatDateTime(row.reviewed_at || row.approved_at)}</strong>
                            </div>
                            <div>
                              <span>Hoàn tất</span>
                              <strong>{formatDateTime(row.completed_at)}</strong>
                            </div>
                            <div>
                              <span>Cập nhật cuối</span>
                              <strong>{formatDateTime(row.updated_at)}</strong>
                            </div>
                            <div>
                              <span>Xét KHMT</span>
                              <strong>{row.consider_for_khmt ? "Có" : "Không"}</strong>
                            </div>
                            <div>
                              <span>Tính OKR</span>
                              <strong>{row.is_counted_for_okr ? "Có" : "Không"}</strong>
                            </div>
                            <div>
                              <span>Công khai</span>
                              <strong>{row.is_public ? "Có" : "Không"}</strong>
                            </div>
                          </div>
                          <div className="admin-fi-detail-section">
                            <span>Nội dung đăng ký</span>
                            <p>{row.content_description || "Chưa có nội dung."}</p>
                          </div>
                          <div className="admin-fi-detail-section">
                            <span>Kế hoạch hoàn thành</span>
                            <p>{row.completion_plan || "Chưa ghi"}</p>
                          </div>
                          {(row.fi_coordinator_comments || row.bm01_raw_conclusion || row.workshop_leader_conclusion || row.decision_note) && (
                            <div className="admin-fi-detail-section">
                              <span>Thông tin xét duyệt</span>
                              <p>{row.fi_coordinator_comments || row.bm01_raw_conclusion || "Chưa ghi"}</p>
                              {row.workshop_leader_conclusion && <p>Kết luận LĐX: {row.workshop_leader_conclusion}</p>}
                              {row.decision_note && <p>Ghi chú: {row.decision_note}</p>}
                            </div>
                          )}
                          <div className="admin-fi-detail-section">
                            <span>Lịch sử xử lý</span>
                            {history.length > 0 ? (
                              <div className="admin-history-list">
                                {history.map((entry: any, index: number) => (
                                  <div className="admin-history-entry" key={`${row.id}-history-${index}`}>
                                    <strong>{historyActionLabel(entry)}</strong>
                                    <small>
                                      {formatDateTime(entry.changed_at)} · bởi {entry.changed_by || "Hệ thống"}
                                    </small>
                                    {entry.reason && <em>{entry.reason}</em>}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p>Chưa có lịch sử xử lý.</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <div className="table-empty-state">
                    <Search size={20} />
                    <span>Không có SK-CTKT phù hợp với bộ lọc hiện tại.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );

  const renderKhmtFiTab = () => {
    const selectedQuotaForRow = (row: any) => FI_QUOTA_BY_ASSESSMENT[khmtAssessments[row.team] || row.assessment || "Hoàn thành nhiệm vụ"] ?? 0;
    const shortageForRow = (row: any) => row.has_report
      ? Math.max(0, selectedQuotaForRow(row) - Number(row.available_count ?? 0))
      : 0;
    const readyCount = khmtRows.filter((row) => row.has_report && shortageForRow(row) === 0 && !row.locked).length;
    const lockedCount = khmtRows.filter((row) => row.locked).length;
    const missingReportCount = khmtRows.filter((row) => !row.has_report).length;
    const shortageCount = khmtRows.filter((row) => row.has_report && shortageForRow(row) > 0).length;

    return (
      <>
        <div className="admin-khmt-toolbar">
          <div>
            <h3>Chốt KHMT và phân bổ FI theo tháng</h3>
            <p>
              Chọn mức đánh giá cho từng đội/tổ, xem trước danh sách FI rồi mới xác nhận. Việc mở tab không tự thay đổi dữ liệu.
            </p>
          </div>
          <div className="admin-khmt-period">
            <label className="admin-filter-field">
              Tháng
              <select value={khmtMonth} onChange={(event) => setKhmtMonth(Number(event.target.value))}>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>T{month}</option>
                ))}
              </select>
            </label>
            <label className="admin-filter-field">
              Năm
              <select value={khmtYear} onChange={(event) => setKhmtYear(Number(event.target.value))}>
                {Array.from({ length: 12 }, (_, index) => new Date().getFullYear() - 3 + index).map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>
            <button className="admin-detail-button" disabled={khmtLoading} onClick={() => loadKhmtOverview()} type="button">
              <RefreshCw size={15} className={khmtLoading ? "icon-spin" : undefined} />
              Tải lại
            </button>
          </div>
        </div>

        <div className="admin-khmt-notice" role="note">
          <ShieldCheck size={18} />
          <div>
            <strong>An toàn dữ liệu thủ công</strong>
            <span>Hệ thống chỉ phân bổ sau khi Admin chọn mức, xem trước và bấm xác nhận. Các FI đã làm thủ công, như tháng 7, không bị tự động thay đổi.</span>
          </div>
        </div>

        <div className="admin-fi-kpis admin-khmt-kpis">
          <div className="admin-fi-kpi current">
            <CalendarCheck size={18} />
            <span>Sẵn sàng chốt</span>
            <strong>{readyCount}/{khmtRows.length}</strong>
            <small>Đủ FI và có báo cáo trong kỳ</small>
          </div>
          <div className="admin-fi-kpi">
            <Lock size={18} />
            <span>Đã chốt</span>
            <strong>{lockedCount}</strong>
            <small>Có thể mở chốt khi cần điều chỉnh</small>
          </div>
          <div className="admin-fi-kpi">
            <AlertTriangle size={18} />
            <span>Thiếu FI</span>
            <strong>{shortageCount}</strong>
            <small>Cần bổ sung FI hoặc chọn lại mức</small>
          </div>
          <div className="admin-fi-kpi">
            <FileText size={18} />
            <span>Chưa có báo cáo</span>
            <strong>{missingReportCount}</strong>
            <small>Chưa thể chốt KHMT tự động</small>
          </div>
        </div>

        <div className="admin-khmt-table-wrap">
          <table className="admin-khmt-table">
            <thead>
              <tr>
                <th>Đội/tổ</th>
                <th>Báo cáo tháng</th>
                <th>Mức đánh giá Admin chọn</th>
                <th>Định mức</th>
                <th>FI khả dụng</th>
                <th>Đang gán kỳ này</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {khmtRows.map((row) => {
                const assessment = khmtAssessments[row.team] || row.assessment || "Hoàn thành nhiệm vụ";
                const required = FI_QUOTA_BY_ASSESSMENT[assessment] ?? 0;
                const selectedShortage = shortageForRow(row);
                const manualNote = !row.allocation && Number(row.currently_assigned_count ?? 0) > 0;
                return (
                  <tr key={row.team}>
                    <td>
                      <strong>{displayTeam(row.team)}</strong>
                      {manualNote && <small className="admin-khmt-cell-note">Có phân bổ thủ công hiện tại</small>}
                    </td>
                    <td>
                      <span className={`admin-status-pill ${row.has_report ? (row.locked ? "success" : "info") : "neutral"}`}>
                        {row.status}
                      </span>
                      {row.submitted_at && <small className="admin-khmt-cell-note">Gửi {formatDateTime(row.submitted_at)}</small>}
                    </td>
                    <td>
                      <select
                        className="admin-khmt-assessment-select"
                        disabled={!row.has_report || row.locked || Boolean(khmtBusyTeam)}
                        value={assessment}
                        onChange={(event) => setKhmtAssessments((current) => ({ ...current, [row.team]: event.target.value }))}
                      >
                        {MONTHLY_ASSESSMENTS.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </td>
                    <td><strong className="admin-khmt-quota">{required} FI</strong></td>
                    <td>{row.has_report ? `${row.available_count ?? 0}/${required}` : "—"}</td>
                    <td>{row.currently_assigned_count ?? 0}</td>
                    <td>
                      {row.locked ? (
                        <span className="admin-status-pill success">Đã chốt & phân bổ</span>
                      ) : row.preview_error ? (
                        <span className="admin-status-pill danger">Cần kiểm tra mức</span>
                      ) : row.has_report && selectedShortage > 0 ? (
                        <span className="admin-status-pill warning">Thiếu {selectedShortage} FI</span>
                      ) : row.has_report ? (
                        <span className="admin-status-pill info">Sẵn sàng xem trước</span>
                      ) : (
                        <span className="admin-status-pill neutral">Chưa có báo cáo</span>
                      )}
                    </td>
                    <td>
                      {row.locked ? (
                        <button className="admin-detail-button" disabled={khmtBusyTeam === row.team} onClick={() => unlockKhmt(row)} type="button">
                          <Unlock size={15} /> Mở chốt
                        </button>
                      ) : row.has_report ? (
                        <button className="admin-detail-button admin-khmt-preview-button" disabled={khmtBusyTeam === row.team} onClick={() => openKhmtPreview(row)} type="button">
                          <Eye size={15} /> Xem trước & chốt
                        </button>
                      ) : (
                        <small className="admin-khmt-muted-action">Nhập báo cáo trước</small>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!khmtRows.length && (
                <tr><td colSpan={8}><div className="table-empty-state"><CalendarCheck size={20} /><span>{khmtLoading ? "Đang tải kỳ KHMT..." : "Chưa có dữ liệu cho kỳ này."}</span></div></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {khmtPreview && (
          <div className="fi-allocation-backdrop" role="presentation">
            <section className="fi-allocation-modal admin-khmt-preview-modal" role="dialog" aria-modal="true" aria-labelledby="admin-khmt-preview-title">
              <header className="fi-allocation-modal-head">
                <div>
                  <span className="fi-allocation-kicker">Chốt KHMT tháng {khmtPreview.month}/{khmtPreview.year}</span>
                  <h2 id="admin-khmt-preview-title">{displayTeam(khmtPreview.team)} · Phân bổ FI</h2>
                  <p>{khmtPreview.assessment}</p>
                </div>
                <button aria-label="Đóng xem trước" className="fi-allocation-close" disabled={Boolean(khmtBusyTeam)} onClick={() => setKhmtPreview(null)} type="button"><X size={19} /></button>
              </header>
              <div className="fi-allocation-modal-body">
                <div className="fi-allocation-stats">
                  <div><span>Định mức</span><strong>{khmtPreview.required_count} FI</strong></div>
                  <div><span>Đang gán</span><strong>{khmtPreview.currently_assigned_count}</strong></div>
                  <div><span>Kho chưa phân bổ</span><strong>{khmtPreview.unassigned_pool_count}</strong></div>
                  <div className={khmtPreview.can_finalize ? "is-ready" : "is-shortage"}><span>Khả dụng</span><strong>{khmtPreview.available_count}/{khmtPreview.required_count}</strong></div>
                </div>
                {!khmtPreview.can_finalize && (
                  <div className="fi-allocation-alert is-danger" role="alert"><AlertTriangle size={18} /><div><strong>Chưa đủ FI để chốt</strong><p>Còn thiếu {khmtPreview.shortage_count} FI hợp lệ. Hệ thống sẽ không thay đổi dữ liệu.</p></div></div>
                )}
                <section className="fi-allocation-selection">
                  <div className="panel-header"><div><h3>Danh sách FI sẽ ghi nhận</h3><p className="panel-sub">Ưu tiên FI được duyệt cũ nhất; FI đang gán hợp lệ được giữ trước.</p></div><span className="status-badge">{khmtPreview.selected_records.length}/{khmtPreview.required_count}</span></div>
                  {khmtPreview.selected_records.length ? (
                    <div className="fi-allocation-list">{khmtPreview.selected_records.map((item, index) => <article key={item.id}><span className="fi-allocation-order">{index + 1}</span><div><strong>{item.sk_code}</strong><p>{item.title}</p><small>{item.author_name}{item.approved_at ? ` · Duyệt ${new Date(item.approved_at).toLocaleDateString("vi-VN")}` : ""}{item.already_assigned ? " · Đang gán kỳ này" : ""}</small></div></article>)}</div>
                  ) : <div className="fi-allocation-empty"><CheckCircle2 size={20} /><span>Mức đánh giá này không yêu cầu ghi nhận FI.</span></div>}
                </section>
                {khmtPreview.to_release_sk_ids.length > 0 && <p className="fi-allocation-release-note">{khmtPreview.to_release_sk_ids.length} FI vượt định mức hoặc không hợp lệ sẽ được trả về kho.</p>}
                <label className="fi-allocation-reason"><span>Lý do chốt</span><textarea maxLength={2000} rows={2} value={khmtReason} onChange={(event) => setKhmtReason(event.target.value)} /></label>
              </div>
              <footer className="fi-allocation-modal-actions">
                <button className="btn-primary" disabled={!khmtPreview.can_finalize || !khmtReason.trim() || Boolean(khmtBusyTeam)} onClick={finalizeKhmt} type="button"><Lock size={17} />{khmtBusyTeam ? "Đang chốt..." : "Xác nhận chốt & phân bổ"}</button>
                <button disabled={Boolean(khmtBusyTeam)} onClick={() => setKhmtPreview(null)} type="button">Quay lại</button>
              </footer>
            </section>
          </div>
        )}
      </>
    );
  };

  const renderAccountsTab = () => (
    <>
      <div className="admin-fi-kpis admin-account-kpis">
        <div className="admin-fi-kpi">
          <Users2 size={18} />
          <span>Tổng tài khoản</span>
          <strong>{users.length}</strong>
          <small>{activeUsers} đang hoạt động</small>
        </div>
        <div className="admin-fi-kpi current">
          <KeyRound size={18} />
          <span>Đã đổi pass</span>
          <strong>{changedPasswordCount}</strong>
          <small>{users.length - changedPasswordCount} còn bắt buộc đổi</small>
        </div>
        <div className="admin-fi-kpi">
          <Clock3 size={18} />
          <span>Có log login</span>
          <strong>{loggedInCount}</strong>
          <small>Áp dụng cho lần đăng nhập từ bản cập nhật này</small>
        </div>
        <div className="admin-fi-kpi">
          <ShieldCheck size={18} />
          <span>Sẵn sàng dùng</span>
          <strong>{readyAccountCount}</strong>
          <small>Đã login và không còn yêu cầu đổi pass</small>
        </div>
      </div>

      {resetResult && (
        <div className="admin-reset-banner" role="status">
          <ShieldCheck size={18} />
          <div className="admin-reset-banner-body">
            <strong>Đã reset mật khẩu cho “{resetResult.userId}”.</strong>
            <span>
              Mật khẩu tạm:{" "}
              <code className="admin-reset-password">{resetResult.password}</code> — gửi cho người
              dùng qua kênh an toàn. Họ sẽ bị buộc đổi mật khẩu khi đăng nhập lần kế tiếp.
            </span>
          </div>
          <div className="admin-reset-banner-actions">
            <button
              type="button"
              className="admin-detail-button"
              onClick={() => navigator.clipboard?.writeText(resetResult.password)}
            >
              <Copy size={14} />
              Sao chép
            </button>
            <button
              type="button"
              className="admin-reset-banner-close"
              aria-label="Đóng thông báo"
              onClick={() => setResetResult(null)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="admin-fi-controls">
        <label className="admin-search-field admin-account-search">
          <Search size={15} />
          <input
            placeholder="Tìm tài khoản, họ tên, vai trò, đội/tổ..."
            value={accountSearch}
            onChange={(event) => setAccountSearch(event.target.value)}
          />
        </label>
        <label className="admin-filter-field">
          Vai trò
          <select value={accountRoleFilter} onChange={(event) => setAccountRoleFilter(event.target.value)}>
            <option value="all">Tất cả</option>
            {accountRoleOptions.map((role) => (
              <option key={role} value={role}>{displayRole(role)}</option>
            ))}
          </select>
        </label>
        <label className="admin-filter-field">
          Đội/tổ
          <select value={accountTeamFilter} onChange={(event) => setAccountTeamFilter(event.target.value)}>
            <option value="all">Tất cả</option>
            {accountTeamOptions.map((team) => (
              <option key={team} value={team}>{team === "__none" ? "Không gán" : displayTeam(team)}</option>
            ))}
          </select>
        </label>
        <label className="admin-filter-field">
          Trạng thái
          <select value={accountStatusFilter} onChange={(event) => setAccountStatusFilter(event.target.value)}>
            <option value="all">Tất cả</option>
            <option value="active">Đang hoạt động</option>
            <option value="locked">Đã khóa</option>
          </select>
        </label>
        <label className="admin-filter-field">
          Đổi pass
          <select value={accountPasswordFilter} onChange={(event) => setAccountPasswordFilter(event.target.value)}>
            <option value="all">Tất cả</option>
            <option value="changed">Đã đổi/không bắt buộc</option>
            <option value="pending">Chưa đổi</option>
          </select>
        </label>
        <label className="admin-filter-field">
          Login
          <select value={accountLoginFilter} onChange={(event) => setAccountLoginFilter(event.target.value)}>
            <option value="all">Tất cả</option>
            <option value="has_login">Đã có log</option>
            <option value="no_login">Chưa có log</option>
          </select>
        </label>
        <label className="admin-filter-field">
          Hoạt động
          <select value={accountActivityFilter} onChange={(event) => setAccountActivityFilter(event.target.value)}>
            <option value="all">Tất cả</option>
            <option value="no_activity">Chưa có hoạt động</option>
            {accountActivityOptions.map((action) => (
              <option key={action} value={action}>{actionLabel(action)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="admin-fi-table-wrap">
        <table className="admin-fi-table admin-account-table">
          <thead>
            <tr>
              <th>Tài khoản</th>
              <th>Người dùng</th>
              <th>Vai trò</th>
              <th>Đội/tổ</th>
              <th>Trạng thái</th>
              <th>Đổi mật khẩu</th>
              <th>Lần login gần nhất</th>
              <th>Hoạt động gần nhất</th>
              <th>Ngày tạo</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {accountRows.map(({ user, loginLog, passwordLog, latestLog }) => (
              <tr key={user.id}>
                <td><strong>{user.id}</strong></td>
                <td>
                  <span className="admin-person">
                    <UserRound size={14} />
                    <span>
                      <strong>{user.display_name || user.full_name || user.id}</strong>
                      <small>{user.full_name || "Chưa ghi họ tên đầy đủ"}</small>
                    </span>
                  </span>
                </td>
                <td>{displayRole(user.role)}</td>
                <td>{displayTeam(user.team) || "Không gán"}</td>
                <td>
                  <span className={`admin-status-pill ${user.is_active ? "success" : "danger"}`}>
                    {user.is_active ? "Đang hoạt động" : "Đã khóa"}
                  </span>
                </td>
                <td>
                  <span className={`admin-status-pill ${user.must_change_password ? "warning" : "success"}`}>
                    {user.must_change_password ? "Chưa đổi" : "Đã đổi/không bắt buộc"}
                  </span>
                  {passwordLog && <small className="admin-cell-note">{formatDateTime(passwordLog.created_at)}</small>}
                </td>
                <td>{loginLog ? formatDateTime(loginLog.created_at) : "Chưa có log"}</td>
                <td>
                  {latestLog ? (
                    <>
                      <strong>{actionLabel(latestLog.action)}</strong>
                      <small className="admin-cell-note">{formatDateTime(latestLog.created_at)}</small>
                    </>
                  ) : (
                    "Chưa có hoạt động"
                  )}
                </td>
                <td>{formatDateTime(user.created_at)}</td>
                <td>
                  <button
                    type="button"
                    className="admin-detail-button admin-reset-button"
                    onClick={() => handleResetPassword(user)}
                    disabled={resetBusyId === user.id}
                    title="Đặt lại mật khẩu mặc định và buộc đổi khi đăng nhập"
                  >
                    <RotateCcw size={14} />
                    {resetBusyId === user.id ? "Đang reset..." : "Reset mật khẩu"}
                  </button>
                </td>
              </tr>
            ))}
            {accountRows.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <div className="table-empty-state">
                    <Search size={20} />
                    <span>Không có tài khoản phù hợp với bộ lọc hiện tại.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <div
      className="content-grid admin-fi-shell"
      data-snapshot-target="true"
      data-snapshot-name="quan-tri"
    >
      {error && <p className="error">{error}</p>}
      <section className="panel wide admin-fi-panel admin-system-panel">
        <div className="panel-header admin-fi-header">
          <div>
            <h2>Quản trị hệ thống</h2>
            <p className="muted">
              Theo dõi dữ liệu vận hành: SK-CTKT và tài khoản đã sử dụng.
            </p>
          </div>
          <button onClick={reload} disabled={loading} type="button">
            <RefreshCw size={17} className={loading ? "icon-spin" : undefined} />
            {loading ? "Đang tải..." : "Tải lại"}
          </button>
        </div>

        <div className="admin-tabs" role="tablist" aria-label="Nhóm quản trị">
          {adminTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-selected={activeTab === item.value}
                className={activeTab === item.value ? "active" : ""}
                key={item.value}
                onClick={() => setActiveTab(item.value)}
                role="tab"
                type="button"
              >
                <Icon size={16} />
                <span>{item.label}</span>
                <small>{item.helper}</small>
              </button>
            );
          })}
        </div>

        {activeTab === "fi" && renderFiTab()}
        {activeTab === "khmt-fi" && renderKhmtFiTab()}
        {activeTab === "accounts" && renderAccountsTab()}
      </section>
    </div>
  );
}
