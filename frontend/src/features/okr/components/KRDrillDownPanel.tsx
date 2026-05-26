import { useEffect, useRef } from "react";
import type { KRSummary } from "../types/dashboard";

function StatusBadge({ value }: { value: string }) {
  const normalized = String(value || "#N/A").replace("#N/A", "na").replace("/", "-").toLowerCase();
  return <span className={`status status-${normalized}`}>{value || "#N/A"}</span>;
}

function metricForTeam(row: KRSummary, team: string) {
  return row.numeric_metric?.teams?.[team] ?? null;
}

function formatMetric(metric: any) {
  if (!metric) return "-";
  const actual = metric.actual ?? "-";
  const total = metric.total ?? metric.target ?? "-";
  if (actual === "-" && total === "-") return "-";
  return `${actual} / ${total}`;
}

export function KRDrillDownPanel({
  row,
  onClose,
}: {
  row: KRSummary | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (row) closeRef.current?.focus();
  }, [row]);

  if (!row) return null;

  return (
    <aside className="kr-drilldown" data-export-exclude="true" aria-label="Chi tiết KR">
      <div className="panel-header">
        <div>
          <h2>{row.workshop_kr_code}</h2>
          <p className="muted">{row.kr_name}</p>
        </div>
        <button ref={closeRef} onClick={onClose} type="button">Đóng</button>
      </div>
      <dl>
        <dt>Mục tiêu</dt>
        <dd>{row.target_value ?? "-"}</dd>
        <dt>Cột dashboard</dt>
        <dd>{row.dashboard_column}</dd>
      </dl>
      <div className="drilldown-teams">
        {Object.entries(row.team_statuses).map(([team, status]) => (
          <div className="drilldown-team" key={team}>
            <strong>{team}</strong>
            <StatusBadge value={status} />
            {row.numeric_metric ? <span>{formatMetric(metricForTeam(row, team))}</span> : <span>Chỉ có trạng thái</span>}
          </div>
        ))}
      </div>
    </aside>
  );
}
