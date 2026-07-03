import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldAlert,
  Unlock,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api } from "../../api/client";

const TEAMS = ["TBHTĐK", "TBCH", "TBĐL", "TCĐK"];
const KR_ASSESSMENTS = ["Hoàn thành xuất sắc", "Hoàn thành tốt", "Hoàn thành", "Không hoàn thành", "N/A"];
const ASSESSMENT_SHORT: Record<string, string> = {
  "Hoàn thành xuất sắc": "Xuất sắc",
  "Hoàn thành tốt": "Tốt",
  "Hoàn thành": "Đạt",
  "Không hoàn thành": "Không đạt",
  "N/A": "N/A",
};

function assessmentTone(value: string | null | undefined): string {
  switch (value) {
    case "Hoàn thành xuất sắc":
      return "tone-excellent";
    case "Hoàn thành tốt":
      return "tone-good";
    case "Hoàn thành":
      return "tone-pass";
    case "Không hoàn thành":
      return "tone-fail";
    case "N/A":
      return "tone-na";
    default:
      return "tone-pending";
  }
}
const MONTHLY_ASSESSMENTS = [
  "Hoàn thành xuất sắc nhiệm vụ",
  "Hoàn thành tốt nhiệm vụ",
  "Hoàn thành nhiệm vụ",
  "Không hoàn thành nhiệm vụ"
];
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
    discipline_violators: string[];
    overall_assessment: string;
    detailed_description: string;
  };
  objective_overrides: Record<string, string | null>;
};

type Employee = {
  id: string;
  display_name: string;
  full_name: string;
  team: string | null;
  role: string;
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
      discipline_violators: [],
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
    errors.push({ field: "discipline-description", message: "Cần mô tả khi tính tuân thủ là NOK" });
  }
  if (data.monthly_conclusion.discipline_status === "NOK" && data.monthly_conclusion.discipline_violators.length === 0) {
    errors.push({ field: "discipline-violators", message: "Cần tag nhân sự vi phạm khi tính tuân thủ là NOK" });
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
  editMode = true,
}: {
  role: string;
  currentUserId: string;
  currentTeam?: string | null;
  editMode?: boolean;
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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [violatorPickerOpen, setViolatorPickerOpen] = useState(false);
  const [violatorSearch, setViolatorSearch] = useState("");
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const autosaveTimer = useRef<number | null>(null);

  const canWrite = role === "Admin" && editMode;
  const readOnly = !canWrite || locked;
  const showAdminEditCommands = canWrite;
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
    api.listTaggableEmployees()
      .then((list) => setEmployees(list))
      .catch(() => setEmployees([]));
  }, []);

  // After data is reloaded (team/month/year changed), reset the "đăng ký xong" flag
  // so user has to confirm again before submitting.
  useEffect(() => {
    setHasSavedDraft(false);
  }, [team, month, year]);

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
        if (manual) {
          setHasSavedDraft(true);
          setError("Đã lưu đăng ký. Bạn có thể bấm Gửi báo cáo.");
        } else {
          setError("");
        }
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
    setHasSavedDraft(false);
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
          <button aria-label="Tải lại" type="button" onClick={load} title="Tải lại"><RefreshCw size={17} className={loading ? "icon-spin" : undefined} /></button>
          {showAdminEditCommands && (
            <button
              type="button"
              className={hasSavedDraft ? "btn-primary-soft is-saved" : "btn-primary-soft"}
              onClick={() => saveDraft(true)}
              disabled={readOnly || saving}
              title={hasSavedDraft ? "Đã lưu đăng ký — bạn có thể gửi báo cáo" : "Lưu đăng ký trước khi gửi báo cáo"}
            >
              <Save size={17} />Lưu đăng ký
            </button>
          )}
          <button type="button" onClick={preview}><Clipboard size={17} />Xem trước</button>
          {showAdminEditCommands && (
            <button
              type="button"
              className={hasSavedDraft && !unsaved ? "btn-primary" : ""}
              onClick={submit}
              disabled={readOnly || saving || !hasSavedDraft || unsaved}
              title={!hasSavedDraft || unsaved ? "Cần bấm Lưu đăng ký trước khi gửi báo cáo" : "Gửi báo cáo chính thức"}
            >
              <Send size={17} />Gửi báo cáo
            </button>
          )}
          {role === "Admin" && editMode && (
            <button type="button" onClick={() => toggleLock(!locked)}>{locked ? <Unlock size={17} /> : <Lock size={17} />}{locked ? "Mở chốt" : "Chốt"}</button>
          )}
        </div>
        <div className="progress-line" aria-label="Tiến độ hoàn thành">
          <span style={{ width: `${completion}%` }} />
        </div>
        {error && <p className={error.includes("Đã") ? "success" : "error"}>{error}</p>}
        {loading && (
          <p className="loading-inline" role="status">
            <Loader2 size={15} className="icon-spin" />
            Đang tải dữ liệu...
          </p>
        )}
      </section>

      <section className="panel wide kr-input-panel">
        <div className="panel-header">
          <div>
            <h2>Danh sách KR</h2>
            <p className="panel-sub">Chọn đánh giá và mô tả tình hình thực hiện từng KR</p>
          </div>
          <div className="toolbar">
            <button type="button" onClick={() => setAllObjectives(true)}>Mở tất cả</button>
            <button type="button" onClick={() => setAllObjectives(false)}>Thu tất cả</button>
          </div>
        </div>
        {OBJECTIVES.map((objective) => {
          const objKrs = grouped[objective] || [];
          const objDone = objKrs.filter((item) => item.team_self_assessment).length;
          const objPct = objKrs.length ? Math.round((objDone / objKrs.length) * 100) : 0;
          return (
            <div className={`okr-accordion ${expanded[objective] ? "is-open" : ""}`} key={objective}>
              <button type="button" className="okr-accordion-title" onClick={() => toggleObjective(objective)}>
                <span className="okr-accordion-chevron">
                  {expanded[objective] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </span>
                <strong className="okr-accordion-badge">{objective}</strong>
                <span className="okr-accordion-meta">
                  <em>{objDone}</em>/{objKrs.length} KR đã đánh giá
                </span>
                <span className="okr-accordion-progress">
                  <span style={{ width: `${objPct}%` }} />
                </span>
                <small className="okr-accordion-pct">{objPct}%</small>
              </button>
              {expanded[objective] && (
                <div className="okr-objective-body">
                  {objKrs.map((item) => {
                    const mappingItem = mappingByCode.get(item.workshop_kr_code);
                    const itemErrors = validationErrors.filter((err) => err.kr_code === item.workshop_kr_code);
                    const itemWarnings = warnings.filter((warning) => warning.kr_code === item.workshop_kr_code);
                    const assessment = item.team_self_assessment;
                    const cardTone = itemErrors.length
                      ? "tone-error"
                      : assessment
                        ? assessmentTone(assessment)
                        : "tone-pending";
                    return (
                      <article className={`kr-card ${cardTone}`} key={item.workshop_kr_code}>
                        <header className="kr-card-head">
                          <span className="kr-card-code">{item.workshop_kr_code}</span>
                          <div className="kr-card-title">
                            <h4>{mappingItem?.kr_name ?? item.workshop_kr_code}</h4>
                            <div className="kr-card-meta">
                              <span className="kr-meta-pill">{mappingItem?.measurement_type || "Chưa định kỳ"}</span>
                              <span className="kr-meta-pill kr-meta-target">Mục tiêu: {mappingItem?.target_value || "—"}</span>
                            </div>
                          </div>
                          {assessment ? (
                            <span className={`kr-status-chip ${assessmentTone(assessment)}`}>
                              <CheckCircle2 size={14} />
                              {ASSESSMENT_SHORT[assessment]}
                            </span>
                          ) : (
                            <span className="kr-status-chip is-pending">Chưa đánh giá</span>
                          )}
                        </header>

                        <div className="kr-card-grid">
                          <label className="kr-field kr-field-report">
                            <span className="kr-field-label">Tình hình thực hiện</span>
                            <textarea
                              data-field={`kr-${item.workshop_kr_code}-report`}
                              value={item.implementation_report}
                              maxLength={10000}
                              disabled={readOnly}
                              rows={3}
                              onChange={(event) => updateKr(item.workshop_kr_code, { implementation_report: event.target.value })}
                              placeholder="Mô tả kết quả, số liệu, nguyên nhân nếu lệch kế hoạch..."
                            />
                            <small className="kr-field-counter">{item.implementation_report.length}/10000</small>
                          </label>

                          <div className="kr-field kr-field-assessment">
                            <span className="kr-field-label">Đánh giá KR</span>
                            <div className="kr-assessment-grid" role="radiogroup" aria-label={`Đánh giá ${item.workshop_kr_code}`}>
                              {KR_ASSESSMENTS.map((value) => {
                                const tone = assessmentTone(value);
                                const isActive = assessment === value;
                                return (
                                  <button
                                    type="button"
                                    key={value}
                                    role="radio"
                                    aria-checked={isActive}
                                    className={`kr-assessment-pill ${tone} ${isActive ? "is-active" : ""}`}
                                    onClick={() => updateKr(item.workshop_kr_code, { team_self_assessment: isActive ? null : value })}
                                    disabled={readOnly}
                                    data-field={isActive ? `kr-${item.workshop_kr_code}-assessment` : undefined}
                                    title={value}
                                  >
                                    {isActive ? <CheckCircle2 className="kr-assessment-pill-tick" size={16} /> : null}
                                    <span className="kr-assessment-pill-label">{ASSESSMENT_SHORT[value]}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <label className="kr-field kr-field-notes">
                            <span className="kr-field-label">Ghi chú</span>
                            <textarea
                              value={item.notes}
                              maxLength={5000}
                              disabled={readOnly}
                              rows={2}
                              onChange={(event) => updateKr(item.workshop_kr_code, { notes: event.target.value })}
                              placeholder="Ghi chú thêm (nếu có)"
                            />
                          </label>
                        </div>

                        {(itemErrors.length || itemWarnings.length) ? (
                          <div className="kr-card-messages">
                            {itemErrors.map((err, index) => (
                              <small className="kr-message kr-message-error" key={`err-${index}`}>
                                <AlertTriangle size={12} /> {err.message}
                              </small>
                            ))}
                            {itemWarnings.map((warning, index) => (
                              <small className="kr-message kr-message-warning" key={`warn-${index}`}>
                                <AlertTriangle size={12} /> {warning.reason}
                              </small>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
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

      <section className="panel conclusion-panel">
        <div className="panel-header">
          <h2>Kết luận tháng</h2>
          <span className="panel-sub">Đánh giá tổng quan và tính tuân thủ trong kỳ</span>
        </div>
        <div className={`conclusion-grid ${data.monthly_conclusion.discipline_status === "NOK" ? "has-violation" : ""}`}>
          <div className="conclusion-card discipline-card">
            <header>
              <span className="conclusion-card-kicker"><ShieldAlert size={14} /> Tính tuân thủ</span>
              <div className="discipline-toggle" role="radiogroup" aria-label="Trạng thái tính tuân thủ">
                <button
                  type="button"
                  className={`discipline-pill ${data.monthly_conclusion.discipline_status === "OK" ? "is-active tone-ok" : ""}`}
                  onClick={() => mutate((current) => ({ ...current, monthly_conclusion: { ...current.monthly_conclusion, discipline_status: "OK", discipline_description: "", discipline_violators: [] } }))}
                  disabled={readOnly}
                >
                  <CheckCircle2 size={14} /> OK
                </button>
                <button
                  type="button"
                  className={`discipline-pill ${data.monthly_conclusion.discipline_status === "NOK" ? "is-active tone-ng" : ""}`}
                  onClick={() => mutate((current) => ({ ...current, monthly_conclusion: { ...current.monthly_conclusion, discipline_status: "NOK" } }))}
                  disabled={readOnly}
                >
                  <AlertTriangle size={14} /> NOK
                </button>
              </div>
            </header>
            {data.monthly_conclusion.discipline_status === "NOK" && (
              <div className="discipline-detail">
                <label className="discipline-field">
                  <span><Users size={13} /> Nhân sự vi phạm</span>
                  <ViolatorPicker
                    employees={employees}
                    selected={data.monthly_conclusion.discipline_violators}
                    excludedRoles={["Workshop_Leader", "Admin"]}
                    open={violatorPickerOpen}
                    setOpen={setViolatorPickerOpen}
                    search={violatorSearch}
                    setSearch={setViolatorSearch}
                    readOnly={readOnly}
                    onChange={(violators) => mutate((current) => ({ ...current, monthly_conclusion: { ...current.monthly_conclusion, discipline_violators: violators } }))}
                  />
                </label>
                <label className="discipline-field">
                  <span>Mô tả vi phạm</span>
                  <textarea
                    data-field="discipline-description"
                    value={data.monthly_conclusion.discipline_description}
                    disabled={readOnly}
                    maxLength={2000}
                    onChange={(event) => mutate((current) => ({ ...current, monthly_conclusion: { ...current.monthly_conclusion, discipline_description: event.target.value } }))}
                    placeholder="Mô tả ngắn gọn nội dung vi phạm..."
                    rows={3}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="conclusion-card assessment-card">
            <header>
              <span className="conclusion-card-kicker"><CheckCircle2 size={14} /> Đánh giá chung</span>
              <select
                className="assessment-select"
                value={data.monthly_conclusion.overall_assessment}
                disabled={readOnly}
                onChange={(event) => mutate((current) => ({ ...current, monthly_conclusion: { ...current.monthly_conclusion, overall_assessment: event.target.value } }))}
              >
                {MONTHLY_ASSESSMENTS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </header>
            <textarea
              data-field="detailed-description"
              value={data.monthly_conclusion.detailed_description}
              disabled={readOnly}
              maxLength={5000}
              onChange={(event) => mutate((current) => ({ ...current, monthly_conclusion: { ...current.monthly_conclusion, detailed_description: event.target.value } }))}
              placeholder="Diễn giải kết quả, nguyên nhân, đề xuất cho tháng tới..."
              rows={5}
            />
          </div>
        </div>
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
              <p><strong>Tính tuân thủ:</strong> {data.monthly_conclusion.discipline_status}</p>
              {data.monthly_conclusion.discipline_status === "NOK" && data.monthly_conclusion.discipline_violators.length > 0 && (
                <p>
                  <strong>Nhân sự vi phạm:</strong>{" "}
                  {data.monthly_conclusion.discipline_violators
                    .map((id) => employees.find((e) => e.id === id)?.full_name || id)
                    .join(", ")}
                </p>
              )}
              {data.monthly_conclusion.discipline_description && <p>{data.monthly_conclusion.discipline_description}</p>}
              <p><strong>Đánh giá chung:</strong> {data.monthly_conclusion.overall_assessment}</p>
              {data.monthly_conclusion.detailed_description && <p>{data.monthly_conclusion.detailed_description}</p>}
            </section>
          </div>
        </section>
      )}
    </div>
  );
}

const TEAM_LABEL: Record<string, string> = {
  TBHTĐK: "Đội thiết bị hệ thống điều khiển",
  TBCH: "Đội thiết bị chấp hành",
  TBĐL: "Đội thiết bị đo lường",
  TCĐK: "Tổ trực ca",
  Workshop_Staff: "Xưởng Điều khiển",
};

function ViolatorPicker({
  employees,
  selected,
  excludedRoles,
  open,
  setOpen,
  search,
  setSearch,
  readOnly,
  onChange,
}: {
  employees: Employee[];
  selected: string[];
  excludedRoles: string[];
  open: boolean;
  setOpen: (next: boolean) => void;
  search: string;
  setSearch: (next: string) => void;
  readOnly: boolean;
  onChange: (next: string[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, setOpen]);

  const excludedRoleSet = new Set(excludedRoles);
  const filtered = employees
    .filter((emp) => !excludedRoleSet.has(emp.role))
    .filter((emp) => {
      if (!search.trim()) return true;
      const needle = search.trim().toLowerCase();
      return (
        emp.full_name.toLowerCase().includes(needle) ||
        emp.display_name.toLowerCase().includes(needle) ||
        (emp.team || "").toLowerCase().includes(needle) ||
        emp.id.toLowerCase().includes(needle)
      );
    });
  const groupedByTeam = filtered.reduce<Record<string, Employee[]>>((acc, emp) => {
    const key = emp.team || "Khác";
    acc[key] = acc[key] || [];
    acc[key].push(emp);
    return acc;
  }, {});

  const selectedSet = new Set(selected);
  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };
  const remove = (id: string) => onChange(selected.filter((s) => s !== id));

  return (
    <div className={`violator-picker ${open ? "is-open" : ""}`} ref={containerRef} data-field="discipline-violators">
      <div className="violator-tags">
        {selected.length === 0 && <span className="violator-empty">Chưa có nhân sự nào được tag</span>}
        {selected.map((id) => {
          const emp = employees.find((e) => e.id === id);
          return (
            <span className="violator-tag" key={id}>
              <strong>{emp?.full_name || id}</strong>
              {emp?.team && <em>{emp.team}</em>}
              {!readOnly && (
                <button type="button" onClick={() => remove(id)} title="Bỏ tag" aria-label={`Bỏ tag ${emp?.full_name || id}`}>
                  <X size={12} />
                </button>
              )}
            </span>
          );
        })}
        {!readOnly && (
          <button type="button" className="violator-add" onClick={() => setOpen(!open)}>
            <UserPlus size={14} /> {open ? "Đóng" : "Tag nhân sự"}
          </button>
        )}
      </div>
      {open && !readOnly && (
        <div className="violator-dropdown" role="listbox">
          <div className="violator-search">
            <Search size={14} />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm theo tên, mã hoặc đội/tổ..."
              autoFocus
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Xóa tìm kiếm">
                <X size={12} />
              </button>
            )}
          </div>
          <div className="violator-list">
            {Object.entries(groupedByTeam).length === 0 ? (
              <p className="violator-empty">Không tìm thấy nhân sự phù hợp.</p>
            ) : (
              Object.entries(groupedByTeam).map(([team, list]) => (
                <div className="violator-group" key={team}>
                  <h5>{team} · {TEAM_LABEL[team] || team}</h5>
                  {list.map((emp) => {
                    const isSelected = selectedSet.has(emp.id);
                    return (
                      <button
                        type="button"
                        key={emp.id}
                        className={`violator-option ${isSelected ? "is-selected" : ""}`}
                        onClick={() => toggle(emp.id)}
                      >
                        <span className="violator-option-main">
                          <strong>{emp.full_name}</strong>
                          <small>{emp.id} · {emp.team || "—"}</small>
                        </span>
                        {isSelected ? <CheckCircle2 size={16} /> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
