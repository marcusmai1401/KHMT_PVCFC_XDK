import type { DashboardPayload } from "../features/okr/types/dashboard";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";

let token = "";

export function setToken(value: string) {
  token = value;
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

function toQuery(params: QueryParams = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) {
    return response.statusText;
  }
  try {
    const data = JSON.parse(body);
    if (typeof data.detail === "string") {
      return data.detail;
    }
    if (typeof data.detail?.message === "string") {
      return data.detail.message;
    }
    if (typeof data.message === "string") {
      return data.message;
    }
  } catch {
    // Fall back to the raw response body below.
  }
  return body;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!(init.body instanceof FormData) && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json() as Promise<T>;
}

async function requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.blob();
}

export function decodeToken(value: string): any {
  try {
    const payload = value.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

export const api = {
  login: (userId: string, password: string) =>
    request<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, password })
    }),
  sandboxSwitchRole: (userId: string) =>
    request<{ access_token: string }>("/auth/sandbox/switch-role", {
      method: "POST",
      body: JSON.stringify({ user_id: userId })
    }),
  sandboxReset: () => request<any>("/auth/sandbox/reset", { method: "POST" }),
  krMapping: () => request<any[]>("/okr/kr-mapping"),
  headcount: () => request<any>("/admin/headcount"),
  auditLog: () => request<any[]>("/admin/audit-log"),
  reports: () => request<any[]>("/okr/reports"),
  previewReport: (id: string) => request<any>(`/okr/reports/${id}/preview`),
  warnings: (month?: number, year?: number) => {
    const params = new URLSearchParams();
    if (month !== undefined) params.set("month", String(month));
    if (year !== undefined) params.set("year", String(year));
    const query = params.toString();
    return request<any[]>(`/okr/warnings${query ? `?${query}` : ""}`);
  },
  dashboard: (month: number, year: number) => request<DashboardPayload>(`/okr/dashboard/${month}/${year}`),
  dashboardLatest: (lastSelected?: { month: number; year: number }) => {
    const query = lastSelected
      ? `?last_selected_month=${lastSelected.month}&last_selected_year=${lastSelected.year}`
      : "";
    return request<DashboardPayload>(`/okr/dashboard/latest${query}`);
  },
  downloadReportTemplate: () => requestBlob("/okr/reports/template"),
  exportDashboard: () => requestBlob("/okr/dashboard/export", { method: "POST" }),
  updateLeaderKpiAllocation: (month: number, year: number, team: string, payload: { a1?: number | null; a2?: number | null }) =>
    request<DashboardPayload>(`/okr/leader-kpi-allocation/${month}/${year}/${encodeURIComponent(team)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  clientDebugLog: (payload: { source: string; event: string; message?: string; data?: Record<string, unknown> }) =>
    request<{ ok: boolean }>("/okr/client-debug-log", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  uploadReport: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<any>("/okr/reports/upload", { method: "POST", body });
  },
  importHistoricalSnapshot: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<any>("/okr/historical-snapshots/import", { method: "POST", body });
  },
  getWebInput: (team: string, month: number, year: number) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}`),
  saveWebInputDraft: (team: string, month: number, year: number, data: any, expectedVersion?: number | null) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/draft`, {
      method: "PUT",
      body: JSON.stringify({ data, expected_version: expectedVersion ?? null })
    }),
  submitWebInput: (team: string, month: number, year: number, data: any) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/submit`, {
      method: "POST",
      body: JSON.stringify({ data })
    }),
  lockWebInput: (team: string, month: number, year: number, reason: string) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/lock`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  unlockWebInput: (team: string, month: number, year: number, reason: string) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/unlock`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  getWebInputPreview: (team: string, month: number, year: number) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/preview`),
  getWebInputStatus: (month: number, year: number) =>
    request<any[]>(`/okr/web-input/status?month=${month}&year=${year}`),
  exportWebInputExcel: (team: string, month: number, year: number) =>
    requestBlob(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/export/excel`),
  getWebInputEmail: (team: string, month: number, year: number) =>
    request<{ text: string; filename: string }>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/export/email`),
  downloadWebInputEmail: (team: string, month: number, year: number) =>
    requestBlob(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/export/email/download`),
  createSk: (payload: any) =>
    request<any>("/fi/sk-ctkt", { method: "POST", body: JSON.stringify(payload) }),
  listSk: (filters: QueryParams = {}) => request<any[]>(`/fi/sk-ctkt${toQuery(filters)}`),
  getSk: (id: string) => request<any>(`/fi/sk-ctkt/${id}`),
  deleteSk: (id: string) => request<any>(`/fi/sk-ctkt/${id}`, { method: "DELETE" }),
  publicSk: (filters: QueryParams = {}) => request<any[]>(`/fi/sk-ctkt/public${toQuery(filters)}`),
  notifications: () => request<any[]>("/notifications"),
  markNotificationRead: (id: string) => request<any>(`/notifications/${id}/read`, { method: "PUT" }),
  transitionSk: (id: string, action: string, payload: any = {}) =>
    request<any>(`/fi/sk-ctkt/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  assignKhmt: (id: string, month: number, year: number) =>
    request<any>(`/fi/sk-ctkt/${id}/assign-khmt`, {
      method: "POST",
      body: JSON.stringify({ month, year })
    }),
  bm01Preview: () => request<any>("/fi/import/bm01/preview", { method: "POST" }),
  bm01Commit: () => request<any>("/fi/import/bm01/commit", { method: "POST" }),
  uploadSkImage: (skId: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<any>(`/fi/sk-ctkt/${skId}/images`, { method: "POST", body });
  },
  getSkImageBlob: (skId: string, imageId: string) =>
    requestBlob(`/fi/sk-ctkt/${skId}/images/${imageId}/raw`),
  deleteSkImage: (skId: string, imageId: string) =>
    request<any>(`/fi/sk-ctkt/${skId}/images/${imageId}`, { method: "DELETE" }),
  etFrameworks: () => request<any[]>("/et/frameworks"),
  etFramework: (id: string) => request<any>(`/et/frameworks/${id}`),
  createEtFramework: (payload: any) =>
    request<any>("/et/frameworks", { method: "POST", body: JSON.stringify(payload) }),
  updateEtFramework: (id: string, payload: any) =>
    request<any>(`/et/frameworks/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  duplicateEtFramework: (id: string) =>
    request<any>(`/et/frameworks/${id}/duplicate`, { method: "POST" }),
  activateEtFramework: (id: string) =>
    request<any>(`/et/frameworks/${id}/activate`, { method: "POST" }),
  importEtFrameworks: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<any>("/et/frameworks/import", { method: "POST", body });
  },
  addEtFrameworkItem: (frameworkId: string, payload: any) =>
    request<any>(`/et/frameworks/${frameworkId}/items`, { method: "POST", body: JSON.stringify(payload) }),
  updateEtFrameworkItem: (frameworkId: string, itemId: string, payload: any) =>
    request<any>(`/et/frameworks/${frameworkId}/items/${itemId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteEtFrameworkItem: (frameworkId: string, itemId: string) =>
    request<any>(`/et/frameworks/${frameworkId}/items/${itemId}`, { method: "DELETE" }),
  exportEtFramework: (id: string) => requestBlob(`/et/frameworks/${id}/export`),
  etPersonnel: (query = "") => request<any[]>(`/et/personnel${query}`),
  etPersonnelSummary: () => request<any>("/et/personnel/summary"),
  createEtPersonnel: (payload: any) =>
    request<any>("/et/personnel", { method: "POST", body: JSON.stringify(payload) }),
  updateEtPersonnel: (id: string, payload: any) =>
    request<any>(`/et/personnel/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  bulkUpdateEtPersonnelLevel: (payload: any) =>
    request<any>("/et/personnel/bulk-level", { method: "PUT", body: JSON.stringify(payload) }),
  importEtPersonnel: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<any>("/et/personnel/import", { method: "POST", body });
  },
  etAssessments: (query = "") => request<any[]>(`/et/assessments${query}`),
  etAssessment: (id: string) => request<any>(`/et/assessments/${id}`),
  createEtAssessment: (payload: any) =>
    request<any>("/et/assessments", { method: "POST", body: JSON.stringify(payload) }),
  updateEtAssessment: (id: string, payload: any) =>
    request<any>(`/et/assessments/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  refreshEtAssessmentScores: (id: string) =>
    request<any>(`/et/assessments/${id}/refresh-required-scores`, { method: "POST" }),
  submitEtAssessment: (id: string) =>
    request<any>(`/et/assessments/${id}/submit`, { method: "POST" }),
  exportEtAssessment: (id: string) => requestBlob(`/et/assessments/${id}/export`),
  etLearningPlans: (query = "") => request<any[]>(`/et/learning-plans${query}`),
  etLearningPlan: (id: string) => request<any>(`/et/learning-plans/${id}`),
  createEtLearningPlan: (payload: any) =>
    request<any>("/et/learning-plans", { method: "POST", body: JSON.stringify(payload) }),
  updateEtLearningPlan: (id: string, payload: any) =>
    request<any>(`/et/learning-plans/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  autoGenerateEtLearningPlan: (id: string, payload: any = {}) =>
    request<any>(`/et/learning-plans/${id}/auto-generate`, { method: "POST", body: JSON.stringify(payload) }),
  completeEtLearningPlanItem: (planId: string, itemId: string, payload: any = {}) =>
    request<any>(`/et/learning-plans/${planId}/items/${itemId}/complete`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  exportEtLearningPlan: (id: string) => requestBlob(`/et/learning-plans/${id}/export`),
  etDashboard: (query = "") => request<any>(`/et/dashboard${query}`),
  etHeatmap: (query = "") => request<any>(`/et/dashboard/heatmap${query}`),
  exportEtDashboard: (query = "") => requestBlob(`/et/dashboard/export${query}`)
};
