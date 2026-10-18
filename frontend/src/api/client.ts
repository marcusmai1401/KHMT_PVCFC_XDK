import type { DashboardPayload } from "../features/okr/types/dashboard";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";

let token = "";
let sessionExpired = false;

export function setToken(value: string) {
  token = value;
  sessionExpired = false;
}

function observeExpiredSession(error: ApiError, requestToken: string) {
  if (error.status !== 401 || !requestToken || requestToken !== token || sessionExpired) return;
  sessionExpired = true;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("okr:session-expired"));
}

function requireActiveSession(path: string, method = "GET") {
  if (sessionExpired && method.toUpperCase() !== "GET" && path !== "/auth/login") {
    throw new ApiError("Vui lòng đăng nhập lại trước khi gửi thay đổi. Bản nháp vẫn được giữ.", {status: 401, code: "SESSION_EXPIRED", outcomeUnknown: false});
  }
}

/** Storage partition only; authorization is always enforced by the server. */
export function recoveryNamespace() {
  let sandbox = false;
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    sandbox = JSON.parse(atob(encoded)).sandbox === true;
  } catch { /* Unauthenticated/test context uses the normal partition. */ }
  return `${API_BASE}:${sandbox ? "sandbox" : "normal"}`;
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export type ApiErrorCode =
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "FORBIDDEN"
  | "TEAM_MISMATCH"
  | "PASSWORD_CHANGE_REQUIRED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "PERIOD_LOCKED"
  | "REPORT_LOCKED"
  | "PREVIEW_STALE"
  | "IDEMPOTENCY_CONFLICT"
  | "CLIENT_UPDATE_REQUIRED"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

export type ApiErrorFields = Record<string, string | number | boolean | null | undefined>;

export type ApiErrorPayload = {
  code?: string;
  error_code?: string;
  message?: string;
  fields?: ApiErrorFields;
  details?: ApiErrorFields;
  request_id?: string;
  requestId?: string;
  retry_after?: number;
  retryAfter?: number;
  context?: Record<string, unknown>;
  current_revision?: number | null;
  currentRevision?: number | null;
  outcome_unknown?: boolean;
  outcomeUnknown?: boolean;
};

/** Stable error contract for every API call, including non-JSON failures. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields: ApiErrorFields;
  readonly requestId?: string;
  readonly retryAfter?: number;
  readonly context?: Record<string, unknown>;
  readonly currentRevision?: number | null;
  readonly outcomeUnknown: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      fields?: ApiErrorFields;
      requestId?: string;
      retryAfter?: number;
      context?: Record<string, unknown>;
      currentRevision?: number | null;
      outcomeUnknown?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? 0;
    this.code = normalizeApiErrorCode(options.code, this.status);
    this.fields = options.fields ?? {};
    this.requestId = options.requestId;
    this.retryAfter = options.retryAfter;
    this.context = options.context;
    this.currentRevision = options.currentRevision;
    this.outcomeUnknown = options.outcomeUnknown ?? this.status === 0;
  }
}
type FiReportExportFilters = {
  q?: string;
  registration_year?: number;
  teams?: string[];
  registration_months?: number[];
  decisions?: string[];
  khmt?: string[];
  khmt_periods?: string[];
  completion?: string[];
  authors?: string[];
  submitters?: string[];
};

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

function normalizeApiErrorCode(code: string | undefined, status: number): ApiErrorCode {
  const normalized = code?.toUpperCase();
  if (normalized === "FI_PREVIEW_STALE") return "PREVIEW_STALE";
  const known: ApiErrorCode[] = [
    "SESSION_EXPIRED", "SESSION_REVOKED", "FORBIDDEN", "TEAM_MISMATCH",
    "PASSWORD_CHANGE_REQUIRED", "NOT_FOUND", "VERSION_CONFLICT", "PERIOD_LOCKED",
    "REPORT_LOCKED", "PREVIEW_STALE", "IDEMPOTENCY_CONFLICT", "CLIENT_UPDATE_REQUIRED",
    "VALIDATION_ERROR", "RATE_LIMITED", "NETWORK_ERROR", "UNKNOWN_ERROR",
  ];
  if (normalized && known.includes(normalized as ApiErrorCode)) return normalized as ApiErrorCode;
  if (status === 401) return "SESSION_EXPIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "VERSION_CONFLICT";
  if (status === 428) return "CLIENT_UPDATE_REQUIRED";
  if (status === 400 || status === 422) return "VALIDATION_ERROR";
  if (status === 429) return "RATE_LIMITED";
  return status === 0 ? "NETWORK_ERROR" : "UNKNOWN_ERROR";
}

function parseErrorPayload(value: unknown): ApiErrorPayload {
  if (!value || typeof value !== "object") return {};
  const candidate = value as Record<string, unknown>;
  const detail = candidate.detail;
  if (Array.isArray(detail)) {
    const fields = Object.fromEntries(detail.map((item) => [
      Array.isArray(item.loc) ? item.loc.filter((part: string) => part !== "body").join(".") : "form",
      String(item.msg ?? "Giá trị không hợp lệ"),
    ]));
    return { code: "VALIDATION_ERROR", message: "Vui lòng kiểm tra các trường chưa hợp lệ.", fields };
  }
  if (detail && typeof detail === "object") {
    return { ...candidate, ...(detail as Record<string, unknown>) } as ApiErrorPayload;
  }
  if (typeof detail === "string") return { ...candidate, message: detail } as ApiErrorPayload;
  return candidate as ApiErrorPayload;
}

async function readApiError(response: Response): Promise<ApiError> {
  const body = await response.text();
  let payload: ApiErrorPayload = {};
  try {
    payload = parseErrorPayload(JSON.parse(body));
  } catch {
    // HTML and proxy text are still represented by the same typed error.
  }
  const fallback: Record<number, string> = {
    401: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    403: "Bạn không có quyền thực hiện thao tác này.",
    404: "Không tìm thấy dữ liệu yêu cầu.",
    409: "Dữ liệu đã thay đổi. Vui lòng kiểm tra phiên bản mới.",
    422: "Vui lòng kiểm tra các trường chưa hợp lệ.",
    428: "Vui lòng tải bản nháp rồi cập nhật trang để tiếp tục.",
    429: "Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.",
  };
  const message = payload.message || fallback[response.status] || "Máy chủ chưa xử lý được yêu cầu. Vui lòng thử lại sau.";
  const retryHeader = response.headers?.get("retry-after");
  const retrySeconds = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) : Math.max(0, Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000))) : undefined;
  return new ApiError(message, {
    status: response.status,
    code: payload.code || payload.error_code,
    fields: payload.fields || payload.details,
    requestId: payload.request_id || payload.requestId || response.headers?.get("x-request-id") || undefined,
    retryAfter: payload.retry_after ?? payload.retryAfter ?? (Number.isFinite(retrySeconds) ? retrySeconds : undefined),
    context: payload.context,
    currentRevision: payload.current_revision ?? payload.currentRevision,
    outcomeUnknown: payload.outcome_unknown ?? payload.outcomeUnknown,
  });
}

function reportApiFailure(path: string, error: ApiError, requestToken: string) {
  if (!requestToken || requestToken !== token || path.includes("client-debug-log")) return;
  const module = path.split("/")[1];
  if (!["okr", "fi", "et", "admin", "auth", "llm"].includes(module)) return;
  // A failed metric cannot delay or retry the business operation. No paths,
  // names, request bodies, tokens or editor text enter the telemetry payload.
  void fetch(`${API_BASE}/okr/client-debug-log`, {
    method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${requestToken}`},
    body: JSON.stringify({event_name: "api_failure", module, http_status: error.status, error_code: error.code}),
  }).catch(() => undefined);
}

function transientStatus(status: number) {
  return status === 408 || status === 425 || status >= 500;
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }, { once: true });
  });
}

function toNetworkError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  const message = error instanceof Error ? error.message : "Không thể kết nối máy chủ";
  return new ApiError(message, { code: "NETWORK_ERROR", outcomeUnknown: true });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  requireActiveSession(path, init.method);
  const requestToken = token;
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!(init.body instanceof FormData) && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const method = (init.method || "GET").toUpperCase();
  const canRetry = method === "GET";
  let attempt = 0;
  while (true) {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, { ...init, headers });
    } catch (error) {
      if (canRetry && attempt < 2 && !(error instanceof DOMException && error.name === "AbortError")) {
        attempt += 1;
        await wait(50 * attempt + Math.floor(Math.random() * 100), init.signal || undefined);
        continue;
      }
      throw toNetworkError(error);
    }
    if (!response.ok) {
      const apiError = await readApiError(response);
      if (canRetry && attempt < 2 && transientStatus(apiError.status)) {
        attempt += 1;
        await wait(50 * attempt + Math.floor(Math.random() * 100), init.signal || undefined);
        continue;
      }
      observeExpiredSession(apiError, requestToken);
      reportApiFailure(path, apiError, requestToken);
      throw apiError;
    }
    if (response.status === 204) return undefined as T;
    try {
      return await response.json() as T;
    } catch (error) {
      throw toNetworkError(error);
    }
  }
}

async function requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  requireActiveSession(path, init.method);
  const requestToken = token;
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (error) {
    throw toNetworkError(error);
  }
  if (!response.ok) {
    const error = await readApiError(response);
    observeExpiredSession(error, requestToken);
    reportApiFailure(path, error, requestToken);
    throw error;
  }
  return response.blob();
}

export type RevisionRequestOptions = {
  expectedRevision?: number | null;
  expectedFiTeamRevision?: number | null;
  expectedPlanHash?: string | null;
  signal?: AbortSignal;
  idempotencyKey?: string;
};

export type ClientTelemetryPayload = {
  event_name: string;
  route_template?: string;
  module?: string;
  duration_ms?: number;
  http_status?: number;
  error_code?: string;
  request_id?: string;
  build_id?: string;
  environment?: string;
  role?: string;
};

export function decodeToken(value: string): any {
  try {
    const payload = value.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

export type LoginResponse = {
  access_token: string;
  token_type?: string;
  must_change_password?: boolean;
  display_name?: string | null;
  role?: string | null;
  team?: string | null;
};

export const api = {
  login: (userId: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, password })
    }),
  me: () =>
    request<{
      user_id: string;
      role: string;
      team: string | null;
      display_name: string | null;
      must_change_password: boolean;
      sandbox: boolean;
    }>("/auth/me"),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<LoginResponse>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    }),
  sandboxEnter: () => request<LoginResponse>("/auth/sandbox/enter", { method: "POST" }),
  sandboxIdentities: () =>
    request<Array<{ id: string; display_name: string; role: string; team: string | null }>>(
      "/auth/sandbox/identities"
    ),
  sandboxSwitchRole: (userId: string) =>
    request<LoginResponse>("/auth/sandbox/switch-role", {
      method: "POST",
      body: JSON.stringify({ user_id: userId })
    }),
  sandboxReset: () => request<any>("/auth/sandbox/reset", { method: "POST" }),
  krMapping: () => request<any[]>("/okr/kr-mapping"),
  headcount: () => request<any>("/admin/headcount"),
  adminUsers: () => request<any[]>("/admin/users"),
  adminResetUserPassword: (userId: string, newPassword?: string | null) =>
    request<any>(`/admin/users/${encodeURIComponent(userId)}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ new_password: newPassword?.trim() ? newPassword.trim() : null }),
    }),
  auditLog: (filters: QueryParams = {}) => request<any[]>(`/admin/audit-log${toQuery(filters)}`),
  adminKhmtFiOverview: (month: number, year: number) =>
    request<any[]>(`/admin/khmt-fi?month=${month}&year=${year}`),
  adminKhmtFiPreview: (team: string, month: number, year: number, assessment: string) =>
    request<any>(
      `/admin/khmt-fi/${encodeURIComponent(team)}/${month}/${year}/preview${toQuery({ assessment })}`,
    ),
  adminKhmtFiFinalize: (team: string, month: number, year: number, reason: string, assessment: string, options: RevisionRequestOptions = {}) =>
    request<any>(`/admin/khmt-fi/${encodeURIComponent(team)}/${month}/${year}/finalize`, {
      method: "POST",
      signal: options.signal,
      headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
      body: JSON.stringify({
        reason,
        assessment,
        ...(options.expectedRevision === undefined ? {} : { expected_revision: options.expectedRevision }),
        ...(options.expectedFiTeamRevision === undefined ? {} : { expected_fi_team_revision: options.expectedFiTeamRevision }),
        ...(options.expectedPlanHash === undefined ? {} : { expected_plan_hash: options.expectedPlanHash }),
      }),
    }),
  adminKhmtFiUnlock: (team: string, month: number, year: number, reason: string, options: RevisionRequestOptions = {}) =>
    request<any>(`/admin/khmt-fi/${encodeURIComponent(team)}/${month}/${year}/unlock`, {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({ reason, expected_revision: options.expectedRevision ?? 0 }),
    }),
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
  exportDashboard: (month: number, year: number) =>
    requestBlob(`/okr/dashboard/export?month=${month}&year=${year}`, { method: "POST" }),
  updateLeaderKpiAllocation: (month: number, year: number, team: string, payload: { a1?: number | null; a2?: number | null }) =>
    request<DashboardPayload>(`/okr/leader-kpi-allocation/${month}/${year}/${encodeURIComponent(team)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  clientDebugLog: (payload: ClientTelemetryPayload) =>
    request<{ ok: boolean }>("/okr/client-debug-log", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  uploadReport: (file: File, mode: "preview" | "insert-missing" | "replace" = "preview") => {
    const body = new FormData();
    body.append("file", file);
    body.append("mode", mode);
    return request<any>("/okr/reports/upload", { method: "POST", body });
  },
  importHistoricalSnapshot: (file: File, mode: "preview" | "insert-missing" = "preview") => {
    const body = new FormData();
    body.append("file", file);
    return request<any>(`/okr/historical-snapshots/import?mode=${mode}`, { method: "POST", body });
  },
  getWebInput: (team: string, month: number, year: number) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}`),
  saveWebInputDraft: (team: string, month: number, year: number, data: any, expectedVersion?: number | null) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/draft`, {
      method: "PUT",
      body: JSON.stringify({ data, expected_version: expectedVersion ?? null })
    }),
  saveWebInputDraftRevision: (
    team: string,
    month: number,
    year: number,
    data: any,
    options: RevisionRequestOptions = {},
  ) => request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/draft`, {
    method: "PUT",
    signal: options.signal,
    headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
    body: JSON.stringify({ data, expected_revision: options.expectedRevision ?? 0 }),
  }),
  submitWebInput: (team: string, month: number, year: number, data: any) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/submit`, {
      method: "POST",
      body: JSON.stringify({ data })
    }),
  submitWebInputRevision: (
    team: string,
    month: number,
    year: number,
    data: any,
    options: RevisionRequestOptions = {},
  ) => request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/submit`, {
    method: "POST",
    signal: options.signal,
    headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
    body: JSON.stringify({ data, expected_revision: options.expectedRevision ?? 0 }),
  }),
  lockWebInput: (team: string, month: number, year: number, reason: string, options: RevisionRequestOptions = {}) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/lock`, {
      method: "POST",
      signal: options.signal,
      headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
      body: JSON.stringify({
        reason,
        ...(options.expectedRevision === undefined ? {} : { expected_revision: options.expectedRevision }),
        ...(options.expectedFiTeamRevision === undefined ? {} : { expected_fi_team_revision: options.expectedFiTeamRevision }),
        ...(options.expectedPlanHash === undefined ? {} : { expected_plan_hash: options.expectedPlanHash }),
      })
    }),
  previewMonthlyFiAllocation: (team: string, month: number, year: number) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/fi-allocation-preview`),
  unlockWebInput: (team: string, month: number, year: number, reason: string, options: RevisionRequestOptions = {}) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/unlock`, {
      method: "POST",
      signal: options.signal,
      headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
      body: JSON.stringify({ reason, ...(options.expectedRevision === undefined ? {} : { expected_revision: options.expectedRevision }) })
    }),
  getWebInputPreview: (team: string, month: number, year: number) =>
    request<any>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/preview`),
  getWebInputStatus: (month: number, year: number) =>
    request<any[]>(`/okr/web-input/status?month=${month}&year=${year}`),
  listTaggableEmployees: () =>
    request<Array<{ id: string; display_name: string; full_name: string; team: string | null; role: string }>>(`/okr/web-input/employees`),
  exportWebInputExcel: (team: string, month: number, year: number) =>
    requestBlob(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/export/excel`),
  getWebInputEmail: (team: string, month: number, year: number) =>
    request<{ text: string; filename: string }>(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/export/email`),
  downloadWebInputEmail: (team: string, month: number, year: number) =>
    requestBlob(`/okr/web-input/${encodeURIComponent(team)}/${month}/${year}/export/email/download`),
  createSk: (payload: any, idempotencyKey?: string) =>
    request<any>("/fi/sk-ctkt", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(payload),
    }),
  listSk: (filters: QueryParams = {}) => request<any[]>(`/fi/sk-ctkt${toQuery(filters)}`),
  fiHistory: (filters: QueryParams = {}) => request<{
    items: any[];
    page: number;
    page_size: number;
    total: number;
    has_next: boolean;
    total_pages: number;
    summary?: Record<string, number>;
    applied_filters?: Record<string, unknown>;
    sort?: string;
    data_revision?: number;
  }>(`/fi/history${toQuery(filters)}`),
  getSk: (id: string) => request<any>(`/fi/sk-ctkt/${id}`),
  updateSk: (id: string, payload: any) =>
    request<any>(`/fi/sk-ctkt/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  updateSkRevision: (id: string, payload: any, options: RevisionRequestOptions = {}) =>
    request<any>(`/fi/sk-ctkt/${id}`, {
      method: "PUT",
      signal: options.signal,
      headers: {
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify({ ...payload, expected_revision: options.expectedRevision ?? null }),
    }),
  deleteSk: (id: string, options: RevisionRequestOptions = {}) =>
    request<any>(`/fi/sk-ctkt/${id}${toQuery({ expected_revision: options.expectedRevision })}`, {
      method: "DELETE",
      signal: options.signal,
    }),
  publicSk: (filters: QueryParams = {}) => request<any[]>(`/fi/sk-ctkt/public${toQuery(filters)}`),
  fiDashboard: () => request<any>("/fi/dashboard"),
  fiReports: (filters: QueryParams = {}) => request<any[]>(`/fi/reports${toQuery(filters)}`),
  exportFiReports: (filters: FiReportExportFilters = {}) =>
    requestBlob(
      `/fi/reports/export${toQuery({
        q: filters.q,
        registration_year: filters.registration_year,
        teams: filters.teams?.join(","),
        registration_months: filters.registration_months?.join(","),
        decisions: filters.decisions?.join(","),
        khmt: filters.khmt?.join(","),
        khmt_periods: filters.khmt_periods?.join(","),
        completion: filters.completion?.join(","),
        authors: filters.authors?.join(","),
        submitters: filters.submitters?.join(","),
      })}`
    ),
  notifications: () => request<any[]>("/notifications"),
  capabilities: () => request<Record<string, unknown>>("/auth/capabilities"),
  revokeAllSessions: () => request<{ revoked: boolean; message: string }>("/auth/revoke-all-sessions", { method: "POST" }),
  markNotificationRead: (id: string) => request<any>(`/notifications/${id}/read`, { method: "PUT" }),
  submitFeedback: (payload: {
    feedback_type: "loi" | "kho_su_dung" | "gop_y";
    description: string;
    context: Record<string, string>;
    build_id?: string;
    consent: boolean;
  }, idempotencyKey: string) => request<{ ticket_id: string; received: boolean }>("/feedback", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey, "X-App-Build-Id": import.meta.env.VITE_APP_BUILD_ID ?? "local" },
    body: JSON.stringify(payload),
  }),
  transitionSk: (id: string, action: string, payload: any = {}) =>
    request<any>(`/fi/sk-ctkt/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  assignKhmt: (id: string, month: number, year: number, expectedRevision?: number | null) =>
    request<any>(`/fi/sk-ctkt/${id}/assign-khmt`, {
      method: "POST",
      body: JSON.stringify({ month, year, expected_revision: expectedRevision ?? 0 })
    }),
  clearKhmt: (id: string, expectedRevision?: number | null) =>
    request<any>(`/fi/sk-ctkt/${id}/assign-khmt${toQuery({ expected_revision: expectedRevision })}`, {
      method: "DELETE",
    }),
  uploadSkImage: (skId: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<any>(`/fi/sk-ctkt/${skId}/images`, { method: "POST", body });
  },
  uploadSkImageWithOptions: (skId: string, file: File, options: RevisionRequestOptions = {}) => {
    const body = new FormData();
    body.append("file", file);
    return request<any>(`/fi/sk-ctkt/${skId}/images${toQuery({ expected_revision: options.expectedRevision })}`, {
      method: "POST",
      signal: options.signal,
      headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
      body,
    });
  },
  getSkImageBlob: (skId: string, imageId: string) =>
    requestBlob(`/fi/sk-ctkt/${skId}/images/${imageId}/raw`),
  deleteSkImage: (skId: string, imageId: string, expectedRevision?: number | null) =>
    request<any>(`/fi/sk-ctkt/${skId}/images/${imageId}${toQuery({ expected_revision: expectedRevision })}`, { method: "DELETE" }),
  etFrameworks: () => request<any[]>("/et/frameworks"),
  etFramework: (id: string) => request<any>(`/et/frameworks/${id}`),
  createEtFramework: (payload: any) =>
    request<any>("/et/frameworks", { method: "POST", body: JSON.stringify(payload) }),
  updateEtFramework: (id: string, payload: any) =>
    request<any>(`/et/frameworks/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteEtFramework: (id: string) =>
    request<any>(`/et/frameworks/${id}`, { method: "DELETE" }),
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
  etPersonnelSummary: (query = "") => request<any>(`/et/personnel/summary${query}`),
  createEtPersonnel: (payload: any) =>
    request<any>("/et/personnel", { method: "POST", body: JSON.stringify(payload) }),
  updateEtPersonnel: (id: string, payload: any) =>
    request<any>(`/et/personnel/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  hideEtPersonnel: (sourceType: string, sourceId: string) =>
    request<any>(`/et/personnel/visibility/${encodeURIComponent(sourceType)}/${encodeURIComponent(sourceId)}`, { method: "DELETE" }),
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
  updateEtAssessment: (id: string, payload: any, options: RevisionRequestOptions = {}) =>
    request<any>(`/et/assessments/${id}`, {
      method: "PUT",
      signal: options.signal,
      headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
      body: JSON.stringify({ ...payload, ...(options.expectedRevision === undefined ? {} : { expected_revision: options.expectedRevision }) }),
    }),
  refreshEtAssessmentScores: (id: string, expectedRevision?: number | null) =>
    request<any>(`/et/assessments/${id}/refresh-required-scores${toQuery({ expected_revision: expectedRevision })}`, { method: "POST" }),
  submitEtAssessment: (id: string, options: RevisionRequestOptions = {}) =>
    request<any>(`/et/assessments/${id}/submit${toQuery({ expected_revision: options.expectedRevision ?? 0 })}`, {
      method: "POST",
      signal: options.signal,
      headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
    }),
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
