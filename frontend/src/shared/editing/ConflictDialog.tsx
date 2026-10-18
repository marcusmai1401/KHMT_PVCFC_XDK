import { useDialogFocus } from "./useDialogFocus";
import type { ApiError } from "../../api/client";

export function ConflictDialog({ error, onKeepLocal, onUseServer, onClose }: {
  error: ApiError | Error | null;
  onKeepLocal: () => void;
  onUseServer: () => void;
  onClose?: () => void;
}) {
  const close = onClose ?? onKeepLocal;
  const dialogRef = useDialogFocus(close, Boolean(error));
  if (!error) return null;
  return (
    <div className="editing-dialog-backdrop" role="presentation">
      <section ref={dialogRef} className="editing-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-dialog-title">
        <h2 id="conflict-dialog-title">Bản nháp đã thay đổi ở nơi khác</h2>
        <p>{error.message || "Máy chủ có phiên bản mới hơn."}</p>
        <p className="muted">Nội dung bạn đang sửa vẫn được giữ nguyên. Hãy xem bản máy chủ trước khi quyết định.</p>
        <div className="editing-dialog-actions">
          <button type="button" className="btn-secondary" onClick={close}>Giữ bản của tôi</button>
          <button type="button" className="btn-primary" onClick={onUseServer}>Dùng bản máy chủ</button>
        </div>
      </section>
    </div>
  );
}
