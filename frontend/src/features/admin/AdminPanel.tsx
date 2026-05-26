import { Fragment, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api } from "../../api/client";
import { displayTeam, isKhmtConsidered, khmtLabel } from "../fi/FIWorkspace";

type FiScope = "current" | "all" | "historical";

const fiScopes: Array<{ value: FiScope; label: string }> = [
  { value: "current", label: "Hiện hành" },
  { value: "all", label: "Tất cả" },
  { value: "historical", label: "Lịch sử" },
];

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

export function AdminPanel() {
  const [fiRows, setFiRows] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<FiScope>("current");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    Promise.all([api.listSk({ include_historical: true }), api.fiDashboard()])
      .then(([rows, dashboardData]) => {
        setFiRows([...rows].sort(compareFiRows));
        setDashboard(dashboardData);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

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

  const totals = dashboard?.totals ?? {};
  const pendingCount = Number(totals.pending ?? fiRows.filter((row) => ["Submitted", "NeedMoreInfo", "Reviewed"].includes(row.status)).length);
  const khmtCount = Number(totals.khmt_considered ?? fiRows.filter(isKhmtConsidered).length);

  return (
    <div
      className="content-grid admin-fi-shell"
      data-snapshot-target="true"
      data-snapshot-name="quan-tri-fi"
    >
      {error && <p className="error">{error}</p>}
      <section className="panel wide admin-fi-panel">
        <div className="panel-header admin-fi-header">
          <div>
            <h2>Quản trị FI</h2>
            <p className="muted">
              Theo dõi toàn bộ SK-CTKT: người đăng ký, thời điểm, trạng thái, KHMT, nguồn dữ liệu và lịch sử xử lý.
            </p>
          </div>
          <button onClick={reload} disabled={loading} type="button">
            <RefreshCw size={17} />
            {loading ? "Đang tải..." : "Tải lại"}
          </button>
        </div>

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
            <small>Đăng ký trực tiếp trên hệ thống</small>
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
                    <tr key={row.id} className={row.is_historical_import ? "" : "admin-current-row"}>
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
                      <tr className="admin-detail-row" key={`${row.id}-detail`}>
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
      </section>
    </div>
  );
}
