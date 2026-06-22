import { Fragment, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  FileText,
  History,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
  Users2,
  X,
} from "lucide-react";
import { api } from "../../api/client";
import { displayTeam, isKhmtConsidered, khmtLabel } from "../fi/FIWorkspace";

type AdminTab = "fi" | "accounts";
type FiScope = "current" | "all" | "historical";

const adminTabs: Array<{ value: AdminTab; label: string; icon: typeof FileText; helper: string }> = [
  { value: "fi", label: "FI", icon: FileText, helper: "SK-CTKT" },
  { value: "accounts", label: "Tài khoản", icon: Users2, helper: "Login & pass" },
];

const fiScopes: Array<{ value: FiScope; label: string }> = [
  { value: "current", label: "Hiện hành" },
  { value: "all", label: "Tất cả" },
  { value: "historical", label: "Lịch sử" },
];

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

function sourceLabel(item: any) {
  return item.is_historical_import ? "Excel lịch sử" : "Hệ thống";
}

function compareFiRows(left: any, right: any) {
  if (Boolean(left.is_historical_import) !== Boolean(right.is_historical_import)) {
    return left.is_historical_import ? 1 : -1;
  }
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
  const [scope, setScope] = useState<FiScope>("current");
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

  const currentRows = useMemo(() => fiRows.filter((row) => !row.is_historical_import), [fiRows]);
  const historicalRows = useMemo(() => fiRows.filter((row) => row.is_historical_import), [fiRows]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return fiRows.filter((row) => {
      if (scope === "current" && row.is_historical_import) return false;
      if (scope === "historical" && !row.is_historical_import) return false;
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
        row.bm01_source_file,
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [fiRows, scope, search, teamFilter, statusFilter]);

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
          <small>{currentRows.length} hiện hành · {historicalRows.length} lịch sử</small>
        </div>
        <div className="admin-fi-kpi current">
          <ShieldCheck size={18} />
          <span>Hiện hành</span>
          <strong>{currentRows.length}</strong>
          <small>Đã gửi vào luồng FI, không tính bản nháp</small>
        </div>
        <div className="admin-fi-kpi">
          <History size={18} />
          <span>Lịch sử</span>
          <strong>{historicalRows.length}</strong>
          <small>Dữ liệu nhập từ Excel</small>
        </div>
        <div className="admin-fi-kpi">
          <CheckCircle2 size={18} />
          <span>Đã vào KHMT</span>
          <strong>{khmtCount}</strong>
          <small>{pendingCount} hồ sơ còn chờ xử lý</small>
        </div>
      </div>

      {currentRows.length > 0 && (
        <div className="admin-current-strip">
          <div className="admin-current-strip-head">
            <Clock3 size={17} />
            <strong>Hồ sơ hiện hành đang có trên hệ thống</strong>
          </div>
          <div className="admin-current-list">
            {currentRows.map((row) => (
              <button
                className="admin-current-item"
                key={row.id}
                onClick={() => {
                  setScope("current");
                  setTeamFilter("all");
                  setStatusFilter("all");
                  setSearch("");
                  setExpandedId(expandedId === row.id ? null : row.id);
                }}
                type="button"
              >
                <span>{row.sk_code}</span>
                <strong>{row.title}</strong>
                <small>
                  {row.author_name} ({row.author_user_id}) · {displayTeam(row.team)} · tạo {formatDateTime(row.created_at)}
                </small>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="admin-fi-controls">
        <div className="segmented-control" aria-label="Phạm vi dữ liệu FI">
          {fiScopes.map((item) => (
            <button
              className={scope === item.value ? "active" : ""}
              key={item.value}
              onClick={() => {
                setScope(item.value);
                setExpandedId(null);
              }}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
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
              <th>Nguồn</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const expanded = expandedId === row.id;
              const history = Array.isArray(row.status_history) ? row.status_history : [];
              return (
                <Fragment key={row.id}>
                  <tr className={row.is_historical_import ? "" : "admin-current-row"}>
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
                      <span className={`admin-source-pill ${row.is_historical_import ? "historical" : "current"}`}>
                        {sourceLabel(row)}
                      </span>
                    </td>
                    <td>
                      <button
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
                      <td colSpan={10}>
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
                              <span>Nguồn Excel</span>
                              <strong>{row.bm01_source_sheet ? `${row.bm01_source_sheet}!${row.bm01_source_row ?? ""}` : "Không"}</strong>
                            </div>
                            <div>
                              <span>File nguồn</span>
                              <strong>{row.bm01_source_file || "Không"}</strong>
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
                            <div>
                              <span>Dữ liệu lịch sử</span>
                              <strong>{row.is_historical_import ? "Có" : "Không"}</strong>
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
                <td colSpan={10}>Không có SK-CTKT phù hợp với bộ lọc hiện tại.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );

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
                <td colSpan={10}>Không có tài khoản phù hợp với bộ lọc hiện tại.</td>
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
            <RefreshCw size={17} />
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
        {activeTab === "accounts" && renderAccountsTab()}
      </section>
    </div>
  );
}
