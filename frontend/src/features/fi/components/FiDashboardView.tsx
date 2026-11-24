import { useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileDown,
  Flag,
  ListChecks,
  Loader2,
  PieChart,
  RefreshCw,
  Users2,
} from "lucide-react";
import type {
  FiDashboardPayload,
  MatrixDrawerSelection,
} from "../types/fiDashboard";
import {
  buildStatusSlices,
  buildTeamProgress,
  displayTeamLabel,
  formatCount,
  khmtUnassignedApprovedCount,
  percent,
  reviewFailedCount,
  reviewPassedCount,
  type StatusSlice,
  type TeamProgress,
} from "../utils/fiMetrics";
import { FiKhmtMatrix } from "./FiKhmtMatrix";

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
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height={size} role="img" aria-label="Phân bố kết luận xét duyệt">
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
      <div className="fi-team-legend fi-team-legend-top" aria-hidden="true">
        <span><i className="fi-swatch approved" /> Đồng ý</span>
        <span><i className="fi-swatch deferred" /> Xem xét sau</span>
        <span><i className="fi-swatch pending" /> Chờ xét duyệt</span>
        <span><i className="fi-swatch rejected" /> Không đồng ý / Hủy</span>
      </div>
      {teams.map((team) => {
        const widthPct = (team.total / maxTotal) * 100;
        const approvedPct = team.total ? (team.approved / team.total) * 100 : 0;
        const deferredPct = team.total ? (team.deferred / team.total) * 100 : 0;
        const pendingPct = team.total ? (team.pending / team.total) * 100 : 0;
        const rejectedPct = team.total ? (team.rejected / team.total) * 100 : 0;
        return (
          <div className="fi-team-row" key={team.team}>
            <div className="fi-team-meta">
              <strong>{displayTeamLabel(team.team)}</strong>
              <small>{team.total} SK · KHMT {team.khmt} ({team.khmtRate}%)</small>
            </div>
            <div className="fi-team-track" title={`Tổng ${team.total} SK`}>
              <div className="fi-team-fill" style={{ width: `${widthPct}%` }}>
                {team.approved > 0 && (
                  <span
                    className="fi-team-seg approved"
                    style={{ width: `${approvedPct}%` }}
                    title={`Đồng ý: ${team.approved}`}
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
                    title={`Không đồng ý / Hủy: ${team.rejected}`}
                  />
                )}
              </div>
            </div>
            <div className="fi-team-numbers">
              <span className="fi-team-num approved" title="Đồng ý">{team.approved}</span>
              <span className="fi-team-num deferred" title="Xem xét sau">{team.deferred}</span>
              <span className="fi-team-num pending" title="Chờ xét duyệt">{team.pending}</span>
              <span className="fi-team-num rejected" title="Không đồng ý / Hủy">{team.rejected}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatGeneratedTime(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function FiDashboardView({
  dashboard,
  loading,
  error,
  selectedYear,
  role,
  currentTeam,
  activeSelection,
  exportingExcel,
  canReview,
  onYearChange,
  onReload,
  onExportExcel,
  onSelectMatrix,
  onJumpToHistory,
  onJumpToReview,
}: {
  dashboard: FiDashboardPayload | null;
  loading: boolean;
  error: string;
  selectedYear: number;
  role?: string;
  currentTeam?: string | null;
  activeSelection: MatrixDrawerSelection | null;
  exportingExcel: boolean;
  canReview: boolean;
  onYearChange: (year: number) => void;
  onReload: () => void;
  onExportExcel: (year: number) => void;
  onSelectMatrix: (selection: MatrixDrawerSelection) => void;
  onJumpToHistory: (filters: {
    team?: string;
    khmt?: "in" | "out";
    decision?: "approved" | "pending";
    completion?: "done" | "pending" | "auto_done" | "paused";
  }) => void;
  onJumpToReview?: () => void;
}) {
  const [kpiScope, setKpiScope] = useState<"year" | "all">("year");

  const currentYear = dashboard?.current_year ?? new Date().getFullYear();
  const currentMonth = dashboard?.current_month ?? new Date().getMonth() + 1;
  const availableYears = useMemo(() => {
    const years = Array.isArray(dashboard?.available_years) && dashboard.available_years.length > 0
      ? dashboard.available_years
      : [selectedYear];
    return years.includes(selectedYear) ? years : [selectedYear, ...years].sort((a, b) => b - a);
  }, [dashboard?.available_years, selectedYear]);

  const activeTotals = useMemo(() => {
    if (kpiScope === "year" && dashboard?.selected_year_totals) {
      return dashboard.selected_year_totals;
    }
    return dashboard?.totals ?? ({} as any);
  }, [kpiScope, dashboard]);

  const activeTeams = useMemo(() => {
    if (kpiScope === "year" && Array.isArray(dashboard?.selected_year_teams)) {
      return dashboard.selected_year_teams;
    }
    return Array.isArray(dashboard?.teams) ? dashboard.teams : [];
  }, [kpiScope, dashboard]);

  const totalCount = Number(activeTotals.total ?? 0);
  const approvedCount = reviewPassedCount(activeTotals);
  const rejectedCount = reviewFailedCount(activeTotals);
  const khmtCount = Number(activeTotals.khmt_considered ?? 0);
  const unassignedApproved = khmtUnassignedApprovedCount(activeTotals);
  const pendingCount = Number(activeTotals.pending ?? 0);
  const deferredCount = Number(activeTotals.deferred ?? 0);
  const hasApprovedExecBreakdown = activeTotals.approved_completed_count !== undefined;
  const completedCount = hasApprovedExecBreakdown
    ? Number(activeTotals.approved_completed_count ?? 0)
    : Number(activeTotals.completed_count ?? activeTotals.completed ?? 0);
  const pausedApprovedCount = Number(activeTotals.approved_paused_count ?? 0);
  const notCompletedCount = hasApprovedExecBreakdown
    ? Number(activeTotals.approved_in_progress_count ?? 0) + pausedApprovedCount
    : Number(activeTotals.not_completed ?? Math.max(0, totalCount - completedCount));

  const approvalRate = percent(approvedCount, totalCount);
  const khmtRate = percent(khmtCount, approvedCount);
  const completionRate = percent(completedCount, hasApprovedExecBreakdown ? approvedCount : totalCount);

  const statusSlices = useMemo(() => buildStatusSlices(activeTotals), [activeTotals]);
  const teamProgress = useMemo(() => buildTeamProgress(activeTeams), [activeTeams]);

  const okrTeamCards = useMemo(() => {
    const okrSet = new Set(dashboard?.khmt_matrix?.okr_teams ?? ["TBCH", "TBĐL", "TBHTĐK", "TCĐK"]);
    return activeTeams.filter((team: any) => okrSet.has(team.team));
  }, [activeTeams, dashboard?.khmt_matrix?.okr_teams]);

  return (
    <section className="wide fi-dashboard-shell">
      <div className="fi-dashboard-toolbar">
        <div>
          <h2>FI Dashboard</h2>
          <p className="muted">Cập nhật {formatGeneratedTime(dashboard?.generated_at)}</p>
        </div>
        <div className="fi-dashboard-toolbar-actions">
          <label className="fi-dashboard-year-select">
            <CalendarDays size={14} aria-hidden="true" />
            <span>Năm</span>
            <select
              aria-label="Chọn năm FI Dashboard"
              value={selectedYear}
              onChange={(event) => onYearChange(Number(event.target.value))}
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </label>
          <div className="fi-matrix-pill-group" role="group" aria-label="Phạm vi thống kê KPI">
            <button
              type="button"
              className={kpiScope === "year" ? "active" : ""}
              aria-pressed={kpiScope === "year"}
              onClick={() => setKpiScope("year")}
            >
              Năm {selectedYear}
            </button>
            <button
              type="button"
              className={kpiScope === "all" ? "active" : ""}
              aria-pressed={kpiScope === "all"}
              onClick={() => setKpiScope("all")}
            >
              Tất cả
            </button>
          </div>
          <button
            type="button"
            className="fi-dashboard-export"
            disabled={exportingExcel || loading}
            onClick={() => onExportExcel(selectedYear)}
            title={`Xuất Excel kèm Ma trận KHMT năm ${selectedYear}`}
          >
            <FileDown size={16} />
            <span>{exportingExcel ? "Đang xuất..." : "Xuất Excel"}</span>
          </button>
          <button
            aria-label="Tải lại FI Dashboard"
            className="fi-dashboard-refresh"
            disabled={loading}
            onClick={onReload}
            title="Tải lại FI Dashboard"
            type="button"
          >
            <RefreshCw size={17} className={loading ? "icon-spin" : undefined} />
          </button>
        </div>
      </div>

      {loading && (
        <p className="loading-inline" role="status">
          <Loader2 size={15} className="icon-spin" />
          Đang tải FI Dashboard...
        </p>
      )}
      {error && <p className="error" role="alert" tabIndex={-1}>{error}</p>}

      {/* 4 Balanced KPI Cards */}
      <div className="fi-dashboard-kpis fi-dashboard-kpis-4">
        <button
          type="button"
          className="fi-dashboard-kpi total is-clickable"
          onClick={() => onJumpToHistory({})}
          title="Xem toàn bộ SK-CTKT trong Lịch sử FI"
        >
          <div className="fi-dashboard-kpi-icon"><ClipboardList size={20} /></div>
          <span>Tổng SK-CTKT</span>
          <strong>{formatCount(totalCount)}</strong>
          <small>
            {formatCount(approvedCount)} đồng ý ({approvalRate}%) · {formatCount(rejectedCount)} không đạt
          </small>
        </button>

        <button
          type="button"
          className="fi-dashboard-kpi info is-clickable"
          onClick={() => onJumpToHistory({ khmt: "in" })}
          title="Xem danh sách SK đã vào KHMT"
        >
          <div className="fi-dashboard-kpi-icon"><CalendarDays size={20} /></div>
          <span>Đã vào KHMT</span>
          <strong>{formatCount(khmtCount)}</strong>
          <small>
            {khmtRate}% SK đạt · còn <em>{formatCount(unassignedApproved)}</em> kho sẵn sàng
          </small>
          <div className="fi-kpi-bar"><div className="fi-kpi-bar-fill info" style={{ width: `${khmtRate}%` }} /></div>
        </button>

        <button
          type="button"
          className="fi-dashboard-kpi warning is-clickable"
          onClick={() => {
            if (canReview && onJumpToReview) onJumpToReview();
            else onJumpToHistory({ decision: "pending" });
          }}
          title={canReview ? "Mở hàng đợi Xét duyệt SK-CTKT" : "Xem các SK đang chờ duyệt"}
        >
          <div className="fi-dashboard-kpi-icon"><Clock3 size={20} /></div>
          <span>Chờ xử lý</span>
          <strong>{formatCount(pendingCount + deferredCount)}</strong>
          <small>
            {formatCount(pendingCount)} chờ duyệt · {formatCount(deferredCount)} xem xét sau
          </small>
        </button>

        <button
          type="button"
          className="fi-dashboard-kpi success is-clickable"
          onClick={() =>
            onJumpToHistory({
              decision: "approved",
              completion: notCompletedCount > 0 ? "pending" : "done",
            })
          }
          title={
            notCompletedCount > 0
              ? `Mở ${notCompletedCount} SK đã đồng ý đang triển khai trong Lịch sử FI`
              : "Xem các SK-CTKT đã hoàn thành trong Lịch sử FI"
          }
        >
          <div className="fi-dashboard-kpi-icon"><Flag size={20} /></div>
          <span>Tiến độ thực hiện</span>
          <strong>
            {formatCount(completedCount)}/{formatCount(hasApprovedExecBreakdown ? approvedCount : totalCount)}
          </strong>
          <small>
            {completionRate}% SK đồng ý · {formatCount(notCompletedCount)} đang triển khai
            {pausedApprovedCount > 0 ? ` (${formatCount(pausedApprovedCount)} tạm dừng)` : ""}
          </small>
          <div className="fi-kpi-bar"><div className="fi-kpi-bar-fill success" style={{ width: `${completionRate}%` }} /></div>
        </button>
      </div>

      {/* HERO: Monthly Team × KHMT Matrix (T1–T12) */}
      {dashboard?.khmt_matrix && (
        <FiKhmtMatrix
          khmtMatrix={dashboard.khmt_matrix}
          registrationMatrix={dashboard.registration_matrix}
          selectedYear={selectedYear}
          currentYear={currentYear}
          currentMonth={currentMonth}
          role={role}
          currentTeam={currentTeam}
          activeSelection={activeSelection}
          onSelect={onSelectMatrix}
        />
      )}

      {/* Analytical Charts Row */}
      <div className="fi-dashboard-chart-row">
        <div className="fi-dashboard-card">
          <div className="fi-dashboard-section-title">
            <PieChart size={17} />
            <h3>Phân bố kết luận xét duyệt</h3>
            <small className="muted">{formatCount(totalCount)} SK (tổng 100%)</small>
          </div>
          <StatusDonutChart slices={statusSlices} total={totalCount} />
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

      {/* Team Detail Cards (4 OKR teams) */}
      {okrTeamCards.length > 0 && (
        <div className="fi-dashboard-team-section">
          <div className="fi-dashboard-section-title">
            <ListChecks size={17} />
            <h3>Chi tiết 4 đội/tổ xét KHMT</h3>
            <small className="muted">tỉ lệ phê duyệt, KHMT và hoàn thành theo từng đội</small>
          </div>
          <div className="fi-dashboard-team-grid">
            {okrTeamCards.map((team: any) => {
              const teamTotal = Number(team.total ?? 0);
              const teamPassed = reviewPassedCount(team);
              const teamFailed = reviewFailedCount(team);
              const teamDeferred = Number(team.deferred ?? 0);
              const teamPending = Number(team.pending ?? 0);
              const teamKhmt = Number(team.khmt_considered ?? 0);
              const teamKhmtMissing = khmtUnassignedApprovedCount(team);
              const teamHasApprovedBreakdown = team.approved_completed_count !== undefined;
              const teamCompleted = teamHasApprovedBreakdown
                ? Number(team.approved_completed_count ?? 0)
                : Number(team.completed_count ?? team.completed ?? 0);
              const teamPaused = Number(team.approved_paused_count ?? 0);
              const teamNotCompleted = teamHasApprovedBreakdown
                ? Number(team.approved_in_progress_count ?? 0) + teamPaused
                : Number(team.not_completed ?? Math.max(0, teamTotal - teamCompleted));
              const teamApprovalRate = percent(teamPassed, teamTotal);
              const teamKhmtRate = percent(teamKhmt, teamPassed);
              const teamCompletionDenom = teamHasApprovedBreakdown ? teamPassed : teamTotal;
              const teamCompletionRate = percent(teamCompleted, teamCompletionDenom);
              return (
                <article className="fi-team-detail-card" key={team.team}>
                  <header className="fi-team-detail-head">
                    <div>
                      <span className="fi-team-detail-name">{displayTeamLabel(team.team)}</span>
                      <small>{formatCount(teamPassed)} đồng ý · {formatCount(teamPending)} chờ duyệt</small>
                    </div>
                    <button
                      type="button"
                      className="fi-team-detail-total-btn"
                      onClick={() => onJumpToHistory({ team: team.team })}
                      title={`Xem tất cả SK của ${displayTeamLabel(team.team)} trong Lịch sử FI`}
                    >
                      <span>Tổng SK</span>
                      <strong>{formatCount(teamTotal)}</strong>
                    </button>
                  </header>

                  <div className="fi-team-detail-rates">
                    <div className="fi-team-rate tone-success">
                      <div className="fi-team-rate-head">
                        <span>Tỉ lệ phê duyệt</span>
                        <strong>{teamApprovalRate}%</strong>
                      </div>
                      <div className="fi-team-rate-bar" aria-hidden="true">
                        <div className="fi-team-rate-bar-fill" style={{ width: `${teamApprovalRate}%` }} />
                      </div>
                      <small>{formatCount(teamPassed)}/{formatCount(teamTotal)} SK đồng ý</small>
                    </div>

                    <div className="fi-team-rate tone-info">
                      <div className="fi-team-rate-head">
                        <span>Đã vào KHMT</span>
                        <strong>{teamKhmtRate}%</strong>
                      </div>
                      <div className="fi-team-rate-bar" aria-hidden="true">
                        <div className="fi-team-rate-bar-fill" style={{ width: `${teamKhmtRate}%` }} />
                      </div>
                      <small>
                        {formatCount(teamKhmt)}/{formatCount(teamPassed)} SK đạt
                        {teamKhmtMissing > 0 && <> · còn <em>{formatCount(teamKhmtMissing)}</em> kho sẵn sàng</>}
                      </small>
                    </div>

                    <div className="fi-team-rate tone-completion">
                      <div className="fi-team-rate-head">
                        <span>Tiến độ thực hiện</span>
                        <strong>{teamCompletionRate}%</strong>
                      </div>
                      <div className="fi-team-rate-bar" aria-hidden="true">
                        <div className="fi-team-rate-bar-fill" style={{ width: `${teamCompletionRate}%` }} />
                      </div>
                      <small>
                        {formatCount(teamCompleted)}/{formatCount(teamCompletionDenom)} SK đạt
                        {teamNotCompleted > 0 && <> · còn <em>{formatCount(teamNotCompleted)}</em> chưa xong</>}
                      </small>
                    </div>
                  </div>

                  <footer className="fi-team-detail-breakdown">
                    <div className="tone-success">
                      <strong>{formatCount(teamPassed)}</strong>
                      <span>Đồng ý</span>
                    </div>
                    <div className="tone-danger">
                      <strong>{formatCount(teamFailed)}</strong>
                      <span>Không đồng ý</span>
                    </div>
                    <div className="tone-warning">
                      <strong>{formatCount(teamDeferred)}</strong>
                      <span>Xem xét sau</span>
                    </div>
                    <div className="tone-neutral">
                      <strong>{formatCount(teamPending)}</strong>
                      <span>Chờ duyệt</span>
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
