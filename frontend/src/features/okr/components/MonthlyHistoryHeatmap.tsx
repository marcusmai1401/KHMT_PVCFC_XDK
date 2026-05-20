import type { LeaderKPIAllocation, MonthlyHistoryEntry } from "../types/dashboard";

const months = Array.from({ length: 12 }, (_, index) => index + 1);

function classForAssessment(value: string | null) {
  if (!value) return "history-empty";
  const normalized = value.toLocaleLowerCase("vi-VN");
  if (normalized.includes("n/a") || normalized.includes("#n/a")) return "history-empty";
  if (normalized.includes("không") || normalized.includes("khong")) return "history-ng";
  if (normalized.includes("tốt") || normalized.includes("tot") || normalized.includes("xuất sắc")) return "history-good";
  if (normalized === "ht" || normalized.includes("hoàn thành") || normalized.includes("hoan thanh")) return "history-ok";
  return "history-empty";
}

export function MonthlyHistoryHeatmap({
  history,
  allocations = [],
  summary = {},
}: {
  history: MonthlyHistoryEntry[];
  allocations?: LeaderKPIAllocation[];
  summary?: Record<string, number>;
}) {
  const assignedAllocations = allocations.filter((allocation) => allocation.a1 || allocation.a2);
  return (
    <section className="panel wide monthly-overview-panel">
      <div className="panel-header">
        <div>
          <h2>Lũy kế theo tháng</h2>
          <p className="muted">Nguồn DB được ưu tiên trước snapshot Excel.</p>
        </div>
      </div>
      <div className="monthly-overview-grid">
        <div className="matrix monthly-history">
          <table>
            <thead>
              <tr>
                <th>Đội/Tổ</th>
                {months.map((month) => <th key={month}>T{month}</th>)}
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.team}>
                  <td title={row.team_name}>{row.team}</td>
                  {months.map((month) => {
                    const item = row.months.find((candidate) => candidate.month === month);
                    return (
                      <td key={month}>
                        <span className={`history-cell ${classForAssessment(item?.assessment ?? null)}`} title={item?.source ?? ""}>
                          {item?.assessment ?? "-"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="allocation-note" aria-label="Phân bổ Đội/Tổ trưởng">
          <div className="allocation-note-header">
            <h3>Phân bổ Đội/Tổ trưởng</h3>
            <div>
              <span>A2</span>
              <strong>{summary.A2 ?? 0}</strong>
              <span>A1</span>
              <strong>{summary.A1 ?? 0}</strong>
            </div>
          </div>
          {assignedAllocations.length ? (
            <div className="allocation-note-list">
              {assignedAllocations.map((allocation) => (
                <div key={allocation.team}>
                  <strong>{allocation.team}</strong>
                  <span>{allocation.a2 ? `A2 x${allocation.a2}` : ""}</span>
                  <span>{allocation.a1 ? `A1 x${allocation.a1}` : ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <p>Chưa phát sinh phân bổ trong kỳ này.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
