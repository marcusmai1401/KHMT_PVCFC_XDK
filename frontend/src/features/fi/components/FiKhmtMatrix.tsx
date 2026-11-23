import { useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Grid2x2,
  Info,
  Lock,
  Table2,
} from "lucide-react";
import type {
  FiKhmtMatrixData,
  FiRegistrationMatrixData,
  KhmtMatrixCell,
  MatrixDrawerSelection,
  MatrixRangeMode,
  MatrixViewMode,
} from "../types/fiDashboard";
import {
  classifyKhmtCellTone,
  formatCount,
  hasQuotaWarning,
  khmtCellTooltip,
  resolveVisibleMonths,
} from "../utils/fiMetrics";

export function FiKhmtMatrix({
  khmtMatrix,
  registrationMatrix,
  selectedYear,
  currentYear,
  currentMonth,
  currentTeam,
  activeSelection,
  onSelect,
}: {
  khmtMatrix: FiKhmtMatrixData;
  registrationMatrix?: FiRegistrationMatrixData;
  selectedYear: number;
  currentYear: number;
  currentMonth: number;
  currentTeam?: string | null;
  activeSelection: MatrixDrawerSelection | null;
  onSelect: (selection: MatrixDrawerSelection) => void;
}) {
  const [mode, setMode] = useState<MatrixViewMode>("khmt");
  const [rangeMode, setRangeMode] = useState<MatrixRangeMode>("full");
  const [mobileLayout, setMobileLayout] = useState<"cards" | "table">("cards");

  const isCurrentYear = selectedYear === currentYear;
  const visibleMonths = useMemo(
    () => resolveVisibleMonths(selectedYear, currentYear, currentMonth, rangeMode),
    [selectedYear, currentYear, currentMonth, rangeMode],
  );

  const isCellActive = (team: string, month: number) =>
    activeSelection?.kind === "cell"
    && activeSelection.team === team
    && activeSelection.month === month
    && activeSelection.year === selectedYear
    && activeSelection.mode === mode;

  const isPoolActive = (team: string, poolKind: "unassigned_approved" | "pending") =>
    activeSelection?.kind === "pool"
    && activeSelection.team === team
    && activeSelection.poolKind === poolKind;

  const regRowsByTeam = useMemo(() => {
    const map = new Map<string, (typeof registrationMatrix extends undefined ? never : NonNullable<typeof registrationMatrix>["rows"][number])>();
    registrationMatrix?.rows.forEach((row) => map.set(row.team, row));
    return map;
  }, [registrationMatrix]);

  const regTotalsByMonth = useMemo(() => {
    const map = new Map<number, number>();
    registrationMatrix?.workshop_totals.months.forEach((m) => map.set(m.month, m.count));
    return map;
  }, [registrationMatrix]);

  const khmtTotalsByMonth = useMemo(() => {
    const map = new Map<number, number>();
    khmtMatrix.workshop_totals.months.forEach((m) => map.set(m.month, m.count));
    return map;
  }, [khmtMatrix]);

  const nonOkrSummary = khmtMatrix.non_okr_summary ?? [];

  const renderKhmtCellButton = (team: string, displayName: string, cell: KhmtMatrixCell) => {
    const tone = classifyKhmtCellTone(cell);
    const warning = hasQuotaWarning(cell);
    const active = isCellActive(team, cell.month);
    const title = khmtCellTooltip(displayName, selectedYear, cell);
    const showDash = cell.is_future_month && cell.count === 0;
    return (
      <button
        type="button"
        className={[
          "fi-matrix-cell-btn",
          `tone-${tone}`,
          cell.is_current_month ? "is-current-month" : "",
          warning ? "has-warning" : "",
          active ? "is-selected" : "",
        ].filter(Boolean).join(" ")}
        title={title}
        aria-label={title}
        aria-pressed={active}
        onClick={() => onSelect({ kind: "cell", team, year: selectedYear, month: cell.month, mode: "khmt" })}
      >
        <span className="fi-matrix-cell-num">{showDash ? "—" : cell.count}</span>
        {cell.is_locked && (
          <Lock size={10} className="fi-matrix-cell-lock" aria-hidden="true" />
        )}
        {warning && (
          <span className="fi-matrix-cell-warn" aria-hidden="true">!</span>
        )}
      </button>
    );
  };

  const renderRegCellButton = (
    team: string,
    displayName: string,
    month: number,
    count: number,
    approvedCount: number,
    inKhmtCount: number,
    isCurrentMonth: boolean,
    isFutureMonth: boolean,
  ) => {
    const active = isCellActive(team, month);
    const showDash = isFutureMonth && count === 0;
    const tone = showDash ? "future" : count >= 3 ? "reg-high" : count >= 1 ? "reg-some" : "reg-zero";
    const title = `${displayName} · Đăng ký T${month}/${selectedYear}: ${count} SK (${approvedCount} đồng ý, ${inKhmtCount} đã vào KHMT)`;
    return (
      <button
        type="button"
        className={[
          "fi-matrix-cell-btn",
          `tone-${tone}`,
          isCurrentMonth ? "is-current-month" : "",
          active ? "is-selected" : "",
        ].filter(Boolean).join(" ")}
        title={title}
        aria-label={title}
        aria-pressed={active}
        onClick={() => onSelect({ kind: "cell", team, year: selectedYear, month, mode: "registration" })}
      >
        <span className="fi-matrix-cell-num">{showDash ? "—" : count}</span>
      </button>
    );
  };

  return (
    <section className="fi-dashboard-card fi-matrix-card" aria-label={`Ma trận FI năm ${selectedYear}`}>
      <div className="fi-matrix-head">
        <div className="fi-matrix-title">
          <div className="fi-dashboard-section-title" style={{ marginBottom: 4 }}>
            <CalendarDays size={18} />
            <h3>
              {mode === "khmt"
                ? `Ma trận FI xét vào KHMT theo tháng — Năm ${selectedYear}`
                : `Ma trận đăng ký SK-CTKT mới theo tháng — Năm ${selectedYear}`}
            </h3>
          </div>
          <p className="muted fi-matrix-subtitle">
            {mode === "khmt"
              ? "Nhìn ngay số FI mỗi đội/tổ đang xét vào KHMT từ T1 đến T12. Bấm vào bất kỳ ô nào để xem danh sách SK và gán/bỏ trực tiếp."
              : "Theo dõi nhịp độ đăng ký sáng kiến mới của 4 đội/tổ theo từng tháng đăng ký. Bấm vào ô để xem chi tiết."}
          </p>
        </div>

        <div className="fi-matrix-controls">
          <div className="fi-matrix-pill-group" role="tablist" aria-label="Chế độ xem ma trận">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "khmt"}
              className={mode === "khmt" ? "active" : ""}
              onClick={() => setMode("khmt")}
            >
              Xét vào KHMT
            </button>
            {registrationMatrix && (
              <button
                type="button"
                role="tab"
                aria-selected={mode === "registration"}
                className={mode === "registration" ? "active" : ""}
                onClick={() => setMode("registration")}
              >
                Đăng ký mới
              </button>
            )}
          </div>

          {isCurrentYear && currentMonth < 12 && (
            <div className="fi-matrix-pill-group" role="group" aria-label="Phạm vi tháng hiển thị">
              <button
                type="button"
                className={rangeMode === "ytd" ? "active" : ""}
                aria-pressed={rangeMode === "ytd"}
                onClick={() => setRangeMode("ytd")}
              >
                Đến T{currentMonth}
              </button>
              <button
                type="button"
                className={rangeMode === "full" ? "active" : ""}
                aria-pressed={rangeMode === "full"}
                onClick={() => setRangeMode("full")}
              >
                Cả năm T1–T12
              </button>
            </div>
          )}

          <div className="fi-matrix-pill-group fi-matrix-mobile-toggle" role="group" aria-label="Kiểu hiển thị trên mobile">
            <button
              type="button"
              className={mobileLayout === "cards" ? "active" : ""}
              aria-pressed={mobileLayout === "cards"}
              onClick={() => setMobileLayout("cards")}
              title="Dạng thẻ lưới 4×3"
            >
              <Grid2x2 size={14} />
              Thẻ
            </button>
            <button
              type="button"
              className={mobileLayout === "table" ? "active" : ""}
              aria-pressed={mobileLayout === "table"}
              onClick={() => setMobileLayout("table")}
              title="Dạng bảng cuộn ngang"
            >
              <Table2 size={14} />
              Bảng
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Table (also shown on mobile when mobileLayout === "table") */}
      <div className={`fi-matrix-table-wrap ${mobileLayout === "table" ? "is-mobile-visible" : ""}`}>
        <table className="fi-matrix-table">
          <thead>
            <tr>
              <th className="fi-matrix-sticky-col" scope="col">Đội/tổ</th>
              {visibleMonths.map((month) => {
                const isCurr = isCurrentYear && month === currentMonth;
                const isFuture = isCurrentYear && month > currentMonth;
                return (
                  <th
                    key={month}
                    scope="col"
                    className={[
                      "fi-matrix-month-th",
                      isCurr ? "is-current-month" : "",
                      isFuture ? "is-future-month" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    <span>T{month}</span>
                    {isCurr && <small>Hiện tại</small>}
                  </th>
                );
              })}
              <th scope="col" className="fi-matrix-summary-th">Tổng năm</th>
              <th
                scope="col"
                className="fi-matrix-summary-th"
                title="Số SK đã duyệt của đội hiện chưa đưa vào KHMT bất kỳ tháng nào"
              >
                Kho sẵn sàng
              </th>
              <th
                scope="col"
                className="fi-matrix-summary-th"
                title="Số SK đang chờ xét duyệt hoặc cần bổ sung của đội"
              >
                Chờ duyệt
              </th>
            </tr>
          </thead>
          <tbody>
            {khmtMatrix.rows.map((row) => {
              const isOwnTeam = Boolean(currentTeam && currentTeam === row.team);
              const regRow = regRowsByTeam.get(row.team);
              const visibleTotal = mode === "khmt"
                ? visibleMonths.reduce((sum, m) => sum + (row.months[m - 1]?.count ?? 0), 0)
                : visibleMonths.reduce((sum, m) => sum + (regRow?.months[m - 1]?.count ?? 0), 0);

              return (
                <tr key={row.team} className={isOwnTeam ? "is-own-team" : ""}>
                  <th scope="row" className="fi-matrix-sticky-col fi-matrix-team-cell">
                    <strong>{row.display_name}</strong>
                    {isOwnTeam && <span className="fi-matrix-own-badge">Đội của bạn</span>}
                  </th>
                  {visibleMonths.map((month) => {
                    if (mode === "khmt") {
                      const cell = row.months[month - 1];
                      return (
                        <td key={month} className={cell?.is_current_month ? "is-current-month" : ""}>
                          {cell ? renderKhmtCellButton(row.team, row.display_name, cell) : "—"}
                        </td>
                      );
                    }
                    const rCell = regRow?.months[month - 1];
                    return (
                      <td key={month} className={rCell?.is_current_month ? "is-current-month" : ""}>
                        {rCell
                          ? renderRegCellButton(
                              row.team,
                              row.display_name,
                              month,
                              rCell.count,
                              rCell.approved_count,
                              rCell.in_khmt_count,
                              rCell.is_current_month,
                              rCell.is_future_month,
                            )
                          : "—"}
                      </td>
                    );
                  })}
                  <td className="fi-matrix-total-cell">
                    <strong>{formatCount(visibleTotal)}</strong>
                  </td>
                  <td className="fi-matrix-pool-cell">
                    <button
                      type="button"
                      className={`fi-matrix-stat-btn tone-pool ${row.approved_unassigned_count > 0 ? "has-items" : ""} ${isPoolActive(row.team, "unassigned_approved") ? "is-selected" : ""}`}
                      onClick={() => onSelect({ kind: "pool", team: row.team, poolKind: "unassigned_approved" })}
                      title={`Xem ${row.approved_unassigned_count} SK đã duyệt chưa gán KHMT của ${row.display_name}`}
                    >
                      {formatCount(row.approved_unassigned_count)}
                    </button>
                  </td>
                  <td className="fi-matrix-pool-cell">
                    <button
                      type="button"
                      className={`fi-matrix-stat-btn tone-pending ${row.pending_count > 0 ? "has-items" : ""} ${isPoolActive(row.team, "pending") ? "is-selected" : ""}`}
                      onClick={() => onSelect({ kind: "pool", team: row.team, poolKind: "pending" })}
                      title={`Xem ${row.pending_count} SK đang chờ duyệt của ${row.display_name}`}
                    >
                      {formatCount(row.pending_count)}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="fi-matrix-footer-row">
              <th scope="row" className="fi-matrix-sticky-col">Tổng 4 đội/tổ</th>
              {visibleMonths.map((month) => {
                const count = mode === "khmt"
                  ? (khmtTotalsByMonth.get(month) ?? 0)
                  : (regTotalsByMonth.get(month) ?? 0);
                const isCurr = isCurrentYear && month === currentMonth;
                return (
                  <td key={month} className={isCurr ? "is-current-month" : ""}>
                    <strong>{formatCount(count)}</strong>
                  </td>
                );
              })}
              <td className="fi-matrix-total-cell">
                <strong>
                  {formatCount(
                    visibleMonths.reduce(
                      (sum, m) => sum + (mode === "khmt" ? (khmtTotalsByMonth.get(m) ?? 0) : (regTotalsByMonth.get(m) ?? 0)),
                      0,
                    ),
                  )}
                </strong>
              </td>
              <td className="fi-matrix-total-cell">
                <strong>{formatCount(khmtMatrix.workshop_totals.approved_unassigned_count)}</strong>
              </td>
              <td className="fi-matrix-total-cell">
                <strong>{formatCount(khmtMatrix.workshop_totals.pending_count)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile Team-Card 4×3 Grid (default on ≤ 760px) */}
      <div className={`fi-matrix-mobile-cards ${mobileLayout === "cards" ? "is-mobile-visible" : ""}`}>
        {khmtMatrix.rows.map((row) => {
          const isOwnTeam = Boolean(currentTeam && currentTeam === row.team);
          const regRow = regRowsByTeam.get(row.team);
          const visibleTotal = mode === "khmt"
            ? visibleMonths.reduce((sum, m) => sum + (row.months[m - 1]?.count ?? 0), 0)
            : visibleMonths.reduce((sum, m) => sum + (regRow?.months[m - 1]?.count ?? 0), 0);
          return (
            <article key={row.team} className={`fi-matrix-mobile-card ${isOwnTeam ? "is-own-team" : ""}`}>
              <header className="fi-matrix-mobile-card-head">
                <div>
                  <strong>{row.display_name}</strong>
                  {isOwnTeam && <span className="fi-matrix-own-badge">Đội của bạn</span>}
                </div>
                <span className="fi-matrix-mobile-card-total">
                  Tổng: <strong>{formatCount(visibleTotal)}</strong>
                </span>
              </header>
              <div className="fi-matrix-mobile-card-stats">
                <button
                  type="button"
                  className="fi-matrix-mobile-stat-chip tone-pool"
                  onClick={() => onSelect({ kind: "pool", team: row.team, poolKind: "unassigned_approved" })}
                >
                  Kho sẵn sàng: <strong>{formatCount(row.approved_unassigned_count)}</strong>
                </button>
                <button
                  type="button"
                  className="fi-matrix-mobile-stat-chip tone-pending"
                  onClick={() => onSelect({ kind: "pool", team: row.team, poolKind: "pending" })}
                >
                  Chờ duyệt: <strong>{formatCount(row.pending_count)}</strong>
                </button>
              </div>
              <div className="fi-matrix-mobile-grid">
                {visibleMonths.map((month) => {
                  if (mode === "khmt") {
                    const cell = row.months[month - 1];
                    if (!cell) return null;
                    const tone = classifyKhmtCellTone(cell);
                    const warning = hasQuotaWarning(cell);
                    const active = isCellActive(row.team, month);
                    const showDash = cell.is_future_month && cell.count === 0;
                    return (
                      <button
                        key={month}
                        type="button"
                        className={[
                          "fi-matrix-mobile-cell",
                          `tone-${tone}`,
                          cell.is_current_month ? "is-current-month" : "",
                          active ? "is-selected" : "",
                        ].filter(Boolean).join(" ")}
                        onClick={() => onSelect({ kind: "cell", team: row.team, year: selectedYear, month, mode: "khmt" })}
                        aria-label={khmtCellTooltip(row.display_name, selectedYear, cell)}
                      >
                        <span className="fi-matrix-mobile-month">T{month}</span>
                        <strong>{showDash ? "—" : cell.count}</strong>
                        {cell.is_locked && <Lock size={10} className="fi-matrix-cell-lock" aria-hidden="true" />}
                        {warning && <span className="fi-matrix-cell-warn" aria-hidden="true">!</span>}
                      </button>
                    );
                  }
                  const rCell = regRow?.months[month - 1];
                  if (!rCell) return null;
                  const showDash = rCell.is_future_month && rCell.count === 0;
                  const tone = showDash ? "future" : rCell.count >= 3 ? "reg-high" : rCell.count >= 1 ? "reg-some" : "reg-zero";
                  const active = isCellActive(row.team, month);
                  return (
                    <button
                      key={month}
                      type="button"
                      className={[
                        "fi-matrix-mobile-cell",
                        `tone-${tone}`,
                        rCell.is_current_month ? "is-current-month" : "",
                        active ? "is-selected" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => onSelect({ kind: "cell", team: row.team, year: selectedYear, month, mode: "registration" })}
                    >
                      <span className="fi-matrix-mobile-month">T{month}</span>
                      <strong>{showDash ? "—" : rCell.count}</strong>
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>

      {/* Legend & Non-OKR Note */}
      <footer className="fi-matrix-footer-meta">
        {mode === "khmt" ? (
          <div className="fi-matrix-legend" aria-label="Chú giải mức KHMT">
            <span><i className="fi-legend-swatch tone-good" /> ≥ 3: HT tốt / XS</span>
            <span><i className="fi-legend-swatch tone-ok" /> 1–2: Hoàn thành</span>
            <span><i className="fi-legend-swatch tone-none" /> 0: Chưa có FI</span>
            <span><i className="fi-legend-swatch tone-future" /> — Tháng tới</span>
            <span><Lock size={12} /> Đã chốt kỳ</span>
            <span><AlertCircle size={12} className="fi-legend-warn-icon" /> ! Lệch / vượt định mức</span>
          </div>
        ) : (
          <div className="fi-matrix-legend" aria-label="Chú giải đăng ký mới">
            <span><i className="fi-legend-swatch tone-reg-high" /> ≥ 3 SK đăng ký</span>
            <span><i className="fi-legend-swatch tone-reg-some" /> 1–2 SK đăng ký</span>
            <span><i className="fi-legend-swatch tone-reg-zero" /> 0 SK đăng ký</span>
          </div>
        )}

        {nonOkrSummary.length > 0 && (
          <div className="fi-matrix-non-okr-note" role="note">
            <Info size={14} />
            <span>
              Khối ngoài ma trận OKR/KHMT:{" "}
              {nonOkrSummary.map((entry, idx) => (
                <span key={entry.team}>
                  {idx > 0 ? " · " : ""}
                  <strong>{entry.display_name}</strong> ({formatCount(entry.total_sk)} SK
                  {entry.pending_count > 0 ? `, ${formatCount(entry.pending_count)} chờ duyệt` : ""})
                </span>
              ))}
            </span>
          </div>
        )}
      </footer>
    </section>
  );
}
