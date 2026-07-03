import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  Copy,
  FileDown,
  FileUp,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
  X
} from "lucide-react";
import { api } from "../../api/client";

type Props = {
  role: string;
  currentUserId: string;
  editMode?: boolean;
  // Node trong topbar (do App cung cấp) để render hàng tab lên chung với tiêu đề.
  tabsHost?: HTMLElement | null;
};

type EtTab = "dashboard" | "frameworks" | "personnel" | "assessments" | "plans";

const categories = ["Cơ bản", "Trung cấp", "Nâng cao", "Nghiệp vụ hành chính"];

const emptyItemForm = () => ({
  id: "",
  nlcm_code: "",
  competency_name: "",
  competency_detail: "",
  definition: "",
  requirements_text: "",
  category: "Cơ bản",
  stt: 1,
  level_requirements: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [String(index + 1), 0]))
});

function canManage(role: string) {
  return role === "Admin";
}

function query(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function gapClass(gap: number | null | undefined, state?: string) {
  if (state === "not_applicable") return "gap-na";
  if (state === "excluded") return "gap-excluded";
  if (gap === null || gap === undefined) return "gap-empty";
  if (gap >= 0) return "gap-good";
  if (gap === -1) return "gap-warn";
  return "gap-bad";
}

function resultClass(value: string | null | undefined) {
  if (value === "Đạt") return "status status-ok";
  if (value === "Không đạt") return "status status-ng";
  return "status status-na";
}

const personnelRoleLabels: Record<string, string> = {
  Staff: "Nhân viên",
  Team_Account: "Đội trưởng",
  "Tổ trưởng": "Tổ trưởng",
  Workshop_Leader: "Quản đốc",
};

const personnelStatusLabels: Record<string, string> = {
  active: "Đang hoạt động",
  inactive: "Nghỉ việc",
  transferred: "Chuyển đi",
};

const personnelRoleOptions = [
  { value: "Workshop_Leader", label: "Quản đốc" },
  { value: "Team_Account", label: "Đội trưởng" },
  { value: "Tổ trưởng", label: "Tổ trưởng" },
  { value: "Staff", label: "Nhân viên" },
];

const personnelStatusOptions = [
  { value: "active", label: "Đang hoạt động" },
  { value: "inactive", label: "Nghỉ việc" },
  { value: "transferred", label: "Chuyển đi" },
];

function personnelRoleLabel(value: string | null | undefined) {
  if (!value) return "";
  return personnelRoleLabels[value] ?? value;
}

function personnelStatusLabel(value: string | null | undefined) {
  if (!value) return "";
  return personnelStatusLabels[value] ?? value;
}

function personnelStatusTone(value: string | null | undefined) {
  if (value === "active") return "active";
  if (value === "inactive") return "inactive";
  if (value === "transferred") return "transferred";
  return "unknown";
}

function normalizeSearchValue(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function personnelRoleTone(row: any) {
  const label = normalizeSearchValue(personnelRoleLabel(row.role || row.position_code));
  if (row.role === "Workshop_Leader" || label.includes("quan doc")) return "leader";
  if (row.role === "Team_Account" || label.includes("doi truong") || label.includes("to truong")) return "captain";
  if (row.role === "Staff" || label.includes("nhan vien")) return "staff";
  return "unknown";
}

function salaryTone(value: string | null | undefined) {
  const text = normalizeSearchValue(value);
  if (!text) return "empty";
  if (/(cao|senior|lead|chinh|7|8|9)/.test(text)) return "high";
  if (/(thap|junior|1|2|3)/.test(text)) return "low";
  return "mid";
}

function personnelInitials(name: string | null | undefined) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "--";
  return parts.slice(-2).map((part) => part[0]).join("").toUpperCase();
}

function assessmentPersonnelLabel(row: any) {
  const roleText = personnelRoleLabel(row.role || row.position_code) || "Chưa có chức vụ";
  return `${row.full_name} - ${roleText}`;
}

function assessmentPersonnelMeta(row: any) {
  return [row.employee_code, row.team]
    .filter(Boolean)
    .join(" · ");
}

function personnelRoleRank(row: any) {
  const label = personnelRoleLabel(row.role || row.position_code).toLowerCase();
  if (label.includes("quản đốc") || row.role === "Workshop_Leader") return 0;
  if (label.includes("đội trưởng") || label.includes("tổ trưởng") || row.role === "Team_Account") return 1;
  if (label.includes("nhân viên") || row.role === "Staff") return 2;
  return 3;
}

export function ETModule({ role, currentUserId, editMode = true, tabsHost = null }: Props) {
  const visibleTabs = useMemo(() => {
    if (role === "FI_Coordinator") return ["dashboard"] as EtTab[];
    if (role === "Team_Account") return ["assessments", "plans"] as EtTab[];
    return ["dashboard", "frameworks", "personnel", "assessments", "plans"] as EtTab[];
  }, [role]);
  const [tab, setTab] = useState<EtTab>(visibleTabs[0]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visibleTabs.includes(tab)) {
      setTab(visibleTabs[0]);
    }
  }, [tab, visibleTabs]);

  const snapshotName = etSnapshotNames[tab];
  const tabsControl = (
    <div className="segmented-control et-topbar-tabs" role="tablist" aria-label="Năng lực ET">
      {visibleTabs.includes("dashboard") && (
        <button role="tab" aria-selected={tab === "dashboard"} className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}>Dashboard</button>
      )}
      {visibleTabs.includes("frameworks") && (
        <button role="tab" aria-selected={tab === "frameworks"} className={tab === "frameworks" ? "active" : ""} onClick={() => setTab("frameworks")}>Khung năng lực</button>
      )}
      {visibleTabs.includes("personnel") && (
        <button role="tab" aria-selected={tab === "personnel"} className={tab === "personnel" ? "active" : ""} onClick={() => setTab("personnel")}>Nhân sự</button>
      )}
      {visibleTabs.includes("assessments") && (
        <button role="tab" aria-selected={tab === "assessments"} className={tab === "assessments" ? "active" : ""} onClick={() => setTab("assessments")}>Đánh giá</button>
      )}
      {visibleTabs.includes("plans") && (
        <button role="tab" aria-selected={tab === "plans"} className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}>Kế hoạch học tập</button>
      )}
    </div>
  );
  return (
    <section
      className="et-shell"
      data-snapshot-target="true"
      data-snapshot-name={snapshotName}
    >
      {/* Hàng tab được "portal" lên topbar để nằm chung hàng với tiêu đề "Năng lực ET".
          Khi host chưa sẵn sàng (vd: render standalone) thì hiển thị tại chỗ. */}
      {tabsHost ? createPortal(tabsControl, tabsHost) : tabsControl}
      {error && <p className="error">{error}</p>}
      {tab === "dashboard" && <DashboardView setError={setError} />}
      {tab === "frameworks" && <FrameworkView role={role} editMode={editMode} setError={setError} />}
      {tab === "personnel" && <PersonnelView role={role} editMode={editMode} setError={setError} />}
      {tab === "assessments" && <AssessmentView role={role} currentUserId={currentUserId} editMode={editMode} setError={setError} />}
      {tab === "plans" && <LearningPlanView role={role} editMode={editMode} setError={setError} />}
    </section>
  );
}

const etSnapshotNames: Record<EtTab, string> = {
  dashboard: "et-dashboard",
  frameworks: "et-khung-nang-luc",
  personnel: "et-nhan-su",
  assessments: "et-danh-gia",
  plans: "et-ke-hoach-hoc-tap",
};

const categoryOrder = new Map(categories.map((category, index) => [category, index]));

function frameworkGroups(items: any[]) {
  const map = new Map<string, any[]>();
  items.forEach((item) => {
    const category = item.category || "Khác";
    map.set(category, [...(map.get(category) ?? []), item]);
  });
  return Array.from(map.entries())
    .sort(([left], [right]) => (categoryOrder.get(left) ?? 99) - (categoryOrder.get(right) ?? 99) || left.localeCompare(right))
    .map(([category, rows]) => ({
      category,
      items: rows.sort((left, right) => Number(left.stt ?? 0) - Number(right.stt ?? 0) || String(left.nlcm_code).localeCompare(String(right.nlcm_code)))
    }));
}

function frameworkLevelScores(item: any) {
  return Array.from({ length: 8 }, (_, index) => {
    const level = String(index + 1);
    const raw = item.level_requirements?.[level];
    return Number(raw ?? 0);
  });
}

function scoreClass(value: number) {
  if (!value) return "score-empty";
  if (value === 1) return "score-one";
  if (value === 2) return "score-two";
  if (value === 3) return "score-three";
  if (value === 4) return "score-four";
  if (value === 5) return "score-five";
  return "score-high";
}

function splitDetailLines(text: string | null | undefined) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-\u2022]+/, "").trim())
    .filter(Boolean);
}

function frameworkTitleText(framework: any) {
  const title = String(framework?.title ?? "");
  const code = String(framework?.code ?? "");
  return title.replace(new RegExp(`\\s*\\(${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\s*$`), "").trim() || title;
}

function FrameworkView({ role, editMode, setError }: { role: string; editMode: boolean; setError: (value: string) => void }) {
  const [frameworks, setFrameworks] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ code: "", title: "" });
  const [itemForm, setItemForm] = useState<any>(emptyItemForm());
  const [detailItem, setDetailItem] = useState<any | null>(null);
  const [itemEditorOpen, setItemEditorOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneForm, setCloneForm] = useState({ code: "", title: "" });
  const [deleteFrameworkOpen, setDeleteFrameworkOpen] = useState(false);
  const [deleteItemTarget, setDeleteItemTarget] = useState<any | null>(null);
  const editable = canManage(role) && editMode;

  const load = () => {
    api.etFrameworks().then((rows) => {
      setFrameworks(rows);
      if (!selected && rows[0]) {
        loadDetail(rows[0].id);
      }
    }).catch((err) => setError(err.message));
  };
  const loadDetail = (id: string) => api.etFramework(id).then(setSelected).catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, [editable]);

  const submitFramework = () => {
    api.createEtFramework({ ...form, is_active: true }).then((row) => {
      setForm({ code: "", title: "" });
      setSelected(row);
      load();
    }).catch((err) => setError(err.message));
  };

  const importFile = () => {
    if (!file) return;
    api.importEtFrameworks(file).then((result) => {
      setFile(null);
      setSelected(result.created?.[0] ?? null);
      load();
    }).catch((err) => setError(err.message));
  };

  const saveItem = () => {
    if (!selected) return;
    const payload = {
      nlcm_code: itemForm.nlcm_code,
      competency_name: itemForm.competency_name,
      competency_detail: itemForm.competency_detail,
      definition: itemForm.definition,
      requirements_text: itemForm.requirements_text,
      category: itemForm.category,
      stt: Number(itemForm.stt),
      level_requirements: Object.fromEntries(
        Object.entries(itemForm.level_requirements).map(([level, value]) => [level, Number(value)])
      )
    };
    const request = itemForm.id
      ? api.updateEtFrameworkItem(selected.id, itemForm.id, payload)
      : api.addEtFrameworkItem(selected.id, payload);
    request.then(() => {
      setItemForm(emptyItemForm());
      setItemEditorOpen(false);
      loadDetail(selected.id);
    }).catch((err) => setError(err.message));
  };

  const deleteItem = (itemId: string) => {
    if (!selected) return;
    api.deleteEtFrameworkItem(selected.id, itemId).then(() => {
      setDeleteItemTarget(null);
      loadDetail(selected.id);
    }).catch((err) => setError(err.message));
  };

  const startEditItem = (item: any) => {
    setItemForm({
      ...emptyItemForm(),
      ...item,
      definition: item.definition ?? "",
      requirements_text: item.requirements_text ?? "",
      level_requirements: { ...emptyItemForm().level_requirements, ...(item.level_requirements ?? {}) }
    });
    setItemEditorOpen(true);
  };

  const startAddItem = () => {
    setItemForm({
      ...emptyItemForm(),
      stt: (items.length ? Math.max(...items.map((item: any) => Number(item.stt ?? 0))) : 0) + 1
    });
    setItemEditorOpen(true);
  };

  const openCloneFramework = () => {
    if (!selected) return;
    setCloneForm({
      code: `${selected.code}_COPY`,
      title: frameworkTitleText(selected)
    });
    setCloneOpen(true);
  };

  const cloneFramework = () => {
    if (!selected) return;
    const payload = {
      code: cloneForm.code.trim(),
      title: cloneForm.title.trim(),
      is_active: true,
      items: (selected.items ?? []).map((item: any) => ({
        nlcm_code: item.nlcm_code,
        competency_name: item.competency_name,
        competency_detail: item.competency_detail,
        definition: item.definition,
        requirements_text: item.requirements_text,
        category: item.category,
        stt: Number(item.stt ?? 0),
        level_requirements: item.level_requirements ?? emptyItemForm().level_requirements,
        month_hold_level: item.month_hold_level,
        year_hold_level: item.year_hold_level,
        gap_reference: item.gap_reference
      }))
    };
    api.createEtFramework(payload).then((row) => {
      setCloneOpen(false);
      setSelected(row);
      load();
    }).catch((err) => setError(err.message));
  };

  const deleteFramework = () => {
    if (!selected) return;
    api.deleteEtFramework(selected.id).then(() => {
      setDeleteFrameworkOpen(false);
      setSelected(null);
      load();
    }).catch((err) => setError(err.message));
  };

  const items = selected?.items ?? [];
  const grouped = frameworkGroups(items);
  const levelTotals = Array.from({ length: 8 }, (_, index) => Number(selected?.level_sums?.[String(index + 1)] ?? 0));
  const averageByLevel = levelTotals.length ? Math.round(levelTotals.reduce((sum, value) => sum + value, 0) / levelTotals.length) : 0;
  const maxTotal = levelTotals.length ? Math.max(...levelTotals) : 0;

  return (
    <div className="content-grid et-grid">
      <section className="panel">
        <div className="panel-header">
          <h2>{"Khung năng lực"}</h2>
          <button aria-label="Tải lại" onClick={load} title="Tải lại" type="button"><RefreshCw size={16} /></button>
        </div>
        {editable && (
          <div className="toolbar">
            <label className="icon-button">
              <FileUp size={16} />
              Import Excel
              <input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <button onClick={importFile} disabled={!file}>{"Nạp"}</button>
          </div>
        )}
        {editable && (
          <div className="form-stack">
            <input placeholder="Mã khung, ví dụ KNL_ĐK_14" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
            <input placeholder="Tên vị trí chức danh" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            <button onClick={submitFramework}><Plus size={16} />{"Tạo khung"}</button>
          </div>
        )}
        <div className="framework-selector-list">
          {frameworks.map((framework) => (
            <button key={framework.id} className={`framework-select-row ${selected?.id === framework.id ? "active-row" : ""}`} onClick={() => loadDetail(framework.id)}>
              <span className="framework-code-chip">{framework.code}</span>
              <span className="framework-select-title">{frameworkTitleText(framework)}</span>
              <span className={`framework-status-dot ${framework.is_active ? "active" : "inactive"}`} title={framework.is_active ? "Đang áp dụng" : "Không áp dụng"}></span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel wide">
        {selected ? (
          <>
            <div className="framework-hero">
              <div>
                <span className={`status ${selected.is_active ? "status-ok" : "status-na"}`}>
                  {selected.is_active ? "Đang áp dụng" : "Bản nháp"}
                </span>
                <h2>{selected.code}</h2>
                <p className="muted">{frameworkTitleText(selected)}</p>
              </div>
              <div className="toolbar">
                <button aria-label="Xuất Excel" title="Xuất Excel" type="button" onClick={() => api.exportEtFramework(selected.id).then((blob) => saveBlob(blob, `${selected.code}.xlsx`))}>
                  <FileDown size={16} />
                </button>
                {editable && <button title="Clone khung" type="button" onClick={openCloneFramework}><Copy size={16} />Clone</button>}
                {editable && <button title="Thêm năng lực" type="button" onClick={startAddItem}><Plus size={16} />Năng lực</button>}
                {editable && !selected.is_active && <button aria-label="Kích hoạt" title="Kích hoạt" type="button" onClick={() => api.activateEtFramework(selected.id).then((row) => { setSelected(row); load(); })}><Power size={16} /></button>}
                {editable && <button aria-label="Xóa khung" className="danger-button" title="Xóa khung" type="button" onClick={() => setDeleteFrameworkOpen(true)}><Trash2 size={16} /></button>}
              </div>
            </div>

            <div className="framework-summary-grid">
              <div className="tone-skills"><span>{"Số kỹ năng"}</span><strong>{items.length}</strong></div>
              <div className="tone-average"><span>{"Điểm TB/bậc"}</span><strong>{averageByLevel}</strong></div>
              <div className="tone-max"><span>{"Tổng cao nhất"}</span><strong>{maxTotal}</strong></div>
              <div className="tone-groups"><span>{"Nhóm năng lực"}</span><strong>{grouped.length}</strong></div>
            </div>

            <div className="framework-level-total-table" aria-label="Tổng điểm chuẩn theo bậc">
              <div className="framework-total-label">
                <span>{"Tổng điểm chuẩn"}</span>
                <strong>{maxTotal}</strong>
              </div>
              <div className="framework-total-grid">
                {levelTotals.map((_, index) => (
                  <span key={`head-${index}`} className="framework-total-head">B{index + 1}</span>
                ))}
                {levelTotals.map((value, index) => (
                  <b key={`value-${index}`} className={`level-total-cell level-${index + 1}`}>{value}</b>
                ))}
              </div>
            </div>

            <div className="framework-card-stack">
              {grouped.map((group) => (
                <section key={group.category} className="framework-group-card">
                  <div className="framework-group-header">
                    <div>
                      <span>{"Nhóm năng lực"}</span>
                      <h3>{group.category}</h3>
                    </div>
                    <strong>{group.items.length}</strong>
                  </div>
                  <div className={`framework-score-column-header ${editable ? "has-actions" : ""}`}>
                    <span></span>
                    <div className="framework-score-grid" aria-hidden="true">
                      {Array.from({ length: 8 }, (_, index) => (
                        <span key={index}>B{index + 1}</span>
                      ))}
                    </div>
                    {editable && <span></span>}
                  </div>
                  <div className="framework-item-list">
                    {group.items.map((item: any) => (
                      <article key={item.id} className={`framework-item-card ${editable ? "has-actions" : ""}`}>
                        <div className="framework-item-main">
                          <span className="framework-item-index">{item.stt}</span>
                          <div>
                            <button className="link-button framework-item-title" onClick={() => setDetailItem(item)}>
                              {item.competency_name}
                            </button>
                            <p>{item.competency_detail}</p>
                            <small>{item.nlcm_code}</small>
                          </div>
                        </div>
                        <div className="framework-score-grid" aria-label="Bang diem B1 den B8">
                          {frameworkLevelScores(item).map((value, index) => (
                            <span key={index} className={`framework-score-chip ${scoreClass(value)}`} title={`Bậc ${index + 1}`}>
                              {value || "-"}
                            </span>
                          ))}
                        </div>
                        {editable && (
                          <div className="framework-item-actions">
                            <button title="Sửa" onClick={() => startEditItem(item)}><Pencil size={14} /></button>
                            <button title="Xóa" onClick={() => setDeleteItemTarget(item)}><Trash2 size={14} /></button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {editable && itemEditorOpen && (
              <div className="modal-backdrop" role="presentation">
                <div className="framework-edit-modal" role="dialog" aria-modal="true" aria-label="Chinh sua nang luc">
                  <div className="panel-header">
                    <div>
                      <h2>{itemForm.id ? "Sửa năng lực" : "Thêm năng lực"}</h2>
                      <p className="muted">{"Cập nhật tên, chi tiết và điểm B1-B8 trong database local."}</p>
                    </div>
                    <button title="Đóng" onClick={() => { setItemEditorOpen(false); setItemForm(emptyItemForm()); }}><X size={18} /></button>
                  </div>
                  <div className="et-item-editor">
                <input placeholder="Mã NLCM" value={itemForm.nlcm_code} onChange={(event) => setItemForm({ ...itemForm, nlcm_code: event.target.value })} />
                <input placeholder="Tên năng lực" value={itemForm.competency_name} onChange={(event) => setItemForm({ ...itemForm, competency_name: event.target.value })} />
                <textarea placeholder="Chi tiết" value={itemForm.competency_detail ?? ""} onChange={(event) => setItemForm({ ...itemForm, competency_detail: event.target.value })} />
                <textarea placeholder="Định nghĩa" value={itemForm.definition ?? ""} onChange={(event) => setItemForm({ ...itemForm, definition: event.target.value })} />
                <textarea placeholder="Yêu cầu kiến thức/kỹ năng" value={itemForm.requirements_text ?? ""} onChange={(event) => setItemForm({ ...itemForm, requirements_text: event.target.value })} />
                <select value={itemForm.category} onChange={(event) => setItemForm({ ...itemForm, category: event.target.value })}>
                  {categories.map((category) => <option key={category}>{category}</option>)}
                </select>
                <input type="number" min={1} value={itemForm.stt} onChange={(event) => setItemForm({ ...itemForm, stt: Number(event.target.value) })} />
                <div className="level-editor">
                  {Array.from({ length: 8 }, (_, index) => {
                    const level = String(index + 1);
                    return (
                      <label key={level}>
                        B{level}
                        <input type="number" min={0} max={5} value={itemForm.level_requirements[level] ?? 0} onChange={(event) => setItemForm({
                          ...itemForm,
                          level_requirements: { ...itemForm.level_requirements, [level]: Number(event.target.value) }
                        })} />
                      </label>
                    );
                  })}
                </div>
                <div className="toolbar">
                  <button onClick={saveItem}><Save size={16} />{"Lưu năng lực"}</button>
                  <button onClick={() => { setItemEditorOpen(false); setItemForm(emptyItemForm()); }}>{"Hủy"}</button>
                </div>
                  </div>
                </div>
              </div>
            )}
            {editable && cloneOpen && (
              <div className="modal-backdrop" role="presentation">
                <div className="framework-edit-modal compact" role="dialog" aria-modal="true" aria-label="Clone khung nang luc">
                  <div className="panel-header">
                    <div>
                      <h2>{"Clone khung năng lực"}</h2>
                      <p className="muted">{"Sao chép toàn bộ năng lực từ khung hiện tại, sau đó lưu thành khung mới."}</p>
                    </div>
                    <button title="Đóng" onClick={() => setCloneOpen(false)}><X size={18} /></button>
                  </div>
                  <div className="form-stack">
                    <label>
                      <span>{"Mã khung mới"}</span>
                      <input value={cloneForm.code} onChange={(event) => setCloneForm({ ...cloneForm, code: event.target.value })} />
                    </label>
                    <label>
                      <span>{"Tên khung mới"}</span>
                      <input value={cloneForm.title} onChange={(event) => setCloneForm({ ...cloneForm, title: event.target.value })} />
                    </label>
                  </div>
                  <div className="modal-actions">
                    <button onClick={() => setCloneOpen(false)}>{"Hủy"}</button>
                    <button onClick={cloneFramework} disabled={!cloneForm.code.trim() || !cloneForm.title.trim()}><Copy size={16} />{"Clone khung"}</button>
                  </div>
                </div>
              </div>
            )}
            {editable && deleteFrameworkOpen && selected && (
              <div className="modal-backdrop" role="presentation">
                <div className="framework-confirm-modal" role="dialog" aria-modal="true" aria-label="Xac nhan xoa khung">
                  <div className="panel-header">
                    <div>
                      <h2>{"Xóa khung năng lực?"}</h2>
                      <p className="muted">{selected.code} - {frameworkTitleText(selected)}</p>
                    </div>
                    <button title="Đóng" onClick={() => setDeleteFrameworkOpen(false)}><X size={18} /></button>
                  </div>
                  <p className="warning-text">
                    {"Thao tác này là xóa khung trong database, không phải chỉ ẩn hiển thị. Backend sẽ chặn xóa nếu khung đang có nhân sự, phiếu đánh giá hoặc kế hoạch phụ thuộc."}
                  </p>
                  <div className="modal-actions">
                    <button onClick={() => setDeleteFrameworkOpen(false)}>{"Hủy"}</button>
                    <button className="danger-button" onClick={deleteFramework}><Trash2 size={16} />{"Xóa trong database"}</button>
                  </div>
                </div>
              </div>
            )}
            {editable && deleteItemTarget && (
              <div className="modal-backdrop" role="presentation">
                <div className="framework-confirm-modal" role="dialog" aria-modal="true" aria-label="Xac nhan xoa nang luc">
                  <div className="panel-header">
                    <div>
                      <h2>{"Xóa năng lực?"}</h2>
                      <p className="muted">{deleteItemTarget.nlcm_code} - {deleteItemTarget.competency_name}</p>
                    </div>
                    <button title="Đóng" onClick={() => setDeleteItemTarget(null)}><X size={18} /></button>
                  </div>
                  <p className="warning-text">
                    {"Thao tác này xóa năng lực trong database. Backend sẽ chặn xóa nếu năng lực đã được dùng trong phiếu đánh giá."}
                  </p>
                  <div className="modal-actions">
                    <button onClick={() => setDeleteItemTarget(null)}>{"Hủy"}</button>
                    <button className="danger-button" onClick={() => deleteItem(deleteItemTarget.id)}><Trash2 size={16} />{"Xóa năng lực"}</button>
                  </div>
                </div>
              </div>
            )}
            {detailItem && (
              <div className="modal-backdrop" role="presentation">
                <div className="framework-detail-modal" role="dialog" aria-modal="true" aria-label="Chi tiet nang luc">
                  <div className="panel-header">
                    <div>
                      <span className="status status-na">{detailItem.nlcm_code}</span>
                      <h2>{detailItem.competency_name}</h2>
                      <p className="muted">{detailItem.competency_detail}</p>
                    </div>
                    <button title="Đóng" onClick={() => setDetailItem(null)}><X size={18} /></button>
                  </div>
                  <div className="framework-score-grid modal-score-grid">
                    {frameworkLevelScores(detailItem).map((value, index) => (
                      <span key={index} className={`framework-score-chip ${scoreClass(value)}`}>
                        <b>B{index + 1}</b>
                        {value || "-"}
                      </span>
                    ))}
                  </div>
                  <div className="framework-detail-section">
                    <h3>Định nghĩa</h3>
                    {splitDetailLines(detailItem.definition).length ? (
                      splitDetailLines(detailItem.definition).map((line, index) => <p key={index}>{line}</p>)
                    ) : (
                      <p className="muted">Chưa có dữ liệu.</p>
                    )}
                  </div>
                  <div className="framework-detail-section">
                    <h3>Yêu cầu kiến thức/kỹ năng</h3>
                    {splitDetailLines(detailItem.requirements_text).length ? (
                      <ul>
                        {splitDetailLines(detailItem.requirements_text).map((line, index) => <li key={index}>{line}</li>)}
                      </ul>
                    ) : (
                      <p className="muted">Chưa có dữ liệu.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="muted">Chưa có khung năng lực.</p>
        )}
      </section>
    </div>
  );
}

function PersonnelView({ role, editMode, setError }: { role: string; editMode: boolean; setError: (value: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [frameworks, setFrameworks] = useState<any[]>([]);
  const [searchText, setSearchText] = useState("");
  const emptyPersonnelForm = { employee_code: "", full_name: "", role: "", position_code: "", team: "", current_level: "", salary_grade: "", status: "active", user_id: "" };
  const [form, setForm] = useState<any>(emptyPersonnelForm);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const editable = canManage(role) && editMode;
  const frameworkCodes = useMemo(() => new Set(frameworks.map((framework) => framework.code)), [frameworks]);
  const isValidFrameworkCode = (value: string) => {
    if (!value) return false;
    return frameworkCodes.size ? frameworkCodes.has(value) : value.startsWith("KNL_");
  };

  const load = () => {
    api.etPersonnel("?include_users=true").then(setRows).catch((err) => setError(err.message));
    api.etPersonnelSummary("?include_users=true").then(setSummary).catch(() => undefined);
    api.etFrameworks().then(setFrameworks).catch(() => undefined);
  };
  useEffect(load, [editable]);

  const save = () => {
    const positionCode = String(form.position_code ?? "").trim();
    const payload = {
      ...form,
      current_level: form.current_level === "" || form.current_level === null ? null : Number(form.current_level),
      employee_code: String(form.employee_code ?? "").trim() || null,
      role: String(form.role ?? "").trim() || null,
      position_code: isValidFrameworkCode(positionCode) ? positionCode : null,
      team: String(form.team ?? "").trim() || null,
      salary_grade: String(form.salary_grade ?? "").trim() || null,
      user_id: String(form.user_id ?? "").trim() || null
    };
    const request = form.id ? api.updateEtPersonnel(form.id, payload) : api.createEtPersonnel(payload);
    setSaving(true);
    request.then(() => {
      setForm(emptyPersonnelForm);
      setModalOpen(false);
      load();
    }).catch((err) => setError(err.message)).finally(() => setSaving(false));
  };

  const editRow = (row: any) => {
    const rowPositionCode = String(row.position_code ?? "").trim();
    const validPositionCode = isValidFrameworkCode(rowPositionCode) ? rowPositionCode : "";
    if (row.source_type === "user") {
      setForm({
        ...emptyPersonnelForm,
        full_name: row.full_name ?? "",
        role: row.role ?? "",
        position_code: validPositionCode,
        team: row.team ?? "",
        status: row.status ?? "active",
        user_id: row.user_id ?? "",
        salary_grade: row.salary_grade ?? "",
      });
      setModalOpen(true);
      return;
    }
    setForm({ ...row, position_code: validPositionCode, current_level: row.current_level ?? "" });
    setModalOpen(true);
  };

  const openCreate = () => {
    setForm(emptyPersonnelForm);
    setModalOpen(true);
  };

  const hideRow = (row: any) => {
    const sourceType = row.source_type === "user" ? "user" : "personnel";
    const sourceId = sourceType === "user" ? row.user_id : row.id;
    if (!sourceId) return;
    api.hideEtPersonnel(sourceType, sourceId)
      .then(load)
      .catch((err) => setError(err.message));
  };

  const activeCount = rows.filter((row) => row.status === "active").length;
  const inactiveCount = rows.length - activeCount;
  const teamCount = Object.keys(summary?.by_team ?? {}).length;
  const roleCount = Object.keys(summary?.by_position ?? {}).length;
  const visibleRows = useMemo(() => {
    const term = normalizeSearchValue(searchText.trim());
    return [...rows]
      .filter((row) => {
        if (!term) return true;
        return [
          row.employee_code,
          row.full_name,
          personnelRoleLabel(row.role || row.position_code),
          row.team,
          personnelStatusLabel(row.status),
          row.salary_grade,
          row.user_id,
          row.position_code,
        ].some((value) => normalizeSearchValue(value).includes(term));
      })
      .sort((left, right) => {
        const roleDelta = personnelRoleRank(left) - personnelRoleRank(right);
        if (roleDelta !== 0) return roleDelta;
        const teamDelta = String(left.team ?? "").localeCompare(String(right.team ?? ""), "vi");
        if (teamDelta !== 0) return teamDelta;
        return String(left.full_name ?? "").localeCompare(String(right.full_name ?? ""), "vi");
      });
  }, [rows, searchText]);

  return (
    <div className="content-grid et-grid">
      <section className="panel wide et-personnel-dashboard">
        {summary && (
          <div className="et-stats">
            <div className="et-stat-card tone-total"><strong>{visibleRows.length}</strong><span>Nhân sự hiển thị</span></div>
            <div className="et-stat-card tone-team"><strong>{teamCount}</strong><span>Đội/tổ</span></div>
            <div className="et-stat-card tone-role"><strong>{roleCount}</strong><span>Vai trò</span></div>
            <div className="et-stat-card tone-active"><strong>{activeCount}</strong><span>Đang hoạt động</span></div>
            <div className="et-stat-card tone-inactive"><strong>{inactiveCount}</strong><span>Không hoạt động</span></div>
          </div>
        )}
      </section>
      <section className="panel wide et-personnel-panel">
        <div className="panel-header et-personnel-table-head">
          <div className="et-personnel-title">
            <h2>Danh sách nhân sự</h2>
            <p className="muted">Quản lý hồ sơ, vai trò, đội/tổ và trạng thái phục vụ đánh giá năng lực.</p>
          </div>
          <div className="et-personnel-search">
            <Search size={16} />
            <input
              placeholder="Tìm theo tên, vai trò, đội/tổ, MSNV, trạng thái, bậc lương..."
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </div>
          <div className="toolbar">
            <button aria-label="Tải lại" onClick={load} title="Tải lại" type="button"><RefreshCw size={16} /></button>
            {editable && <button aria-label="Thêm nhân sự" onClick={openCreate} title="Thêm nhân sự" type="button"><Plus size={16} /></button>}
          </div>
        </div>
        <div className="matrix et-personnel-table-wrap">
          <table>
            <thead>
              <tr><th>MSNV</th><th>Tên nhân sự</th><th>Vai trò</th><th>Đội/tổ</th><th>Trạng thái</th><th>Bậc lương</th>{editable && <th>Thao tác</th>}</tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className={`et-personnel-row tone-${personnelStatusTone(row.status)}`}>
                  <td><span className="et-code-chip">{row.employee_code || "Chưa có"}</span></td>
                  <td>
                    <div className="et-person-name-cell">
                      <span className={`et-person-avatar tone-${personnelRoleTone(row)}`}>{personnelInitials(row.full_name)}</span>
                      <div>
                        <strong>{row.full_name}</strong>
                      </div>
                    </div>
                  </td>
                  <td><span className={`et-data-pill et-role-${personnelRoleTone(row)}`}>{personnelRoleLabel(row.role || row.position_code) || "Chưa chọn"}</span></td>
                  <td><span className="et-team-pill">{row.team || "Chưa có"}</span></td>
                  <td><span className={`et-data-pill et-status-${personnelStatusTone(row.status)}`}>{personnelStatusLabel(row.status) || "Chưa có"}</span></td>
                  <td><span className={`et-salary-pill et-salary-${salaryTone(row.salary_grade)}`}>{row.salary_grade || "Chưa có"}</span></td>
                  {editable && (
                    <td className="et-row-actions">
                      <button onClick={() => editRow(row)} title={row.source_type === "user" ? "Tạo hồ sơ" : "Sửa nhân sự"}>
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => hideRow(row)} title="Ẩn khỏi bảng nhân sự">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={editable ? 7 : 6} className="et-personnel-empty-state">
                    Không tìm thấy nhân sự phù hợp với bộ lọc hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {modalOpen && (
        <div className="et-personnel-modal-backdrop" role="presentation">
          <section
            className="et-personnel-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="et-personnel-modal-title"
          >
            <div className="et-personnel-modal-head">
              <div>
                <h2 id="et-personnel-modal-title">{form.id ? "Sửa thông tin nhân sự" : "Thêm nhân sự"}</h2>
                <p className="muted">Lưu hồ sơ nháp trước, bổ sung mã vị trí và bậc năng lực khi cần đánh giá.</p>
              </div>
              <button className="et-personnel-modal-close" onClick={() => setModalOpen(false)} title="Đóng">
                <X size={18} />
              </button>
            </div>
            <div className="et-personnel-modal-banner">
              <span>Thông tin hiển thị trên bảng</span>
              <strong>{form.full_name || "Nhân sự mới"}</strong>
            </div>
            <div className="et-personnel-form-grid">
              <div className="et-personnel-section-title">Thông tin chính</div>
              <label>
                Tên nhân sự
                <input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} />
              </label>
              <label>
                Vai trò
                <select value={form.role ?? ""} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                  <option value="">Chưa chọn</option>
                  {personnelRoleOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  {form.role && !personnelRoleLabels[form.role] && <option value={form.role}>{form.role}</option>}
                </select>
              </label>
              <label>
                Đội/tổ
                <input value={form.team ?? ""} onChange={(event) => setForm({ ...form, team: event.target.value })} />
              </label>
              <label>
                MSNV
                <input value={form.employee_code ?? ""} onChange={(event) => setForm({ ...form, employee_code: event.target.value })} />
              </label>
              <label>
                Trạng thái
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                  {personnelStatusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>
                Bậc lương
                <input value={form.salary_grade ?? ""} onChange={(event) => setForm({ ...form, salary_grade: event.target.value })} />
              </label>
              <div className="et-personnel-section-title">Thông tin đánh giá</div>
              <label>
                Mã khung/vị trí đánh giá
                <select value={form.position_code ?? ""} onChange={(event) => setForm({ ...form, position_code: event.target.value })}>
                  <option value="">ChÆ°a gÃ¡n khung</option>
                  {frameworks.map((framework) => (
                    <option key={framework.id} value={framework.code}>
                      {framework.code} - {framework.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Bậc năng lực
                <input type="number" min={1} max={8} value={form.current_level ?? ""} onChange={(event) => setForm({ ...form, current_level: event.target.value })} />
              </label>
              <div className="et-personnel-section-title">Liên kết hệ thống</div>
              <label className="et-personnel-field-wide">
                User ID liên kết
                <input value={form.user_id ?? ""} onChange={(event) => setForm({ ...form, user_id: event.target.value })} />
              </label>
            </div>
            <div className="et-personnel-modal-actions">
              <button onClick={() => setModalOpen(false)}>Hủy</button>
              <button onClick={save} disabled={saving || !String(form.full_name ?? "").trim()}>
                <Save size={16} />
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function AssessmentView({ role, editMode, setError }: { role: string; currentUserId: string; editMode: boolean; setError: (value: string) => void }) {
  const [assessments, setAssessments] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [createForm, setCreateForm] = useState({ personnel_id: "", assessment_period: "" });
  const [personnelPickerOpen, setPersonnelPickerOpen] = useState(false);
  const [personnelSearch, setPersonnelSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editable = canManage(role) && editMode;
  const selectedPersonnel = useMemo(
    () => personnel.find((row) => row.id === createForm.personnel_id) ?? null,
    [personnel, createForm.personnel_id]
  );
  const filteredPersonnel = useMemo(() => {
    const term = normalizeSearchValue(personnelSearch);
    return personnel
      .filter((row) => {
        if (!term) return true;
        return [
          row.full_name,
          row.employee_code,
          row.team,
          row.user_id,
          row.role,
          row.position_code,
          personnelRoleLabel(row.role || row.position_code),
        ].some((value) => normalizeSearchValue(value).includes(term));
      })
      .sort((left, right) => {
        const roleDiff = personnelRoleRank(left) - personnelRoleRank(right);
        if (roleDiff !== 0) return roleDiff;
        return String(left.full_name ?? "").localeCompare(String(right.full_name ?? ""), "vi");
      });
  }, [personnel, personnelSearch]);
  const personnelInputValue = personnelPickerOpen
    ? personnelSearch
    : selectedPersonnel
      ? assessmentPersonnelLabel(selectedPersonnel)
      : personnelSearch;

  const load = () => {
    api.etAssessments().then(setAssessments).catch((err) => setError(err.message));
    if (editable) {
      api.etPersonnel("?status=active").then(setPersonnel).catch(() => undefined);
    }
  };
  useEffect(load, [editable]);

  const selectAssessment = (id: string) => api.etAssessment(id).then((row) => { setSelected(row); setDraft(row); setDirty(false); }).catch((err) => setError(err.message));

  useEffect(() => {
    if (!dirty || !draft || !editable) return;
    const handle = setTimeout(() => {
      setSaving(true);
      api.updateEtAssessment(draft.id, {
        notes: draft.notes,
        training_content: draft.training_content,
        items: draft.items.map((item: any) => ({ id: item.id, actual_score: item.actual_score, notes: item.notes }))
      }).then((row) => {
        setSelected(row);
        setDraft(row);
        setDirty(false);
      }).catch((err) => setError(err.message)).finally(() => setSaving(false));
    }, 3000);
    return () => clearTimeout(handle);
  }, [dirty, draft, editable, setError]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const create = () => {
    if (!createForm.personnel_id || !createForm.assessment_period.trim()) {
      setError("Vui lòng chọn nhân sự và nhập kỳ đánh giá.");
      return;
    }
    api.createEtAssessment({ ...createForm, assessment_period: createForm.assessment_period.trim() }).then((row) => {
      setCreateForm({ personnel_id: "", assessment_period: "" });
      setPersonnelSearch("");
      setPersonnelPickerOpen(false);
      setSelected(row);
      setDraft(row);
      load();
    }).catch((err) => setError(err.message));
  };

  const choosePersonnel = (row: any) => {
    setCreateForm({ ...createForm, personnel_id: row.id });
    setPersonnelSearch(assessmentPersonnelLabel(row));
    setPersonnelPickerOpen(false);
  };

  const setItem = (itemId: string, patch: any) => {
    setDraft((current: any) => ({
      ...current,
      items: current.items.map((item: any) => item.id === itemId ? { ...item, ...patch } : item)
    }));
    setDirty(true);
  };

  const submit = () => {
    if (!draft) return;
    api.submitEtAssessment(draft.id).then((row) => { setDraft(row); setSelected(row); load(); }).catch((err) => setError(err.message));
  };

  return (
    <div className="content-grid et-grid">
      <section className="panel">
        <div className="panel-header"><h2>Phiếu đánh giá</h2><button aria-label="Tải lại" onClick={load} title="Tải lại" type="button"><RefreshCw size={16} /></button></div>
        {editable && (
          <div className="form-stack">
            <div
              className="et-assessment-personnel-picker"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setPersonnelPickerOpen(false);
                }
              }}
            >
              <label htmlFor="et-assessment-personnel" className="sr-only">Chọn nhân sự</label>
              <input
                id="et-assessment-personnel"
                role="combobox"
                aria-expanded={personnelPickerOpen}
                aria-controls="et-assessment-personnel-list"
                aria-autocomplete="list"
                placeholder="Tìm nhân sự theo tên, chức vụ, MSNV, đội/tổ..."
                value={personnelInputValue}
                onFocus={() => {
                  setPersonnelPickerOpen(true);
                  setPersonnelSearch("");
                }}
                onChange={(event) => {
                  setPersonnelPickerOpen(true);
                  setPersonnelSearch(event.target.value);
                  setCreateForm({ ...createForm, personnel_id: "" });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setPersonnelPickerOpen(false);
                  }
                  if (event.key === "Enter" && filteredPersonnel[0]) {
                    event.preventDefault();
                    choosePersonnel(filteredPersonnel[0]);
                  }
                }}
              />
              {personnelPickerOpen && (
                <div id="et-assessment-personnel-list" className="et-assessment-personnel-list" role="listbox">
                  {filteredPersonnel.length > 0 ? filteredPersonnel.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      role="option"
                      aria-selected={createForm.personnel_id === row.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choosePersonnel(row)}
                    >
                      <strong>{assessmentPersonnelLabel(row)}</strong>
                      <span>{assessmentPersonnelMeta(row)}</span>
                    </button>
                  )) : (
                    <div className="et-assessment-personnel-empty">Không tìm thấy nhân sự phù hợp.</div>
                  )}
                </div>
              )}
            </div>
            {selectedPersonnel && (
              <div className="et-assessment-account-link">
                <span>Phiếu sẽ liên kết tới account</span>
                <strong>{selectedPersonnel.user_id || "Chưa có account liên kết"}</strong>
              </div>
            )}
            <input placeholder="Kỳ đánh giá, ví dụ 2026-Q2" value={createForm.assessment_period} onChange={(event) => setCreateForm({ ...createForm, assessment_period: event.target.value })} />
            <button onClick={create} disabled={!createForm.personnel_id || !createForm.assessment_period.trim()}><Plus size={16} />Tạo phiếu</button>
          </div>
        )}
        <div className="list">
          {assessments.map((assessment) => (
            <button key={assessment.id} className={`row-item ${selected?.id === assessment.id ? "active-row" : ""}`} onClick={() => selectAssessment(assessment.id)}>
              <strong>{assessment.personnel?.full_name}</strong>
              <span>{assessment.assessment_period} · {assessment.status}</span>
              <small>{assessment.overall_result ?? "Chưa hoàn tất"}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="panel wide">
        {draft ? (
          <>
            <div className="panel-header">
              <div>
                <h2>{draft.personnel.full_name}</h2>
                <p className="muted">{draft.assessment_period} · Bậc {draft.personnel_level_at_assessment} · {saving ? "Đang lưu..." : dirty ? "Chưa lưu" : "Đã lưu"}</p>
              </div>
              <div className="toolbar">
                <span className={resultClass(draft.overall_result)}>{draft.overall_result ?? "Chưa hoàn tất"}</span>
                <button onClick={() => api.exportEtAssessment(draft.id).then((blob) => saveBlob(blob, `assessment-${draft.assessment_period}.xlsx`))}><FileDown size={16} /></button>
                {editable && draft.status === "draft" && <button onClick={() => api.refreshEtAssessmentScores(draft.id).then((row) => { setDraft(row); setSelected(row); })}><RefreshCw size={16} /></button>}
                {editable && <button onClick={submit}><Send size={16} />Submit</button>}
              </div>
            </div>
            <div className="progress-line"><span style={{ width: `${draft.summary?.total_items ? (draft.summary.scored_items / draft.summary.total_items) * 100 : 0}%` }} /></div>
            <div className="matrix et-assessment-table">
              <table>
                <thead><tr><th>STT</th><th>Mã</th><th>Năng lực</th><th>Chuẩn</th><th>Thực tế</th><th>GAP</th><th>Ghi chú</th></tr></thead>
                <tbody>
                  {draft.items.map((item: any) => (
                    <tr key={item.id} className={item.excluded_from_result ? "excluded-row" : ""}>
                      <td>{item.stt}</td>
                      <td>{item.nlcm_code}</td>
                      <td className="wrap-cell">{item.competency_name}</td>
                      <td>{item.required_score}</td>
                      <td>
                        {editable ? (
                          <input className="score-input" type="number" min={0} max={5} value={item.actual_score ?? ""} onChange={(event) => setItem(item.id, { actual_score: event.target.value === "" ? null : Number(event.target.value) })} />
                        ) : item.actual_score}
                      </td>
                      <td><span className={`gap-pill ${gapClass(item.gap, item.excluded_from_result ? "excluded" : undefined)}`}>{item.gap ?? ""}</span></td>
                      <td>{editable ? <input value={item.notes ?? ""} onChange={(event) => setItem(item.id, { notes: event.target.value })} /> : item.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="et-notes">
              <textarea placeholder="Nhận xét / đánh giá" value={draft.notes ?? ""} disabled={!editable} onChange={(event) => { setDraft({ ...draft, notes: event.target.value }); setDirty(true); }} />
              <textarea placeholder="Nội dung đào tạo" value={draft.training_content ?? ""} disabled={!editable} onChange={(event) => { setDraft({ ...draft, training_content: event.target.value }); setDirty(true); }} />
            </div>
          </>
        ) : (
          <p className="muted">Chọn một phiếu đánh giá.</p>
        )}
      </section>
    </div>
  );
}

function LearningPlanView({ role, editMode, setError }: { role: string; editMode: boolean; setError: (value: string) => void }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState({ personnel_id: "", title: "", start_date: "", duration_months: 14 });
  const editable = canManage(role) && editMode;

  const load = () => {
    api.etLearningPlans().then(setPlans).catch((err) => setError(err.message));
    if (editable) api.etPersonnel("?status=active").then(setPersonnel).catch(() => undefined);
  };
  useEffect(load, [editable]);

  const loadDetail = (id: string) => api.etLearningPlan(id).then(setSelected).catch((err) => setError(err.message));

  const create = () => {
    api.createEtLearningPlan({ ...form, duration_months: Number(form.duration_months) }).then((row) => {
      setSelected(row);
      setForm({ personnel_id: "", title: "", start_date: "", duration_months: 14 });
      load();
    }).catch((err) => setError(err.message));
  };

  const grouped = categories.map((category) => ({
    category,
    items: (selected?.items ?? []).filter((item: any) => item.category === category)
  })).filter((group) => group.items.length);

  return (
    <div className="content-grid et-grid">
      <section className="panel">
        <div className="panel-header"><h2>Kế hoạch học tập</h2><button aria-label="Tải lại" onClick={load} title="Tải lại" type="button"><RefreshCw size={16} /></button></div>
        {editable && (
          <div className="form-stack">
            <select value={form.personnel_id} onChange={(event) => setForm({ ...form, personnel_id: event.target.value })}>
              <option value="">Chọn nhân sự</option>
              {personnel.map((row) => <option key={row.id} value={row.id}>{row.employee_code} - {row.full_name}</option>)}
            </select>
            <input placeholder="Tiêu đề" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            <input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} />
            <input type="number" min={1} max={60} value={form.duration_months} onChange={(event) => setForm({ ...form, duration_months: Number(event.target.value) })} />
            <button onClick={create}><Plus size={16} />Tạo kế hoạch</button>
          </div>
        )}
        <div className="list">
          {plans.map((plan) => (
            <button key={plan.id} className={`row-item ${selected?.id === plan.id ? "active-row" : ""}`} onClick={() => loadDetail(plan.id)}>
              <strong>{plan.title}</strong>
              <span>{plan.personnel?.full_name}</span>
              <small>{plan.start_date} · {plan.status}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="panel wide">
        {selected ? (
          <>
            <div className="panel-header">
              <div>
                <h2>{selected.title}</h2>
                <p className="muted">{selected.personnel.full_name} · {selected.progress?.completed_items}/{selected.progress?.total_items} · {selected.progress?.completion_percentage}%</p>
              </div>
              <div className="toolbar">
                <button onClick={() => api.exportEtLearningPlan(selected.id).then((blob) => saveBlob(blob, `${selected.title}.xlsx`))}><FileDown size={16} /></button>
                {editable && <button onClick={() => api.autoGenerateEtLearningPlan(selected.id).then(setSelected)}><RefreshCw size={16} />Tạo từ GAP</button>}
              </div>
            </div>
            <div className="progress-line"><span style={{ width: `${selected.progress?.completion_percentage ?? 0}%` }} /></div>
            <div className="matrix et-timeline">
              <table>
                <thead>
                  <tr><th>Năng lực</th>{Array.from({ length: selected.duration_months * 4 }, (_, index) => <th key={index}>W{index + 1}</th>)}</tr>
                </thead>
                <tbody>
                  {grouped.map((group) => (
                    <>
                      <tr key={group.category} className="category-row"><td colSpan={selected.duration_months * 4 + 1}>{group.category}</td></tr>
                      {group.items.map((item: any) => (
                        <tr key={item.id}>
                          <td className="wrap-cell">{item.competency_name}</td>
                          {Array.from({ length: selected.duration_months * 4 }, (_, index) => (
                            <td key={index} className={item.target_week === index + 1 ? `level-${item.target_level ?? 1}` : ""}>
                              {item.target_week === index + 1 ? item.target_level : ""}
                            </td>
                          ))}
                          {editable && item.status !== "completed" && <td><button onClick={() => api.completeEtLearningPlanItem(selected.id, item.id).then(setSelected)}><CheckCircle2 size={14} /></button></td>}
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="muted">Chọn một kế hoạch.</p>
        )}
      </section>
    </div>
  );
}

function DashboardView({ setError }: { setError: (value: string) => void }) {
  const [filters, setFilters] = useState({ team: "", position: "", level: "", result: "" });
  const [dashboard, setDashboard] = useState<any | null>(null);
  const [heatmap, setHeatmap] = useState<any | null>(null);

  const load = () => {
    const params = query(filters);
    api.etDashboard(params).then(setDashboard).catch((err) => setError(err.message));
    api.etHeatmap(params).then(setHeatmap).catch(() => setHeatmap(null));
  };
  useEffect(load, []);

  return (
    <div className="content-grid et-grid">
      <section className="panel wide">
        <div className="panel-header">
          <h2>Dashboard năng lực ET</h2>
          <div className="toolbar">
            <button aria-label="Tải lại" onClick={load} title="Tải lại" type="button"><RefreshCw size={16} /></button>
            <button aria-label="Xuất Excel" onClick={() => api.exportEtDashboard(query(filters)).then((blob) => saveBlob(blob, "et-dashboard.xlsx"))} title="Xuất Excel" type="button"><FileDown size={16} /></button>
          </div>
        </div>
        <div className="web-input-controls">
          <input placeholder="Team" value={filters.team} onChange={(event) => setFilters({ ...filters, team: event.target.value })} />
          <input placeholder="Vị trí" value={filters.position} onChange={(event) => setFilters({ ...filters, position: event.target.value })} />
          <input placeholder="Bậc" type="number" min={1} max={8} value={filters.level} onChange={(event) => setFilters({ ...filters, level: event.target.value })} />
          <select value={filters.result} onChange={(event) => setFilters({ ...filters, result: event.target.value })}>
            <option value="">Tất cả kết quả</option>
            <option>Đạt</option>
            <option>Không đạt</option>
            <option>Chưa đánh giá</option>
            <option>Đang đánh giá</option>
          </select>
          <button onClick={load}>Lọc</button>
        </div>
        {dashboard && (
          <>
            <div className="et-stats">
              <div><strong>{dashboard.aggregate.total_active_personnel}</strong><span>Tổng</span></div>
              <div><strong>{dashboard.aggregate.pass_count}</strong><span>Đạt ({dashboard.aggregate.pass_percentage}%)</span></div>
              <div><strong>{dashboard.aggregate.fail_count}</strong><span>Không đạt</span></div>
              <div><strong>{dashboard.aggregate.not_assessed_count}</strong><span>Chưa đánh giá</span></div>
              <div><strong>{dashboard.aggregate.draft_count}</strong><span>Đang đánh giá</span></div>
            </div>
            <div className="matrix">
              <table>
                <thead><tr><th>Team</th><th>Nhân sự</th><th>Bậc</th><th>Đạt</th><th>GAP</th><th>Tổng GAP</th><th>Kết quả</th></tr></thead>
                <tbody>
                  {dashboard.rows.map((row: any) => (
                    <tr key={row.personnel_id}>
                      <td>{row.team}</td>
                      <td>{row.full_name}</td>
                      <td>{row.current_level}</td>
                      <td>{row.achieved_count}</td>
                      <td>{row.gap_count}</td>
                      <td>{row.total_gap}</td>
                      <td><span className={resultClass(row.overall_result)}>{row.overall_result}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="et-top-lists">
              <div>
                <h2>Top NLCM GAP</h2>
                {dashboard.top_gap_items.map((item: any) => <p key={item.nlcm_code}>{item.nlcm_code} · {item.gap_personnel_count}</p>)}
              </div>
              <div>
                <h2>Top nhân sự GAP</h2>
                {dashboard.top_gap_personnel.map((person: any) => <p key={person.personnel_id}>{person.full_name} · {person.gap_count}</p>)}
              </div>
            </div>
          </>
        )}
      </section>
      {heatmap && (
        <section className="panel wide">
          <h2>Heatmap GAP</h2>
          <div className="matrix et-heatmap">
            <table>
              <thead>
                <tr><th>NLCM</th>{heatmap.personnel.map((person: any) => <th key={person.id}>{person.full_name}</th>)}</tr>
              </thead>
              <tbody>
                {heatmap.rows.map((row: any) => (
                  <tr key={row.nlcm_code}>
                    <td className="wrap-cell">{row.nlcm_code}<br />{row.competency_name}</td>
                    {row.cells.map((cell: any) => (
                      <td key={cell.personnel_id} className={gapClass(cell.gap, cell.state)}>{cell.display}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
