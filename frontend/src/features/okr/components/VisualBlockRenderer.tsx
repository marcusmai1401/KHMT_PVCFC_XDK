import { Activity, BarChart3, ClipboardList, LineChart, Radar, TrendingUp } from "lucide-react";
import type React from "react";
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

function BarLineChartInline({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const series = datasets(payload);
  const blockLabels = labels(payload);
  const barSeries = series.filter((dataset) => dataset.chart_type !== "line");
  const lineSeries = series.filter((dataset) => dataset.chart_type === "line");
  const leftScale = axisScale(maxValue(barSeries));
  const rightScale = axisScale(Math.max(1, ...numericValues(lineSeries)), 4, lineSeries.some((dataset) => dataset.value_format === "percent"));
  const axis = axisLabels(payload);
  const width = 520;
  const height = 230;
  const chartLeft = 52;
  const chartRight = width - 52;
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
            return <rect key={`${dataset.label}-${index}`} x={x} y={y} width={barWidth} height={barHeight} rx="4" fill={dataset.color || "#f97316"} />;
          }))}
          {linePoints.map((points, datasetIndex) => {
            const path = points.filter(Boolean).map((point) => `${point!.x},${point!.y}`).join(" ");
            const dataset = lineSeries[datasetIndex];
            return path ? <polyline key={dataset.label} points={path} fill="none" stroke={dataset.color || "currentColor"} strokeWidth="3" /> : null;
          })}
          {linePoints.flatMap((points, datasetIndex) => points.map((point, index) => {
            const dataset = lineSeries[datasetIndex];
            return point ? <circle key={`${dataset.label}-${index}`} cx={point.x} cy={point.y} r="4" fill={dataset.color || "currentColor"} /> : null;
          }))}
          {blockLabels.map((label, index) => (
            <text key={label} x={chartLeft + index * step + step / 2} y={height - 29} textAnchor="middle">{label}</text>
          ))}
          <text className="chart-axis-title" x={(chartLeft + chartRight) / 2} y={height - 8} textAnchor="middle">{axis.x}</text>
          <text className="chart-axis-title" x={14} y={(chartTop + chartBottom) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(chartTop + chartBottom) / 2})`}>
            {axis.leftY}
          </text>
          {lineSeries.length ? (
            <text className="chart-axis-title" x={width - 14} y={(chartTop + chartBottom) / 2} textAnchor="middle" transform={`rotate(90 ${width - 14} ${(chartTop + chartBottom) / 2})`}>
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
                        <>
                          <strong>{formatValue(row[column.key])}</strong>
                          {row.team ? <small>{row.team}</small> : null}
                        </>
                      ) : (
                        formatDatasetValue(row[column.key], column.format)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
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
  return (
    <ChartShell title={title} icon={<TrendingUp size={17} />} kind={kind} visualId={visualId}>
      <div className="okr-card-grid">
        {items.map((item: any) => {
          const rate = typeof item.participation_rate === "number" ? Math.min(item.participation_rate, 1) : 0;
          return (
            <div className="metric-card compact-card" key={String(item.team || item.label)}>
              <strong>{item.team_name || item.team || item.label}</strong>
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

function RadarChartInline({ title, payload, visualId, kind }: { title: string; payload?: Record<string, any>; visualId?: string; kind?: string }) {
  const blockLabels = labels(payload);
  const values = datasets(payload)[0]?.data ?? [];
  const numeric = values.map((value) => (typeof value === "number" ? value : 0));
  const max = Math.max(1, ...numeric);
  const size = 220;
  const center = size / 2;
  const radius = 86;
  const points = numeric.map((value, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(numeric.length, 1) - Math.PI / 2;
    const scaled = (value / max) * radius;
    return `${center + Math.cos(angle) * scaled},${center + Math.sin(angle) * scaled}`;
  });
  return (
    <ChartShell title={title} icon={<Radar size={17} />} kind={kind} visualId={visualId}>
      <div className="radar-layout">
        <svg className="okr-chart radar-chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title}>
          <circle cx={center} cy={center} r={radius} />
          <circle cx={center} cy={center} r={radius * 0.66} />
          <circle cx={center} cy={center} r={radius * 0.33} />
          {points.length ? <polygon points={points.join(" ")} /> : null}
        </svg>
        <div className="radar-legend">
          {blockLabels.map((label, index) => (
            <span key={label}>{label}: <strong>{formatValue(values[index])}</strong></span>
          ))}
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
      return <KpiBadges title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
    case "narrative_card":
    default:
      return <NarrativeCard title={block.title} payload={payload} visualId={block.id} kind={block.kind} />;
  }
}
