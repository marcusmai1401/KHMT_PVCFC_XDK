import { useRef, useState } from "react";
import { api } from "../../api/client";
import { useDialogFocus } from "../editing/useDialogFocus";

type Props = {
  route: string;
  module: string;
  onClose: () => void;
  onReceived: (message: string) => void;
  onError: (message: string) => void;
};

export function FeedbackDialog({ route, module, onClose, onReceived, onError }: Props) {
  const [feedbackType, setFeedbackType] = useState<"loi" | "kho_su_dung" | "gop_y">("loi");
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const operationKey = useRef(globalThis.crypto?.randomUUID?.() ?? `feedback-${Date.now()}`);
  const dialogRef = useDialogFocus(sending ? undefined : onClose);

  const submit = () => {
    if (!description.trim() || !consent || sending) return;
    setSending(true);
    api.submitFeedback({
      feedback_type: feedbackType,
      description: description.trim(),
      context: { route_template: route, module, view: "account-help" },
      consent,
    }, operationKey.current)
      .then((response) => {
        onReceived(`Đã ghi nhận phản hồi. Mã tiếp nhận: ${response.ticket_id}`);
        onClose();
      })
      .catch((error) => onError(error.message || "Không gửi được phản hồi."))
      .finally(() => setSending(false));
  };

  return (
    <div className="editing-dialog-backdrop" role="presentation">
      <section ref={dialogRef} className="editing-dialog feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <h2 id="feedback-title">Báo vấn đề</h2>
        <p className="muted">Chỉ gửi khi bạn bấm “Gửi phản hồi”. Hệ thống kèm trang, phân hệ và build ID; không tự chụp màn hình.</p>
        <label>
          Loại vấn đề
          <select value={feedbackType} onChange={(event) => setFeedbackType(event.target.value as typeof feedbackType)}>
            <option value="loi">Lỗi</option>
            <option value="kho_su_dung">Khó sử dụng</option>
            <option value="gop_y">Góp ý</option>
          </select>
        </label>
        <label>
          Mô tả <span aria-hidden="true">*</span>
          <textarea autoFocus value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} placeholder="Điều gì đã xảy ra? Bạn mong đợi điều gì?" />
        </label>
        <label className="feedback-consent">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>Tôi đồng ý gửi mô tả và ngữ cảnh tối thiểu nêu trên cho hệ thống nội bộ.</span>
        </label>
        <div className="editing-dialog-actions">
          <button type="button" onClick={onClose} disabled={sending}>Hủy</button>
          <button type="button" onClick={submit} disabled={sending || !description.trim() || !consent}>{sending ? "Đang gửi…" : "Gửi phản hồi"}</button>
        </div>
      </section>
    </div>
  );
}
