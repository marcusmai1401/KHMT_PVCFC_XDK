import { Activity, BarChart3, CalendarDays, CheckCircle2, ClipboardList, Flag, LineChart, Radar, Target, TrendingUp } from "lucide-react";
import React from "react";
import type { ChartDataset, VisualBlock } from "../types/dashboard";
import { vn } from "../i18n";
import { NoDataBlock, NoPlanBlock } from "./EmptyBlocks";

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return vn(String(value));
}

function formatDatasetValue(value: unknown, format?: string) {
  if (format === "percent" && typeof value === "number") {
    return `${(value * 100).toFixed(1)}%`;
  }
  return formatValue(value);
}

function datasets(payload: Record<string, any> | undefined): ChartDataset[] {
  const raw = payload?.datasets;
  return Array.isArray(raw) ? raw : [];
}

function labels(payload: Record<string, any> | undefined): string[] {
  const raw = payload?.labels;
  return Array.isArray(raw) ? raw.map((label) => String(label)) : [];
}

function numericValues(series: ChartDataset[]) {
  return series.flatMap((dataset) => dataset.data).filter((value): value is number => typeof value === "number");
}

function maxValue(series: ChartDataset[]) {
  return Math.max(1, ...numericValues(series));
}

function axisLabels(payload: Record<string, any> | undefined) {
  const raw = payload?.axis_labels;
  return {
    x: typeof raw?.x === "string" ? raw.x : "Danh mục",
    leftY: typeof raw?.left_y === "string" ? raw.left_y : "Giá trị",
    rightY: typeof raw?.right_y === "string" ? raw.right_y : "Tỷ lệ (%)",
  };
}

function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function axisScale(max: number, count = 4, preserveUnitMax = false) {
  const safeMax = Math.max(1, max);
  const domainMax = preserveUnitMax && safeMax <= 1 ? 1 : niceStep(safeMax / count) * count;
  return {
    max: domainMax,
    ticks: Array.from({ length: count + 1 }, (_, index) => (domainMax / count) * index),
  };
}

function formatAxisValue(value: number, format?: string) {
  return format === "percent" ? `${(value * 100).toFixed(0)}%` : formatValue(value);
}

function percentValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numeric)) return null;
  const percent = numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, percent));
}

function formatPercentValue(value: unknown) {
  const percent = percentValue(value);
  return percent === null ? "-" : `${Math.round(percent)}%`;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

const FI_TEAM_ORDER = ["TBHTĐK", "TBCH", "TBĐL", "TCĐK"];

function rateValue(value: number, total: number) {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0;
}

function reviewPassedCount(bucket: any) {
  return numberValue(bucket?.review_passed ?? bucket?.approved);
}

function completedCount(bucket: any) {
  return numberValue(bucket?.completed_count ?? bucket?.completed);
}

function khmtMissingCount(bucket: any) {
  if (bucket?.khmt_not_considered !== undefined && bucket?.khmt_not_considered !== null) {
    return numberValue(bucket.khmt_not_considered);
  }
  return Math.max(reviewPassedCount(bucket) - numberValue(bucket?.khmt_considered), 0);
}

function buildFiDashboardSnapshot(payload: Record<string, any> | undefined) {
  const summary = payload?.fi_dashboard_summary && typeof payload.fi_dashboard_summary === "object"
    ? payload.fi_dashboard_summary
    : {};
  const rawTeams = Array.isArray(summary?.teams) ? summary.teams : [];
  const rawCounts = payload?.fi_counts_by_team && typeof payload.fi_counts_by_team === "object"
    ? payload.fi_counts_by_team
    : {};
  const teamByCode = new Map<string, any>();
  rawTeams.forEach((team: any) => {
    if (team?.team) teamByCode.set(String(team.team), team);
  });
  const rows = FI_TEAM_ORDER.map((team) => {
    const source = teamByCode.get(team) ?? {};
    const total = numberValue(source.total);
    const approved = reviewPassedCount(source);
    const khmt = numberValue(source.khmt_considered);
    const completed = completedCount(source);
    const okrCount = numberValue(rawCounts[team]);
    return {
      team,
      total,
      approved,
      khmt,
      completed,
      okrCount,
      approvalRate: rateValue(approved, total),
      khmtRate: rateValue(khmt, approved),
      completionRate: rateValue(completed, total),
    };
  }).filter((row) => row.total || row.approved || row.khmt || row.completed || row.okrCount);
  const rowTotals = rows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      approved: acc.approved + row.approved,
      khmt: acc.khmt + row.khmt,
      completed: acc.completed + row.completed,
      okrCount: acc.okrCount + row.okrCount,
    }),
    { total: 0, approved: 0, khmt: 0, completed: 0, okrCount: 0 },
  );
  const totalsSource = summary?.totals && typeof summary.totals === "object" ? summary.totals : {};
  const totals = {
    total: numberValue(totalsSource.total) || rowTotals.total,
    approved: reviewPassedCount(totalsSource) || rowTotals.approved,
    khmt: numberValue(totalsSource.khmt_considered) || rowTotals.khmt,
    completed: completedCount(totalsSource) || rowTotals.completed,
    missing: khmtMissingCount(totalsSource),
    okrCount: rowTotals.okrCount,
  };
  if (!rows.length && !Object.values(totals).some((value) => value > 0)) return null;
  return {
    rows,
    totals,
    approvalRate: rateValue(totals.approved, totals.total),
    khmtRate: rateValue(totals.khmt, totals.approved),
    completionRate: rateValue(totals.completed, totals.total),
  };
}

function ChartShell({
  title,
  icon,
  kind,
  visualId,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  kind?: string;
  visualId?: string;
  children: React.ReactNode;
}) {
  const classes = [
    "objective-visual",
    kind ? `visual-kind-${kind}` : "",
    visualId ? `visual-id-${visualId}` : "",
  ].filter(Boolean).join(" ");
  return (
    <article className={classes}>
      <div className="objective-visual-header">
        <span className="objective-visual-icon">{icon}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </article>
  );
}

function BarChartInline({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  if (visualId === "o5_training") {
    return <TrainingChartInline title={title} payload={payload} visualId={visualId} kind={kind} />;
  }

  const series = datasets(payload);
  const blockLabels = labels(payload);
  const max = maxValue(series);
  return (
    <ChartShell title={title} icon={<BarChart3 size={17} />} kind={kind} visualId={visualId}>
      <div className="okr-chart-bars">
        {blockLabels.map((label, labelIndex) => (
          <div className="okr-chart-row" key={`${label}-${labelIndex}`}>
            <span>{label}</span>
            <div>
              {series.map((dataset) => {
                const value = dataset.data[labelIndex];
                const width = typeof value === "number" ? `${Math.max(2, (value / max) * 100)}%` : "0";
                return (
                  <div className="okr-bar-line" key={dataset.label}>
                    <span className="okr-bar-label">{vn(dataset.label)}</span>
                    <span className="okr-bar-track">
                      <span className="okr-bar-fill" style={{ width }} />
                    </span>
                    <strong>{formatValue(value)}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ChartShell>
  );
}

function trainingStatus(plan: number, actual: number) {
  if (plan <= 0 && actual <= 0) return { tone: "empty", statusLabel: "Không phát sinh" };
  if (plan > 0 && actual >= plan) return { tone: "done", statusLabel: "Đạt kế hoạch" };
  if (actual > 0) return { tone: "progress", statusLabel: "Đang thực hiện" };
  return { tone: "planned", statusLabel: "Theo kế hoạch" };
}

function TrainingChartInline({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const series = datasets(payload);
  const blockLabels = labels(payload);
  const planDataset = series.find((dataset) => /k[eế]\s*ho[aạ]ch/i.test(vn(dataset.label))) ?? series[0];
  const actualDataset = series.find((dataset) => /th[uự]c\s*hi[eệ]n/i.test(vn(dataset.label))) ?? series[1] ?? series[0];
  const rows = blockLabels.map((label, index) => {
    const plan = numberValue(planDataset?.data?.[index]);
    const actual = numberValue(actualDataset?.data?.[index]);
    const status = trainingStatus(plan, actual);
    const completion = plan > 0 ? Math.round((actual / plan) * 100) : actual > 0 ? 100 : 0;
    return { monthLabel: label, plan, actual, completion, ...status };
  });
  const max = Math.max(1, ...rows.flatMap((row) => [row.plan, row.actual]));
  const totalPlan = rows.reduce((sum, row) => sum + row.plan, 0);
  const totalActual = rows.reduce((sum, row) => sum + row.actual, 0);
  const completionRate = totalPlan > 0 ? Math.round((totalActual / totalPlan) * 100) : 0;
  const completedMonths = rows.filter((row) => row.plan > 0 && row.actual >= row.plan).length;
  const plannedMonths = rows.filter((row) => row.plan > 0).length;
  const remaining = Math.max(0, totalPlan - totalActual);
  const peakMonth = rows.reduce(
    (best, row) => (row.plan > best.plan ? row : best),
    rows[0] ?? { monthLabel: "-", plan: 0, actual: 0, completion: 0, tone: "empty", statusLabel: "Không phát sinh" },
  );

  return (
    <ChartShell title={title} icon={<BarChart3 size={17} />} kind={kind} visualId={visualId}>
      <div className="training-dashboard">
        <section className="training-summary-panel" aria-label="Tổng quan đào tạo nội bộ">
          <div className="training-summary-main">
            <span className="training-kicker">O5.KR3</span>
            <h4>Tiến độ đào tạo theo tháng</h4>
            <div className="training-total">
              <strong>{formatValue(totalActual)}</strong>
              <span>/ {formatValue(totalPlan)} giờ</span>
            </div>
            <div className="training-total-track">
              <span style={{ width: `${Math.min(100, completionRate)}%` }} />
            </div>
            <small>{completionRate}% hoàn thành kế hoạch năm</small>
          </div>
          <div className="training-summary-stats">
            <span><strong>{completedMonths}</strong> tháng đạt KH</span>
            <span><strong>{plannedMonths}</strong> tháng có KH</span>
            <span><strong>{formatValue(remaining)}</strong> giờ còn lại</span>
            <span><strong>{peakMonth?.monthLabel ?? "-"}</strong> tháng trọng điểm</span>
          </div>
        </section>

        <div className="training-month-grid" aria-label="Kế hoạch và thực hiện đào tạo từng tháng">
          {rows.map((row) => {
            const planWidth = `${Math.max(row.plan > 0 ? 4 : 0, (row.plan / max) * 100)}%`;
            const actualWidth = `${Math.max(row.actual > 0 ? 4 : 0, (row.actual / max) * 100)}%`;
            return (
              <article className={`training-month-card tone-${row.tone}`} key={row.monthLabel}>
                <div className="training-month-head">
                  <strong>{row.monthLabel}</strong>
                  <span>{row.monthLabel.replace("T", "Tháng ")}</span>
                </div>
                <div className="training-month-bars">
                  <div>
                    <span>Kế hoạch</span>
                    <i><b style={{ width: planWidth }} /></i>
                    <strong>{formatValue(row.plan)}</strong>
                  </div>
                  <div>
                    <span>Thực hiện</span>
                    <i><b style={{ width: actualWidth }} /></i>
                    <strong>{formatValue(row.actual)}</strong>
                  </div>
                </div>
                <div className="training-month-footer">
                  <strong>{row.completion}%</strong>
                  <span>{row.statusLabel}</span>
                </div>
                {row.monthLabel === peakMonth?.monthLabel && row.plan > 0 ? <p>Tháng trọng điểm</p> : null}
              </article>
            );
          })}
        </div>
      </div>
    </ChartShell>
  );
}

function BarLineChartInline({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const [hoveredItem, setHoveredItem] = React.useState<{
    x: number;
    y: number;
    title: string;
    label: string;
    value: string;
    color: string;
  } | null>(null);

  const series = datasets(payload);
  const blockLabels = labels(payload);
  const barSeries = series.filter((dataset) => dataset.chart_type !== "line");
  const lineSeries = series.filter((dataset) => dataset.chart_type === "line");
  const leftScale = axisScale(maxValue(barSeries));
  const rightScale = axisScale(Math.max(1, ...numericValues(lineSeries)), 4, lineSeries.some((dataset) => dataset.value_format === "percent"));
  const axis = axisLabels(payload);
  const width = 560;
  const height = 230;
  const chartLeft = 75;
  const chartRight = width - 75;
  const chartTop = 18;
  const chartBottom = height - 52;
  const innerWidth = chartRight - chartLeft;
  const step = blockLabels.length <= 1 ? innerWidth : innerWidth / blockLabels.length;
  const groupWidth = Math.min(step * 0.72, 42);
  const barWidth = Math.max(8, groupWidth / Math.max(barSeries.length, 1));
  const linePoints = lineSeries.map((dataset) => dataset.data.map((value, index) => {
    if (typeof value !== "number") return null;
    const x = chartLeft + index * step + step / 2;
    const max = dataset.axis === "right" ? rightScale.max : leftScale.max;
    const y = chartBottom - (value / max) * (chartBottom - chartTop);
    return { x, y };
  }));

  return (
    <ChartShell title={title} icon={<TrendingUp size={17} />} kind={kind} visualId={visualId}>
      <div className="bar-line-chart">
        <svg className="okr-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {leftScale.ticks.map((tick) => {
            const y = chartBottom - (tick / leftScale.max) * (chartBottom - chartTop);
            return (
              <g key={`left-tick-${tick}`}>
                <line className="chart-gridline" x1={chartLeft} x2={chartRight} y1={y} y2={y} />
                <text className="chart-tick" x={chartLeft - 8} y={y + 4} textAnchor="end">
                  {formatAxisValue(tick)}
                </text>
              </g>
            );
          })}
          <line className="chart-axis-line" x1={chartLeft} x2={chartLeft} y1={chartTop} y2={chartBottom} />
          <line className="chart-axis-line" x1={chartLeft} x2={chartRight} y1={chartBottom} y2={chartBottom} />
          {lineSeries.length ? rightScale.ticks.map((tick) => {
            const y = chartBottom - (tick / rightScale.max) * (chartBottom - chartTop);
            return (
              <text className="chart-tick chart-tick-right" key={`right-tick-${tick}`} x={chartRight + 8} y={y + 4} textAnchor="start">
                {formatAxisValue(tick, lineSeries[0]?.value_format)}
              </text>
            );
          }) : null}
          {barSeries.flatMap((dataset, datasetIndex) => dataset.data.map((value, index) => {
            if (typeof value !== "number") return null;
            const barHeight = (value / leftScale.max) * (chartBottom - chartTop);
            const x = chartLeft + index * step + (step - groupWidth) / 2 + datasetIndex * barWidth;
            const y = chartBottom - barHeight;
            return (
              <rect
                key={`${dataset.label}-${index}`}
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx="4"
                fill={dataset.color || "#f97316"}
                onMouseEnter={() =>
                  setHoveredItem({
                    x: x + barWidth / 2,
                    y: y,
                    title: blockLabels[index] || "",
                    label: vn(dataset.label),
                    value: formatDatasetValue(value, dataset.value_format),
                    color: dataset.color || "#f97316",
                  })
                }
                onMouseLeave={() => setHoveredItem(null)}
              />
            );
          }))}
          {linePoints.map((points, datasetIndex) => {
            const path = points.filter(Boolean).map((point) => `${point!.x},${point!.y}`).join(" ");
            const dataset = lineSeries[datasetIndex];
            return path ? <polyline key={dataset.label} points={path} fill="none" stroke={dataset.color || "currentColor"} strokeWidth="3" /> : null;
          })}
          {linePoints.flatMap((points, datasetIndex) => points.map((point, index) => {
            const dataset = lineSeries[datasetIndex];
            const value = dataset.data[index];
            return point ? (
              <circle
                key={`${dataset.label}-${index}`}
                cx={point.x}
                cy={point.y}
                r="4"
                fill={dataset.color || "currentColor"}
                onMouseEnter={() =>
                  setHoveredItem({
                    x: point.x,
                    y: point.y,
                    title: blockLabels[index] || "",
                    label: vn(dataset.label),
                    value: formatDatasetValue(value, dataset.value_format),
                    color: dataset.color || "currentColor",
                  })
                }
                onMouseLeave={() => setHoveredItem(null)}
              />
            ) : null;
          }))}
          {blockLabels.map((label, index) => (
            <text key={label} x={chartLeft + index * step + step / 2} y={height - 29} textAnchor="middle">{label}</text>
          ))}
          <text className="chart-axis-title" x={(chartLeft + chartRight) / 2} y={height - 8} textAnchor="middle">{axis.x}</text>
          <text className="chart-axis-title" x={18} y={(chartTop + chartBottom) / 2} textAnchor="middle" transform={`rotate(-90 18 ${(chartTop + chartBottom) / 2})`}>
            {axis.leftY}
          </text>
          {lineSeries.length ? (
            <text className="chart-axis-title" x={width - 18} y={(chartTop + chartBottom) / 2} textAnchor="middle" transform={`rotate(90 ${width - 18} ${(chartTop + chartBottom) / 2})`}>
              {axis.rightY}
            </text>
          ) : null}
        </svg>
        <div className="chart-legend">
          {series.map((dataset) => (
            <span key={dataset.label}>
              <i
                className={dataset.chart_type === "line" ? "legend-line" : "legend-bar"}
                style={dataset.color ? dataset.chart_type === "line" ? { borderColor: dataset.color } : { background: dataset.color } : undefined}
              />
              {vn(dataset.label)}
            </span>
          ))}
        </div>
        {Array.isArray(payload?.summary_items) && payload.summary_items.length ? <SummaryBadges items={payload.summary_items} /> : null}
        {hoveredItem && (
          <div
            className="okr-chart-tooltip"
            style={{
              left: `${(hoveredItem.x / width) * 100}%`,
              top: `${(hoveredItem.y / height) * 100}%`,
              borderLeftColor: hoveredItem.color,
            }}
          >
            <div className="tooltip-title">{hoveredItem.title}</div>
            <div className="tooltip-row">
              <span className="tooltip-color-dot" style={{ backgroundColor: hoveredItem.color }} />
              <span className="tooltip-label">{hoveredItem.label}:</span>
              <strong className="tooltip-value">{hoveredItem.value}</strong>
            </div>
          </div>
        )}
      </div>
    </ChartShell>
  );
}

function LineChartInline({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const series = datasets(payload);
  const values = series[0]?.data ?? [];
  const scale = axisScale(maxValue(series));
  const axis = axisLabels(payload);
  const width = 420;
  const height = 210;
  const chartLeft = 46;
  const chartRight = width - 18;
  const chartTop = 18;
  const chartBottom = height - 48;
  const innerWidth = chartRight - chartLeft;
  const points = values.map((value, index) => {
    if (typeof value !== "number") return null;
    const x = values.length <= 1 ? chartLeft : chartLeft + (index / (values.length - 1)) * innerWidth;
    const y = chartBottom - (value / scale.max) * (chartBottom - chartTop);
    return { x, y };
  });
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (!point) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length) segments.push(current);
  return (
    <ChartShell title={title} icon={<LineChart size={17} />} kind={kind} visualId={visualId}>
      <div className="okr-line-chart">
        <svg className="okr-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {scale.ticks.map((tick) => {
            const y = chartBottom - (tick / scale.max) * (chartBottom - chartTop);
            return (
              <g key={`line-tick-${tick}`}>
                <line className="chart-gridline" x1={chartLeft} x2={chartRight} y1={y} y2={y} />
                <text className="chart-tick" x={chartLeft - 8} y={y + 4} textAnchor="end">
                  {formatAxisValue(tick)}
                </text>
              </g>
            );
          })}
          <line className="chart-axis-line" x1={chartLeft} x2={chartLeft} y1={chartTop} y2={chartBottom} />
          <line className="chart-axis-line" x1={chartLeft} x2={chartRight} y1={chartBottom} y2={chartBottom} />
          {segments.map((segment, index) => (
            <polyline key={index} points={segment.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="3" />
          ))}
          {points.map((point, index) => point ? <circle key={index} cx={point.x} cy={point.y} r="4" /> : null)}
          <text className="chart-axis-title" x={(chartLeft + chartRight) / 2} y={height - 8} textAnchor="middle">{axis.x}</text>
          <text className="chart-axis-title" x={14} y={(chartTop + chartBottom) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(chartTop + chartBottom) / 2})`}>
            {axis.leftY}
          </text>
        </svg>
        <div className="okr-line-labels" style={{ gridTemplateColumns: `repeat(${Math.max(labels(payload).length, 1)}, 1fr)` }}>
          {labels(payload).map((label) => <span key={label}>{label}</span>)}
        </div>
        {Array.isArray(payload?.summary_items) && payload.summary_items.length ? <SummaryBadges items={payload.summary_items} /> : null}
      </div>
    </ChartShell>
  );
}

function SummaryBadges({ items }: { items: Array<Record<string, any>> }) {
  return (
    <div className="summary-badge-row">
      {items.map((item, index) => (
        <div className="summary-badge" key={`${item.label}-${index}`}>
          <span>{vn(String(item.label || "Chỉ số"))}</span>
          <strong>{formatDatasetValue(item.value, item.format)}</strong>
        </div>
      ))}
    </div>
  );
}

function MetricTable({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const notes = Array.isArray(payload?.notes) ? payload.notes : [];
  return (
    <ChartShell title={title} icon={<ClipboardList size={17} />} kind={kind} visualId={visualId}>
      <div className="metric-table-stack">
        {columns.length ? (
          <div className="metric-table-wrapper">
            <table className="metric-table">
              <thead>
                <tr>
                  {columns.map((column: any) => <th key={column.key}>{vn(String(column.label || column.key))}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row: Record<string, any>, rowIndex: number) => (
                  <tr key={String(row.team || rowIndex)}>
                    {columns.map((column: any) => (
                      <td key={column.key}>
                        {column.key === "team_name" ? (
                          <div className="team-cell-info" title={formatValue(row[column.key])}>
                            <strong>{row.team || formatValue(row[column.key])}</strong>
                            {row.team ? <small className="team-fullname">{formatValue(row[column.key])}</small> : null}
                          </div>
                        ) : (
                          formatDatasetValue(row[column.key], column.format)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {Array.isArray(payload?.summary_items) && payload.summary_items.length ? <SummaryBadges items={payload.summary_items} /> : null}
        {notes.length ? (
          <div className="metric-note-block">
            <strong>Ghi chú từ dashboard Excel</strong>
            <ul>
              {notes.map((note: string, index: number) => <li key={`${note}-${index}`}>{note}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </ChartShell>
  );
}

function KpiBadges({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const items = Array.isArray(payload?.items)
    ? payload.items
    : [
        { label: "Mục tiêu", value: payload?.master_target },
        { label: "Kết quả", value: payload?.total ?? payload?.current_result },
        { label: "Lũy kế", value: payload?.cumulative },
      ];
  return (
    <ChartShell title={title} icon={<TrendingUp size={17} />} kind={kind} visualId={visualId}>
      <div className="kpi-badge-grid">
        {items.map((item: any, index: number) => (
          <div className="kpi-badge" key={`${item.label}-${index}`}>
            <span>{vn(String(item.label || "Chỉ số"))}</span>
            <strong>{formatValue(item.value)}</strong>
          </div>
        ))}
      </div>
    </ChartShell>
  );
}

function StatusGrid({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return (
    <ChartShell title={title} icon={<ClipboardList size={17} />} kind={kind} visualId={visualId}>
      <div className="objective-status-grid">
        {items.map((item: any) => (
          <div className="objective-status-row" key={item.workshop_kr_code}>
            <strong>{item.workshop_kr_code}</strong>
            <span>{item.kr_name || item.workshop_kr_code}</span>
            <div>
              {Object.entries(item.team_statuses || {}).map(([team, status]) => (
                <small className={`status status-${String(status || "#N/A").replace("#N/A", "na").toLowerCase()}`} key={team}>
                  {team}: {formatValue(status)}
                </small>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ChartShell>
  );
}

function NarrativeCard({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const snapshotRows = Array.isArray(payload?.snapshot_rows) ? payload.snapshot_rows : [];
  const sourceItems = items.length ? items : snapshotRows;
  return (
    <ChartShell title={title} icon={<Activity size={17} />} kind={kind} visualId={visualId}>
      <div className="narrative-list">
        {sourceItems.length ? sourceItems.map((item: any, index: number) => (
          <div className="narrative-item" key={`${item.workshop_kr_code || item.label || index}`}>
            <strong>{item.workshop_kr_code || item.label || `Mục ${index + 1}`}</strong>
            <span>{item.kr_name || formatValue(item.value) || formatValue(item.values?.[1])}</span>
          </div>
        )) : (
          <div className="narrative-item">
            <strong>Kết quả</strong>
            <span>{formatValue(payload?.total ?? payload?.current_result)}</span>
          </div>
        )}
      </div>
    </ChartShell>
  );
}

function ProgressCard({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const isRunning = visualId === "o6_running";

  return (
    <ChartShell title={title} icon={isRunning ? <Activity size={17} /> : <TrendingUp size={17} />} kind={kind} visualId={visualId}>
      <div className="okr-card-grid">
        {items.map((item: any) => {
          const rate = typeof item.participation_rate === "number" ? Math.min(item.participation_rate, 1) : 0;
          const pct = Math.round(rate * 100);
          return (
            <div className="metric-card compact-card" key={String(item.team || item.label)}>
              <div className="compact-card-header">
                <strong>{item.team_name || item.team || item.label}</strong>
                {isRunning ? (
                  <span className={`status-pill ${pct >= 100 ? "status-success" : pct >= 50 ? "status-warning" : "status-danger"}`}>
                    {pct}% đạt
                  </span>
                ) : null}
              </div>
              <span>{formatValue(item.actual ?? item.value)} / {formatValue(item.total)}</span>
              <div className="progress-track">
                <span style={{ width: `${rate * 100}%` }} />
              </div>
              <small>Mục tiêu tham gia {formatValue(item.participation_target)}</small>
            </div>
          );
        })}
      </div>
    </ChartShell>
  );
}

const competencyMilestones = [
  { value: "25%", label: "Xây dựng" },
  { value: "50%", label: "Review góp ý" },
  { value: "75%", label: "Phản biện" },
  { value: "100%", label: "Chuẩn hóa KNL và bậc" },
];

function radarCoordinate(centerX: number, centerY: number, radius: number, index: number, total: number, scale = 1) {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
  return {
    x: centerX + Math.cos(angle) * radius * scale,
    y: centerY + Math.sin(angle) * radius * scale,
  };
}

function radarPolygon(total: number, centerX: number, centerY: number, radius: number, scale: number) {
  return Array.from({ length: total }, (_, index) => {
    const point = radarCoordinate(centerX, centerY, radius, index, total, scale);
    return `${point.x},${point.y}`;
  }).join(" ");
}

function competencyLabelLines(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 4 && parts[0] === "KNL") {
    return [`${parts[0]} ${parts[1]}`, parts.slice(2, -1).join(" "), parts[parts.length - 1]];
  }
  return parts.length > 2 ? [parts.slice(0, 2).join(" "), parts.slice(2).join(" ")] : [label];
}

function competencyTone(percent: number | null) {
  if (percent === null) return "empty";
  if (percent >= 100) return "complete";
  if (percent >= 75) return "review";
  if (percent >= 50) return "progress";
  if (percent > 0) return "start";
  return "empty";
}

function CompetencyRadarInline({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const blockLabels = labels(payload);
  const values = datasets(payload)[0]?.data ?? [];
  const percents = blockLabels.map((_, index) => percentValue(values[index]));
  const plotted = percents.map((value) => value ?? 0);
  const validValues = percents.filter((value): value is number => value !== null);
  const average = validValues.length ? Math.round(validValues.reduce((sum, value) => sum + value, 0) / validValues.length) : 0;
  const completed = validValues.filter((value) => value >= 100).length;
  const inProgress = validValues.filter((value) => value > 0 && value < 100).length;
  const fiSnapshot = buildFiDashboardSnapshot(payload);

  const width = 460;
  const height = 350;
  const centerX = 230;
  const centerY = 174;
  const radius = 108;
  const labelRadius = 158;
  const total = Math.max(blockLabels.length, 3);
  const dataPointList = plotted.map((percent, index) => radarCoordinate(centerX, centerY, radius, index, total, percent / 100));
  const dataPoints = dataPointList.map((point) => `${point.x},${point.y}`).join(" ");
  const dataOutlinePoints = plotted.length > 1 && plotted[0] > 0 && plotted[plotted.length - 1] > 0
    ? `${dataPoints} ${dataPointList[0].x},${dataPointList[0].y}`
    : dataPoints;
  const axisPoints = blockLabels.map((label, index) => {
    const point = radarCoordinate(centerX, centerY, radius, index, total);
    const labelPoint = radarCoordinate(centerX, centerY, labelRadius, index, total);
    const anchor: "middle" | "start" | "end" = Math.abs(labelPoint.x - centerX) < 8 ? "middle" : labelPoint.x > centerX ? "start" : "end";
    return { label, point, labelPoint, anchor };
  });

  return (
    <ChartShell title={title} icon={<Radar size={17} />} kind={kind} visualId={visualId}>
      <div className="competency-radar-layout">
        <section className="competency-goal-panel" aria-label="Mục tiêu khung năng lực">
          <span className="competency-kicker"><Target size={16} />Mục tiêu</span>
          <h4>KR1. Xây dựng khung năng lực</h4>
          <div className="competency-main-metric">
            <strong>{blockLabels.length}</strong>
            <span>vị trí chức danh</span>
          </div>
          <div className="competency-mini-stats">
            <span><strong>{completed}</strong> chuẩn hóa</span>
            <span><strong>{inProgress}</strong> đang làm</span>
            <span><strong>{average}%</strong> trung bình</span>
          </div>
          <dl className="competency-milestones">
            {competencyMilestones.map((item) => (
              <div key={item.value}>
                <dt>{item.value}</dt>
                <dd>{item.label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="competency-radar-stage">
          <svg className="okr-chart competency-radar-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
            {[1, 0.75, 0.5, 0.25].map((scale) => (
              <polygon
                className={`competency-radar-ring ${scale === 1 ? "outer" : ""}`}
                key={scale}
                points={radarPolygon(total, centerX, centerY, radius, scale)}
              />
            ))}
            {axisPoints.map(({ point, label }, index) => (
              <line className="competency-radar-axis" key={`axis-${label}-${index}`} x1={centerX} y1={centerY} x2={point.x} y2={point.y} />
            ))}
            <line className="competency-radar-main-axis" x1={centerX} y1={centerY - radius} x2={centerX} y2={centerY + radius} />
            {[100, 75, 50, 25, 0].map((tick) => (
              <text className="competency-radar-scale" key={tick} x={centerX - 12} y={centerY - (radius * tick) / 100 + 5} textAnchor="end">
                {tick}%
              </text>
            ))}
            {dataPoints ? <polygon className="competency-radar-data-fill" points={dataPoints} /> : null}
            {dataOutlinePoints ? <polyline className="competency-radar-data-line" points={dataOutlinePoints} /> : null}
            {plotted.map((percent, index) => {
              const point = radarCoordinate(centerX, centerY, radius, index, total, percent / 100);
              return <circle className="competency-radar-point" key={`${blockLabels[index]}-${index}`} cx={point.x} cy={point.y} r="4.5" />;
            })}
            {axisPoints.map(({ label, labelPoint, anchor }) => (
              <text className="competency-radar-label" key={label} x={labelPoint.x} y={labelPoint.y} textAnchor={anchor}>
                {competencyLabelLines(label).map((line, lineIndex) => (
                  <tspan key={line} x={labelPoint.x} dy={lineIndex === 0 ? 0 : 15}>{line}</tspan>
                ))}
              </text>
            ))}
          </svg>
        </div>


        <div className="competency-position-list" aria-label="Tiến độ từng vị trí">
          {blockLabels.map((label, index) => {
            const percent = percents[index];
            return (
              <div className={`competency-position-item tone-${competencyTone(percent)}`} key={label}>
                <div className="competency-position-head">
                  <span className="competency-position-dot" />
                  <span title={label}>{label}</span>
                  <strong>{formatPercentValue(values[index])}</strong>
                </div>
                <span className="competency-position-track"><span style={{ width: `${percent ?? 0}%` }} /></span>
              </div>
            );
          })}
        </div>
      </div>
    </ChartShell>
  );
}

function InitiativesFiDashboard({
  title,
  payload,
  visualId,
  kind,
}: {
  title: string;
  payload?: Record<string, any>;
  visualId?: string;
  kind?: string;
}) {
  const fiSnapshot = buildFiDashboardSnapshot(payload);

  const kr12Items = Array.isArray(payload?.items)
    ? payload.items
    : [
        { label: "Mục tiêu", value: payload?.master_target },
        { label: "Kết quả", value: payload?.total ?? payload?.current_result },
        { label: "Lũy kế", value: payload?.cumulative },
      ];

  const kr13Target = payload?.o5_fi_payload?.master_target ?? 8;
  const kr13Result = fiSnapshot?.totals?.okrCount ?? payload?.o5_fi_payload?.total ?? 8;

  // Lấy danh sách sáng kiến cụ thể từ o5_fi_payload
  const fiItems = Array.isArray(payload?.o5_fi_payload?.items) ? payload.o5_fi_payload.items : [];
  const snapshotRows = Array.isArray(payload?.o5_fi_payload?.snapshot_rows) ? payload.o5_fi_payload.snapshot_rows : [];
  const actualFiItems = fiItems.length ? fiItems : snapshotRows;

  return (
    <ChartShell title="Sáng kiến & FI Dashboard" icon={<ClipboardList size={17} />} kind={kind} visualId={visualId}>
      <div className="initiatives-fi-layout">
        
        {/* Hàng trên cùng: Tóm tắt KPI OKR của O5.KR12 và O5.KR13 */}
        <div className="kr-summary-grid">
          <div className="kr-summary-card kr12-card">
            <div className="kr-card-head">
              <span className="kr-badge kr12-badge">O5.KR12</span>
              <h4>Sáng kiến được công nhận</h4>
            </div>
            <div className="kr-card-metrics">
              {kr12Items.map((item: any, idx: number) => (
                <div className="kr-metric-box" key={idx}>
                  <span>{vn(item.label)}</span>
                  <strong>{formatValue(item.value)}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="kr-summary-card kr13-card">
            <div className="kr-card-head">
              <span className="kr-badge kr13-badge">O5.KR13</span>
              <h4>FI/CTKT cấp Xưởng</h4>
            </div>
            <div className="kr-card-metrics">
              <div className="kr-metric-box">
                <span>Mục tiêu</span>
                <strong>{formatValue(kr13Target)}</strong>
              </div>
              <div className="kr-metric-box">
                <span>Kết quả</span>
                <strong>{formatValue(kr13Result)}</strong>
              </div>
              <div className="kr-metric-box">
                <span>Tỷ lệ đạt</span>
                <strong>{kr13Target > 0 ? `${Math.round((Number(kr13Result) / Number(kr13Target)) * 100)}%` : "-"}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Khối giữa: Chỉ số Dashboard FI tổng hợp */}
        {fiSnapshot ? (
          <div className="fi-dashboard-content">
            <div className="fi-sub-header">
              <span>BÁO CÁO TIẾN ĐỘ SÁNG KIẾN & CTKT THỰC TẾ</span>
            </div>
            
            <div className="competency-fi-kpis">
              <span>
                <ClipboardList size={15} />
                <small>Tổng SK đăng ký</small>
                <strong>{formatValue(fiSnapshot.totals.total)}</strong>
              </span>
              <span>
                <CheckCircle2 size={15} />
                <small>Đã xét đạt</small>
                <strong>{formatValue(fiSnapshot.totals.approved)}</strong>
                <em>{fiSnapshot.approvalRate}%</em>
              </span>
              <span>
                <CalendarDays size={15} />
                <small>Đã vào KHMT</small>
                <strong>{formatValue(fiSnapshot.totals.khmt)}</strong>
                <em>{fiSnapshot.khmtRate}%</em>
              </span>
              <span>
                <Flag size={15} />
                <small>Hoàn tất áp dụng</small>
                <strong>{formatValue(fiSnapshot.totals.completed)}</strong>
                <em>{fiSnapshot.completionRate}%</em>
              </span>
            </div>

            {/* Tiến độ chi tiết theo từng đội tổ */}
            {fiSnapshot.rows.length ? (
              <div className="competency-fi-team-grid">
                {fiSnapshot.rows.map((team) => (
                  <div className="competency-fi-team" key={team.team}>
                    <div className="competency-fi-team-head">
                      <strong>{team.team}</strong>
                      <span>{formatValue(team.total)} SK</span>
                    </div>
                    <div className="competency-fi-team-bars">
                      <span title={`${team.approved} SK đã xét đạt`}>
                        <i><b className="tone-approved" style={{ width: `${team.approvalRate}%` }} /></i>
                        <em>{formatValue(team.approved)} đạt ({team.approvalRate}%)</em>
                      </span>
                      <span title={`${team.khmt} SK đã vào KHMT`}>
                        <i><b className="tone-khmt" style={{ width: `${team.khmtRate}%` }} /></i>
                        <em>{formatValue(team.khmt)} KHMT ({team.khmtRate}%)</em>
                      </span>
                      <span title={`${team.okrCount} CTKT tính O5.KR13`}>
                        <i><b className="tone-okr" style={{ width: `${team.okrCount ? 100 : 0}%` }} /></i>
                        <em>{formatValue(team.okrCount)} O5.KR13</em>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Danh sách sáng kiến cụ thể nếu có */}
        {actualFiItems.length ? (
          <div className="fi-narrative-section">
            <div className="fi-sub-header">
              <span>DANH SÁCH CHI TIẾT SÁNG KIẾN / CẢI TIẾN TRONG KỲ</span>
            </div>
            <div className="narrative-list visual-id-o5_fi">
              {actualFiItems.map((item: any, index: number) => (
                <div className="narrative-item" key={`${item.workshop_kr_code || item.label || index}`}>
                  <strong>{item.workshop_kr_code || item.label || `Mục ${index + 1}`}</strong>
                  <span>{item.kr_name || formatValue(item.value) || formatValue(item.values?.[1])}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </ChartShell>
  );
}

function RadarChartInline({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  if (visualId === "o5_competency") {
    return <CompetencyRadarInline title={title} payload={payload} visualId={visualId} kind={kind} />;
  }

  const blockLabels = labels(payload);
  const values = datasets(payload)[0]?.data ?? [];
  const numeric = values.map((value) => percentValue(value) ?? 0);
  const max = 100;
  const size = 220;
  const center = size / 2;
  const radius = 86;

  // Compute radar vertices
  const points = numeric.map((value, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(numeric.length, 1) - Math.PI / 2;
    const scaled = (value / max) * radius;
    return `${center + Math.cos(angle) * scaled},${center + Math.sin(angle) * scaled}`;
  });

  // Compute spokes (grid axes)
  const spokes = numeric.map((_, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(numeric.length, 1) - Math.PI / 2;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    return { x, y };
  });

  return (
    <ChartShell title={title} icon={<Radar size={17} />} kind={kind} visualId={visualId}>
      <div className="radar-layout">
        <div className="radar-chart-container">
          <svg className="okr-chart radar-chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title}>
            {/* Concentric grid circles representing 25%, 50%, 75%, 100% */}
            <circle cx={center} cy={center} r={radius} className="radar-grid-circle outer" />
            <circle cx={center} cy={center} r={radius * 0.75} className="radar-grid-circle" />
            <circle cx={center} cy={center} r={radius * 0.50} className="radar-grid-circle" />
            <circle cx={center} cy={center} r={radius * 0.25} className="radar-grid-circle" />

            {/* Scale Labels */}
            <text x={center - 6} y={center - radius + 4} className="radar-grid-label">100%</text>
            <text x={center - 6} y={center - radius * 0.75 + 4} className="radar-grid-label">75%</text>
            <text x={center - 6} y={center - radius * 0.50 + 4} className="radar-grid-label">50%</text>
            <text x={center - 6} y={center - radius * 0.25 + 4} className="radar-grid-label">25%</text>

            {/* Grid Spokes */}
            {spokes.map((spoke, idx) => (
              <line
                key={idx}
                x1={center}
                y1={center}
                x2={spoke.x}
                y2={spoke.y}
                className="radar-grid-spoke"
              />
            ))}

            {/* Main Radar Polygon */}
            {points.length ? <polygon points={points.join(" ")} className="radar-polygon" /> : null}
          </svg>
        </div>
        <div className="radar-legend">
          {blockLabels.map((label, index) => {
            const val = values[index];
            const formatted = formatPercentValue(val);
            return (
              <div className="radar-legend-item" key={label}>
                <div className="radar-legend-label-group">
                  <span className="radar-legend-bullet" />
                  <span className="radar-legend-label" title={label}>{label}</span>
                </div>
                <strong className="radar-legend-value">{formatted}</strong>
              </div>
            );
          })}
        </div>
      </div>
    </ChartShell>
  );
}

export function VisualBlockRenderer({ block }: { block: VisualBlock }) {
  const state = block.data_state || "no_data";
  if (state === "no_plan") return <NoPlanBlock message={block.empty_message} />;
  if (state === "no_data") return <NoDataBlock message={block.empty_message} />;

  const payload = block.payload || {};
  switch (block.kind) {
    case "status_grid":
      return <StatusGrid title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
    case "metric_table":
      return <MetricTable title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
    case "line_chart":
      return <LineChartInline title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
    case "bar_line_chart":
      return <BarLineChartInline title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
    case "bar_chart":
    case "training_bar_chart":
      return <BarChartInline title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
    case "radar_chart":
      return <RadarChartInline title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
    case "progress_card":
      return <ProgressCard title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
    case "kpi_badges":
      if (block.id === "o5_initiatives") {
        return <InitiativesFiDashboard title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
      }
      return <KpiBadges title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
    case "narrative_card":
    default:
      return <NarrativeCard title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
  }
}
