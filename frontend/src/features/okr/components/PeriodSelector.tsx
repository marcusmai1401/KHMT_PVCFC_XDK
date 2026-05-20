import { CalendarDays } from "lucide-react";
import { writeLastSelectedPeriod } from "../lastSelectedPeriod";

const months = Array.from({ length: 12 }, (_, index) => index + 1);

export function PeriodSelector({
  value,
  onChange,
  latestDataPeriod,
}: {
  value: { month: number; year: number };
  onChange: (next: { month: number; year: number }) => void;
  latestDataPeriod?: { month: number; year: number } | null;
}) {
  const update = (next: { month: number; year: number }) => {
    writeLastSelectedPeriod(next);
    onChange(next);
  };
  return (
    <div className="period-selector">
      <span className="period-label"><CalendarDays size={16} /> T{value.month}/{value.year}</span>
      <select
        aria-label="Tháng dashboard"
        value={value.month}
        onChange={(event) => update({ ...value, month: Number(event.target.value) })}
      >
        {months.map((month) => <option key={month} value={month}>T{month}</option>)}
      </select>
      <input
        aria-label="Năm dashboard"
        max={2100}
        min={2020}
        type="number"
        value={value.year}
        onChange={(event) => update({ ...value, year: Number(event.target.value) })}
      />
      {latestDataPeriod ? <small>Kỳ có dữ liệu: T{latestDataPeriod.month}/{latestDataPeriod.year}</small> : null}
    </div>
  );
}
