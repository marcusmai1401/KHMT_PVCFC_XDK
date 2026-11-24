import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ImagePlus,
  Info,
  Loader2,
  PauseCircle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { ApiError, api } from "../../../api/client";
import {
  EXECUTION_EDITABLE_STATUSES,
  addDaysIso,
  addMonthsIso,
  endOfYearIso,
  resolveExecutionView,
  todayIsoDate,
  tomorrowIsoDate,
} from "../utils/fiExecution";
import { FiCompletionPill } from "./FiExecutionBand";

export type ExecutionModalInitialStatus = "in_progress" | "paused" | "completed";

type StagedFile = {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "uploading" | "done" | "failed";
  error?: string;
};

const QUICK_NOTES = [
  "Đã lắp đặt & nghiệm thu tại hiện trường",
  "Chờ dừng máy bảo dưỡng để triển khai",
  "Đang chờ vật tư / thiết bị",
  "Cần thêm thời gian theo dõi vận hành",
];

function makeIdemKey(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${rand}`;
}

export function FiExecutionUpdateModal({
  item,
  canUploadImages = false,
  initialStatus,
  onClose,
  onSaved,
}: {
  item: any;
  canUploadImages?: boolean;
  initialStatus?: ExecutionModalInitialStatus;
  onClose: () => void;
  onSaved: (updated: any, message: string) => void;
}) {
  const isApproved = EXECUTION_EDITABLE_STATUSES.includes(item?.status);
  const currentView = resolveExecutionView(item);
  const today = todayIsoDate();
  const tomorrow = tomorrowIsoDate();

  const defaultStatus: ExecutionModalInitialStatus = (() => {
    if (initialStatus) {
      if (initialStatus === "paused" && !isApproved) return "in_progress";
      return initialStatus;
    }
    // Keep the current state pre-selected so opening the dialog never proposes a
    // change the user did not choose (e.g. silently marking an SK completed).
    if (isApproved && currentView.tone === "paused") return "paused";
    return currentView.tone === "done" ? "completed" : "in_progress";
  })();

  const [activeRecord, setActiveRecord] = useState<any>(item);
  const [status, setStatus] = useState<ExecutionModalInitialStatus>(defaultStatus);
  const [completedDate, setCompletedDate] = useState<string>(
    currentView.tone === "done" && currentView.date && currentView.date <= today ? currentView.date : today,
  );
  const [plannedDate, setPlannedDate] = useState<string>(
    currentView.tone === "planned" && currentView.date && currentView.date > today
      ? currentView.date
      : addMonthsIso(1),
  );
  const [pausedDate, setPausedDate] = useState<string>(
    currentView.tone === "paused" && currentView.date && currentView.date >= today ? currentView.date : "",
  );
  const [note, setNote] = useState<string>(currentView.executionNote ?? "");
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadingConflict, setReloadingConflict] = useState(false);
  const [conflictDetected, setConflictDetected] = useState(false);
  const [executionSaved, setExecutionSaved] = useState(false);
  const [savedRecord, setSavedRecord] = useState<any>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs on unmount to avoid leaking memory
  const stagedRef = useRef<StagedFile[]>([]);
  stagedRef.current = stagedFiles;
  useEffect(() => {
    return () => {
      stagedRef.current.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    };
  }, []);

  // Close the dialog; when the execution status was already saved (only some
  // images failed), hand the saved record back so every open view resyncs.
  const dismiss = () => {
    if (executionSaved && savedRecord) {
      onSaved(savedRecord, "Đã lưu tình hình thực hiện.");
    } else {
      onClose();
    }
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  // Capture Escape so only this modal closes and parent FiDetailDrawer remains open
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!saving) dismissRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [saving]);

  const appendFiles = (incoming: File[]) => {
    const valid = incoming.filter(
      (file) =>
        file.type.startsWith("image/") || /\.(heic|heif|jfif|bmp|tiff?|avif|jpe?g|png|webp|gif)$/i.test(file.name),
    );
    if (valid.length === 0) return;
    setError("");
    setStagedFiles((prev) => [
      ...prev,
      ...valid.map((file) => ({
        id: makeIdemKey("stage"),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "pending" as const,
      })),
    ]);
  };

  const removeStagedFile = (id: string) => {
    setStagedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    if (!canUploadImages || !isApproved) return;
    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const files: File[] = [];
    clipboardItems.forEach((entry, idx) => {
      if (entry.kind === "file" && entry.type.startsWith("image/")) {
        const raw = entry.getAsFile();
        if (!raw) return;
        const ext = (raw.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const named =
          raw.name && raw.name !== "image.png"
            ? raw
            : new File([raw], `hoan-thanh-${stamp}-${idx + 1}.${ext}`, { type: raw.type || "image/png" });
        files.push(named);
      }
    });
    if (files.length > 0) {
      event.preventDefault();
      appendFiles(files);
    }
  };

  const reloadLatestRecord = async () => {
    setReloadingConflict(true);
    setError("");
    try {
      const fresh = await api.getSk(activeRecord.id);
      setActiveRecord(fresh);
      setConflictDetected(false);
      setExecutionSaved(false);
      setSavedRecord(null);
      const freshView = resolveExecutionView(fresh);
      setNote(freshView.executionNote ?? "");
      if (freshView.tone === "paused") {
        setStatus("paused");
        setPausedDate(freshView.date && freshView.date >= today ? freshView.date : "");
      } else if (freshView.tone === "done") {
        setStatus("completed");
        setCompletedDate(freshView.date && freshView.date <= today ? freshView.date : today);
      } else {
        setStatus("in_progress");
        setPlannedDate(freshView.date && freshView.date > today ? freshView.date : addMonthsIso(1));
      }
    } catch (err: any) {
      setError(err?.message || "Không thể tải lại phiên bản mới nhất.");
    } finally {
      setReloadingConflict(false);
    }
  };

  const validate = (): string => {
    if (status === "completed") {
      if (!completedDate) return "Vui lòng chọn ngày hoàn thành.";
      if (completedDate > today) return "Ngày hoàn thành không được sau ngày hôm nay.";
    } else if (status === "in_progress") {
      if (!plannedDate) return "Vui lòng chọn ngày dự kiến hoàn thành.";
      if (isApproved && plannedDate <= today) {
        return "Ngày dự kiến phải sau hôm nay. Nếu đã xong chọn “Đã hoàn thành”; nếu đang chờ dừng máy/vật tư chọn “Tạm dừng”.";
      }
      if (!isApproved && plannedDate < today) {
        return "Ngày dự kiến không được trước ngày hôm nay.";
      }
    } else if (status === "paused") {
      if (pausedDate && pausedDate < today) {
        return "Ngày dự kiến mới không được trước ngày hôm nay.";
      }
    }
    return "";
  };

  const handleSave = async () => {
    if (saving) return;
    if (!executionSaved) {
      const validationError = validate();
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setSaving(true);
    setError("");
    setConflictDetected(false);

    try {
      let currentRec = savedRecord ?? activeRecord;
      let currentRev = Number(currentRec.server_revision ?? currentRec.revision ?? 0);

      // Step 1: Save execution status (skip if already saved in a previous attempt where image upload partially failed)
      if (!executionSaved) {
        const targetDate =
          status === "completed" ? completedDate : status === "paused" ? pausedDate || null : plannedDate;
        const updated = await api.updateSkExecution(activeRecord.id, {
          execution_status: status,
          completion_date: targetDate,
          execution_note: note.trim() || null,
          expected_revision: currentRev,
        });
        currentRec = updated;
        currentRev = Number(updated.server_revision ?? updated.revision ?? currentRev + 1);
        setSavedRecord(updated);
        setActiveRecord(updated);
        setExecutionSaved(true);
      }

      // Step 2: Upload any pending/failed completion evidence images sequentially
      const pendingFiles = stagedFiles.filter((entry) => entry.status !== "done");
      let uploadedCount = stagedFiles.filter((entry) => entry.status === "done").length;
      let failedCount = 0;

      if (canUploadImages && isApproved && pendingFiles.length > 0) {
        for (const entry of pendingFiles) {
          setStagedFiles((prev) =>
            prev.map((itemFile) =>
              itemFile.id === entry.id ? { ...itemFile, status: "uploading", error: undefined } : itemFile,
            ),
          );
          try {
            const response = await api.uploadSkImageWithOptions(activeRecord.id, entry.file, {
              expectedRevision: currentRev,
              idempotencyKey: makeIdemKey(`fi-comp-img:${activeRecord.id}:${entry.id}`),
              stage: "completion",
            });
            currentRev = Number(response.server_revision ?? currentRev + 1);
            uploadedCount += 1;
            setStagedFiles((prev) =>
              prev.map((itemFile) => (itemFile.id === entry.id ? { ...itemFile, status: "done" } : itemFile)),
            );
          } catch (uploadErr: any) {
            failedCount += 1;
            setStagedFiles((prev) =>
              prev.map((itemFile) =>
                itemFile.id === entry.id
                  ? { ...itemFile, status: "failed", error: uploadErr?.message || "Lỗi tải ảnh" }
                  : itemFile,
              ),
            );
            // Reconcile latest revision in case a previous image committed
            const latest = await api.getSk(activeRecord.id).catch(() => null);
            if (latest) {
              currentRec = latest;
              currentRev = Number(latest.server_revision ?? latest.revision ?? currentRev);
              setSavedRecord(latest);
              setActiveRecord(latest);
            }
          }
        }
      }

      if (failedCount > 0) {
        setError(
          `Đã lưu tình hình thực hiện, nhưng ${failedCount} ảnh chưa tải lên được. Bạn có thể bấm “Thử lại ảnh lỗi” hoặc đóng cửa sổ.`,
        );
        return;
      }

      // Re-fetch full SK detail (including supporting_images) when images were uploaded
      const finalRecord =
        uploadedCount > 0 ? await api.getSk(activeRecord.id).catch(() => currentRec) : currentRec;
      const finalView = resolveExecutionView(finalRecord);
      const statusText = `${finalView.label}${finalView.dateText ? ` ${finalView.dateText}` : ""}`;
      const message =
        uploadedCount > 0
          ? `Đã cập nhật tình hình thực hiện (${statusText}) và tải lên ${uploadedCount} ảnh hoàn thành.`
          : `Đã cập nhật tình hình thực hiện: ${statusText}.`;
      onSaved(finalRecord, message);
    } catch (err: any) {
      if (err instanceof ApiError && (err.status === 409 || err.code === "VERSION_CONFLICT")) {
        setConflictDetected(true);
        setError("Hồ sơ này vừa được người khác cập nhật. Vui lòng tải lại phiên bản mới trước khi lưu.");
      } else {
        setError(err?.message || "Không lưu được tình hình thực hiện.");
      }
    } finally {
      setSaving(false);
    }
  };

  const hasPendingFailedImages = executionSaved && stagedFiles.some((f) => f.status === "failed");

  return (
    <div
      className="fi-edit-modal-backdrop fi-execution-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) dismiss();
      }}
    >
      <section
        aria-labelledby="fi-exec-modal-title"
        aria-modal="true"
        className="fi-plan-dialog fi-execution-modal"
        role="dialog"
        onPaste={handlePaste}
      >
        <header className="fi-plan-dialog-head">
          <div>
            <h2 id="fi-exec-modal-title">Cập nhật tình hình thực hiện</h2>
            <p>
              {activeRecord.sk_code ? `${activeRecord.sk_code} · ` : ""}
              {activeRecord.title}
            </p>
          </div>
          <button
            aria-label="Đóng"
            className="fi-edit-modal-close"
            disabled={saving}
            onClick={dismiss}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="fi-execution-modal-body">
          <div className="fi-plan-dialog-current">
            <span>Hiện tại</span>
            <FiCompletionPill item={activeRecord} />
            {currentView.note && <small>{currentView.note}</small>}
          </div>

          <div className="fi-plan-options fi-execution-options" role="radiogroup" aria-label="Trạng thái thực hiện">
            {/* Option 1: Completed */}
            <div className={`fi-plan-option tone-done ${status === "completed" ? "selected" : ""}`}>
              <button
                aria-checked={status === "completed"}
                className="fi-plan-option-choice"
                disabled={saving || executionSaved}
                onClick={() => setStatus("completed")}
                role="radio"
                type="button"
              >
                <CheckCircle2 size={20} />
                <span>
                  <strong>Đã hoàn thành</strong>
                  <small>Sáng kiến đã áp dụng xong tại hiện trường</small>
                </span>
              </button>
              {status === "completed" && (
                <div className="fi-plan-option-date">
                  <label htmlFor="fi-exec-completed-date">
                    Ngày hoàn thành <span className="fi-required">*</span>
                  </label>
                  <div className="fi-exec-date-row">
                    <input
                      id="fi-exec-completed-date"
                      disabled={saving || executionSaved}
                      max={today}
                      onChange={(event) => setCompletedDate(event.target.value)}
                      type="date"
                      value={completedDate}
                    />
                    <div className="fi-exec-date-chips">
                      <button
                        type="button"
                        disabled={saving || executionSaved}
                        className={completedDate === today ? "is-selected" : ""}
                        onClick={() => setCompletedDate(today)}
                      >
                        Hôm nay
                      </button>
                      <button
                        type="button"
                        disabled={saving || executionSaved}
                        className={completedDate === addDaysIso(-1) ? "is-selected" : ""}
                        onClick={() => setCompletedDate(addDaysIso(-1))}
                      >
                        Hôm qua
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Option 2: In Progress */}
            <div className={`fi-plan-option tone-planned ${status === "in_progress" ? "selected" : ""}`}>
              <button
                aria-checked={status === "in_progress"}
                className="fi-plan-option-choice"
                disabled={saving || executionSaved}
                onClick={() => setStatus("in_progress")}
                role="radio"
                type="button"
              >
                <Clock3 size={20} />
                <span>
                  <strong>Đang thực hiện</strong>
                  <small>Đang triển khai, cập nhật ngày dự kiến hoàn thành</small>
                </span>
              </button>
              {status === "in_progress" && (
                <div className="fi-plan-option-date">
                  <label htmlFor="fi-exec-planned-date">
                    Ngày dự kiến hoàn thành <span className="fi-required">*</span>
                  </label>
                  <div className="fi-exec-date-row">
                    <input
                      id="fi-exec-planned-date"
                      disabled={saving || executionSaved}
                      min={isApproved ? tomorrow : today}
                      onChange={(event) => setPlannedDate(event.target.value)}
                      type="date"
                      value={plannedDate}
                    />
                    <div className="fi-exec-date-chips">
                      <button
                        type="button"
                        disabled={saving || executionSaved}
                        onClick={() => setPlannedDate(addDaysIso(15))}
                      >
                        +15 ngày
                      </button>
                      <button
                        type="button"
                        disabled={saving || executionSaved}
                        onClick={() => setPlannedDate(addMonthsIso(1))}
                      >
                        +1 tháng
                      </button>
                      <button
                        type="button"
                        disabled={saving || executionSaved}
                        onClick={() => setPlannedDate(endOfYearIso())}
                      >
                        Cuối năm
                      </button>
                    </div>
                  </div>
                  <small>
                    {isApproved
                      ? "Tới ngày dự kiến, hệ thống tự ghi nhận “Tự ghi nhận · cần xác nhận”."
                      : "Chỉ áp dụng tự ghi nhận sau khi SK được Đồng ý."}
                  </small>
                </div>
              )}
            </div>

            {/* Option 3: Paused (only for Approved/Completed) */}
            {isApproved && (
              <div className={`fi-plan-option tone-paused ${status === "paused" ? "selected" : ""}`}>
                <button
                  aria-checked={status === "paused"}
                  className="fi-plan-option-choice"
                  disabled={saving || executionSaved}
                  onClick={() => setStatus("paused")}
                  role="radio"
                  type="button"
                >
                  <PauseCircle size={20} />
                  <span>
                    <strong>Tạm dừng / Chờ dừng máy</strong>
                    <small>Đang chờ vật tư, dừng máy hoặc điều kiện vận hành</small>
                  </span>
                </button>
                {status === "paused" && (
                  <div className="fi-plan-option-date">
                    <label htmlFor="fi-exec-paused-date">Ngày dự kiến triển khai lại (tùy chọn)</label>
                    <input
                      id="fi-exec-paused-date"
                      disabled={saving || executionSaved}
                      min={today}
                      onChange={(event) => setPausedDate(event.target.value)}
                      type="date"
                      value={pausedDate}
                    />
                    <small>Hệ thống sẽ không tự chuyển sang Đã hoàn thành khi đang tạm dừng.</small>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Optional execution note + quick chips */}
          <div className="fi-exec-note-field">
            <div className="fi-exec-note-head">
              <label htmlFor="fi-exec-note">
                Ghi chú thực hiện <span className="muted">(tùy chọn)</span>
              </label>
              <small className="muted">{note.length}/1000</small>
            </div>
            <textarea
              id="fi-exec-note"
              disabled={saving || executionSaved}
              maxLength={1000}
              rows={2}
              placeholder="Ví dụ: Đã lắp đặt cover bảo vệ, chạy thử ổn định 7 ngày..."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="fi-exec-quick-notes" role="group" aria-label="Gợi ý ghi chú nhanh">
              {QUICK_NOTES.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={saving || executionSaved}
                  onClick={() => setNote((prev) => (prev.trim() ? `${prev.trim()}; ${preset}` : preset).slice(0, 1000))}
                >
                  + {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Optional completion evidence photo uploader */}
          {canUploadImages && isApproved && (
            <div className="fi-exec-upload-section">
              <div className="fi-exec-note-head">
                <label>
                  Ảnh bằng chứng hoàn thành <span className="muted">(tùy chọn, khuyến khích)</span>
                </label>
                {stagedFiles.length > 0 && <small className="muted">{stagedFiles.length} ảnh đã chọn</small>}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.heic,.heif,.jfif,.bmp,.tif,.tiff,.avif"
                multiple
                style={{ display: "none" }}
                onChange={(event) => {
                  appendFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <div
                className={`fi-dropzone fi-exec-dropzone ${dragOver ? "is-drag-over" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  appendFiles(Array.from(event.dataTransfer?.files ?? []));
                }}
              >
                <button type="button" disabled={saving} onClick={() => fileInputRef.current?.click()}>
                  <ImagePlus size={15} />
                  Chọn / chụp ảnh hoàn thành
                </button>
                <span className="fi-dropzone-hint">kéo thả hoặc dán Ctrl+V ảnh sau triển khai</span>
              </div>

              {stagedFiles.length > 0 && (
                <div className="fi-exec-staged-grid">
                  {stagedFiles.map((entry) => (
                    <div className={`fi-exec-staged-item is-${entry.status}`} key={entry.id}>
                      <img src={entry.previewUrl} alt={entry.file.name} />
                      <div className="fi-exec-staged-meta">
                        <small title={entry.file.name}>{entry.file.name}</small>
                        {entry.status === "done" && <span className="tone-done">Đã tải</span>}
                        {entry.status === "uploading" && <span>Đang tải...</span>}
                        {entry.status === "failed" && <span className="tone-danger">{entry.error || "Lỗi"}</span>}
                      </div>
                      {entry.status !== "done" && !saving && (
                        <button
                          type="button"
                          aria-label={`Bỏ ảnh ${entry.file.name}`}
                          className="image-card-delete"
                          onClick={() => removeStagedFile(entry.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="fi-plan-dialog-note">
            <Info size={14} />
            Trạng thái xét duyệt (“Đồng ý”) và tháng KHMT được giữ nguyên. Mọi cập nhật đều lưu vào lịch sử xử lý.
          </p>

          {error && (
            <div className="fi-exec-error-box" role="alert">
              <AlertTriangle size={15} />
              <div>
                <p>{error}</p>
                {conflictDetected && (
                  <button
                    type="button"
                    className="link-button"
                    disabled={reloadingConflict}
                    onClick={() => void reloadLatestRecord()}
                  >
                    <RefreshCw size={13} className={reloadingConflict ? "icon-spin" : undefined} />
                    {reloadingConflict ? "Đang tải lại..." : "Tải lại phiên bản mới"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="fi-plan-dialog-actions">
          <button
            className="btn-secondary"
            disabled={saving}
            onClick={dismiss}
            type="button"
          >
            {executionSaved ? "Đóng" : "Hủy"}
          </button>
          <button className="btn-primary" disabled={saving || reloadingConflict} onClick={() => void handleSave()} type="button">
            {saving && <Loader2 size={15} className="icon-spin" />}
            {saving ? "Đang lưu…" : hasPendingFailedImages ? "Thử lại ảnh lỗi" : "Lưu tình hình thực hiện"}
          </button>
        </footer>
      </section>
    </div>
  );
}
