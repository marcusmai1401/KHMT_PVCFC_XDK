import { useEffect, type ReactNode } from "react";
import {
  CalendarDays,
  ClipboardCheck,
  History,
  ImagePlus,
  Pencil,
  Trash2,
  UserRound,
  Users2,
  X,
} from "lucide-react";
import type { FiKhmtMatrixData } from "../types/fiDashboard";
import { displayTeamLabel } from "../utils/fiMetrics";
import { FiKhmtMonthPicker } from "./FiKhmtMonthPicker";

export function FiDetailDrawer({
  item,
  statusLabel,
  statusToneClass,
  submitterLabel,
  registrationLabel,
  khmtText,
  canSelectKhmt,
  khmtBusy,
  khmtMatrix,
  actions,
  isPlanOnly,
  editTitle,
  canUploadImages,
  uploadingImages,
  images,
  historyEntries,
  completionBand,
  reviewPanel,
  renderImageCard,
  historyActionLabel,
  actorLabel,
  historyDetail,
  formatHistoryTime,
  onClose,
  onEdit,
  onDelete,
  onReview,
  onTriggerImageUpload,
  onAssignKhmt,
  onClearKhmt,
  suspended = false,
}: {
  item: any | null;
  statusLabel: string;
  statusToneClass: string;
  submitterLabel: string;
  registrationLabel: string;
  khmtText: string;
  canSelectKhmt: boolean;
  khmtBusy: boolean;
  khmtMatrix?: FiKhmtMatrixData | null;
  actions: string[];
  isPlanOnly: boolean;
  editTitle: string;
  canUploadImages: boolean;
  uploadingImages: boolean;
  images: any[];
  historyEntries: any[];
  completionBand: ReactNode;
  reviewPanel?: ReactNode;
  renderImageCard: (img: any, index: number) => ReactNode;
  historyActionLabel: (entry: any) => string;
  actorLabel: (actor: string | null | undefined) => string;
  historyDetail: (entry: any) => { label: string; text: string } | null;
  formatHistoryTime: (value: string | null | undefined) => string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReview: () => void;
  onTriggerImageUpload: () => void;
  onAssignKhmt: (item: any, month: number, year: number) => Promise<void> | void;
  onClearKhmt: (item: any) => Promise<void> | void;
  // True while a dialog opened from the drawer (lightbox, edit, plan) is on top,
  // so Escape closes only that dialog instead of the drawer underneath.
  suspended?: boolean;
}) {
  useEffect(() => {
    if (!item || suspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, suspended, onClose]);

  if (!item) return null;

  return (
    <div
      className="fi-drawer-backdrop fi-detail-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="fi-drawer fi-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Chi tiết ${item.sk_code || item.title}`}
      >
        <header className="fi-drawer-head">
          <div className="fi-drawer-head-title">
            <div className="fi-detail-code-line">
              <span className="fi-drawer-code">{item.sk_code || "SK-CTKT"}</span>
              <span className={`fi-status-pill ${statusToneClass}`}>{statusLabel}</span>
              <span className="fi-drawer-team-pill">{displayTeamLabel(item.team)}</span>
            </div>
            <h2>{item.title}</h2>
          </div>
          <button
            type="button"
            className="fi-drawer-close"
            aria-label="Đóng chi tiết"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="fi-detail-drawer-actions">
          {actions.includes("reviewDecision") && (
            <button
              className="fi-detail-action primary"
              type="button"
              onClick={onReview}
            >
              <ClipboardCheck size={16} />
              Đánh giá
            </button>
          )}
          {actions.includes("edit") && (
            <button
              className="fi-detail-action"
              title={editTitle}
              type="button"
              onClick={onEdit}
            >
              <Pencil size={16} />
              {isPlanOnly ? "Cập nhật kế hoạch" : "Chỉnh sửa"}
            </button>
          )}
          {canUploadImages && (
            <button
              className="fi-detail-action"
              title="Tải ảnh bằng chứng"
              type="button"
              disabled={uploadingImages}
              onClick={onTriggerImageUpload}
            >
              <ImagePlus size={16} />
              {uploadingImages ? "Đang tải..." : "Thêm ảnh"}
            </button>
          )}
          {actions.includes("delete") && (
            <button
              className="fi-detail-action danger-button"
              title="Xóa SK"
              type="button"
              onClick={onDelete}
            >
              <Trash2 size={16} />
              Xóa
            </button>
          )}
        </div>

        <div className="fi-drawer-body">
          {reviewPanel}

          <div className="fi-detail-meta fi-detail-drawer-meta">
            <div className="fi-meta-item">
              <UserRound size={16} />
              <span>Tác giả</span>
              <strong>{item.author_name}</strong>
            </div>
            <div className="fi-meta-item">
              <Users2 size={16} />
              <span>Người đăng ký</span>
              <strong>{submitterLabel}</strong>
            </div>
            <div className="fi-meta-item">
              <CalendarDays size={16} />
              <span>Tháng đăng ký</span>
              <strong>{registrationLabel}</strong>
            </div>
            <div className="fi-meta-item fi-meta-item-khmt">
              <ClipboardCheck size={16} />
              <span>KHMT</span>
              {canSelectKhmt ? (
                <FiKhmtMonthPicker
                  item={item}
                  khmtMatrix={khmtMatrix}
                  busy={khmtBusy}
                  onAssign={onAssignKhmt}
                  onClear={onClearKhmt}
                />
              ) : (
                <strong>{khmtText}</strong>
              )}
            </div>
          </div>

          {completionBand}

          <div className="fi-detail-content fi-detail-drawer-content">
            <div className="fi-content-section primary">
              <span className="fi-section-label">Nội dung đăng ký</span>
              <p>{item.content_description || "Chưa có mô tả nội dung."}</p>
            </div>

            {(item.fi_coordinator_comments || item.bm01_raw_conclusion || item.workshop_leader_conclusion || item.decision_note) && (
              <div className="fi-content-section notes">
                <h3>Ghi chú và kết luận xét duyệt</h3>
                {(item.fi_coordinator_comments || item.bm01_raw_conclusion) && (
                  <div>
                    <span>Nhận xét FI / BM01</span>
                    <p>{item.fi_coordinator_comments || item.bm01_raw_conclusion}</p>
                  </div>
                )}
                {item.workshop_leader_conclusion && (
                  <div>
                    <span>Kết luận LĐX (dữ liệu cũ)</span>
                    <p>{item.workshop_leader_conclusion}</p>
                  </div>
                )}
                {item.decision_note && (
                  <div>
                    <span>Ghi chú quyết định</span>
                    <p>{item.decision_note}</p>
                  </div>
                )}
              </div>
            )}

            {(images.length > 0 || canUploadImages) && (
              <div className="image-list">
                <h3>Ảnh bằng chứng ({images.length})</h3>
                {images.length === 0 ? (
                  <div className="image-empty">
                    <span>Chưa có ảnh bằng chứng.</span>
                    {canUploadImages && (
                      <button
                        type="button"
                        onClick={onTriggerImageUpload}
                        disabled={uploadingImages}
                      >
                        <ImagePlus size={15} />
                        {uploadingImages ? "Đang tải..." : "Thêm ảnh"}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="image-card-grid">
                    {images.map((img, index) => renderImageCard(img, index))}
                  </div>
                )}
              </div>
            )}

            {historyEntries.length > 0 && (
              <div className="fi-content-section timeline">
                <div className="fi-section-heading">
                  <History size={16} />
                  <h3>Lịch sử xử lý</h3>
                </div>
                <div className="fi-timeline">
                  {historyEntries.map((entry: any, index: number) => {
                    const detail = historyDetail(entry);
                    const time = formatHistoryTime(entry.changed_at);
                    return (
                      <div className="fi-timeline-item" key={`${entry.changed_at}-${index}`}>
                        <span className="fi-timeline-dot" />
                        <div>
                          <div className="fi-timeline-row">
                            <strong>{historyActionLabel(entry)}</strong>
                            {time && <time>{time}</time>}
                          </div>
                          <p className="fi-timeline-actor">
                            <span>Người thực hiện</span>
                            <strong>{actorLabel(entry.changed_by)}</strong>
                          </p>
                          {detail && (
                            <div className="fi-timeline-note">
                              <span>{detail.label}</span>
                              <p>{detail.text}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
