import type { ChartBlockData } from "../types/dashboard";

function numericValues(block: ChartBlockData) {
  return block.datasets.flatMap((dataset) => dataset.data).filter((value): value is number => typeof value === "number");
}

function maxValue(block: ChartBlockData) {
  return Math.max(1, ...numericValues(block));
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function BarBlock({ block }: { block: ChartBlockData }) {
  const max = maxValue(block);
  return (
    <div className="okr-chart-bars">
      {block.labels.map((label, labelIndex) => (
        <div className="okr-chart-row" key={label}>
          <span>{label}</span>
          <div>
            {block.datasets.map((dataset) => {
              const value = dataset.data[labelIndex];
              const width = typeof value === "number" ? `${Math.max(2, (value / max) * 100)}%` : "0";
              return (
                <div className="okr-bar-line" key={dataset.label}>
                  <span className="okr-bar-label">{dataset.label}</span>
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
  );
}

function LineBlock({ block }: { block: ChartBlockData }) {
  const values = block.datasets[0]?.data ?? [];
  const max = maxValue(block);
  const width = 420;
  const height = 150;
  const points = values.map((value, index) => {
    if (typeof value !== "number") return null;
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - (value / max) * (height - 20) - 10;
    return `${x},${y}`;
  });
  const segments: string[][] = [];
  let current: string[] = [];
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
    <div className="okr-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={block.title}>
        {segments.map((segment, index) => (
          <polyline key={index} points={segment.join(" ")} fill="none" stroke="currentColor" strokeWidth="3" />
        ))}
        {points.map((point, index) => point ? <circle key={index} cx={Number(point.split(",")[0])} cy={Number(point.split(",")[1])} r="4" /> : null)}
      </svg>
      <div className="okr-line-labels">
        {block.labels.map((label) => <span key={label}>{label}</span>)}
      </div>
    </div>
  );
}

function CardsBlock({ block }: { block: ChartBlockData }) {
  const items = block.items ?? [];
  return (
    <div className="okr-card-grid">
      {items.map((item) => {
        const rate = typeof item.participation_rate === "number" ? item.participation_rate : null;
        return (
          <div className="metric-card compact-card" key={String(item.team)}>
            <strong>{item.team}</strong>
            <span>{formatValue(item.actual)} / {formatValue(item.total)}</span>
            <div className="progress-track">
              <span style={{ width: rate === null ? "0" : `${Math.min(rate * 100, 100)}%` }} />
            </div>
            <small>Mục tiêu tham gia {formatValue(block.participation_target)}</small>
          </div>
        );
      })}
    </div>
  );
}

function ProgressGrid({ block }: { block: ChartBlockData }) {
  const items = block.items?.length ? block.items : block.labels.map((label, index) => ({ label, value: block.datasets[0]?.data[index] }));
  return (
    <div className="okr-progress-grid">
      {items.map((item, index) => (
        <div className="progress-item" key={`${item.label}-${index}`}>
          <span>{item.label}</span>
          <strong>{formatValue(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function ChartBlock({ block }: { block: ChartBlockData }) {
  return (
    <article className="chart-block">
      <div className="chart-block-header">
        <div>
          <h3>{block.title}</h3>
          <small>{block.kr_code} · {block.source_reference}</small>
        </div>
        {block.master_target !== null && block.master_target !== undefined ? <strong>Target {formatValue(block.master_target)}</strong> : null}
      </div>
      {block.chart_type === "line" && <LineBlock block={block} />}
      {block.chart_type === "bar" && <BarBlock block={block} />}
      {block.chart_type === "cards" && <CardsBlock block={block} />}
      {block.chart_type === "progress_grid" && <ProgressGrid block={block} />}
      {block.warnings?.length ? <small className="warning-inline">{block.warnings.length} cảnh báo dữ liệu</small> : null}
    </article>
  );
}

export function ChartBlocks({ blocks }: { blocks: Record<string, ChartBlockData | undefined> }) {
  const ordered = [
    "stop_by_team",
    "stop_by_month",
    "training",
    "competency",
    "vhdn_running",
    "vhdn_sports",
    "sk_initiatives",
    "ctkt_fi",
  ].map((key) => blocks[key]).filter((block): block is ChartBlockData => Boolean(block));

  return (
    <section className="panel wide">
      <div className="panel-header">
        <div>
          <h2>Dashboard metrics</h2>
          <p className="muted">Các block chính từ sheet data và FI.</p>
        </div>
      </div>
      <div className="chart-grid">
        {ordered.map((block) => <ChartBlock block={block} key={block.block_type} />)}
      </div>
    </section>
  );
}
