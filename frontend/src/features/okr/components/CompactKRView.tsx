import { useMemo, useState } from "react";
import type { KRSummary, TeamStatus } from "../types/dashboard";

const objectives = ["all", "O1", "O2", "O3", "O4", "O5", "O6"];

function StatusBadge({ value }: { value: TeamStatus }) {
  const normalized = String(value || "#N/A").replace("#N/A", "na").replace("/", "-").toLowerCase();
  return <span className={`status status-${normalized}`}>{value || "#N/A"}</span>;
}

export function filterKRSummaries(rows: KRSummary[], objective: string, query: string) {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    const objectiveMatches = objective === "all" || row.workshop_kr_code.startsWith(`${objective}.`);
    const queryMatches = !needle || `${row.workshop_kr_code} ${row.kr_name}`.toLowerCase().includes(needle);
    return objectiveMatches && queryMatches;
  });
}

function numericLabel(row: KRSummary) {
  if (!row.numeric_metric) return null;
  const actual = row.numeric_metric.actual ?? "-";
  const target = row.numeric_metric.target ?? row.target_value ?? "-";
  return `${actual} / ${target}`;
}

export function CompactKRView({
  rows,
  activeKr,
  onSelect,
}: {
  rows: KRSummary[];
  activeKr?: string | null;
  onSelect: (row: KRSummary) => void;
}) {
  const [objective, setObjective] = useState("all");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterKRSummaries(rows, objective, query), [rows, objective, query]);

  return (
    <section className="panel wide">
      <div className="panel-header">
        <div>
          <h2>Tất cả KR</h2>
          <p className="muted">{filtered.length}/{rows.length} KR</p>
        </div>
        <div className="toolbar compact-toolbar">
          <label>
            <span className="sr-only">Lọc objective</span>
            <select value={objective} onChange={(event) => setObjective(event.target.value)}>
              {objectives.map((item) => <option key={item} value={item}>{item === "all" ? "Tất cả" : item}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Tìm KR</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã hoặc tên KR" />
          </label>
        </div>
      </div>
      <div className="compact-kr-list">
        {filtered.map((row) => (
          <button
            className={`compact-kr-row ${activeKr === row.workshop_kr_code ? "active-row" : ""}`}
            key={row.workshop_kr_code}
            onClick={() => onSelect(row)}
            type="button"
          >
            <span className="kr-code">{row.workshop_kr_code}</span>
            <span className="kr-name">{row.kr_name}</span>
            <span className="kr-target">{numericLabel(row) ?? row.target_value ?? "-"}</span>
            <span className="kr-statuses">
              {Object.entries(row.team_statuses).map(([team, status]) => (
                <span className="team-status" key={team}>
                  <small>{team}</small>
                  <StatusBadge value={status} />
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
