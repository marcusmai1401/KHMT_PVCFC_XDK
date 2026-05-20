import { useEffect, useRef, useState } from "react";
import { Check, ClipboardCheck, ImagePlus, RefreshCw, Send, Trash2, XCircle } from "lucide-react";
import { api } from "../../api/client";

const TEAM_ROLE = "Team_Account";

const statusLabels: Record<string, string> = {
  Draft: "Nháp",
  Submitted: "Chờ đầu mối SK duyệt",
  NeedMoreInfo: "Cần bổ sung",
  Reviewed: "Đã xem xét",
  Approved: "Đã phê duyệt",
  Rejected: "Từ chối",
  Deferred: "Tạm hoãn",
  Cancelled: "Đã hủy",
  Completed: "Hoàn tất",
};

function displayStatus(value: string) {
  return statusLabels[value] ?? value;
}

export function visibleActionsForSk(role: string, currentUserId: string, item: any): string[] {
  const actions: string[] = [];
  const canSubmit =
    (role === "Admin" || (role === TEAM_ROLE && item.author_user_id === currentUserId)) &&
    ["Draft", "NeedMoreInfo"].includes(item.status);
  const canApprove = ["Admin", "FI_Coordinator"].includes(role) && ["Submitted", "Reviewed"].includes(item.status);
  const canReject = ["Admin", "FI_Coordinator"].includes(role) && ["Submitted", "Reviewed"].includes(item.status);
  const canAssign = role === "Admin" && ["Approved", "Completed"].includes(item.status);
  const canDelete =
    role === "Admin" ||
    (role === TEAM_ROLE && item.author_user_id === currentUserId && item.status === "Draft");
  if (canSubmit) actions.push("submit");
  if (canApprove) actions.push("approve");
  if (canReject) actions.push("reject");
  if (canAssign) actions.push("assignKhmt");
  if (canDelete) actions.push("delete");
  return actions;
}

const isReviewerRole = (role: string) => ["FI_Coordinator", "Workshop_Leader"].includes(role);

function canUploadImages(role: string, currentUserId: string, item: any) {
  return (
    role === "Admin" ||
    (role === TEAM_ROLE && item.author_user_id === currentUserId && ["Draft", "NeedMoreInfo"].includes(item.status))
  );
}

function AuthenticatedSkImage({ skId, image }: { skId: string; image: any }) {
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
        if (active) setSrc("");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [skId, image.id]);

  if (!src) return <div className="image-placeholder">Đang tải ảnh...</div>;
  if (failed) {
    return (
      <a className="image-placeholder" href={src} target="_blank" rel="noreferrer">
        Không hiển thị được ảnh. Mở ảnh
      </a>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer">
      <img
        src={src}
        alt={image.file_name}
        onError={() => setFailed(true)}
        style={{ maxWidth: 150, maxHeight: 150, display: "block" }}
      />
    </a>
  );
}

export function FIWorkspace({ role, currentUserId }: { role: string; currentUserId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [publicItems, setPublicItems] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [form, setForm] = useState({
    author_name: "Nguyễn Văn A",
    team: "TBCH",
    title: "Cải tiến quy trình kiểm tra thiết bị",
    content_description: "Hiện trạng, giải pháp và hiệu quả dự kiến",
    completion_plan: "T6/2026"
  });
  const [error, setError] = useState("");
  const [actionTarget, setActionTarget] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [actionNote, setActionNote] = useState("");
  const draftFileInputRef = useRef<HTMLInputElement>(null);
  const detailFileInputRef = useRef<HTMLInputElement>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [notice, setNotice] = useState("");

  const reload = () => {
    Promise.all([api.listSk(), api.publicSk()])
      .then(([privateList, publicList]) => {
        setItems(privateList);
        setPublicItems(publicList);
        setError("");
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    reload();
  }, [role]);

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
        setError(`Đã tạo bản nháp nhưng ${failedFiles.length}/${filesToUpload.length} ảnh chưa tải lên được. Có thể thử tải lại trong phần chi tiết bản nháp.`);
      } else {
        setNotice(filesToUpload.length > 0 ? `Đã tạo bản nháp và tải lên ${filesToUpload.length} ảnh bằng chứng.` : "Đã tạo bản nháp.");
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
    api.getSk(id)
      .then((item) => {
        setSelectedItem(item);
        setError("");
      })
      .catch((err) => setError(err.message));
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
        setNotice("Đã xóa bản nháp/SK.");
        reload();
      })
      .catch((err) => setError(err.message));
  };

  const showForm = !isReviewerRole(role);
  const selectedImages = Array.isArray(selectedItem?.supporting_images) ? selectedItem.supporting_images : [];
  const canUploadForSelected = selectedItem ? canUploadImages(role, currentUserId, selectedItem) : false;

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

      {showForm && (
        <section className="panel">
          <h2>Đăng ký SK-CTKT</h2>
          <div className="form-stack">
            <input value={form.author_name} onChange={(e) => setForm({ ...form, author_name: e.target.value })} />
            {role === TEAM_ROLE ? (
              <input value={currentUserId} readOnly aria-label="Đội/tổ" />
            ) : (
              <select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
                <option>TBHTĐK</option>
                <option>TBCH</option>
                <option>TBĐL</option>
                <option>TCĐK</option>
              </select>
            )}
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
                <small className="muted">{evidenceFiles.length} ảnh sẽ được tải lên sau khi tạo bản nháp.</small>
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
              {creating ? "Đang tạo bản nháp..." : "Tạo bản nháp"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {notice && <p className="success">{notice}</p>}
        </section>
      )}

      <section className="panel wide">
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

      {actionTarget && (
        <section className="panel wide">
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

      {selectedItem && (
        <section className="panel wide">
          <div className="panel-header">
            <div>
              <h2>{selectedItem.sk_code}</h2>
              <p className="muted">{selectedItem.team} · {displayStatus(selectedItem.status)}</p>
            </div>
            {canUploadForSelected && (
              <button
                title="Tải ảnh bằng chứng"
                type="button"
                disabled={uploadingImages}
                onClick={() => detailFileInputRef.current?.click()}
              >
                <ImagePlus size={17} />
                {uploadingImages ? "Đang tải..." : "Thêm ảnh"}
              </button>
            )}
          </div>
          <div className="detail-grid">
            <div>
              <span>Tác giả</span>
              <strong>{selectedItem.author_name}</strong>
            </div>
            <div>
              <span>Kế hoạch hoàn thành</span>
              <strong>{selectedItem.completion_plan}</strong>
            </div>
            <div>
              <span>KHMT</span>
              <strong>{selectedItem.khmt_month ? `T${selectedItem.khmt_month}/${selectedItem.khmt_year}` : "Chưa ghi KHMT"}</strong>
            </div>
          </div>
          <div className="detail-panel">
            <h2>{selectedItem.title}</h2>
            <p>{selectedItem.content_description}</p>
            {selectedItem.fi_coordinator_comments && <p><strong>Nhận xét FI:</strong> {selectedItem.fi_coordinator_comments}</p>}
            {selectedItem.workshop_leader_conclusion && <p><strong>Kết luận LĐX:</strong> {selectedItem.workshop_leader_conclusion}</p>}
            {selectedItem.decision_note && <p><strong>Ghi chú quyết định:</strong> {selectedItem.decision_note}</p>}
            {Array.isArray(selectedItem.status_history) && selectedItem.status_history.length > 0 && (
              <div className="history-list">
                {selectedItem.status_history.map((history: any, index: number) => (
                  <small key={`${history.changed_at}-${index}`}>
                    {displayStatus(history.from_status)} → {displayStatus(history.to_status)} · {history.changed_by}
                    {history.reason && <span> · {history.reason}</span>}
                  </small>
                ))}
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {selectedImages.map((img: any) => (
                  <div key={img.id} style={{ position: "relative", border: "1px solid #ddd", borderRadius: 4, padding: 4 }}>
                    <AuthenticatedSkImage skId={selectedItem.id} image={img} />
                    <small>{img.file_name}</small>
                    {canUploadForSelected && (
                      <button
                        title="Xóa ảnh"
                        onClick={() => handleDeleteImage(selectedItem.id, img.id)}
                        style={{ position: "absolute", top: 2, right: 2, background: "rgba(255,255,255,0.8)", border: "none", cursor: "pointer", padding: 2, borderRadius: 2 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Tất cả SK-CTKT</h2>
        <p className="muted" style={{ fontSize: "0.85em", marginBottom: 8 }}>
          Hiển thị các SK đã gửi duyệt trở lên để tránh trùng lặp giữa các đội tổ.
        </p>
        <div className="list">
          {publicItems.map((item) => (
            <div className="row-item" key={item.id}>
              <strong>{item.sk_code} · {item.title}</strong>
              <span>{item.author_name} · {item.team}</span>
              <small>{displayStatus(item.status)}{item.khmt_month ? ` · T${item.khmt_month}/${item.khmt_year}` : ""}</small>
            </div>
          ))}
          {publicItems.length === 0 && <p className="muted">Chưa có SK nào.</p>}
        </div>
      </section>
    </div>
  );
}
