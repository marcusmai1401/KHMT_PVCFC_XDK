import { CheckCircle2, Clock3, Loader2, PauseCircle } from "lucide-react";
import { resolveExecutionView } from "../utils/fiExecution";

function formatShortTime(value: string | null | undefined): string {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function FiCompletionPill({
  item,
  compact = false,
  interactive = false,
  onClick,
}: {
  item: any;
  compact?: boolean;
  interactive?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const view = resolveExecutionView(item);
  const iconSize = compact ? 12 : 14;
  const icon =
    view.tone === "done" ? (
      <CheckCircle2 size={iconSize} />
    ) : view.tone === "paused" ? (
      <PauseCircle size={iconSize} />
    ) : (
      <Clock3 size={iconSize} />
    );

  const toneClass = `tone-${view.tone}${view.auto ? " is-auto" : ""}`;
  const pillTitle = view.auto
    ? "Hệ thống tự ghi nhận khi tới ngày dự kiến — cần xác nhận lại"
    : interactive
      ? "Bấm để cập nhật tình hình thực hiện"
      : undefined;

  const content = (
    <>
      {icon}
      <span>{view.auto && compact ? "Tự ghi nhận" : view.label}</span>
      {view.dateText && <strong>{view.dateText}</strong>}
      {view.auto && !compact && <em className="fi-pill-auto-tag">Tự ghi nhận</em>}
    </>
  );

  if (interactive && onClick) {
    return (
      <button
        type="button"
        className={`fi-completion-pill ${toneClass} ${compact ? "is-compact" : ""} is-interactive`}
        title={pillTitle}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={`fi-completion-pill ${toneClass} ${compact ? "is-compact" : ""}`} title={pillTitle}>
      {content}
    </span>
  );
}

export function FiExecutionBand({
  item,
  canUpdate,
  confirmingAutoDone = false,
  onUpdate,
  onQuickConfirm,
  onQuickExtend,
  hint,
  actorName,
}: {
  item: any;
  canUpdate: boolean;
  confirmingAutoDone?: boolean;
  onUpdate: () => void;
  onQuickConfirm?: () => void;
  onQuickExtend?: () => void;
  hint?: string;
  actorName?: (userId: string | null | undefined) => string;
}) {
  const view = resolveExecutionView(item);
  const updatedByText = view.updatedByName || (view.updatedBy ? (actorName ? actorName(view.updatedBy) : view.updatedBy) : null);
  const updatedTime = formatShortTime(view.updatedAt);

  return (
    <section
      className={`fi-completion-band fi-execution-band tone-${view.tone}${view.auto ? " is-auto" : ""}`}
      aria-label="Tình hình thực hiện"
    >
      <div className="fi-execution-band-top">
        <div className="fi-completion-band-main">
          <span className="fi-completion-band-label">Tình hình thực hiện</span>
          <FiCompletionPill item={item} />
        </div>
        {canUpdate ? (
          <button className="fi-completion-update fi-execution-cta" onClick={onUpdate} type="button">
            <CheckCircle2 size={16} />
            Cập nhật tình hình thực hiện
          </button>
        ) : hint ? (
          <small className="fi-completion-hint">{hint}</small>
        ) : null}
      </div>

      {view.auto && canUpdate && (onQuickConfirm || onQuickExtend) && (
        <div className="fi-execution-auto-banner" role="group" aria-label="Xác nhận tự ghi nhận">
          <div className="fi-execution-auto-actions">
            {onQuickConfirm && (
              <button
                type="button"
                className="fi-execution-quick-confirm"
                disabled={confirmingAutoDone}
                onClick={onQuickConfirm}
              >
                {confirmingAutoDone ? <Loader2 size={13} className="icon-spin" /> : <CheckCircle2 size={13} />}
                {confirmingAutoDone ? "Đang xác nhận..." : "Xác nhận đã xong"}
              </button>
            )}
            {onQuickExtend && (
              <button
                type="button"
                className="fi-execution-quick-extend"
                disabled={confirmingAutoDone}
                onClick={onQuickExtend}
              >
                Gia hạn
              </button>
            )}
          </div>
        </div>
      )}

      <div className="fi-execution-band-foot">
        {(updatedByText || updatedTime) && (
          <small className="fi-execution-updated-meta">
            Cập nhật gần nhất{updatedByText ? ` bởi ${updatedByText}` : ""}
            {updatedTime ? ` lúc ${updatedTime}` : ""}
          </small>
        )}
      </div>
    </section>
  );
}
