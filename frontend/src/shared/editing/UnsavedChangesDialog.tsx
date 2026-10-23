import { useDialogFocus } from "./useDialogFocus";

export function UnsavedChangesDialog({
  actionLabel = "rời trang",
  busy = false,
  message,
  saveLabel = "Lưu và đi",
  discardLabel = "Bỏ thay đổi",
  onStay,
  onSaveAndGo,
  onDiscard,
}: {
  actionLabel?: string;
  busy?: boolean;
  message?: string;
  saveLabel?: string;
  discardLabel?: string;
  onStay: () => void;
  onSaveAndGo: () => void | Promise<void>;
  onDiscard: () => void;
}) {
  const dialogRef = useDialogFocus(() => { if (!busy) onStay(); });
  return (
    <div className="editing-dialog-backdrop" role="presentation">
      <section ref={dialogRef} className="editing-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-dialog-title">
        <h2 id="unsaved-dialog-title">Bạn có thay đổi chưa lưu</h2>
        <p>{message ?? `Một số thay đổi chưa được lưu lên hệ thống. Chọn cách xử lý trước khi ${actionLabel}.`}</p>
        <div className="editing-dialog-actions">
          <button type="button" disabled={busy} className="btn-secondary" onClick={onStay}>Ở lại</button>
          <button type="button" disabled={busy} className="btn-secondary" onClick={onDiscard}>{discardLabel}</button>
          <button type="button" disabled={busy} className="btn-primary" onClick={() => void onSaveAndGo()}>{busy ? "Đang lưu…" : saveLabel}</button>
        </div>
      </section>
    </div>
  );
}
