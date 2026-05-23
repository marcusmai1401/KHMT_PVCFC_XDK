import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  Flag,
  History,
  ImagePlus,
  RefreshCw,
  Send,
  Trash2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { api } from "../../api/client";

const TEAM_ROLE = "Team_Account";
const FI_TEAMS = ["TBCH", "TBĐL", "TBHTĐK", "TCĐK"];
const REVIEWER_ROLES = ["Admin", "FI_Coordinator", "Workshop_Leader"];
const REVIEWABLE_STATUSES = ["Submitted", "Reviewed", "Deferred"];

const statusLabels: Record<string, string> = {
  Draft: "Chưa gửi duyệt",
  Submitted: "Chờ xét duyệt",
  NeedMoreInfo: "Cần bổ sung",
  Reviewed: "Đã xem xét",
  Approved: "Đã phê duyệt",
  Rejected: "Từ chối",
  Deferred: "Xem xét sau",
  Cancelled: "Đã hủy",
  Completed: "Hoàn tất",
};

const importedStatusLabels: Record<string, string> = {
  Approved: "Đồng ý",
  Submitted: "Chờ xét duyệt",
  Rejected: "Không đồng ý",
  Deferred: "Xem xét sau",
  Completed: "Hoàn tất",
};

type FITab = "register" | "history";
type HistoryMonthGroup = { key: string; month: number | null; year: number; items: any[] };

function displayStatus(value: string) {
  return statusLabels[value] ?? value;
}

function displayImportedStatus(value: string) {
  return importedStatusLabels[value] ?? displayStatus(value);
}

function displayHistoryStatus(item: any) {
  return item.is_historical_import ? displayImportedStatus(item.status) : displayStatus(item.status);
}

function registrationInfo(item: any) {
  const history = Array.isArray(item.status_history) ? item.status_history : [];
  const comments = history[0]?.comments ?? {};
  const month = Number(comments.registration_month);
  const year = Number(comments.registration_year ?? item.khmt_year ?? 2026) || 2026;
  if (Number.isFinite(month) && month >= 1 && month <= 12) return { month, year };
  if (item.created_at) {
    const date = new Date(item.created_at);
    if (!Number.isNaN(date.getTime())) return { month: date.getMonth() + 1, year: date.getFullYear() };
  }
  return { month: null, year };
}

function registrationMonthValue(item: any) {
  return registrationInfo(item).month;
}

function registrationMonthLabel(item: any) {
  const { month, year } = registrationInfo(item);
  return month ? `T${month}/${year}` : "Chưa rõ tháng";
}

function statusTone(status: string) {
  if (["Approved", "Completed"].includes(status)) return "success";
  if (["Submitted", "Reviewed"].includes(status)) return "info";
  if (["NeedMoreInfo", "Deferred"].includes(status)) return "warning";
  if (["Rejected", "Cancelled"].includes(status)) return "danger";
  return "neutral";
}

function historyActionLabel(history: any) {
  if (!history.from_status && history.to_status === "Draft") return "Ghi nhận đăng ký";
  if (!history.from_status) return displayStatus(history.to_status);
  return `${displayStatus(history.from_status)} → ${displayStatus(history.to_status)}`;
}

function actorLabel(actor: string | null | undefined) {
  if (!actor) return "Hệ thống";
  const labels: Record<string, string> = {
    admin: "Quản trị",
    fi: "Đầu mối SK",
    leader: "Lãnh đạo Xưởng",
    test: "Tài khoản kiểm thử",
    "historical-import": "Dữ liệu lịch sử",
  };
  return labels[actor] ?? actor;
}

function historyDetail(history: any) {
  const reason = typeof history.reason === "string" ? history.reason.trim() : "";
  const comments = typeof history.comments === "string" ? history.comments.trim() : "";
  if (reason === "web_registration") {
    return { label: "Nguồn ghi nhận", text: "Đăng ký trên hệ thống" };
  }
  if (comments) {
    return { label: "Nhận xét", text: comments };
  }
  if (!reason) return null;
  if (history.to_status === "Rejected") return { label: "Lý do từ chối", text: reason };
  if (history.to_status === "NeedMoreInfo") return { label: "Yêu cầu bổ sung", text: reason };
  if (["Approved", "Completed"].includes(history.to_status)) return { label: "Ghi chú quyết định", text: reason };
  return { label: "Ghi chú", text: reason };
}

function formatHistoryTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function visibleActionsForSk(role: string, currentUserId: string, item: any): string[] {
  const actions: string[] = [];
  const reviewableStatuses = item.is_historical_import ? ["Submitted", "Deferred"] : REVIEWABLE_STATUSES;
  const canSubmit =
    !item.is_historical_import &&
    (role === "Admin" || (role === TEAM_ROLE && item.author_user_id === currentUserId)) &&
    ["Draft", "NeedMoreInfo"].includes(item.status);
  const canApprove = REVIEWER_ROLES.includes(role) && reviewableStatuses.includes(item.status);
  const canReject = REVIEWER_ROLES.includes(role) && reviewableStatuses.includes(item.status);
  const canAssign = !item.is_historical_import && role === "Admin" && ["Approved", "Completed"].includes(item.status);
  const canDelete =
    !item.is_historical_import &&
    (role === "Admin" ||
      (role === TEAM_ROLE && item.author_user_id === currentUserId && item.status === "Draft"));
  if (canSubmit) actions.push("submit");
  if (canApprove) actions.push("approve");
  if (canReject) actions.push("reject");
  if (canAssign) actions.push("assignKhmt");
  if (canDelete) actions.push("delete");
  return actions;
}

const isReviewerRole = (role: string) => ["FI_Coordinator", "Workshop_Leader"].includes(role);

function canUploadImages(role: string, currentUserId: string, item: any) {
  if (item.is_historical_import) return false;
  return (
    role === "Admin" ||
    (role === TEAM_ROLE && item.author_user_id === currentUserId && ["Draft", "NeedMoreInfo"].includes(item.status))
  );
}

function AuthenticatedSkImage({ skId, image, onOpen }: { skId: string; image: any; onOpen: () => void }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setSrc("");
    setFailed(false);
    api.getSkImageBlob(skId, image.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) {
          setSrc("");
          setFailed(true);
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [skId, image.id]);

  if (failed) {
    return (
      <div className="image-placeholder">
        Không hiển thị được ảnh
      </div>
    );
  }
  if (!src) return <div className="image-placeholder">Đang tải ảnh...</div>;
  return (
    <button className="image-thumb" onClick={onOpen} type="button">
      <img
        src={src}
        alt={image.file_name}
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function SkImageViewer({
  skId,
  images,
  index,
  canDelete,
  onClose,
  onIndexChange,
  onDelete,
}: {
  skId: string;
  images: any[];
  index: number;
  canDelete: boolean;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onDelete: (imageId: string) => void;
}) {
  const image = images[index];
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const hasMultiple = images.length > 1;

  useEffect(() => {
    if (!image) {
      setSrc("");
      setFailed(false);
      return;
    }
    let active = true;
    let objectUrl = "";
    setSrc("");
    setFailed(false);
    api.getSkImageBlob(skId, image.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [skId, image?.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (!hasMultiple) return;
      if (event.key === "ArrowLeft") onIndexChange((index - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") onIndexChange((index + 1) % images.length);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasMultiple, images.length, index, onClose, onIndexChange]);

  if (!image) return null;

  const previous = () => onIndexChange((index - 1 + images.length) % images.length);
  const next = () => onIndexChange((index + 1) % images.length);

  return (
    <div className="image-viewer-backdrop" role="dialog" aria-modal="true" aria-label="Xem ảnh bằng chứng">
      <div className="image-viewer">
        <div className="image-viewer-toolbar">
          <strong>{image.file_name}</strong>
          <div>
            {canDelete && (
              <button
                title="Xóa ảnh"
                type="button"
                onClick={() => {
                  onDelete(image.id);
                  onClose();
                }}
              >
                <Trash2 size={16} />
                Xóa ảnh
              </button>
            )}
            <button title="Đóng" type="button" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="image-viewer-stage">
          {hasMultiple ? (
            <button className="image-viewer-nav" onClick={previous} title="Ảnh trước" type="button">
              <ChevronLeft size={22} />
            </button>
          ) : (
            <span />
          )}
          {failed ? (
            <div className="image-placeholder">Không hiển thị được ảnh</div>
          ) : src ? (
            <img src={src} alt={image.file_name} onError={() => setFailed(true)} />
          ) : (
            <div className="image-placeholder">Đang tải ảnh...</div>
          )}
          {hasMultiple ? (
            <button className="image-viewer-nav" onClick={next} title="Ảnh sau" type="button">
              <ChevronRight size={22} />
            </button>
          ) : (
            <span />
          )}
        </div>
        {hasMultiple && <small>{index + 1}/{images.length}</small>}
      </div>
    </div>
  );
}

export function FIWorkspace({ role, currentUserId }: { role: string; currentUserId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [historyTeam, setHistoryTeam] = useState("TBCH");
  const [historyMonths, setHistoryMonths] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<FITab>("register");
  const [form, setForm] = useState(() => {
    const today = new Date();
    return {
      author_name: "Nguyễn Văn A",
      team: "TBCH",
      title: "Cải tiến quy trình kiểm tra thiết bị",
      content_description: "Hiện trạng, giải pháp và hiệu quả dự kiến",
      completion_plan: "T6/2026",
      registration_month: today.getMonth() + 1,
      registration_year: today.getFullYear(),
    };
  });
  const [error, setError] = useState("");
  const [actionTarget, setActionTarget] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [actionNote, setActionNote] = useState("");
  const draftFileInputRef = useRef<HTMLInputElement>(null);
  const detailFileInputRef = useRef<HTMLInputElement>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  const reload = () => {
    Promise.all([api.listSk(), api.publicSk({ team: historyTeam })])
      .then(([privateList, historyList]) => {
        setItems(privateList.filter((item) => !item.is_historical_import));
        setHistoryItems(historyList.filter((item) => item.team === historyTeam));
        setError("");
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    reload();
  }, [role, historyTeam]);

  useEffect(() => {
    setImagePreviewIndex(null);
  }, [selectedItem?.id]);

  const reloadDetail = (id: string) => {
    api.getSk(id).then(setSelectedItem).catch((err) => setError(err.message));
  };

  const create = async () => {
    if (creating) return;
    const payload = role === TEAM_ROLE ? { ...form, team: currentUserId } : form;
    const filesToUpload = [...evidenceFiles];
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const created = await api.createSk(payload);
      const uploadResults = await Promise.allSettled(
        filesToUpload.map((file) => api.uploadSkImage(created.id, file))
      );
      const failedFiles = filesToUpload.filter((_, index) => uploadResults[index].status === "rejected");
      setEvidenceFiles(failedFiles);
      reload();
      reloadDetail(created.id);
      if (failedFiles.length > 0) {
        setError(`Đã lưu đăng ký nhưng ${failedFiles.length}/${filesToUpload.length} ảnh chưa tải lên được. Có thể thử tải lại trong phần chi tiết hồ sơ.`);
      } else {
        setNotice(filesToUpload.length > 0 ? `Đã lưu đăng ký và tải lên ${filesToUpload.length} ảnh bằng chứng.` : "Đã lưu đăng ký.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const transition = (id: string, action: string, payload: any = {}) => {
    api.transitionSk(id, action, payload)
      .then(() => {
        reload();
        if (selectedItem?.id === id) reloadDetail(id);
      })
      .catch((err) => setError(err.message));
  };

  const openItem = (id: string) => {
    if (selectedItem?.id === id) {
      setSelectedItem(null);
      setError("");
      return;
    }
    api.getSk(id)
      .then((item) => {
        setSelectedItem(item);
        setError("");
      })
      .catch((err) => setError(err.message));
  };

  const selectTab = (tab: FITab) => {
    setActiveTab(tab);
    setActionTarget(null);
    setSelectedItem(null);
  };

  const selectHistoryTeam = (team: string) => {
    setHistoryTeam(team);
    setHistoryMonths([]);
    setSelectedItem(null);
  };

  const toggleHistoryMonth = (month: number) => {
    setHistoryMonths((current) =>
      current.includes(month)
        ? current.filter((value) => value !== month)
        : [...current, month].sort((a, b) => b - a)
    );
    setSelectedItem(null);
  };

  const openHistoryItem = (item: any) => {
    setSelectedItem((current: any) => current?.id === item.id ? null : item);
    setError("");
  };

  const handleAction = () => {
    if (!actionTarget) return;
    if (actionTarget.action === "reject" && !actionNote.trim()) {
      setError("Cần nhập lý do từ chối");
      return;
    }
    transition(actionTarget.id, actionTarget.action, actionNote.trim() ? { note: actionNote } : {});
    setActionTarget(null);
    setActionNote("");
  };

  const handleDraftImageSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setError("");
      setNotice("");
      setEvidenceFiles((current) => [...current, ...files]);
    }
    e.target.value = "";
  };

  const uploadImagesForItem = async (skId: string, files: File[]) => {
    if (files.length === 0 || uploadingImages) return;
    setUploadingImages(true);
    setError("");
    setNotice("");
    try {
      const results = await Promise.allSettled(files.map((file) => api.uploadSkImage(skId, file)));
      const failedCount = results.filter((result) => result.status === "rejected").length;
      reload();
      reloadDetail(skId);
      if (failedCount > 0) {
        const firstError = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
        setError(`Có ${failedCount}/${files.length} ảnh chưa tải lên được${firstError?.reason?.message ? `: ${firstError.reason.message}` : "."}`);
      } else {
        setNotice(`Đã tải lên ${files.length} ảnh bằng chứng.`);
      }
    } finally {
      setUploadingImages(false);
    }
  };

  const handleDetailImageSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const skId = selectedItem?.id;
    e.target.value = "";
    if (!skId || files.length === 0) return;
    uploadImagesForItem(skId, files);
  };

  const handleDeleteImage = (skId: string, imageId: string) => {
    api.deleteSkImage(skId, imageId)
      .then(() => {
        if (selectedItem?.id === skId) reloadDetail(skId);
      })
      .catch((err) => setError(err.message));
  };

  const handleDelete = (id: string) => {
    if (!confirm("Xác nhận xóa SK-CTKT này?")) return;
    api.deleteSk(id)
      .then(() => {
        if (selectedItem?.id === id) setSelectedItem(null);
        setNotice("Đã xóa hồ sơ SK-CTKT.");
        reload();
      })
      .catch((err) => setError(err.message));
  };

  const showForm = !isReviewerRole(role);
  const selectedImages = Array.isArray(selectedItem?.supporting_images) ? selectedItem.supporting_images : [];
  const selectedHistory = Array.isArray(selectedItem?.status_history) ? selectedItem.status_history : [];
  const canUploadForSelected = selectedItem ? canUploadImages(role, currentUserId, selectedItem) : false;
  const historyMonthCounts = historyItems.reduce<Map<number, number>>((monthCounts, item) => {
    const month = registrationMonthValue(item);
    if (month) monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    return monthCounts;
  }, new Map<number, number>());
  const historyMonthOptions = Array.from(historyMonthCounts.entries()).sort((a, b) => b[0] - a[0]);
  const selectedHistoryMonthSet = new Set(historyMonths);
  const filteredHistoryItems = historyItems
    .filter((item) => historyMonths.length === 0 || selectedHistoryMonthSet.has(registrationMonthValue(item) ?? -1))
    .sort((a, b) =>
      (registrationMonthValue(b) ?? 0) - (registrationMonthValue(a) ?? 0) ||
      (a.bm01_source_row ?? 0) - (b.bm01_source_row ?? 0)
    );
  const groupedHistoryItems = filteredHistoryItems.reduce<HistoryMonthGroup[]>((groups, item) => {
    const { month, year } = registrationInfo(item);
    const groupKey = `${year}-${month ?? "unknown"}`;
    const existingGroup = groups.find((group) => group.key === groupKey);
    if (existingGroup) {
      existingGroup.items.push(item);
    } else {
      groups.push({ key: groupKey, month, year, items: [item] });
    }
    return groups;
  }, []);

  return (
    <div className="content-grid">
      <input
        ref={draftFileInputRef}
        type="file"
        accept="image/*,.heic,.heif,.jfif,.bmp,.tif,.tiff,.avif"
        multiple
        style={{ display: "none" }}
        onChange={handleDraftImageSelection}
      />
      <input
        ref={detailFileInputRef}
        type="file"
        accept="image/*,.heic,.heif,.jfif,.bmp,.tif,.tiff,.avif"
        multiple
        style={{ display: "none" }}
        onChange={handleDetailImageSelection}
      />

      <div className="fi-workspace-tabs" role="tablist" aria-label="Luồng SK-CTKT">
        <div className="segmented-control">
          <button
            aria-selected={activeTab === "register"}
            className={activeTab === "register" ? "active" : ""}
            onClick={() => selectTab("register")}
            role="tab"
            type="button"
          >
            Đăng ký SK-CTKT
          </button>
          <button
            aria-selected={activeTab === "history"}
            className={activeTab === "history" ? "active" : ""}
            onClick={() => selectTab("history")}
            role="tab"
            type="button"
          >
            Lịch sử FI
          </button>
        </div>
      </div>

      {actionTarget && (
        <section className="panel wide fi-action-panel">
          <h2>{actionTarget.action === "approve" ? "Phê duyệt SK-CTKT" : "Từ chối SK-CTKT"}</h2>
          <div className="form-stack">
            <label>
              Ghi chú {actionTarget.action === "reject" && <span style={{ color: "red" }}>*</span>}
              {actionTarget.action === "approve" && <span className="muted"> (tùy chọn)</span>}
            </label>
            <textarea
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
              placeholder={actionTarget.action === "approve" ? "Nhập ghi chú (nếu có)..." : "Nhập lý do từ chối..."}
              rows={3}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleAction}>
                {actionTarget.action === "approve" ? <Check size={17} /> : <XCircle size={17} />}
                {actionTarget.action === "approve" ? "Xác nhận phê duyệt" : "Xác nhận từ chối"}
              </button>
              <button onClick={() => { setActionTarget(null); setActionNote(""); }}>
                Hủy
              </button>
            </div>
          </div>
        </section>
      )}

      {activeTab === "register" && (
        <>
      <div className={`fi-register-layout ${showForm ? "" : "single"}`}>
      {showForm && (
        <section className="panel fi-form-panel">
          <h2>Đăng ký SK-CTKT</h2>
          <div className="form-stack">
            <input value={form.author_name} onChange={(e) => setForm({ ...form, author_name: e.target.value })} />
            {role === TEAM_ROLE ? (
              <input value={currentUserId} readOnly aria-label="Đội/tổ" />
            ) : (
              <select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
                {FI_TEAMS.map((team) => (
                  <option key={team}>{team}</option>
                ))}
              </select>
            )}
            <div className="period-selector fi-registration-period">
              <label htmlFor="fi-registration-month">Tháng đăng ký</label>
              <select
                id="fi-registration-month"
                value={form.registration_month}
                onChange={(e) => setForm({ ...form, registration_month: Number(e.target.value) })}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>T{month}</option>
                ))}
              </select>
              <input
                aria-label="Năm đăng ký"
                max={2100}
                min={2020}
                type="number"
                value={form.registration_year}
                onChange={(e) => setForm({ ...form, registration_year: Number(e.target.value) || new Date().getFullYear() })}
              />
            </div>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <textarea value={form.content_description} onChange={(e) => setForm({ ...form, content_description: e.target.value })} />
            <input value={form.completion_plan} onChange={(e) => setForm({ ...form, completion_plan: e.target.value })} />
            <label>
              Ảnh bằng chứng FI <span className="muted">(tùy chọn)</span>
            </label>
            <button type="button" onClick={() => draftFileInputRef.current?.click()}>
              <ImagePlus size={16} />
              Chọn ảnh
            </button>
            {evidenceFiles.length > 0 && (
              <div className="evidence-file-list">
                <small className="muted">{evidenceFiles.length} ảnh sẽ được tải lên sau khi lưu đăng ký.</small>
                {evidenceFiles.map((file, index) => (
                  <div className="evidence-file-row" key={`${file.name}-${file.lastModified}-${index}`}>
                    <span>{file.name}</span>
                    <button
                      title="Xóa file đã chọn"
                      type="button"
                      onClick={() => setEvidenceFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={create} disabled={creating}>
              <ClipboardCheck size={17} />
              {creating ? "Đang lưu đăng ký..." : "Lưu đăng ký"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {notice && <p className="success">{notice}</p>}
        </section>
      )}

      <section className="panel fi-processing-panel">
        <div className="panel-header">
          <h2>Danh sách xử lý</h2>
          <button onClick={reload} title="Tải lại danh sách">
            <RefreshCw size={17} />
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="list">
          {items.map((item) => {
            const actions = visibleActionsForSk(role, currentUserId, item);
            return (
              <div className={`workflow-item ${selectedItem?.id === item.id ? "active-row" : ""}`} key={item.id}>
                <button className="workflow-main" onClick={() => openItem(item.id)} type="button">
                  <strong>{item.sk_code}</strong>
                  <span>{item.title}</span>
                  <small>{item.author_name} · {item.team}</small>
                  <small>
                    {displayStatus(item.status)}
                    {item.submitted_at && item.status === "Submitted" && ` · gửi ${new Date(item.submitted_at).toLocaleDateString("vi-VN")}`}
                  </small>
                </button>
                <div className="toolbar">
                  {actions.includes("submit") && (
                    <button title="Gửi duyệt" onClick={() => transition(item.id, "submit")}>
                      <Send size={16} />
                    </button>
                  )}
                  {actions.includes("approve") && (
                    <button title="Phê duyệt" onClick={() => { setActionTarget({ id: item.id, action: "approve" }); setActionNote(""); }}>
                      <Check size={16} />
                    </button>
                  )}
                  {actions.includes("reject") && (
                    <button title="Từ chối" onClick={() => { setActionTarget({ id: item.id, action: "reject" }); setActionNote(""); }}>
                      <XCircle size={16} />
                    </button>
                  )}
                  {actions.includes("assignKhmt") && (
                    <button title="Ghi nhận KHMT tháng 4/2026" onClick={() => api.assignKhmt(item.id, 4, 2026).then(reload)}>
                      T4
                    </button>
                  )}
                  {actions.includes("delete") && (
                    <button title="Xóa SK" onClick={() => handleDelete(item.id)}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {items.length === 0 && <p className="muted">Không có SK nào cần xử lý.</p>}
        </div>
      </section>
      </div>

      {selectedItem && !selectedItem.is_historical_import && (
        <section className="panel wide fi-detail-card">
          <div className="fi-detail-header">
            <div className="fi-detail-title">
              <div className="fi-detail-code-line">
                <h2>{selectedItem.sk_code}</h2>
                <span className={`fi-status-pill ${statusTone(selectedItem.status)}`}>
                  {displayStatus(selectedItem.status)}
                </span>
              </div>
              <p>{selectedItem.team}</p>
            </div>
            <div className="fi-detail-actions">
            {canUploadForSelected && (
              <button
                className="fi-detail-action"
                title="Tải ảnh bằng chứng"
                type="button"
                disabled={uploadingImages}
                onClick={() => detailFileInputRef.current?.click()}
              >
                <ImagePlus size={17} />
                {uploadingImages ? "Đang tải..." : "Thêm ảnh"}
              </button>
            )}
              <button
                className="fi-detail-action secondary"
                title="Thu gọn chi tiết"
                type="button"
                onClick={() => setSelectedItem(null)}
              >
                <ChevronUp size={17} />
                Thu gọn
              </button>
            </div>
          </div>

          <div className="fi-detail-meta">
            <div className="fi-meta-item">
              <UserRound size={17} />
              <span>Tác giả</span>
              <strong>{selectedItem.author_name}</strong>
            </div>
            <div className="fi-meta-item">
              <CalendarDays size={17} />
              <span>Tháng đăng ký</span>
              <strong>{registrationMonthLabel(selectedItem)}</strong>
            </div>
            <div className="fi-meta-item">
              <Flag size={17} />
              <span>Kế hoạch hoàn thành</span>
              <strong>{selectedItem.completion_plan}</strong>
            </div>
            <div className="fi-meta-item">
              <ClipboardCheck size={17} />
              <span>KHMT</span>
              <strong>{selectedItem.khmt_month ? `T${selectedItem.khmt_month}/${selectedItem.khmt_year}` : "Chưa ghi KHMT"}</strong>
            </div>
          </div>

          <div className="fi-detail-content">
            <div className="fi-content-section primary">
              <span className="fi-section-label">Tên SK-CTKT</span>
              <h3>{selectedItem.title}</h3>
              <span className="fi-section-label">Nội dung đăng ký</span>
              <p>{selectedItem.content_description || "Chưa có mô tả nội dung."}</p>
            </div>
            {(selectedItem.fi_coordinator_comments || selectedItem.workshop_leader_conclusion || selectedItem.decision_note) && (
              <div className="fi-content-section notes">
                <h3>Ghi chú và kết luận</h3>
                {selectedItem.fi_coordinator_comments && (
                  <div>
                    <span>Nhận xét FI</span>
                    <p>{selectedItem.fi_coordinator_comments}</p>
                  </div>
                )}
                {selectedItem.workshop_leader_conclusion && (
                  <div>
                    <span>Kết luận LĐX</span>
                    <p>{selectedItem.workshop_leader_conclusion}</p>
                  </div>
                )}
                {selectedItem.decision_note && (
                  <div>
                    <span>Ghi chú quyết định</span>
                    <p>{selectedItem.decision_note}</p>
                  </div>
                )}
              </div>
            )}
            {selectedHistory.length > 0 && (
              <div className="fi-content-section timeline">
                <div className="fi-section-heading">
                  <History size={17} />
                  <h3>Lịch sử xử lý</h3>
                </div>
                <div className="fi-timeline">
                  {selectedHistory.map((history: any, index: number) => {
                    const detail = historyDetail(history);
                    const time = formatHistoryTime(history.changed_at);
                    return (
                      <div className="fi-timeline-item" key={`${history.changed_at}-${index}`}>
                        <span className="fi-timeline-dot" />
                        <div>
                          <div className="fi-timeline-row">
                            <strong>{historyActionLabel(history)}</strong>
                            {time && <time>{time}</time>}
                          </div>
                          <p className="fi-timeline-actor">
                            <span>Người thực hiện</span>
                            <strong>{actorLabel(history.changed_by)}</strong>
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
          {(selectedImages.length > 0 || canUploadForSelected) && (
            <div className="image-list">
              <h3>Ảnh bằng chứng ({selectedImages.length})</h3>
              {selectedImages.length === 0 && (
                <div className="image-empty">
                  <span>Chưa có ảnh bằng chứng.</span>
                  {canUploadForSelected && (
                    <button type="button" onClick={() => detailFileInputRef.current?.click()} disabled={uploadingImages}>
                      <ImagePlus size={16} />
                      {uploadingImages ? "Đang tải..." : "Thêm ảnh"}
                    </button>
                  )}
                </div>
              )}
              <div className="image-card-grid">
                {selectedImages.map((img: any, index: number) => (
                  <div className="image-card" key={img.id}>
                    <AuthenticatedSkImage skId={selectedItem.id} image={img} onOpen={() => setImagePreviewIndex(index)} />
                    <small title={img.file_name}>{img.file_name}</small>
                    {canUploadForSelected && (
                      <button
                        className="image-card-delete"
                        title="Xóa ảnh"
                        onClick={() => handleDeleteImage(selectedItem.id, img.id)}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {imagePreviewIndex !== null && selectedImages[imagePreviewIndex] && (
            <SkImageViewer
              canDelete={canUploadForSelected}
              images={selectedImages}
              index={imagePreviewIndex}
              onClose={() => setImagePreviewIndex(null)}
              onDelete={(imageId) => handleDeleteImage(selectedItem.id, imageId)}
              onIndexChange={setImagePreviewIndex}
              skId={selectedItem.id}
            />
          )}
        </section>
      )}

        </>
      )}

      {activeTab === "history" && (
      <section className="panel wide legacy-sk-panel">
        <div className="legacy-sticky-controls">
          <div className="panel-header">
            <div>
              <h2>Lịch sử FI</h2>
              <p className="muted">{historyTeam} · {historyItems.length} SK-CTKT đã ghi nhận</p>
            </div>
            <div className="toolbar">
              <div className="segmented-control legacy-team-picker" aria-label="Chọn đội/tổ">
                {FI_TEAMS.map((team) => (
                  <button
                    className={historyTeam === team ? "active" : ""}
                    key={team}
                    onClick={() => selectHistoryTeam(team)}
                    type="button"
                  >
                    {team}
                  </button>
                ))}
              </div>
              <button onClick={reload} title="Tải lại lịch sử FI">
                <RefreshCw size={17} />
              </button>
            </div>
          </div>
          <div className="legacy-filter-tier" aria-label="Lọc lịch sử FI">
            <div className="legacy-filter-line">
              <span className="filter-label">Đội/tổ</span>
              <strong>{historyTeam}</strong>
            </div>
            <div className="legacy-filter-line">
              <span className="filter-label">Tháng</span>
              <div className="legacy-month-ticks">
                <button
                  className={historyMonths.length === 0 ? "active" : ""}
                  onClick={() => {
                    setHistoryMonths([]);
                    setSelectedItem(null);
                  }}
                  type="button"
                >
                  <span className="tick-box" aria-hidden="true">{historyMonths.length === 0 ? "✓" : ""}</span>
                  Tất cả
                  <small>{historyItems.length}</small>
                </button>
                {historyMonthOptions.map(([month, count]) => {
                  const active = historyMonths.includes(month);
                  return (
                    <button
                      className={active ? "active" : ""}
                      key={month}
                      onClick={() => toggleHistoryMonth(month)}
                      type="button"
                    >
                      <span className="tick-box" aria-hidden="true">{active ? "✓" : ""}</span>
                      T{month}
                      <small>{count}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="legacy-list">
          {groupedHistoryItems.map((group) => (
            <div className="legacy-month-group" key={group.key}>
              <div className="legacy-month-heading">
                <h3>{group.month ? `T${group.month}/${group.year}` : "Chưa rõ tháng"}</h3>
                <span>{group.items.length} SK-CTKT</span>
              </div>
              {group.items.map((item) => {
                const isOpen = selectedItem?.id === item.id;
                const actions = visibleActionsForSk(role, currentUserId, item);
                return (
                <div className="legacy-record" key={item.id}>
                  <div className={`legacy-row ${isOpen ? "active-row" : ""}`}>
                    <button
                      aria-expanded={isOpen}
                      className="legacy-row-main legacy-row-toggle"
                      onClick={() => openHistoryItem(item)}
                      type="button"
                    >
                      <div className="legacy-row-head">
                        <strong>{item.title}</strong>
                      </div>
                      <div className="legacy-row-subtitle">
                        <span>{item.author_name}</span>
                      </div>
                      <div className="legacy-row-meta">
                        <small>Kế hoạch: {item.completion_plan || "Chưa ghi"}</small>
                        {item.khmt_month && <small>KHMT T{item.khmt_month}/{item.khmt_year}</small>}
                      </div>
                    </button>
                    <div className="legacy-row-side">
                      <span className="legacy-period-pill">{registrationMonthLabel(item)}</span>
                      <div className="legacy-status-stack">
                        <span className="legacy-decision-label">Kết luận của LĐX</span>
                        <span className={`legacy-status-pill ${statusTone(item.status)}`}>{displayHistoryStatus(item)}</span>
                      </div>
                      <div className="legacy-row-controls">
                        {actions.includes("approve") && (
                          <button
                            className="legacy-icon-action"
                            title="Phê duyệt"
                            onClick={() => { setActionTarget({ id: item.id, action: "approve" }); setActionNote(""); }}
                            type="button"
                          >
                            <Check size={15} />
                          </button>
                        )}
                        {actions.includes("reject") && (
                          <button
                            className="legacy-icon-action"
                            title="Từ chối"
                            onClick={() => { setActionTarget({ id: item.id, action: "reject" }); setActionNote(""); }}
                            type="button"
                          >
                            <XCircle size={15} />
                          </button>
                        )}
                        <button className="legacy-row-action" onClick={() => openHistoryItem(item)} type="button">
                          {isOpen ? "Thu gọn" : "Xem chi tiết"}
                        </button>
                      </div>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="legacy-inline-detail">
                      <div className="detail-grid">
                        <div>
                          <span>Tác giả</span>
                          <strong>{item.author_name}</strong>
                        </div>
                        <div>
                          <span>Kế hoạch hoàn thành</span>
                          <strong>{item.completion_plan || "Chưa ghi"}</strong>
                        </div>
                        <div>
                          <span>Trạng thái</span>
                          <strong>{displayHistoryStatus(item)}</strong>
                        </div>
                        <div>
                          <span>Tháng đăng ký</span>
                          <strong>{registrationMonthLabel(item)}</strong>
                        </div>
                      </div>
                      <div className="legacy-expanded-content">
                        <section>
                          <span>Nội dung đăng ký</span>
                          <p>{item.content_description || "Chưa có mô tả nội dung."}</p>
                        </section>
                        {(item.fi_coordinator_comments || item.bm01_raw_conclusion) && (
                          <section className="legacy-review-note">
                            <span>Xét duyệt</span>
                            <p>{item.fi_coordinator_comments || item.bm01_raw_conclusion}</p>
                          </section>
                        )}
                        {item.workshop_leader_conclusion && (
                          <section>
                            <span>Kết luận LĐX</span>
                            <p>{item.workshop_leader_conclusion}</p>
                          </section>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          ))}
          {historyItems.length === 0 && <p className="muted">Không có FI cho đội {historyTeam}.</p>}
          {historyItems.length > 0 && filteredHistoryItems.length === 0 && (
            <p className="muted">Không có FI cho tháng đang chọn.</p>
          )}
        </div>
      </section>
      )}

    </div>
  );
}
