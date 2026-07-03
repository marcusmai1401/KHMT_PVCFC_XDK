import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileDown, ImageDown, RefreshCw, RotateCcw, Save, Upload } from "lucide-react";
import { api } from "../../api/client";
import { EmptyStateBanner } from "./components/EmptyStateBanner";
import { NoDataBlock } from "./components/EmptyBlocks";
import { KRDrillDownPanel } from "./components/KRDrillDownPanel";
import { MonthlyHistoryHeatmap } from "./components/MonthlyHistoryHeatmap";
import { ObjectiveDashboard } from "./components/ObjectiveDashboard";
import { PeriodSelector } from "./components/PeriodSelector";
import { exportDashboardElementAsPng } from "./exportDashboardPng";
import { readLastSelectedPeriod, writeLastSelectedPeriod } from "./lastSelectedPeriod";
import type { DashboardColumn, DashboardPayload, DashboardTeamRow, KRSummary } from "./types/dashboard";

function krSortKey(code: string): [number, number, string] {
  const match = /^O(\d+)\.KR(\d+)$/i.exec(code || "");
  if (!match) {
    return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, code || ""];
  }
  return [Number(match[1]), Number(match[2]), code];
}

function compareKrColumns(left: DashboardColumn, right: DashboardColumn) {
  const leftKey = krSortKey(left.workshop_kr_code);
  const rightKey = krSortKey(right.workshop_kr_code);
  return leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || leftKey[2].localeCompare(rightKey[2]);
}

function defaultDashboardPeriod() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export function OKRWorkspace({ role, editMode = true }: { role: string; editMode?: boolean }) {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [period, setPeriod] = useState(() => {
    const stored = readLastSelectedPeriod();
    return stored ? { month: stored.month, year: stored.year } : defaultDashboardPeriod();
  });
  const [needsLatestBootstrap, setNeedsLatestBootstrap] = useState(() => readLastSelectedPeriod() === null);
  const [error, setError] = useState("");
  const [exportingPng, setExportingPng] = useState(false);
  const [savingLeaderKpi, setSavingLeaderKpi] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activeKr, setActiveKr] = useState<KRSummary | null>(null);
  const [activeObjective, setActiveObjective] = useState<{ objectiveCode: string; team?: { code: string; name: string } } | null>(null);
  const dashboardExportRef = useRef<HTMLDivElement | null>(null);
  const canManageOkr = ["Admin", "Workshop_Leader"].includes(role) && editMode;
  const canUploadReport = role === "Admin" && editMode;
  const canExportDashboard = canManageOkr;
  const showEditCommands = role !== "Admin" || editMode;
  const logDashboardDiagnostics = (dashboardData: DashboardPayload) => {
    const technicalWarnings = dashboardData.technical_metadata?.warnings ?? [];
    void api.clientDebugLog({
      source: "okr-dashboard",
      event: "dashboard-loaded",
      data: {
        period: dashboardData.period,
        technical_warning_count: technicalWarnings.length,
        technical_warning_types: technicalWarnings.map((warning) => warning.warning_type || warning.type || "UNKNOWN_WARNING"),
      },
    }).catch(() => undefined);
  };

  const reload = (targetPeriod = period) => {
    api.dashboard(targetPeriod.month, targetPeriod.year)
      .then((dashboardData) => {
        setDashboard(dashboardData);
        logDashboardDiagnostics(dashboardData);
        setError("");
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    if (needsLatestBootstrap) {
      api.dashboardLatest()
        .then((dashboardData) => {
          const resolvedPeriod = dashboardData.period?.month && dashboardData.period?.year
            ? { month: Number(dashboardData.period.month), year: Number(dashboardData.period.year) }
            : period;
          return { dashboardData, resolvedPeriod };
        })
        .then(({ dashboardData, resolvedPeriod }) => {
          setDashboard(dashboardData);
          setPeriod(resolvedPeriod);
          logDashboardDiagnostics(dashboardData);
          setNeedsLatestBootstrap(false);
          setError("");
        })
        .catch(() => {
          setNeedsLatestBootstrap(false);
          reload();
        });
      return;
    }
    reload();
  }, [role, period.month, period.year, needsLatestBootstrap]);

  const switchPeriodToReport = (report: any) => {
    if (!report?.report_month || !report?.report_year) return false;
    const nextPeriod = { month: Number(report.report_month), year: Number(report.report_year) };
    if (nextPeriod.month === period.month && nextPeriod.year === period.year) {
      reload(nextPeriod);
    } else {
      writeLastSelectedPeriod(nextPeriod);
      setPeriod(nextPeriod);
    }
    return true;
  };

  const upload = (file?: File) => {
    if (!file) return;
    api.uploadReport(file)
      .then((report) => {
        if (!switchPeriodToReport(report)) reload();
      })
      .catch((err) => setError(err.message));
  };

  const importSnapshot = (file?: File) => {
    if (!file) return;
    api.importHistoricalSnapshot(file)
      .then(() => reload())
      .catch((err) => setError(err.message));
  };

  const exportExcel = () => {
    api.exportDashboard()
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "okr-dashboard-export.xlsx";
        anchor.click();
        URL.revokeObjectURL(url);
      })
      .catch((err) => setError(err.message));
  };

  const exportPng = () => {
    const target = dashboardExportRef.current;
    if (!target || exportingPng) return;
    setExportingPng(true);
    setError("");
    exportDashboardElementAsPng(target, `okr-dashboard-T${dashboardPeriod?.month ?? period.month}-${dashboardPeriod?.year ?? period.year}.png`)
      .catch((err) => setError(err instanceof Error ? err.message : "Không thể xuất PNG dashboard."))
      .finally(() => setExportingPng(false));
  };

  const downloadTemplate = () => {
    api.downloadReportTemplate()
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "okr-team-report-template.xlsx";
        anchor.click();
        URL.revokeObjectURL(url);
      })
      .catch((err) => setError(err.message));
  };

  const dashboardColumns = useMemo(
    () => [...(dashboard?.columns ?? [])].sort(compareKrColumns),
    [dashboard],
  );
  const objectiveColumnGroups = useMemo(() => {
    const groups: Array<{ objectiveCode: string; columns: DashboardColumn[] }> = [];
    dashboardColumns.forEach((column) => {
      const objectiveCode = column.workshop_kr_code.split(".")[0] || column.workshop_kr_code;
      const current = groups[groups.length - 1];
      if (!current || current.objectiveCode !== objectiveCode) {
        groups.push({ objectiveCode, columns: [column] });
      } else {
        current.columns.push(column);
      }
    });
    return groups;
  }, [dashboardColumns]);

  const summaries = dashboard?.minor_okr_summary ?? [];
  const disciplineViolations = useMemo(
    () => (dashboard?.teams ?? [])
      .filter((team) => isViolationStatus(team.discipline_status))
      .sort(compareViolationTeams)
      .map((team) => ({
        description: violationDescription(team),
        team: team.team,
      })),
    [dashboard?.teams],
  );
  const dashboardPeriod = dashboard?.period;
  const periodLabel = dashboardPeriod?.label || `T${period.month}/${period.year}`;
  const latestDataPeriod = dashboard?.technical_metadata?.latest_data_period ?? null;
  const latestDataLabel = latestDataPeriod ? `T${latestDataPeriod.month}/${latestDataPeriod.year}` : undefined;
  const isNoDataPeriod = dashboardPeriod?.data_state === "no_data";
  const activeObjectiveRows = activeObjective
    ? summaries.filter((item) => item.workshop_kr_code?.startsWith(`${activeObjective.objectiveCode}.KR`))
    : [];

  const changePeriod = (nextPeriod: { month: number; year: number }) => {
    setPeriod(nextPeriod);
  };

  const jumpToLatest = () => {
    if (!latestDataPeriod) return;
    writeLastSelectedPeriod(latestDataPeriod);
    setPeriod({ month: latestDataPeriod.month, year: latestDataPeriod.year });
  };

  const saveMultipleLeaderKpis = async (changes: Array<{ team: string; values: { a1: number | null; a2: number | null } }>) => {
    const targetMonth = Number(dashboardPeriod?.month ?? period.month);
    const targetYear = Number(dashboardPeriod?.year ?? period.year);
    setSavingLeaderKpi(true);
    setError("");
    try {
      let finalDashboard = dashboard;
      for (const change of changes) {
        finalDashboard = await api.updateLeaderKpiAllocation(targetMonth, targetYear, change.team, change.values);
      }
      if (finalDashboard) {
        setDashboard(finalDashboard);
        logDashboardDiagnostics(finalDashboard);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingLeaderKpi(false);
    }
  };

  const handleResetData = () => {
    if (resetting) return;
    if (!confirm("Reset toàn bộ dữ liệu kiểm thử? Database production sẽ không bị ảnh hưởng.")) return;
    setResetting(true);
    setError("");
    api.sandboxReset()
      .then(() => {
        reload();
      })
      .catch((err) => setError(err.message))
      .finally(() => setResetting(false));
  };

  const reportMonth = String(dashboardPeriod?.month ?? period.month).padStart(2, "0");
  const reportYear = dashboardPeriod?.year ?? period.year;

  return (
    <div className="content-grid" ref={dashboardExportRef}>
      <header className="okr-report-banner">
        <p className="okr-report-eyebrow">CHUNG MỘT NIỀM TIN - VƯƠN MÌNH PHÁT TRIỂN</p>
        <h1>BÁO CÁO KẾ HOẠCH MỤC TIÊU XƯỞNG ĐIỀU KHIỂN THÁNG {reportMonth} VÀ LŨY KẾ NĂM {reportYear}</h1>
        <p className="okr-report-note">(Dữ liệu được cập nhật vào ngày 25 hàng tháng)</p>
      </header>
      <section className="panel wide okr-matrix-panel">
        <div className="panel-header">
          <div>
            <h2>Ma trận đánh giá</h2>
            <p className="muted">Kỳ {periodLabel}</p>
          </div>
          <div className="toolbar">
            <PeriodSelector latestDataPeriod={latestDataPeriod} onChange={changePeriod} value={period} />
            <button
              aria-label="Tải PNG snapshot"
              data-export-exclude="true"
              disabled={exportingPng || !dashboard}
              onClick={exportPng}
              title="Tải PNG snapshot"
              type="button"
            >
              <ImageDown size={17} />
            </button>
            {showEditCommands && (
              <button
                aria-label="Reset dữ liệu"
                disabled={resetting}
                onClick={handleResetData}
                title="Reset dữ liệu"
                type="button"
              >
                <RotateCcw size={17} />
              </button>
            )}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {isNoDataPeriod ? (
          <EmptyStateBanner currentLabel={periodLabel} latestDataLabel={latestDataLabel} onJumpToLatest={latestDataPeriod ? jumpToLatest : undefined} />
        ) : (
          <>
            <EvaluationMatrixOverview
              activeObjective={activeObjective}
              canEditLeaderKpi={canManageOkr}
              groups={objectiveColumnGroups}
              onSelectObjective={(objectiveCode, team) => {
                setActiveKr(null);
                setActiveObjective(objectiveCode ? { objectiveCode, team } : null);
              }}
              onSaveLeaderKpis={saveMultipleLeaderKpis}
              savingLeaderKpi={savingLeaderKpi}
              teams={dashboard?.teams ?? []}
            />
            <DisciplineViolations items={disciplineViolations} periodLabel={periodLabel} />
          </>
        )}
      </section>
      {!isNoDataPeriod && (
        <>
          {dashboard?.monthly_history?.length ? (
            <MonthlyHistoryHeatmap
              allocations={dashboard.leader_kpi_allocations}
              history={dashboard.monthly_history}
              summary={dashboard.kpi_allocation_summary}
            />
          ) : null}
          <ObjectiveDashboard
            onDrillDown={(objectiveCode) => {
              setActiveKr(null);
              setActiveObjective({ objectiveCode });
            }}
            sections={dashboard?.objective_sections}
          />
        </>
      )}
      <KRDrillDownPanel row={activeKr} onClose={() => setActiveKr(null)} />
      <ObjectiveKRPanel
        activeObjective={activeObjective}
        rows={activeObjectiveRows}
        onClose={() => setActiveObjective(null)}
        onSelect={(row) => {
          setActiveObjective(null);
          setActiveKr(row);
        }}
      />
    </div>
  );
}

function formatMetric(metric: any) {
  if (!metric) return "-";
  const actual = metric.actual ?? "-";
  const total = metric.total ?? metric.target ?? "-";
  if (actual === "-" && total === "-") return "-";
  return `${actual}/${total}`;
}

function ObjectiveKRPanel({
  activeObjective,
  rows,
  onClose,
  onSelect,
}: {
  activeObjective: { objectiveCode: string; team?: { code: string; name: string } } | null;
  rows: KRSummary[];
  onClose: () => void;
  onSelect: (row: KRSummary) => void;
}) {
  if (!activeObjective) return null;
  const { objectiveCode, team } = activeObjective;

  return (
    <aside className="kr-drilldown objective-kr-panel" data-export-exclude="true" aria-label="Danh sách KR theo mục tiêu">
      <div className="panel-header">
        <div>
          <h2>{team ? `${team.code} · ${objectiveCode}` : objectiveCode}</h2>
          <p className="muted">{team ? `KR thuộc ${team.name}` : "KR liên quan đến mục tiêu"}</p>
        </div>
        <button onClick={onClose} type="button">Đóng</button>
      </div>
      <div className="compact-kr-list">
        {rows.length ? rows.map((row) => {
          const teamStatus = team ? row.team_statuses[team.code] : undefined;
          const metric = team ? row.numeric_metric?.teams?.[team.code] : undefined;

          return (
            <button className="compact-kr-row" key={row.workshop_kr_code} onClick={() => onSelect(row)} type="button">
              <span className="kr-code">{row.workshop_kr_code}</span>
              <span className="kr-name" title={row.kr_name}>{row.kr_name}</span>
              <span className="kr-target">
                {team ? (metric ? `Thực hiện: ${formatMetric(metric)}` : "Chỉ có trạng thái") : `Mục tiêu ${row.target_value ?? "-"}`}
              </span>
              <div className="kr-statuses">
                {team ? (
                  <span className="team-status">
                    <Status value={teamStatus || "#N/A"} />
                  </span>
                ) : (
                  Object.entries(row.team_statuses).map(([t, s]) => (
                    <span className="team-status" key={t} title={`${t}: ${displayStatus(s)}`}>
                      <small>{t}</small>
                      <CompactStatus value={s} />
                    </span>
                  ))
                )}
              </div>
            </button>
          );
        }) : <NoDataBlock message="Chưa có KR liên quan cho mục tiêu này." />}
      </div>
    </aside>
  );
}

function EvaluationMatrixOverview({
  activeObjective,
  canEditLeaderKpi,
  groups,
  onSelectObjective,
  onSaveLeaderKpis,
  savingLeaderKpi,
  teams,
}: {
  activeObjective: { objectiveCode: string; team?: { code: string; name: string } } | null;
  canEditLeaderKpi: boolean;
  groups: Array<{ objectiveCode: string; columns: DashboardColumn[] }>;
  onSelectObjective: (code: string, team?: { code: string; name: string }) => void;
  onSaveLeaderKpis: (changes: Array<{ team: string; values: { a1: number | null; a2: number | null } }>) => void;
  savingLeaderKpi: boolean;
  teams: DashboardTeamRow[];
}) {
  const tableTemplate = groups.length
    ? `130px minmax(170px, 185px) 80px repeat(${groups.length}, minmax(100px, 1fr))`
    : "130px minmax(170px, 185px) 80px";
  const overview = executiveMatrixStats(teams, groups);

  const [allocations, setAllocations] = useState<Record<string, { a1: string; a2: string }>>({});

  useEffect(() => {
    const initial: Record<string, { a1: string; a2: string }> = {};
    teams.forEach((t) => {
      const alloc = t.leader_kpi_manual_allocation;
      initial[t.team] = {
        a1: alloc?.a1 !== null && alloc?.a1 !== undefined ? String(alloc.a1) : "",
        a2: alloc?.a2 !== null && alloc?.a2 !== undefined ? String(alloc.a2) : "",
      };
    });
    setAllocations(initial);
  }, [teams]);

  const hasChanges = useMemo(() => {
    return teams.some((t) => {
      const current = allocations[t.team];
      if (!current) return false;
      const originalA1 = t.leader_kpi_manual_allocation?.a1 !== null && t.leader_kpi_manual_allocation?.a1 !== undefined ? String(t.leader_kpi_manual_allocation.a1) : "";
      const originalA2 = t.leader_kpi_manual_allocation?.a2 !== null && t.leader_kpi_manual_allocation?.a2 !== undefined ? String(t.leader_kpi_manual_allocation.a2) : "";
      return current.a1 !== originalA1 || current.a2 !== originalA2;
    });
  }, [allocations, teams]);

  const handleGlobalSave = () => {
    const changedTeams: Array<{ team: string; values: { a1: number | null; a2: number | null } }> = [];
    teams.forEach((t) => {
      const current = allocations[t.team];
      if (!current) return;
      const originalA1 = t.leader_kpi_manual_allocation?.a1 !== null && t.leader_kpi_manual_allocation?.a1 !== undefined ? String(t.leader_kpi_manual_allocation.a1) : "";
      const originalA2 = t.leader_kpi_manual_allocation?.a2 !== null && t.leader_kpi_manual_allocation?.a2 !== undefined ? String(t.leader_kpi_manual_allocation.a2) : "";
      if (current.a1 !== originalA1 || current.a2 !== originalA2) {
        changedTeams.push({
          team: t.team,
          values: {
            a1: parseAllocationInput(current.a1),
            a2: parseAllocationInput(current.a2),
          }
        });
      }
    });

    if (changedTeams.length === 0) return;
    onSaveLeaderKpis(changedTeams);
  };

  return (
    <div className="matrix okr-matrix okr-matrix-overview" aria-label="Ma trận đánh giá OKR">
      <section className="okr-exec-matrix-card" aria-label="Ma trận tổng hợp OKR">
        <div className="okr-exec-matrix-header">
          <div>
            <strong>Ma trận tổng hợp</strong>
          </div>
          <div className="okr-exec-legend" aria-label="Chú giải trạng thái">
            <span className="tone-good">Đạt</span>
            <span className="tone-risk">Không Đạt</span>
            <span className="tone-na">N/A</span>
          </div>
        </div>

        <div className="okr-exec-top-panel">
          <div className="okr-exec-summary-section">
            <div className={`okr-summary-mini-card ${overview.attentionTeams ? "is-risk" : "is-good"}`}>
              <strong>{overview.attentionTeams}</strong>
              <small>Đội/tổ cần chú ý</small>
            </div>
            <div className={`okr-summary-mini-card ${overview.riskObjectiveCells ? "is-risk" : "is-good"}`}>
              <strong>{overview.riskObjectiveCells}</strong>
              <small>Mục tiêu Không Đạt</small>
            </div>
            <div className={`okr-summary-mini-card ${overview.missingTeams ? "is-na" : "is-good"}`}>
              <strong>{overview.missingTeams}</strong>
              <small>Chưa có dữ liệu</small>
            </div>
          </div>

          <div className="okr-exec-kpi-section">
            <div className="kpi-section-header">
              <strong>Xét A1/A2</strong>
              <div className="kpi-section-actions">
                <span className="muted">Điều chỉnh phân bổ Đội/Tổ trưởng</span>
                {canEditLeaderKpi && (
                  <button
                    className="kpi-global-save-btn"
                    disabled={savingLeaderKpi || !hasChanges}
                    onClick={handleGlobalSave}
                    type="button"
                  >
                    {savingLeaderKpi ? "Đang lưu..." : "Lưu Xét A1/A2"}
                  </button>
                )}
              </div>
            </div>
            <div className="kpi-section-grid">
              {teams.map((team) => {
                const current = allocations[team.team] || { a1: "", a2: "" };
                return (
                  <LeaderKpiCompactRow
                    canEdit={canEditLeaderKpi}
                    key={team.team}
                    team={team}
                    a1Text={current.a1}
                    a2Text={current.a2}
                    onChangeA1={(val) => setAllocations(prev => ({ ...prev, [team.team]: { ...prev[team.team], a1: val } }))}
                    onChangeA2={(val) => setAllocations(prev => ({ ...prev, [team.team]: { ...prev[team.team], a2: val } }))}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div className="okr-exec-table-shell">
          <div className="okr-exec-table" role="table" aria-label="Bảng tổng hợp trạng thái theo đội tổ và mục tiêu">
            <div className="okr-exec-row okr-exec-row-header" role="row" style={{ gridTemplateColumns: tableTemplate }}>
              <span role="columnheader">Đội/Tổ</span>
              <span role="columnheader">Đánh giá tháng</span>
              <span role="columnheader">Quy định</span>
              {groups.map((group) => {
                const stats = objectiveStatusStats(group.columns, teams);
                const summary = objectiveCellSummary(stats);
                return (
                  <button
                    aria-pressed={activeObjective?.objectiveCode === group.objectiveCode && !activeObjective.team}
                    className={`okr-exec-objective-heading tone-${summary.tone} ${activeObjective?.objectiveCode === group.objectiveCode && !activeObjective.team ? "active-objective" : ""}`}
                    key={group.objectiveCode}
                    onClick={() => onSelectObjective(group.objectiveCode)}
                    title={`${group.objectiveCode}: ${group.columns.length} KR, ${summary.title}`}
                    type="button"
                  >
                    <strong>{group.objectiveCode}</strong>
                    <small>{group.columns.length} KR</small>
                  </button>
                );
              })}
            </div>
            {teams.map((team) => (
              <div
                className={`okr-exec-row ${hasTeamReport(team) ? "" : "is-missing"}`}
                key={team.team}
                role="row"
                style={{ gridTemplateColumns: tableTemplate }}
              >
                <div className="okr-exec-team" role="cell">
                  <strong>{team.team}</strong>
                  <span>{team.team_name}</span>
                </div>
                <div className={`okr-exec-assessment tone-${assessmentTone(team)}`} role="cell">
                  <strong>{displayAssessment(team.monthly_assessment)}</strong>
                </div>
                <div className="okr-exec-discipline" role="cell"><Status value={team.discipline_status} /></div>

                {groups.map((group) => (
                  <ObjectiveExecutiveCell
                    activeObjective={activeObjective}
                    group={group}
                    key={`${team.team}-${group.objectiveCode}`}
                    onSelectObjective={onSelectObjective}
                    team={team}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ObjectiveExecutiveCell({
  activeObjective,
  group,
  onSelectObjective,
  team,
}: {
  activeObjective: { objectiveCode: string; team?: { code: string; name: string } } | null;
  group: { objectiveCode: string; columns: DashboardColumn[] };
  onSelectObjective: (code: string, team?: { code: string; name: string }) => void;
  team: DashboardTeamRow;
}) {
  const stats = teamObjectiveStats(group.columns, team);
  const isMissing = !hasTeamReport(team);
  const summary = isMissing ? missingObjectiveSummary(group.columns.length) : objectiveCellSummary(stats);
  const isActive = activeObjective?.objectiveCode === group.objectiveCode && activeObjective?.team?.code === team.team;

  return (
    <div className={`okr-exec-objective-cell tone-${summary.tone} ${isActive ? "active" : ""}`} role="cell">
      <button
        aria-pressed={isActive}
        className="okr-exec-objective-button"
        onClick={() => onSelectObjective(group.objectiveCode, { code: team.team, name: team.team_name })}
        title={`${team.team} - ${group.objectiveCode}: ${summary.title}`}
        type="button"
      >
        <strong>{summary.label}</strong>
        <span>{summary.detail}</span>
      </button>
    </div>
  );
}

function allocationText(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function parseAllocationInput(value: string) {
  const text = value.trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function LeaderKpiCompactRow({
  canEdit,
  team,
  a1Text,
  a2Text,
  onChangeA1,
  onChangeA2,
}: {
  canEdit: boolean;
  team: DashboardTeamRow;
  a1Text: string;
  a2Text: string;
  onChangeA1: (val: string) => void;
  onChangeA2: (val: string) => void;
}) {
  const allocation = team.leader_kpi_manual_allocation;
  const initialA1 = allocationText(allocation?.a1);
  const initialA2 = allocationText(allocation?.a2);

  if (!hasTeamReport(team)) {
    return (
      <div className="kpi-team-compact readonly is-na">
        <span className="team-code">{team.team}</span>
        <span className="kpi-values">N/A</span>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="kpi-team-compact readonly">
        <span className="team-code">{team.team}</span>
        <span className="kpi-value-pill">A2: <b>{initialA2 || "0"}</b></span>
        <span className="kpi-value-pill">A1: <b>{initialA1 || "0"}</b></span>
      </div>
    );
  }

  return (
    <div className="kpi-team-compact editable">
      <span className="team-code" title={team.team_name}>{team.team}</span>
      <div className="kpi-inputs-group">
        <label>
          <span>A2</span>
          <input
            aria-label={`${team.team} A2`}
            inputMode="numeric"
            min={0}
            onChange={(event) => onChangeA2(event.target.value)}
            type="number"
            value={a2Text}
          />
        </label>
        <label>
          <span>A1</span>
          <input
            aria-label={`${team.team} A1`}
            inputMode="numeric"
            min={0}
            onChange={(event) => onChangeA1(event.target.value)}
            type="number"
            value={a1Text}
          />
        </label>
      </div>
    </div>
  );
}

function hasTeamReport(team: DashboardTeamRow) {
  return team.has_report !== false && displayAssessment(team.monthly_assessment) !== "N/A";
}

function displayAssessment(value: string | undefined) {
  const text = String(value || "").trim();
  return text && text !== "#N/A" ? text : "N/A";
}

function displayStatus(value: string | undefined) {
  const text = String(value || "").trim();
  return text === "#N/A" || !text ? "N/A" : text;
}

function isNaStatus(value: string | undefined) {
  return ["", "#N/A", "N/A", "NA"].includes(String(value || "").trim().toUpperCase());
}

function isGoodStatus(value: string | undefined) {
  return ["OK", "GOOD", "G"].includes(String(value || "").trim().toUpperCase());
}

function teamObjectiveStats(columns: DashboardColumn[], team: DashboardTeamRow) {
  return statusStats(columns.map((column) => team.kr_statuses[column.workshop_kr_code]));
}

function objectiveStatusStats(columns: DashboardColumn[], teams: DashboardTeamRow[]) {
  return statusStats(columns.flatMap((column) => teams.map((team) => team.kr_statuses[column.workshop_kr_code])));
}

function statusStats(values: Array<string | undefined>) {
  return values.reduce(
    (stats, status) => {
      if (isNaStatus(status)) {
        stats.na += 1;
      } else if (isGoodStatus(status)) {
        stats.good += 1;
      } else {
        stats.risk += 1;
      }
      stats.total += 1;
      return stats;
    },
    { good: 0, risk: 0, na: 0, total: 0 },
  );
}

type ExecutiveTone = "good" | "complete" | "risk" | "na";

function objectiveCellSummary(stats: { good: number; risk: number; na: number; total: number }) {
  const tone = objectiveTone(stats);
  const label = objectiveVerdict(stats);
  const detail = objectiveMicroSummary(stats);
  const title = `${stats.good} đạt, ${stats.risk} không đạt, ${stats.na} N/A`;
  return { ...stats, detail, label, title, tone };
}

function missingObjectiveSummary(total: number) {
  return {
    detail: "Chưa cập nhật",
    good: 0,
    label: "N/A",
    na: total,
    risk: 0,
    title: "Đội/tổ chưa cập nhật OKR kỳ này",
    tone: "na" as ExecutiveTone,
    total,
  };
}

function objectiveTone(stats: { good: number; risk: number; na: number; total: number }): ExecutiveTone {
  if (!stats.total) return "na";
  if (stats.risk > 0) return "risk";
  return "good";
}

function objectiveVerdict(stats: { good: number; risk: number; na: number; total: number }) {
  if (!stats.total) return "N/A";
  if (stats.risk > 0) return "Không Đạt";
  return "Đạt";
}

function objectiveMicroSummary(stats: { good: number; risk: number; na: number; total: number }) {
  if (!stats.total) return "Không có KR";

  const parts: string[] = [];
  const passed = stats.good + stats.na;
  if (passed > 0) {
    parts.push(`${passed}/${stats.total} đạt`);
  }
  if (stats.risk > 0) {
    parts.push(`${stats.risk} NG`);
  }
  if (stats.na > 0 && stats.na < stats.total) {
    parts.push(`${stats.na} N/A`);
  }
  return parts.join(" · ");
}

function executiveMatrixStats(teams: DashboardTeamRow[], groups: Array<{ objectiveCode: string; columns: DashboardColumn[] }>) {
  return teams.reduce(
    (overview, team) => {
      const hasReport = hasTeamReport(team);
      if (!hasReport) {
        overview.missingTeams += 1;
        return overview;
      }

      let hasRiskObjective = false;
      groups.forEach((group) => {
        if (objectiveTone(teamObjectiveStats(group.columns, team)) === "risk") {
          overview.riskObjectiveCells += 1;
          hasRiskObjective = true;
        }
      });
      if (hasRiskObjective || isViolationStatus(team.discipline_status)) {
        overview.attentionTeams += 1;
      }
      return overview;
    },
    { attentionTeams: 0, missingTeams: 0, riskObjectiveCells: 0 },
  );
}

function normalizeForMatch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function assessmentTone(team: DashboardTeamRow): ExecutiveTone {
  if (!hasTeamReport(team)) return "na";
  const normalized = normalizeForMatch(displayAssessment(team.monthly_assessment));
  if (normalized === "N/A") return "na";
  if (normalized.includes("KHONG") || normalized.includes("NOK") || normalized === "NG") return "risk";
  if (normalized.includes("TOT") || normalized.includes("XUAT SAC")) return "good";
  if (normalized.includes("HOAN THANH") || normalized === "HT") return "complete";
  return "complete";
}

function isViolationStatus(value: string | undefined) {
  const normalized = String(value || "").trim().toUpperCase();
  return ["NOK", "NG", "VI PHẠM", "VI PHAM"].includes(normalized);
}

const violationTeamOrder = ["TBĐL", "TBCH", "TBHTĐK", "TCĐK"];

function compareViolationTeams(left: DashboardTeamRow, right: DashboardTeamRow) {
  const leftIndex = violationTeamOrder.indexOf(left.team);
  const rightIndex = violationTeamOrder.indexOf(right.team);
  const safeLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const safeRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
  return safeLeft - safeRight || left.team.localeCompare(right.team);
}

function violationDescription(team: DashboardTeamRow) {
  const description = team.discipline_description?.trim();
  if (description) return description;
  return `${team.team_name || team.team} vi phạm quy định của Nhà máy/Công ty`;
}

function DisciplineViolations({ items, periodLabel }: { items: Array<{ team: string; description: string }>; periodLabel?: string }) {
  const hasViolations = items.length > 0;
  return (
    <div className={`discipline-violations ${hasViolations ? "" : "is-clear"}`} aria-label="Vi phạm quy định của Nhà máy/Công ty">
      <h3>VI PHẠM QUY ĐỊNH CỦA NHÀ MÁY/ CÔNG TY</h3>
      {hasViolations ? (
        <ul>
          {items.map((item) => (
            <li key={item.team}>{item.description}</li>
          ))}
        </ul>
      ) : (
        <p className="discipline-clear-note">
          Không ghi nhận vi phạm quy định của Nhà máy/Công ty{periodLabel ? ` trong kỳ ${periodLabel}` : " trong kỳ"}.
        </p>
      )}
    </div>
  );
}

function Status({ value }: { value: string }) {
  const normalized = isNaStatus(value) ? "na" : String(value).replace("/", "-").toLowerCase();
  const className = `status status-${normalized}`;
  return <span className={className}>{displayStatus(value)}</span>;
}

function CompactStatus({ value }: { value: string }) {
  const rawValue = String(value || "#N/A");
  const normalized = isNaStatus(rawValue) ? "na" : rawValue.replace("/", "-").toLowerCase();
  const label = normalized === "good" ? "G" : normalized === "na" ? "NA" : rawValue;
  return <span className={`compact-status compact-status-${normalized}`}>{label}</span>;
}
