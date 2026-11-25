import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { ApiError, api } from "../../../api/client";
import {
  EXECUTION_EDITABLE_STATUSES,
  addMonthsIso,
  resolveExecutionView,
  todayIsoDate,
  tomorrowIsoDate,
} from "../utils/fiExecution";

export type ExecutionModalInitialStatus = "in_progress" | "completed";

type StagedFile = {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "uploading" | "done" | "failed";
};

const IMAGE_NAME = /\.(heic|heif|jfif|bmp|tiff?|avif|jpe?g|png|webp|gif)$/i;

function makeIdemKey(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${rand}`;
}

function initialDates(view: ReturnType<typeof resolveExecutionView>, today: string) {
  return {
    completed: view.tone === "done" && view.date && view.date <= today ? view.date : today,
    planned: view.tone === "planned" && view.date && view.date > today ? view.date : addMonthsIso(1),
  };
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
  const today = todayIsoDate();
  const currentView = resolveExecutionView(item);
  const dates = initialDates(currentView, today);

  const [activeRecord, setActiveRecord] = useState<any>(item);
  const [status, setStatus] = useState<ExecutionModalInitialStatus>(
    initialStatus ?? (currentView.tone === "done" ? "completed" : "in_progress"),
  );
  const [completedDate, setCompletedDate] = useState(dates.completed);
  const [plannedDate, setPlannedDate] = useState(dates.planned);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [executionSaved, setExecutionSaved] = useState(false);
  const [savedRecord, setSavedRecord] = useState<any>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const allowPhotos = canUploadImages && isApproved;

  const stagedRef = useRef<StagedFile[]>([]);
  stagedRef.current = stagedFiles;
  useEffect(() => () => stagedRef.current.forEach((entry) => URL.revokeObjectURL(entry.previewUrl)), []);

  // Once the status is saved (only some photos failed), closing hands the saved
  // record back so every open view resyncs.
  const dismiss = () => {
    if (executionSaved && savedRecord) onSaved(savedRecord, "Đã lưu tình hình thực hiện.");
    else onClose();
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  // Escape closes only this dialog; the drawer underneath stays open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (!saving) dismissRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [saving]);

  const appendFiles = (incoming: File[]) => {
    const valid = incoming.filter((file) => file.type.startsWith("image/") || IMAGE_NAME.test(file.name));
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
      const target = prev.find((entry) => entry.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((entry) => entry.id !== id);
    });
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    if (!allowPhotos) return;
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const files: File[] = [];
    Array.from(event.clipboardData?.items ?? []).forEach((entry, idx) => {
      if (entry.kind !== "file" || !entry.type.startsWith("image/")) return;
      const raw = entry.getAsFile();
      if (!raw) return;
      const ext = (raw.type.split("/")[1] || "png").replace("jpeg", "jpg");
      files.push(
        raw.name && raw.name !== "image.png"
          ? raw
          : new File([raw], `hoan-thanh-${stamp}-${idx + 1}.${ext}`, { type: raw.type || "image/png" }),
      );
    });
    if (files.length > 0) {
      event.preventDefault();
      appendFiles(files);
    }
  };

  const reloadLatest = async () => {
    setError("");
    try {
      const fresh = await api.getSk(activeRecord.id);
      const view = resolveExecutionView(fresh);
      const next = initialDates(view, today);
      setActiveRecord(fresh);
      setConflict(false);
      setExecutionSaved(false);
      setSavedRecord(null);
      setStatus(view.tone === "done" ? "completed" : "in_progress");
      setCompletedDate(next.completed);
      setPlannedDate(next.planned);
    } catch (err: any) {
      setError(err?.message || "Không tải lại được hồ sơ.");
    }
  };

  const validate = (): string => {
    if (status === "completed") {
      if (!completedDate) return "Chọn ngày hoàn thành.";
      if (completedDate > today) return "Ngày hoàn thành không được sau hôm nay.";
      return "";
    }
    if (!plannedDate) return "Chọn ngày dự kiến.";
    if (isApproved && plannedDate <= today) return "Ngày dự kiến phải sau hôm nay.";
    if (!isApproved && plannedDate < today) return "Ngày dự kiến không được trước hôm nay.";
    return "";
  };

  const handleSave = async () => {
    if (saving) return;
    if (!executionSaved) {
      const invalid = validate();
      if (invalid) {
        setError(invalid);
        return;
      }
    }
    setSaving(true);
    setError("");
    setConflict(false);
    try {
      let currentRec = savedRecord ?? activeRecord;
      let currentRev = Number(currentRec.server_revision ?? currentRec.revision ?? 0);

      if (!executionSaved) {
        const updated = await api.updateSkExecution(activeRecord.id, {
          execution_status: status,
          completion_date: status === "completed" ? completedDate : plannedDate,
          // The dialog no longer edits notes; keep whatever is already recorded.
          execution_note: resolveExecutionView(activeRecord).executionNote ?? null,
          expected_revision: currentRev,
        });
        currentRec = updated;
        currentRev = Number(updated.server_revision ?? updated.revision ?? currentRev + 1);
        setSavedRecord(updated);
        setActiveRecord(updated);
        setExecutionSaved(true);
      }

      let uploaded = stagedFiles.filter((entry) => entry.status === "done").length;
      let failed = 0;
      if (allowPhotos) {
        for (const entry of stagedFiles.filter((file) => file.status !== "done")) {
          setStagedFiles((prev) => prev.map((file) => (file.id === entry.id ? { ...file, status: "uploading" } : file)));
          try {
            const response = await api.uploadSkImageWithOptions(activeRecord.id, entry.file, {
              expectedRevision: currentRev,
              idempotencyKey: makeIdemKey(`fi-comp-img:${activeRecord.id}:${entry.id}`),
              stage: "completion",
            });
            currentRev = Number(response.server_revision ?? currentRev + 1);
            uploaded += 1;
            setStagedFiles((prev) => prev.map((file) => (file.id === entry.id ? { ...file, status: "done" } : file)));
          } catch {
            failed += 1;
            setStagedFiles((prev) => prev.map((file) => (file.id === entry.id ? { ...file, status: "failed" } : file)));
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

      if (failed > 0) {
        setError(`Đã lưu. ${failed} ảnh chưa tải lên được.`);
        return;
      }
      const finalRecord = uploaded > 0 ? await api.getSk(activeRecord.id).catch(() => currentRec) : currentRec;
      const view = resolveExecutionView(finalRecord);
      const label = `${view.label}${view.dateText ? ` ${view.dateText}` : ""}`;
      onSaved(
        finalRecord,
        uploaded > 0 ? `Đã cập nhật: ${label} · ${uploaded} ảnh.` : `Đã cập nhật: ${label}.`,
      );
    } catch (err: any) {
      if (err instanceof ApiError && (err.status === 409 || err.code === "VERSION_CONFLICT")) {
        setConflict(true);
        setError("Hồ sơ vừa được người khác cập nhật.");
      } else {
        setError(err?.message || "Không lưu được.");
      }
    } finally {
      setSaving(false);
    }
  };

  const hasFailedPhotos = executionSaved && stagedFiles.some((file) => file.status === "failed");
  const locked = saving || executionSaved;

  return (
    <div
      className="fi-edit-modal-backdrop fi-exec-sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) dismiss();
      }}
    >
      <section
        aria-labelledby="fi-exec-sheet-title"
        aria-modal="true"
        className="fi-exec-sheet"
        role="dialog"
        onPaste={handlePaste}
        onDragOver={(event) => {
          if (allowPhotos) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!allowPhotos) return;
          event.preventDefault();
          appendFiles(Array.from(event.dataTransfer?.files ?? []));
        }}
      >
        <header className="fi-exec-sheet-head">
          <div>
            <h2 id="fi-exec-sheet-title">Tiến độ thực hiện</h2>
            <p>{activeRecord.sk_code || activeRecord.title}</p>
          </div>
          <button aria-label="Đóng" className="fi-exec-sheet-close" disabled={saving} onClick={dismiss} type="button">
            <X size={16} />
          </button>
        </header>

        <div className="fi-exec-segmented" role="radiogroup" aria-label="Tình trạng">
          {(
            [
              ["in_progress", "Đang thực hiện"],
              ["completed", "Đã hoàn thành"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-checked={status === value}
              className={status === value ? "is-selected" : ""}
              disabled={locked}
              key={value}
              onClick={() => {
                setStatus(value);
                setError("");
              }}
              role="radio"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="fi-exec-group">
          <label className="fi-exec-row" htmlFor="fi-exec-date">
            <span>{status === "completed" ? "Ngày hoàn thành" : "Dự kiến xong"}</span>
            {status === "completed" ? (
              <input
                disabled={locked}
                id="fi-exec-date"
                max={today}
                onChange={(event) => setCompletedDate(event.target.value)}
                type="date"
                value={completedDate}
              />
            ) : (
              <input
                disabled={locked}
                id="fi-exec-date"
                min={isApproved ? tomorrowIsoDate() : today}
                onChange={(event) => setPlannedDate(event.target.value)}
                type="date"
                value={plannedDate}
              />
            )}
          </label>

          {allowPhotos && (
            <div className="fi-exec-row fi-exec-photos">
              <span>Ảnh</span>
              <div className="fi-exec-photo-strip">
                {stagedFiles.map((entry) => (
                  <div className={`fi-exec-photo is-${entry.status}`} key={entry.id}>
                    <img alt={entry.file.name} src={entry.previewUrl} />
                    {entry.status === "uploading" && <Loader2 className="icon-spin" size={14} />}
                    {entry.status !== "done" && entry.status !== "uploading" && !saving && (
                      <button
                        aria-label={`Bỏ ảnh ${entry.file.name}`}
                        onClick={() => removeStagedFile(entry.id)}
                        type="button"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  aria-label="Thêm ảnh"
                  className="fi-exec-photo-add"
                  disabled={saving}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <Plus size={18} />
                </button>
              </div>
              <input
                accept="image/*,.heic,.heif,.jfif,.bmp,.tif,.tiff,.avif"
                hidden
                multiple
                onChange={(event) => {
                  appendFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
                ref={fileInputRef}
                type="file"
              />
            </div>
          )}
        </div>

        {error && (
          <p className="fi-exec-sheet-error" role="alert">
            {error}
            {conflict && (
              <button className="link-button" onClick={() => void reloadLatest()} type="button">
                Tải lại
              </button>
            )}
          </p>
        )}

        <footer className="fi-exec-sheet-actions">
          <button className="fi-exec-btn is-plain" disabled={saving} onClick={dismiss} type="button">
            {executionSaved ? "Đóng" : "Hủy"}
          </button>
          <button className="fi-exec-btn is-filled" disabled={saving} onClick={() => void handleSave()} type="button">
            {saving ? <Loader2 className="icon-spin" size={15} /> : hasFailedPhotos ? "Thử lại" : "Lưu"}
          </button>
        </footer>
      </section>
    </div>
  );
}
