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

type FeedbackType = "loi" | "kho_su_dung" | "gop_y";

const FEEDBACK_TYPES: Array<{ value: FeedbackType; label: string; placeholder: string }> = [
  { value: "loi", label: "Lỗi", placeholder: "Bạn đang làm gì thì gặp lỗi? Hệ thống hiển thị gì?" },
  { value: "kho_su_dung", label: "Khó sử dụng", placeholder: "Thao tác nào khó hiểu hoặc mất nhiều thời gian?" },
  { value: "gop_y", label: "Góp ý", placeholder: "Bạn muốn hệ thống có thêm hoặc thay đổi điều gì?" },
];

const MAX_LENGTH = 4000;

export function FeedbackDialog({ route, module, onClose, onReceived, onError }: Props) {
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("loi");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const operationKey = useRef(globalThis.crypto?.randomUUID?.() ?? `feedback-${Date.now()}`);
  const dialogRef = useDialogFocus(sending ? undefined : onClose);
  const activeType = FEEDBACK_TYPES.find((type) => type.value === feedbackType) ?? FEEDBACK_TYPES[0];

  const submit = () => {
    if (!description.trim() || sending) return;
    setSending(true);
    api.submitFeedback({
      feedback_type: feedbackType,
      description: description.trim(),
      context: { route_template: route, module, view: "account-help" },
      // Pressing "Gửi" is the explicit consent; the note above the buttons says what is sent.
      consent: true,
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
        <h2 id="feedback-title">Báo vấn đề hoặc góp ý</h2>

        <div className="feedback-field">
          <span className="feedback-label" id="feedback-type-label">Loại phản hồi</span>
          <div className="feedback-type-group" role="radiogroup" aria-labelledby="feedback-type-label">
            {FEEDBACK_TYPES.map((type) => (
              <button
                aria-checked={feedbackType === type.value}
                className={feedbackType === type.value ? "active" : ""}
                disabled={sending}
                key={type.value}
                onClick={() => setFeedbackType(type.value)}
                role="radio"
                type="button"
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <div className="feedback-field">
          <label className="feedback-label" htmlFor="feedback-description">
            Mô tả <span aria-hidden="true" className="feedback-required">*</span>
          </label>
          <textarea
            autoFocus
            disabled={sending}
            id="feedback-description"
            maxLength={MAX_LENGTH}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={activeType.placeholder}
            rows={6}
            value={description}
          />
          <span className="feedback-counter">{description.length}/{MAX_LENGTH}</span>
        </div>

        <p className="feedback-note">
          Nội dung này cùng tên trang bạn đang mở sẽ được gửi tới quản trị hệ thống. Hệ thống không chụp màn hình.
        </p>

        <div className="editing-dialog-actions">
          <button className="btn-secondary" type="button" onClick={onClose} disabled={sending}>Hủy</button>
          <button className="btn-primary" type="button" onClick={submit} disabled={sending || !description.trim()}>
            {sending ? "Đang gửi…" : "Gửi phản hồi"}
          </button>
        </div>
      </section>
    </div>
  );
}
