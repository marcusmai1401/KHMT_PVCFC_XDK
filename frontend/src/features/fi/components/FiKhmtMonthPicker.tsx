import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Lock, X } from "lucide-react";
import type { FiKhmtMatrixData } from "../types/fiDashboard";
import { classifyKhmtCellTone } from "../utils/fiMetrics";

const MONTHS = Array.from({ length: 12 }, (_, idx) => idx + 1);

export function FiKhmtMonthPicker({
  item,
  khmtMatrix,
  busy = false,
  triggerLabel,
  onAssign,
  onClear,
}: {
  item: any;
  khmtMatrix?: FiKhmtMatrixData | null;
  busy?: boolean;
  // Fixed trigger text (e.g. "Chuyển tháng"); defaults to the current KHMT period.
  triggerLabel?: string;
  onAssign: (item: any, month: number, year: number) => Promise<void> | void;
  onClear: (item: any) => Promise<void> | void;
}) {
  const considered = Boolean(item?.consider_for_khmt && item?.khmt_month && item?.khmt_year);
  const currentMonth = considered ? Number(item.khmt_month) : null;
  const currentYear = considered ? Number(item.khmt_year) : null;
  const defaultYear = currentYear || khmtMatrix?.year || new Date().getFullYear();

  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(defaultYear);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setPickerYear(defaultYear);
  }, [open, defaultYear]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const teamRow = useMemo(() => {
    if (!khmtMatrix || khmtMatrix.year !== pickerYear) return null;
    return khmtMatrix.rows.find((row) => row.team === item?.team) ?? null;
  }, [khmtMatrix, pickerYear, item?.team]);

  const selectMonth = async (month: number) => {
    if (busy) return;
    if (considered && currentMonth === month && currentYear === pickerYear) {
      setOpen(false);
      return;
    }
    setOpen(false);
    await onAssign(item, month, pickerYear);
  };

  const clearSelection = async () => {
    if (busy) return;
    setOpen(false);
    await onClear(item);
  };

  return (
    <div ref={containerRef} className={`fi-khmt-picker ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className={`fi-khmt-picker-trigger ${considered ? "is-assigned" : "is-empty"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
        title={considered ? `Đang xét vào KHMT T${currentMonth}/${currentYear} — bấm để đổi tháng/năm` : "Chọn tháng/năm xét vào KHMT"}
      >
        <CalendarDays size={13} aria-hidden="true" />
        <span>{triggerLabel ?? (considered ? `KHMT T${currentMonth}/${currentYear}` : "Chưa vào KHMT")}</span>
        <ChevronDown size={13} className={open ? "is-rotated" : ""} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="fi-khmt-picker-popover"
          role="dialog"
          aria-label={`Chọn kỳ KHMT cho ${item?.sk_code || item?.title}`}
        >
          <div className="fi-khmt-picker-head">
            <span>Chọn kỳ KHMT · <strong>{item?.team}</strong></span>
            <div className="fi-khmt-picker-year">
              <button
                type="button"
                aria-label="Năm trước"
                onClick={() => setPickerYear((y) => Math.max(2020, y - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <strong>{pickerYear}</strong>
              <button
                type="button"
                aria-label="Năm sau"
                onClick={() => setPickerYear((y) => Math.min(2100, y + 1))}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="fi-khmt-picker-grid">
            {MONTHS.map((month) => {
              const cell = teamRow?.months[month - 1];
              const isSelected = considered && currentMonth === month && currentYear === pickerYear;
              const isLocked = Boolean(cell?.is_locked);
              const count = cell?.count;
              const tone = cell ? classifyKhmtCellTone(cell) : "neutral";
              return (
                <button
                  key={month}
                  type="button"
                  disabled={busy || isLocked}
                  className={[
                    "fi-khmt-picker-month",
                    `tone-${tone}`,
                    isSelected ? "is-selected" : "",
                    isLocked ? "is-locked" : "",
                  ].filter(Boolean).join(" ")}
                  title={
                    isLocked
                      ? `T${month}/${pickerYear} đã chốt kỳ — không thể gán`
                      : count !== undefined
                        ? `T${month}/${pickerYear}: hiện có ${count} FI`
                        : `Gán vào KHMT T${month}/${pickerYear}`
                  }
                  onClick={() => void selectMonth(month)}
                >
                  <span className="fi-khmt-picker-month-label">T{month}</span>
                  <small className="fi-khmt-picker-month-count">
                    {isLocked ? <Lock size={10} /> : count !== undefined ? `${count} FI` : "—"}
                  </small>
                </button>
              );
            })}
          </div>

          {teamRow && (
            <p className="fi-khmt-picker-hint">
              Màu ô thể hiện số FI đội {item?.team} hiện có trong năm {pickerYear} (≥3 HT tốt · 1–2 HT · 0 chưa có).
            </p>
          )}

          {considered && (
            <div className="fi-khmt-picker-foot">
              <button
                type="button"
                className="fi-khmt-picker-clear"
                disabled={busy}
                onClick={() => void clearSelection()}
              >
                <X size={13} />
                Bỏ khỏi KHMT T{currentMonth}/{currentYear}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
