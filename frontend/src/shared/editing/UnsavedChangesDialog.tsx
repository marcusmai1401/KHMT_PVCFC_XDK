import { useDialogFocus } from "./useDialogFocus";

export function UnsavedChangesDialog({ actionLabel = "rời trang", busy = false, onStay, onSaveAndGo, onDiscard }: {
  actionLabel?: string;
  busy?: boolean;
  onStay: () => void;
  onSaveAndGo: () => void | Promise<void>;
  onDiscard: () => void;
}) {
  const dialogRef = useDialogFocus(() => { if (!busy) onStay(); });
  return (
    <div className="editing-dialog-backdrop" role="presentation">
      <section ref={dialogRef} className="editing-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-dialog-title">
        <h2 id="unsaved-dialog-title">Bạn có thay đổi chưa lưu</h2>
        <p>Bản nháp sẽ vẫn ở trên máy chủ nếu lần lưu đã hoàn tất. Chọn cách xử lý trước khi {actionLabel}.</p>
        <div className="editing-dialog-actions">
          <button type="button" disabled={busy} className="btn-secondary" onClick={onStay}>Ở lại</button>
          <button type="button" disabled={busy} className="btn-secondary" onClick={onDiscard}>Bỏ thay đổi</button>
          <button type="button" disabled={busy} className="btn-primary" onClick={() => void onSaveAndGo()}>{busy ? "Đang lưu…" : "Lưu và đi"}</button>
        </div>
      </section>
    </div>
  );
}
