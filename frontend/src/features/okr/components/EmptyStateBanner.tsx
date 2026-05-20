import { AlertTriangle } from "lucide-react";

export function EmptyStateBanner({
  currentLabel,
  latestDataLabel,
  onJumpToLatest,
}: {
  currentLabel: string;
  latestDataLabel?: string;
  onJumpToLatest?: () => void;
}) {
  return (
    <section className="empty-dashboard-banner" aria-label="Dashboard không có dữ liệu">
      <AlertTriangle size={22} />
      <div>
        <strong>
          {latestDataLabel
            ? `Chưa có dữ liệu dashboard cho ${currentLabel}. Kỳ gần nhất có dữ liệu là ${latestDataLabel}.`
            : `Chưa có dữ liệu dashboard cho ${currentLabel}.`}
        </strong>
      </div>
      {latestDataLabel && onJumpToLatest ? (
        <button aria-label={`Chuyển sang ${latestDataLabel}`} onClick={onJumpToLatest} type="button">
          Chuyển sang {latestDataLabel}
        </button>
      ) : null}
    </section>
  );
}
