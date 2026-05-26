import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  FileDown,
  FileUp,
  Plus,
  Power,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2
} from "lucide-react";
import { api } from "../../api/client";

type Props = {
  role: string;
  currentUserId: string;
};

type EtTab = "dashboard" | "frameworks" | "personnel" | "assessments" | "plans";

const categories = ["Cơ bản", "Trung cấp", "Nâng cao", "Nghiệp vụ hành chính"];

const emptyItemForm = () => ({
  id: "",
  nlcm_code: "",
  competency_name: "",
  competency_detail: "",
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

export function ETModule({ role, currentUserId }: Props) {
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
  return (
    <section
      className="et-shell"
      data-snapshot-target="true"
      data-snapshot-name={snapshotName}
    >
      <div className="segmented-control">
        {visibleTabs.includes("dashboard") && (
          <button className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}>Dashboard</button>
        )}
        {visibleTabs.includes("frameworks") && (
          <button className={tab === "frameworks" ? "active" : ""} onClick={() => setTab("frameworks")}>Khung năng lực</button>
        )}
        {visibleTabs.includes("personnel") && (
          <button className={tab === "personnel" ? "active" : ""} onClick={() => setTab("personnel")}>Nhân sự</button>
        )}
        {visibleTabs.includes("assessments") && (
          <button className={tab === "assessments" ? "active" : ""} onClick={() => setTab("assessments")}>Đánh giá</button>
        )}
        {visibleTabs.includes("plans") && (
          <button className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}>Kế hoạch học tập</button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {tab === "dashboard" && <DashboardView setError={setError} />}
      {tab === "frameworks" && <FrameworkView role={role} setError={setError} />}
      {tab === "personnel" && <PersonnelView role={role} setError={setError} />}
      {tab === "assessments" && <AssessmentView role={role} currentUserId={currentUserId} setError={setError} />}
      {tab === "plans" && <LearningPlanView role={role} setError={setError} />}
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

function FrameworkView({ role, setError }: { role: string; setError: (value: string) => void }) {
  const [frameworks, setFrameworks] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ code: "", title: "" });
  const [itemForm, setItemForm] = useState<any>(emptyItemForm());
  const editable = canManage(role);

  const load = () => {
    api.etFrameworks().then((rows) => {
      setFrameworks(rows);
      if (!selected && rows[0]) {
        loadDetail(rows[0].id);
      }
    }).catch((err) => setError(err.message));
  };
  const loadDetail = (id: string) => api.etFramework(id).then(setSelected).catch((err) => setError(err.message));

  useEffect(load, []);

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
      loadDetail(selected.id);
    }).catch((err) => setError(err.message));
  };

  const deleteItem = (itemId: string) => {
    if (!selected) return;
    api.deleteEtFrameworkItem(selected.id, itemId).then(() => loadDetail(selected.id)).catch((err) => setError(err.message));
  };

  const grouped = categories.map((category) => ({
    category,
    items: (selected?.items ?? []).filter((item: any) => item.category === category)
  })).filter((group) => group.items.length);

  return (
    <div className="content-grid et-grid">
      <section className="panel">
        <div className="panel-header">
          <h2>Khung năng lực</h2>
          <button onClick={load} title="Tải lại"><RefreshCw size={16} /></button>
        </div>
        {editable && (
          <div className="toolbar">
            <label className="icon-button">
              <FileUp size={16} />
              Import Excel
              <input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <button onClick={importFile} disabled={!file}>Nạp</button>
          </div>
        )}
        {editable && (
          <div className="form-stack">
            <input placeholder="Mã khung, ví dụ KNL_ĐK_14" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
            <input placeholder="Tên vị trí chức danh" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            <button onClick={submitFramework}><Plus size={16} />Tạo khung</button>
          </div>
        )}
        <div className="list">
          {frameworks.map((framework) => (
            <button key={framework.id} className={`row-item ${selected?.id === framework.id ? "active-row" : ""}`} onClick={() => loadDetail(framework.id)}>
              <strong>{framework.code} v{framework.version}</strong>
              <span>{framework.title}</span>
              <small>{framework.is_active ? "Đang áp dụng" : "Không áp dụng"}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="panel wide">
        {selected ? (
          <>
            <div className="panel-header">
              <div>
                <h2>{selected.code} v{selected.version}</h2>
                <p className="muted">{selected.title}</p>
              </div>
              <div className="toolbar">
                <button onClick={() => api.exportEtFramework(selected.id).then((blob) => saveBlob(blob, `${selected.code}.xlsx`))}>
                  <FileDown size={16} />
                </button>
                {editable && <button onClick={() => api.duplicateEtFramework(selected.id).then((row) => { setSelected(row); load(); })}><Copy size={16} /></button>}
                {editable && !selected.is_active && <button onClick={() => api.activateEtFramework(selected.id).then((row) => { setSelected(row); load(); })}><Power size={16} /></button>}
              </div>
            </div>
            <div className="matrix et-matrix">
              <table>
                <thead>
                  <tr>
                    <th>Nhóm</th>
                    <th>STT</th>
                    <th>Mã</th>
                    <th>Năng lực</th>
                    {Array.from({ length: 8 }, (_, index) => <th key={index}>Bậc {index + 1}</th>)}
                    {editable && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((group) => (
                    <>
                      <tr key={group.category} className="category-row"><td colSpan={editable ? 13 : 12}>{group.category}</td></tr>
                      {group.items.map((item: any) => (
                        <tr key={item.id}>
                          <td>{item.category}</td>
                          <td>{item.stt}</td>
                          <td>{item.nlcm_code}</td>
                          <td className="wrap-cell">{item.competency_name}</td>
                          {Array.from({ length: 8 }, (_, index) => <td key={index}>{item.level_requirements?.[String(index + 1)] ?? 0}</td>)}
                          {editable && (
                            <td>
                              <button onClick={() => setItemForm({ ...item, level_requirements: item.level_requirements ?? emptyItemForm().level_requirements })}>Sửa</button>
                              <button onClick={() => deleteItem(item.id)}><Trash2 size={14} /></button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </>
                  ))}
                  <tr className="sum-row">
                    <td colSpan={4}>Tổng điểm chuẩn</td>
                    {Array.from({ length: 8 }, (_, index) => <td key={index}>{selected.level_sums?.[String(index + 1)] ?? 0}</td>)}
                    {editable && <td></td>}
                  </tr>
                </tbody>
              </table>
            </div>
            {editable && (
              <div className="et-item-editor">
                <h2>{itemForm.id ? "Sửa năng lực" : "Thêm năng lực"}</h2>
                <input placeholder="Mã NLCM" value={itemForm.nlcm_code} onChange={(event) => setItemForm({ ...itemForm, nlcm_code: event.target.value })} />
                <input placeholder="Tên năng lực" value={itemForm.competency_name} onChange={(event) => setItemForm({ ...itemForm, competency_name: event.target.value })} />
                <textarea placeholder="Chi tiết" value={itemForm.competency_detail ?? ""} onChange={(event) => setItemForm({ ...itemForm, competency_detail: event.target.value })} />
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
                  <button onClick={saveItem}><Save size={16} />Lưu năng lực</button>
                  <button onClick={() => setItemForm(emptyItemForm())}>Mới</button>
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

function PersonnelView({ role, setError }: { role: string; setError: (value: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [filters, setFilters] = useState({ search: "", team: "", position: "", level: "" });
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<any>({ employee_code: "", full_name: "", position_code: "", team: "", current_level: 1, status: "active", user_id: "" });
  const editable = canManage(role);

  const load = () => {
    api.etPersonnel(query(filters)).then(setRows).catch((err) => setError(err.message));
    api.etPersonnelSummary().then(setSummary).catch(() => undefined);
  };
  useEffect(load, []);

  const save = () => {
    const payload = { ...form, current_level: Number(form.current_level), user_id: form.user_id || null };
    const request = form.id ? api.updateEtPersonnel(form.id, payload) : api.createEtPersonnel(payload);
    request.then(() => {
      setForm({ employee_code: "", full_name: "", position_code: "", team: "", current_level: 1, status: "active", user_id: "" });
      load();
    }).catch((err) => setError(err.message));
  };

  const importFile = () => {
    if (!file) return;
    api.importEtPersonnel(file).then(() => { setFile(null); load(); }).catch((err) => setError(err.message));
  };

  return (
    <div className="content-grid et-grid">
      <section className="panel">
        <div className="panel-header"><h2>Tìm kiếm</h2><button onClick={load}><Search size={16} /></button></div>
        <div className="form-stack">
          <input placeholder="Tên hoặc mã nhân viên" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          <input placeholder="Team" value={filters.team} onChange={(event) => setFilters({ ...filters, team: event.target.value })} />
          <input placeholder="Mã vị trí" value={filters.position} onChange={(event) => setFilters({ ...filters, position: event.target.value })} />
          <input placeholder="Bậc" type="number" min={1} max={8} value={filters.level} onChange={(event) => setFilters({ ...filters, level: event.target.value })} />
          <button onClick={load}>Lọc</button>
        </div>
        {summary && (
          <div className="et-stats">
            <div><strong>{summary.total}</strong><span>Tổng nhân sự</span></div>
            <div><strong>{Object.keys(summary.by_team ?? {}).length}</strong><span>Team</span></div>
            <div><strong>{Object.keys(summary.by_position ?? {}).length}</strong><span>Vị trí</span></div>
          </div>
        )}
      </section>
      {editable && (
        <section className="panel">
          <h2>{form.id ? "Sửa nhân sự" : "Thêm nhân sự"}</h2>
          <div className="form-stack">
            <input placeholder="Mã nhân viên" value={form.employee_code} onChange={(event) => setForm({ ...form, employee_code: event.target.value })} />
            <input placeholder="Họ tên" value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} />
            <input placeholder="Mã khung/vị trí" value={form.position_code} onChange={(event) => setForm({ ...form, position_code: event.target.value })} />
            <input placeholder="Team" value={form.team} onChange={(event) => setForm({ ...form, team: event.target.value })} />
            <input type="number" min={1} max={8} value={form.current_level} onChange={(event) => setForm({ ...form, current_level: Number(event.target.value) })} />
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="active">Đang làm việc</option>
              <option value="inactive">Nghỉ việc</option>
              <option value="transferred">Chuyển đi</option>
            </select>
            <input placeholder="User ID liên kết" value={form.user_id ?? ""} onChange={(event) => setForm({ ...form, user_id: event.target.value })} />
            <div className="toolbar">
              <button onClick={save}><Save size={16} />Lưu</button>
              <label className="icon-button"><FileUp size={16} />Import<input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
              <button onClick={importFile} disabled={!file}>Nạp</button>
            </div>
          </div>
        </section>
      )}
      <section className="panel wide">
        <div className="matrix">
          <table>
            <thead>
              <tr><th>Mã NV</th><th>Họ tên</th><th>Team</th><th>Vị trí</th><th>Bậc</th><th>Trạng thái</th><th>User</th>{editable && <th></th>}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.employee_code}</td>
                  <td>{row.full_name}</td>
                  <td>{row.team}</td>
                  <td>{row.position_code}</td>
                  <td>{row.current_level}</td>
                  <td>{row.status}</td>
                  <td>{row.user_id}</td>
                  {editable && <td><button onClick={() => setForm(row)}>Sửa</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AssessmentView({ role, setError }: { role: string; currentUserId: string; setError: (value: string) => void }) {
  const [assessments, setAssessments] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [createForm, setCreateForm] = useState({ personnel_id: "", assessment_period: "" });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editable = canManage(role);

  const load = () => {
    api.etAssessments().then(setAssessments).catch((err) => setError(err.message));
    if (editable) {
      api.etPersonnel("?status=active").then(setPersonnel).catch(() => undefined);
    }
  };
  useEffect(load, []);

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
    api.createEtAssessment(createForm).then((row) => {
      setCreateForm({ personnel_id: "", assessment_period: "" });
      setSelected(row);
      setDraft(row);
      load();
    }).catch((err) => setError(err.message));
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
        <div className="panel-header"><h2>Phiếu đánh giá</h2><button onClick={load}><RefreshCw size={16} /></button></div>
        {editable && (
          <div className="form-stack">
            <select value={createForm.personnel_id} onChange={(event) => setCreateForm({ ...createForm, personnel_id: event.target.value })}>
              <option value="">Chọn nhân sự</option>
              {personnel.map((row) => <option key={row.id} value={row.id}>{row.employee_code} - {row.full_name}</option>)}
            </select>
            <input placeholder="Kỳ đánh giá, ví dụ 2026-Q2" value={createForm.assessment_period} onChange={(event) => setCreateForm({ ...createForm, assessment_period: event.target.value })} />
            <button onClick={create}><Plus size={16} />Tạo phiếu</button>
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

function LearningPlanView({ role, setError }: { role: string; setError: (value: string) => void }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState({ personnel_id: "", title: "", start_date: "", duration_months: 14 });
  const editable = canManage(role);

  const load = () => {
    api.etLearningPlans().then(setPlans).catch((err) => setError(err.message));
    if (editable) api.etPersonnel("?status=active").then(setPersonnel).catch(() => undefined);
  };
  useEffect(load, []);

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
        <div className="panel-header"><h2>Kế hoạch học tập</h2><button onClick={load}><RefreshCw size={16} /></button></div>
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
            <button onClick={load}><RefreshCw size={16} /></button>
            <button onClick={() => api.exportEtDashboard(query(filters)).then((blob) => saveBlob(blob, "et-dashboard.xlsx"))}><FileDown size={16} /></button>
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
