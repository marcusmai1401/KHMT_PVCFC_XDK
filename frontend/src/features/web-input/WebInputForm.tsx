import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Clipboard, Copy, Download, FileDown, Lock, RefreshCw, Save, Send, Unlock } from "lucide-react";
import { api } from "../../api/client";

const TEAMS = ["TBHTĐK", "TBCH", "TBĐL", "TCĐK"];
const KR_ASSESSMENTS = ["Hoàn thành xuất sắc", "Hoàn thành tốt", "Hoàn thành", "Không hoàn thành", "N/A"];
const MONTHLY_ASSESSMENTS = [
  "Hoàn thành xuất sắc nhiệm vụ",
  "Hoàn thành tốt nhiệm vụ",
  "Hoàn thành nhiệm vụ",
  "Không hoàn thành nhiệm vụ"
];
const OBJECTIVE_OVERRIDE_OPTIONS = ["", "Hoàn thành xuất sắc nhiệm vụ", "Hoàn thành tốt nhiệm vụ", "Hoàn thành nhiệm vụ", "Không hoàn thành nhiệm vụ", "Không có kế hoạch"];
const OBJECTIVES = ["O1", "O2", "O3", "O4", "O5", "O6"];

type KRMapping = {
  workshop_kr_code: string;
  kr_name: string;
  measurement_type: string;
  target_value: string;
};

type KRAssessment = {
  workshop_kr_code: string;
  implementation_report: string;
  team_self_assessment: string | null;
  notes: string;
};

type ArisingWork = {
  content: string;
  status: string;
};

type WebInputData = {
  kr_assessments: KRAssessment[];
  arising_work: ArisingWork[];
  monthly_conclusion: {
    discipline_status: string;
    discipline_description: string;
    overall_assessment: string;
    detailed_description: string;
  };
  objective_overrides: Record<string, string | null>;
};

type ValidationError = {
  field: string;
  message: string;
  kr_code?: string | null;
};

function krSortKey(code: string): [number, number, string] {
  const match = /^O(\d+)\.KR(\d+)$/i.exec(code || "");
  if (!match) return [999, 999, code || ""];
  return [Number(match[1]), Number(match[2]), code];
}

function objectiveFor(code: string) {
  return code.split(".", 1)[0] || "O1";
}

function emptyData(mapping: KRMapping[]): WebInputData {
  return {
    kr_assessments: [...mapping].sort((a, b) => {
      const left = krSortKey(a.workshop_kr_code);
      const right = krSortKey(b.workshop_kr_code);
      return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
    }).map((item) => ({
      workshop_kr_code: item.workshop_kr_code,
      implementation_report: "",
      team_self_assessment: null,
      notes: ""
    })),
    arising_work: [],
    monthly_conclusion: {
      discipline_status: "OK",
      discipline_description: "",
      overall_assessment: "Hoàn thành nhiệm vụ",
      detailed_description: ""
    },
    objective_overrides: {}
  };
}

function mergeData(data: Partial<WebInputData> | undefined, mapping: KRMapping[]): WebInputData {
  const base = emptyData(mapping);
  const byCode = new Map((data?.kr_assessments ?? []).map((item) => [item.workshop_kr_code, item]));
  return {
    ...base,
    ...data,
    kr_assessments: base.kr_assessments.map((item) => ({
      ...item,
      ...(byCode.get(item.workshop_kr_code) ?? {})
    })),
    arising_work: data?.arising_work ?? [],
    monthly_conclusion: {
      ...base.monthly_conclusion,
      ...(data?.monthly_conclusion ?? {})
    },
    objective_overrides: data?.objective_overrides ?? {}
  };
}

function validateData(data: WebInputData): ValidationError[] {
  const errors: ValidationError[] = [];
  data.kr_assessments.forEach((item, index) => {
    if (!item.team_self_assessment) {
      errors.push({ field: `kr-${item.workshop_kr_code}-assessment`, message: `Thiếu đánh giá cho ${item.workshop_kr_code}`, kr_code: item.workshop_kr_code });
    }
    if (item.team_self_assessment && item.team_self_assessment !== "N/A" && !item.implementation_report.trim()) {
      errors.push({ field: `kr-${item.workshop_kr_code}-report`, message: `Thiếu tình hình thực hiện cho ${item.workshop_kr_code}`, kr_code: item.workshop_kr_code });
    }
    if (item.implementation_report.length > 10000) {
      errors.push({ field: `kr-${item.workshop_kr_code}-report`, message: `Tình hình thực hiện dòng ${index + 1} vượt 10.000 ký tự`, kr_code: item.workshop_kr_code });
    }
  });
  data.arising_work.forEach((item, index) => {
    if (!item.content.trim()) errors.push({ field: `arising-${index}-content`, message: `Thiếu nội dung công việc phát sinh #${index + 1}` });
    if (item.content.length > 2000) errors.push({ field: `arising-${index}-content`, message: `Công việc phát sinh #${index + 1} vượt 2.000 ký tự` });
  });
  if (data.monthly_conclusion.discipline_status === "NOK" && !data.monthly_conclusion.discipline_description.trim()) {
    errors.push({ field: "discipline-description", message: "Cần mô tả khi kỷ luật là NOK" });
  }
  if (data.monthly_conclusion.overall_assessment === "Không hoàn thành nhiệm vụ" && data.monthly_conclusion.detailed_description.trim().length < 20) {
    errors.push({ field: "detailed-description", message: "Cần lý do ít nhất 20 ký tự khi Không hoàn thành nhiệm vụ" });
  }
  return errors;
}

function deriveObjectiveAssessments(data: WebInputData) {
  const rank: Record<string, number> = {
    "Không hoàn thành": 0,
    "Hoàn thành": 1,
    "Hoàn thành tốt": 2,
    "Hoàn thành xuất sắc": 3
  };
  const mapText: Record<string, string> = {
    "Không hoàn thành": "Không hoàn thành nhiệm vụ",
    "Hoàn thành": "Hoàn thành nhiệm vụ",
    "Hoàn thành tốt": "Hoàn thành tốt nhiệm vụ",
    "Hoàn thành xuất sắc": "Hoàn thành xuất sắc nhiệm vụ"
  };
  return Object.fromEntries(OBJECTIVES.map((objective) => {
    const values = data.kr_assessments
      .filter((item) => objectiveFor(item.workshop_kr_code) === objective && item.team_self_assessment && item.team_self_assessment !== "N/A")
      .map((item) => item.team_self_assessment as string)
      .filter((value) => value in rank);
    const derived = values.length ? mapText[values.sort((a, b) => rank[a] - rank[b])[0]] : "Không có kế hoạch";
    return [objective, data.objective_overrides[objective] || derived];
  }));
}

function buildEmailText(team: string, month: number, data: WebInputData) {
  const objectiveAssessments = deriveObjectiveAssessments(data);
  const lines = ["1. Báo cáo tổng quát:"];
  OBJECTIVES.forEach((objective) => {
    lines.push(`• Mục tiêu ĐK.${objective}.${team}.${objective}: ${objectiveAssessments[objective]}`);
  });
  if (data.arising_work.some((item) => item.content.trim())) {
    lines.push("• Ngoài kế hoạch mục tiêu trong tháng đội có thực hiện thêm các việc phát sinh:");
    data.arising_work.filter((item) => item.content.trim()).forEach((item) => {
      const suffix = item.status !== "Hoàn thành" ? ` (${item.status})` : "";
      lines.push(`  - ${item.content.trim()}${suffix}`);
    });
  }
  lines.push("");
  lines.push(`2. Đánh giá chung kết quả tháng ${month}: ${data.monthly_conclusion.overall_assessment}`);
  if (data.monthly_conclusion.detailed_description.trim()) {
    lines.push(data.monthly_conclusion.detailed_description.trim());
  }
  return lines.join("\n");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function WebInputForm({
  role,
  currentUserId,
  currentTeam,
}: {
  role: string;
  currentUserId: string;
  currentTeam?: string | null;
}) {
  const now = new Date();
  const teamFromAccount = currentTeam ?? currentUserId;
  const [mapping, setMapping] = useState<KRMapping[]>([]);
  const [team, setTeam] = useState(TEAMS.includes(teamFromAccount) ? teamFromAccount : "TBHTĐK");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<WebInputData>(emptyData([]));
  const [status, setStatus] = useState("Chưa nhập");
  const [locked, setLocked] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => Object.fromEntries(OBJECTIVES.map((objective) => [objective, true])));
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const autosaveTimer = useRef<number | null>(null);

  const canWrite = role === "Admin" || (role === "Team_Account" && teamFromAccount === team);
  const readOnly = !canWrite || locked;
  const emailText = useMemo(() => buildEmailText(team, month, data), [team, month, data]);

  const mappingByCode = useMemo(() => new Map(mapping.map((item) => [item.workshop_kr_code, item])), [mapping]);
  const grouped = useMemo(() => {
    const groups: Record<string, KRAssessment[]> = Object.fromEntries(OBJECTIVES.map((objective) => [objective, []]));
    data.kr_assessments.forEach((item) => {
      groups[objectiveFor(item.workshop_kr_code)]?.push(item);
    });
    return groups;
  }, [data.kr_assessments]);

  const completion = useMemo(() => {
    if (!data.kr_assessments.length) return 0;
    const complete = data.kr_assessments.filter((item) => item.team_self_assessment && (item.team_self_assessment === "N/A" || item.implementation_report.trim())).length;
    return Math.round((complete / data.kr_assessments.length) * 100);
  }, [data.kr_assessments]);

  const summaryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      "Hoàn thành xuất sắc": 0,
      "Hoàn thành tốt": 0,
      "Hoàn thành": 0,
      "Không hoàn thành": 0,
      "N/A": 0,
      "Chưa chọn": 0
    };
    data.kr_assessments.forEach((item) => {
      const key = item.team_self_assessment || "Chưa chọn";
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [data.kr_assessments]);

  const load = useCallback(() => {
    if (!mapping.length) return;
    setLoading(true);
    api.getWebInput(team, month, year)
      .then((response) => {
        setData(mergeData(response.data, mapping));
        setStatus(response.status ?? "Chưa nhập");
        setLocked(Boolean(response.locked));
        setVersion(response.version ?? null);
        setSavedAt(response.last_saved_at ?? response.submitted_at ?? null);
        setWarnings(response.warnings ?? []);
        setValidationErrors(response.validation_errors ?? []);
        setUnsaved(false);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [mapping, team, month, year]);

  useEffect(() => {
    api.krMapping()
      .then((items) => {
        const sorted = [...items].sort((a, b) => {
          const left = krSortKey(a.workshop_kr_code);
          const right = krSortKey(b.workshop_kr_code);
          return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
        });
        setMapping(sorted);
        setData(emptyData(sorted));
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveDraft = useCallback((manual = false) => {
    if (!canWrite || locked) return Promise.resolve();
    setSaving(true);
    return api.saveWebInputDraft(team, month, year, data, version)
      .then((response) => {
        setStatus(response.status ?? "Đang nhập");
        setVersion(response.version ?? null);
        setSavedAt(response.last_saved_at ?? new Date().toISOString());
        setWarnings(response.warnings ?? []);
        setUnsaved(false);
        setError(manual ? "Đã lưu draft." : "");
      })
      .catch((err) => {
        setError(err.message);
        if (err.message.includes("Draft") || err.message.includes("VERSION")) {
          load();
        }
      })
      .finally(() => setSaving(false));
  }, [canWrite, data, locked, load, month, team, version, year]);

  useEffect(() => {
    if (!unsaved || readOnly) return;
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      saveDraft(false);
    }, 3000);
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, [data, readOnly, saveDraft, unsaved]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!unsaved) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [unsaved]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveDraft(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveDraft]);

  function mutate(next: (current: WebInputData) => WebInputData) {
    setData((current) => next(current));
    setUnsaved(true);
    setError("");
  }

  function preserveScroll(update: () => void) {
    const top = window.scrollY;
    update();
    window.requestAnimationFrame(() => window.scrollTo({ top }));
  }

  function toggleObjective(objective: string) {
    preserveScroll(() => setExpanded((current) => ({ ...current, [objective]: !current[objective] })));
  }

  function setAllObjectives(nextExpanded: boolean) {
    preserveScroll(() => setExpanded(Object.fromEntries(OBJECTIVES.map((objective) => [objective, nextExpanded]))));
  }

  function updateKr(code: string, patch: Partial<KRAssessment>) {
    mutate((current) => ({
      ...current,
      kr_assessments: current.kr_assessments.map((item) => item.workshop_kr_code === code ? { ...item, ...patch } : item)
    }));
  }

  function focusFirstError(errors: ValidationError[]) {
    const first = errors[0]?.field;
    if (!first) return;
    window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(`[data-field="${first}"]`);
      element?.focus();
    }, 0);
  }

  function submit() {
    const errors = validateData(data);
    setValidationErrors(errors);
    if (errors.length) {
      focusFirstError(errors);
      return;
    }
    setSaving(true);
    api.submitWebInput(team, month, year, data)
      .then((response) => {
        setData(mergeData(response.data, mapping));
        setStatus(response.status ?? "Đã gửi");
        setVersion(response.version ?? null);
        setLocked(Boolean(response.locked));
        setSavedAt(response.submitted_at ?? new Date().toISOString());
        setWarnings(response.warnings ?? []);
        setValidationErrors([]);
        setUnsaved(false);
        setError("Đã gửi báo cáo.");
      })
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false));
  }

  function preview() {
    const errors = validateData(data);
    setValidationErrors(errors);
    setShowPreview(true);
  }

  function copyEmail() {
    navigator.clipboard?.writeText(emailText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }

  function downloadExcel() {
    api.exportWebInputExcel(team, month, year)
      .then((blob) => downloadBlob(blob, `bao-cao-okr-${team}-T${month}-${year}.xlsx`))
      .catch((err) => setError(err.message));
  }

  function downloadEmail() {
    api.downloadWebInputEmail(team, month, year)
      .then((blob) => downloadBlob(blob, `email-bao-cao-okr-${team}-T${month}-${year}.txt`))
      .catch((err) => setError(err.message));
  }

  function toggleLock(nextLocked: boolean) {
    const reason = window.prompt(nextLocked ? "Lý do chốt báo cáo" : "Lý do mở chốt báo cáo");
    if (!reason) return;
    const request = nextLocked ? api.lockWebInput(team, month, year, reason) : api.unlockWebInput(team, month, year, reason);
    request.then((response) => {
      setStatus(response.status);
      setLocked(Boolean(response.locked));
      setError(nextLocked ? "Đã chốt báo cáo." : "Đã mở chốt báo cáo.");
    }).catch((err) => setError(err.message));
  }

  const saveLabel = saving ? "Đang lưu" : unsaved ? "Chưa lưu" : savedAt ? `Đã lưu ${new Date(savedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : "Chưa có dữ liệu";

  return (
    <div className="web-input-shell">
      <section className="panel wide web-input-header">
        <div>
          <h2>Nhập liệu OKR</h2>
          <p className="muted">Dữ liệu web form dùng chung Dashboard và báo cáo Excel hiện có.</p>
        </div>
        <div className="web-input-controls">
          <label>
            <span>Đội/Tổ</span>
            <select value={team} onChange={(event) => setTeam(event.target.value)} disabled={role === "Team_Account"}>
              {TEAMS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Tháng</span>
            <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => <option key={item} value={item}>T{item}</option>)}
            </select>
          </label>
          <label>
            <span>Năm</span>
            <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {Array.from({ length: 12 }, (_, index) => 2024 + index).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <span className={`status-badge status-${status.replace(/\s+/g, "-").toLowerCase()}`}>{status}</span>
        </div>
        <div className="web-input-actions">
          <span className={unsaved ? "save-state unsaved" : "save-state"}>{saveLabel}</span>
          <button type="button" onClick={load} title="Tải lại"><RefreshCw size={17} /></button>
          <button type="button" onClick={() => saveDraft(true)} disabled={readOnly || saving}><Save size={17} />Lưu draft</button>
          <button type="button" onClick={preview}><Clipboard size={17} />Xem trước</button>
          <button type="button" onClick={submit} disabled={readOnly || saving}><Send size={17} />Gửi báo cáo</button>
          {role === "Admin" && (
            <button type="button" onClick={() => toggleLock(!locked)}>{locked ? <Unlock size={17} /> : <Lock size={17} />}{locked ? "Mở chốt" : "Chốt"}</button>
          )}
        </div>
        <div className="progress-line" aria-label="Tiến độ hoàn thành">
          <span style={{ width: `${completion}%` }} />
        </div>
        {error && <p className={error.includes("Đã") ? "success" : "error"}>{error}</p>}
        {loading && <p className="muted">Đang tải dữ liệu...</p>}
      </section>

      <section className="panel wide">
        <div className="panel-header">
          <h2>Danh sách KR</h2>
          <div className="toolbar">
            <button type="button" onClick={() => setAllObjectives(true)}>Mở tất cả</button>
            <button type="button" onClick={() => setAllObjectives(false)}>Thu tất cả</button>
          </div>
        </div>
        {OBJECTIVES.map((objective) => (
          <div className="okr-accordion" key={objective}>
            <button type="button" className="okr-accordion-title" onClick={() => toggleObjective(objective)}>
              {expanded[objective] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <strong>{objective}</strong>
              <span>{grouped[objective]?.filter((item) => item.team_self_assessment).length ?? 0}/{grouped[objective]?.length ?? 0} KR đã nhập</span>
            </button>
            {expanded[objective] && (
              <div className="okr-objective-body">
                <label className="objective-override">
                  <span>Đánh giá Objective trong email</span>
                  <select
                    value={data.objective_overrides[objective] ?? ""}
                    disabled={readOnly}
                    onChange={(event) => mutate((current) => ({
                      ...current,
                      objective_overrides: { ...current.objective_overrides, [objective]: event.target.value || null }
                    }))}
                  >
                    {OBJECTIVE_OVERRIDE_OPTIONS.map((item) => <option key={item || "auto"} value={item}>{item || "Tự động theo KR"}</option>)}
                  </select>
                </label>
                {grouped[objective]?.map((item) => {
                  const mappingItem = mappingByCode.get(item.workshop_kr_code);
                  const itemErrors = validationErrors.filter((err) => err.kr_code === item.workshop_kr_code);
                  const itemWarnings = warnings.filter((warning) => warning.kr_code === item.workshop_kr_code);
                  return (
                    <div className={itemErrors.length ? "kr-row invalid" : "kr-row"} key={item.workshop_kr_code}>
                      <div className="kr-readonly">
                        <strong>{item.workshop_kr_code}</strong>
                        <span>{mappingItem?.kr_name ?? item.workshop_kr_code}</span>
                        <small>{mappingItem?.measurement_type || "-"} · {mappingItem?.target_value || "-"}</small>
                      </div>
                      <textarea
                        data-field={`kr-${item.workshop_kr_code}-report`}
                        value={item.implementation_report}
                        maxLength={10000}
                        disabled={readOnly}
                        onChange={(event) => updateKr(item.workshop_kr_code, { implementation_report: event.target.value })}
                        placeholder="Tình hình thực hiện"
                      />
                      <select
                        data-field={`kr-${item.workshop_kr_code}-assessment`}
                        value={item.team_self_assessment ?? ""}
                        disabled={readOnly}
                        onChange={(event) => updateKr(item.workshop_kr_code, { team_self_assessment: event.target.value || null })}
                      >
                        <option value="">Chọn đánh giá</option>
                        {KR_ASSESSMENTS.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                      <textarea
                        value={item.notes}
                        maxLength={5000}
                        disabled={readOnly}
                        onChange={(event) => updateKr(item.workshop_kr_code, { notes: event.target.value })}
                        placeholder="Ghi chú"
                      />
                      {[...itemErrors, ...itemWarnings.map((warning) => ({ message: warning.reason, field: "", kr_code: item.workshop_kr_code }))].map((err, index) => (
                        <small className={index < itemErrors.length ? "error" : "warning-text"} key={`${err.message}-${index}`}>{err.message}</small>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Công việc phát sinh</h2>
          <button type="button" disabled={readOnly || data.arising_work.length >= 20} onClick={() => mutate((current) => ({ ...current, arising_work: [...current.arising_work, { content: "", status: "Hoàn thành" }] }))}>Thêm</button>
        </div>
        {data.arising_work.length >= 20 && <p className="muted">Đã đạt tối đa 20 mục.</p>}
        <div className="arising-list">
          {data.arising_work.map((item, index) => (
            <div className="arising-item" key={index}>
              <strong>{index + 1}</strong>
              <textarea
                data-field={`arising-${index}-content`}
                value={item.content}
                maxLength={2000}
                disabled={readOnly}
                onChange={(event) => mutate((current) => ({
                  ...current,
                  arising_work: current.arising_work.map((row, rowIndex) => rowIndex === index ? { ...row, content: event.target.value } : row)
                }))}
                placeholder="Nội dung công việc"
              />
              <select
                value={item.status}
                disabled={readOnly}
                onChange={(event) => mutate((current) => ({
                  ...current,
                  arising_work: current.arising_work.map((row, rowIndex) => rowIndex === index ? { ...row, status: event.target.value } : row)
                }))}
              >
                <option>Hoàn thành</option>
                <option>Đang thực hiện</option>
                <option>Chưa bắt đầu</option>
              </select>
              <button type="button" disabled={readOnly} onClick={() => mutate((current) => ({ ...current, arising_work: current.arising_work.filter((_, rowIndex) => rowIndex !== index) }))}>Xóa</button>
            </div>
          ))}
          {!data.arising_work.length && <p className="muted">Không có công việc phát sinh.</p>}
        </div>
      </section>

      <section className="panel">
        <h2>Kết luận tháng</h2>
        <div className="form-stack">
          <label>
            <span>Kỷ luật</span>
            <select value={data.monthly_conclusion.discipline_status} disabled={readOnly} onChange={(event) => mutate((current) => ({ ...current, monthly_conclusion: { ...current.monthly_conclusion, discipline_status: event.target.value } }))}>
              <option>OK</option>
              <option>NOK</option>
            </select>
          </label>
          {data.monthly_conclusion.discipline_status === "NOK" && (
            <textarea
              data-field="discipline-description"
              value={data.monthly_conclusion.discipline_description}
              disabled={readOnly}
              maxLength={2000}
              onChange={(event) => mutate((current) => ({ ...current, monthly_conclusion: { ...current.monthly_conclusion, discipline_description: event.target.value } }))}
              placeholder="Mô tả kỷ luật"
            />
          )}
          <label>
            <span>Đánh giá chung</span>
            <select value={data.monthly_conclusion.overall_assessment} disabled={readOnly} onChange={(event) => mutate((current) => ({ ...current, monthly_conclusion: { ...current.monthly_conclusion, overall_assessment: event.target.value } }))}>
              {MONTHLY_ASSESSMENTS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <textarea
            data-field="detailed-description"
            value={data.monthly_conclusion.detailed_description}
            disabled={readOnly}
            maxLength={5000}
            onChange={(event) => mutate((current) => ({ ...current, monthly_conclusion: { ...current.monthly_conclusion, detailed_description: event.target.value } }))}
            placeholder="Mô tả chi tiết"
          />
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-header">
          <h2>Email báo cáo</h2>
          <div className="toolbar">
            <button type="button" onClick={copyEmail}><Copy size={17} />{copied ? "Đã copy" : "Copy"}</button>
            <button type="button" onClick={downloadEmail}><FileDown size={17} />Tải .txt</button>
            <button type="button" onClick={downloadExcel}><Download size={17} />Tải Excel</button>
          </div>
        </div>
        <textarea className="email-preview" readOnly value={emailText} />
      </section>

      {showPreview && (
        <section className="panel wide preview-panel">
          <div className="panel-header">
            <h2>Xem trước báo cáo</h2>
            <button type="button" onClick={() => setShowPreview(false)}>Quay lại nhập</button>
          </div>
          {validationErrors.length > 0 && (
            <div className="error-list">
              {validationErrors.map((err, index) => <p className="error" key={`${err.field}-${index}`}>{err.message}</p>)}
            </div>
          )}
          <div className="preview-summary">
            {Object.entries(summaryCounts).map(([label, count]) => (
              <div className="preview-stat" key={label}>
                <span>{label}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
          <div className="matrix preview-table">
            <table>
              <thead>
                <tr>
                  <th>KR</th>
                  <th>Tình hình thực hiện</th>
                  <th>Đánh giá</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {data.kr_assessments.map((item) => (
                  <tr key={item.workshop_kr_code} className={validationErrors.some((err) => err.kr_code === item.workshop_kr_code) ? "invalid-row" : ""}>
                    <td>{item.workshop_kr_code}</td>
                    <td>{item.implementation_report}</td>
                    <td>{item.team_self_assessment || "Chưa chọn"}</td>
                    <td>{item.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="preview-sections">
            <section>
              <h2>Công việc phát sinh</h2>
              {data.arising_work.filter((item) => item.content.trim()).length ? (
                <ol>
                  {data.arising_work.filter((item) => item.content.trim()).map((item, index) => (
                    <li key={`${item.content}-${index}`}>
                      {item.content} <small>{item.status}</small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">Không có công việc phát sinh.</p>
              )}
            </section>
            <section>
              <h2>Kết luận tháng</h2>
              <p><strong>Kỷ luật:</strong> {data.monthly_conclusion.discipline_status}</p>
              {data.monthly_conclusion.discipline_description && <p>{data.monthly_conclusion.discipline_description}</p>}
              <p><strong>Đánh giá chung:</strong> {data.monthly_conclusion.overall_assessment}</p>
              {data.monthly_conclusion.detailed_description && <p>{data.monthly_conclusion.detailed_description}</p>}
            </section>
          </div>
          <pre className="preview-email">{emailText}</pre>
        </section>
      )}
    </div>
  );
}
