import { AlertCircle, CheckCircle2, CloudOff, LoaderCircle, LockKeyhole, TriangleAlert } from "lucide-react";
import type { DraftPhase } from "./useDraftController";

const labels: Record<DraftPhase, string> = {
  loading: "Đang tải",
  clean: "Đã lưu",
  dirty: "Chưa lưu",
  saving: "Đang lưu",
  offline: "Ngoại tuyến",
  conflict: "Có xung đột",
  error: "Lỗi lưu",
  locked: "Đã khóa",
  "auth-required": "Cần đăng nhập lại",
};

export function SaveStatus({ phase, savedAt, recoveryAvailable, onDownloadRecovery }: {
  phase: DraftPhase;
  savedAt?: string | null;
  recoveryAvailable?: boolean;
  onDownloadRecovery?: () => void;
}) {
  const Icon = phase === "saving" ? LoaderCircle
    : phase === "clean" ? CheckCircle2
      : phase === "offline" ? CloudOff
        : phase === "locked" ? LockKeyhole
          : phase === "conflict" || phase === "error" ? AlertCircle : TriangleAlert;
  const label = phase === "clean" && savedAt
    ? `Đã lưu ${new Date(savedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`
    : labels[phase];
  return (
    <span className={`save-status save-status-${phase}`} role="status" aria-live="polite">
      <Icon size={15} aria-hidden="true" className={phase === "saving" ? "save-status-spin" : undefined} />
      <span>{label}</span>
      {recoveryAvailable && onDownloadRecovery && (
        <button type="button" className="save-status-recovery" onClick={onDownloadRecovery}>
          Tải bản nháp
        </button>
      )}
    </span>
  );
}
