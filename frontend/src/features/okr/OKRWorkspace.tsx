import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileDown, ImageDown, RefreshCw, Upload } from "lucide-react";
import { api } from "../../api/client";
import { EmptyStateBanner } from "./components/EmptyStateBanner";
import { KRDrillDownPanel } from "./components/KRDrillDownPanel";
import { MonthlyHistoryHeatmap } from "./components/MonthlyHistoryHeatmap";
import { ObjectiveDashboard } from "./components/ObjectiveDashboard";
import { PeriodSelector } from "./components/PeriodSelector";
import { exportDashboardElementAsPng } from "./exportDashboardPng";
import { readLastSelectedPeriod, writeLastSelectedPeriod } from "./lastSelectedPeriod";
import type { DashboardColumn, DashboardPayload, DashboardTeamRow, KRSummary, LeaderKPIAllocation } from "./types/dashboard";

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

export function OKRWorkspace({ role }: { role: string }) {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [period, setPeriod] = useState(() => {
    const stored = readLastSelectedPeriod();
    return stored ? { month: stored.month, year: stored.year } : defaultDashboardPeriod();
  });
  const [needsLatestBootstrap, setNeedsLatestBootstrap] = useState(() => readLastSelectedPeriod() === null);
  const [error, setError] = useState("");
  const [exportingPng, setExportingPng] = useState(false);
  const [activeKr, setActiveKr] = useState<KRSummary | null>(null);
  const [activeObjective, setActiveObjective] = useState<string | null>(null);
  const dashboardExportRef = useRef<HTMLDivElement | null>(null);
  const canManageOkr = ["Admin", "Workshop_Leader"].includes(role);
  const canUploadReport = role === "Admin";
  const canExportDashboard = canManageOkr;
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
  const dashboardPeriod = dashboard?.period;
  const periodLabel = dashboardPeriod?.label || `T${period.month}/${period.year}`;
  const latestDataPeriod = dashboard?.technical_metadata?.latest_data_period ?? null;
  const latestDataLabel = latestDataPeriod ? `T${latestDataPeriod.month}/${latestDataPeriod.year}` : undefined;
  const isNoDataPeriod = dashboardPeriod?.data_state === "no_data";
  const activeObjectiveRows = activeObjective
    ? summaries.filter((item) => item.workshop_kr_code?.startsWith(`${activeObjective}.KR`))
    : [];

  const selectKrByCode = (code: string) => {
    const row = summaries.find((item) => item.workshop_kr_code === code);
    if (row) {
      setActiveObjective(null);
      setActiveKr(row);
    }
  };

  const changePeriod = (nextPeriod: { month: number; year: number }) => {
    setPeriod(nextPeriod);
  };

  const jumpToLatest = () => {
    if (!latestDataPeriod) return;
    writeLastSelectedPeriod(latestDataPeriod);
    setPeriod({ month: latestDataPeriod.month, year: latestDataPeriod.year });
  };

  return (
    <div className="content-grid" ref={dashboardExportRef}>
      <section className="panel wide okr-matrix-panel">
        <div className="panel-header">
          <div>
            <h2>Ma trận đánh giá</h2>
            <p className="muted">Kỳ {periodLabel}</p>
          </div>
          <div className="toolbar">
            <PeriodSelector latestDataPeriod={latestDataPeriod} onChange={changePeriod} value={period} />
            {canUploadReport && (
              <label className="icon-button" title="Tải báo cáo đội/tổ">
                <Upload size={17} />
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(event) => {
                    upload(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            )}
            {canUploadReport && (
              <label className="icon-button" title="Import snapshot lịch sử">
                <Upload size={17} />
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(event) => {
                    importSnapshot(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            )}
            <button title="Tải template báo cáo" onClick={downloadTemplate}>
              <FileDown size={17} />
            </button>
            <button title="Tải lại dữ liệu" onClick={() => reload()}>
              <RefreshCw size={17} />
            </button>
            <button
              data-export-exclude="true"
              disabled={exportingPng || !dashboard}
              onClick={exportPng}
              title="Xuất PNG toàn dashboard"
              type="button"
            >
              <ImageDown size={17} />
            </button>
            {canExportDashboard && (
              <button title="Xuất Excel" onClick={exportExcel}>
                <Download size={17} />
              </button>
            )}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {isNoDataPeriod ? (
          <EmptyStateBanner currentLabel={periodLabel} latestDataLabel={latestDataLabel} onJumpToLatest={latestDataPeriod ? jumpToLatest : undefined} />
        ) : (
          <div className="matrix okr-matrix">
            <table className="okr-matrix-table">
              <colgroup>
                <col className="okr-team-column" />
                <col className="okr-assessment-column" />
                <col className="okr-discipline-column" />
                <col className="okr-allocation-column" />
                <col className="okr-allocation-column" />
                {dashboardColumns.map((column) => <col className="okr-kr-column" key={`col-${column.workshop_kr_code}`} />)}
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2}>Đội/Tổ</th>
                  <th rowSpan={2}>Đánh giá tháng</th>
                  <th rowSpan={2}>Kỷ luật</th>
                  <th rowSpan={2}>A2</th>
                  <th rowSpan={2}>A1</th>
                  {objectiveColumnGroups.map((group) => (
                    <th className="okr-objective-group" colSpan={group.columns.length} key={group.objectiveCode}>
                      {group.objectiveCode}
                    </th>
                  ))}
                </tr>
                <tr>
                  {dashboardColumns.map((column) => (
                    <th key={column.workshop_kr_code} title={column.workshop_kr_code}>
                      {column.workshop_kr_code.split(".")[1] || column.workshop_kr_code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dashboard?.teams?.map((team: DashboardTeamRow) => (
                  <tr key={team.team}>
                    <td>{team.team}</td>
                    <td>{team.monthly_assessment}</td>
                    <td><Status value={team.discipline_status} /></td>
                    <td title={allocationTitle(team.leader_kpi_allocation, "A2")}>
                      {team.leader_kpi_allocation?.a2 || ""}
                    </td>
                    <td title={allocationTitle(team.leader_kpi_allocation, "A1")}>
                      {team.leader_kpi_allocation?.a1 || ""}
                    </td>
                    {dashboardColumns.map((column: any) => (
                      <td key={column.workshop_kr_code}>
                        <button
                          className={`matrix-status-button ${activeKr?.workshop_kr_code === column.workshop_kr_code ? "active-kr" : ""}`}
                          onClick={() => selectKrByCode(column.workshop_kr_code)}
                          type="button"
                        >
                          <Status value={team.kr_statuses[column.workshop_kr_code]} />
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              setActiveObjective(objectiveCode);
            }}
            sections={dashboard?.objective_sections}
          />
        </>
      )}
      <KRDrillDownPanel row={activeKr} onClose={() => setActiveKr(null)} />
      <ObjectiveKRPanel
        objectiveCode={activeObjective}
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

function ObjectiveKRPanel({
  objectiveCode,
  rows,
  onClose,
  onSelect,
}: {
  objectiveCode: string | null;
  rows: KRSummary[];
  onClose: () => void;
  onSelect: (row: KRSummary) => void;
}) {
  if (!objectiveCode) return null;
  return (
    <aside className="kr-drilldown objective-kr-panel" aria-label="Danh sách KR theo mục tiêu">
      <div className="panel-header">
        <div>
          <h2>{objectiveCode}</h2>
          <p className="muted">KR liên quan đến mục tiêu</p>
        </div>
        <button onClick={onClose} type="button">Đóng</button>
      </div>
      <div className="compact-kr-list">
        {rows.length ? rows.map((row) => (
          <button className="compact-kr-row" key={row.workshop_kr_code} onClick={() => onSelect(row)} type="button">
            <span className="kr-code">{row.workshop_kr_code}</span>
            <span className="kr-name">{row.kr_name}</span>
            <span className="kr-target">Mục tiêu {row.target_value ?? "-"}</span>
          </button>
        )) : <p className="muted">Chưa có KR liên quan cho mục tiêu này.</p>}
      </div>
    </aside>
  );
}

function allocationTitle(allocation: LeaderKPIAllocation | undefined, grade: "A1" | "A2") {
  const rules = allocation?.triggered_rules?.filter((rule) => rule.grade === grade) ?? [];
  const details = rules.map((rule) => `${rule.rule}: ${rule.reason}`).join("\n");
  return [details, allocation?.cap_note].filter(Boolean).join("\n");
}

function Status({ value }: { value: string }) {
  const normalized = String(value).replace("#N/A", "na").replace("/", "-").toLowerCase();
  const className = `status status-${normalized}`;
  return <span className={className}>{value}</span>;
}
