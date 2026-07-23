import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, setToken } from "./client";

let fetchMock: ReturnType<typeof vi.fn>;

function okJson(payload: unknown): Response {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
    blob: vi.fn(),
    text: vi.fn().mockResolvedValue("")
  } as unknown as Response;
}

function okBlob(payload: Blob): Response {
  return {
    ok: true,
    json: vi.fn(),
    blob: vi.fn().mockResolvedValue(payload),
    text: vi.fn().mockResolvedValue("")
  } as unknown as Response;
}

beforeEach(() => {
  setToken("");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("api client auth contract", () => {
  it("logs in with user_id and password only", async () => {
    fetchMock.mockResolvedValue(okJson({ access_token: "jwt" }));

    await api.login("admin", "secret");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/login", expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ user_id: "admin", password: "secret" });
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
    expect((init.headers as Headers).get("Authorization")).toBeNull();
  });

  it("exports dashboard as an authenticated blob request", async () => {
    const workbook = new Blob(["xlsx"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    setToken("signed-token");
    fetchMock.mockResolvedValue(okBlob(workbook));

    const result = await api.exportDashboard();

    expect(result).toBe(workbook);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/okr/dashboard/export", expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer signed-token");
    expect((init.headers as Headers).get("Content-Type")).toBeNull();
  });

  it("downloads the report template as an authenticated blob request", async () => {
    const workbook = new Blob(["xlsx"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    setToken("signed-token");
    fetchMock.mockResolvedValue(okBlob(workbook));

    const result = await api.downloadReportTemplate();

    expect(result).toBe(workbook);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/okr/reports/template", expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer signed-token");
    expect((init.headers as Headers).get("Content-Type")).toBeNull();
  });

  it("loads warnings for the selected OKR period", async () => {
    setToken("signed-token");
    fetchMock.mockResolvedValue(okJson([]));

    await api.warnings(4, 2026);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/okr/warnings?month=4&year=2026", expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer signed-token");
  });

  it("imports historical snapshots as an authenticated form request", async () => {
    setToken("signed-token");
    fetchMock.mockResolvedValue(okJson({ imported_count: 1 }));
    const file = new File(["xlsx"], "snapshot.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    await api.importHistoricalSnapshot(file);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/okr/historical-snapshots/import", expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer signed-token");
    expect((init.headers as Headers).get("Content-Type")).toBeNull();
  });

  it("saves web input draft with expected version", async () => {
    setToken("signed-token");
    fetchMock.mockResolvedValue(okJson({ status: "Đang nhập" }));

    await api.saveWebInputDraft("TBCH", 4, 2026, { kr_assessments: [] }, 3);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/okr/web-input/TBCH/4/2026/draft", expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { kr_assessments: [] },
      expected_version: 3
    });
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer signed-token");
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
  });

  it("downloads web input Excel as a blob request", async () => {
    const workbook = new Blob(["xlsx"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    setToken("signed-token");
    fetchMock.mockResolvedValue(okBlob(workbook));

    const result = await api.exportWebInputExcel("TBCH", 4, 2026);

    expect(result).toBe(workbook);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/okr/web-input/TBCH/4/2026/export/excel", expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer signed-token");
    expect((init.headers as Headers).get("Content-Type")).toBeNull();
  });

  it("uses the web input submit endpoint", async () => {
    setToken("signed-token");
    fetchMock.mockResolvedValue(okJson({ status: "Đã gửi" }));

    await api.submitWebInput("TBCH", 4, 2026, { kr_assessments: [] });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/okr/web-input/TBCH/4/2026/submit", expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ data: { kr_assessments: [] } });
  });

  it("uses the web input status and email endpoints", async () => {
    setToken("signed-token");
    fetchMock.mockResolvedValue(okJson([]));

    await api.getWebInputStatus(4, 2026);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/okr/web-input/status?month=4&year=2026", expect.any(Object));

    fetchMock.mockResolvedValue(okJson({ text: "email", filename: "email.txt" }));
    await api.getWebInputEmail("TBCH", 4, 2026);

    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/okr/web-input/TBCH/4/2026/export/email", expect.any(Object));
  });

  it("uses web input lock and unlock endpoints", async () => {
    setToken("signed-token");
    fetchMock.mockResolvedValue(okJson({ status: "Đã chốt" }));

    await api.lockWebInput("TBCH", 4, 2026, "done");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/okr/web-input/TBCH/4/2026/lock", expect.any(Object));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ reason: "done" });

    fetchMock.mockResolvedValue(okJson({ status: "Đã gửi" }));
    await api.unlockWebInput("TBCH", 4, 2026, "edit");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/okr/web-input/TBCH/4/2026/unlock", expect.any(Object));
  });

  it("uses ET assessment update and submit endpoints", async () => {
    setToken("signed-token");
    fetchMock.mockResolvedValue(okJson({ id: "a1" }));

    await api.updateEtAssessment("a1", { items: [{ id: "i1", actual_score: 5 }] });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/et/assessments/a1", expect.any(Object));
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PUT");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      items: [{ id: "i1", actual_score: 5 }]
    });

    await api.submitEtAssessment("a1");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/et/assessments/a1/submit", expect.any(Object));
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("POST");
  });

  it("uses ET personnel hide endpoint", async () => {
    setToken("signed-token");
    fetchMock.mockResolvedValue(okJson({ hidden: true }));

    await api.hideEtPersonnel("user", "admin");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/et/personnel/visibility/user/admin", expect.any(Object));
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });

  it("exports ET dashboard as an authenticated blob request", async () => {
    const workbook = new Blob(["xlsx"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    setToken("signed-token");
    fetchMock.mockResolvedValue(okBlob(workbook));

    const result = await api.exportEtDashboard("?team=TBHT%C4%90K");

    expect(result).toBe(workbook);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/et/dashboard/export?team=TBHT%C4%90K", expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer signed-token");
    expect((init.headers as Headers).get("Content-Type")).toBeNull();
  });

  it("loads report and FI details for clickable list rows", async () => {
    setToken("signed-token");
    fetchMock.mockResolvedValue(okJson({ id: "r1" }));

    await api.previewReport("r1");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/okr/reports/r1/preview", expect.any(Object));

    fetchMock.mockResolvedValue(okJson({ id: "sk1" }));
    await api.getSk("sk1");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/fi/sk-ctkt/sk1", expect.any(Object));
  });

  it("passes FI list filters through query params", async () => {
    setToken("signed-token");
    fetchMock.mockResolvedValue(okJson([]));

    await api.listSk({ include_historical: true, team: "TBĐL" });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/fi/sk-ctkt?include_historical=true&team=TB%C4%90L", expect.any(Object));

    await api.listSk({ mine_only: true });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/fi/sk-ctkt?mine_only=true", expect.any(Object));

    await api.publicSk({ historical: true, team: "TCĐK" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/fi/sk-ctkt/public?historical=true&team=TC%C4%90K", expect.any(Object));
  });

  it("exports FI reports as an authenticated blob request with active filters", async () => {
    const workbook = new Blob(["xlsx"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    setToken("signed-token");
    fetchMock.mockResolvedValue(okBlob(workbook));

    const result = await api.exportFiReports({
      teams: ["TBCH", "TBĐL"],
      registration_months: [6, 5],
      decisions: ["approved"],
      khmt: ["in"],
      khmt_periods: ["2026-6", "2026-5"],
      completion: ["done"]
    });

    expect(result).toBe(workbook);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/fi/reports/export?teams=TBCH%2CTB%C4%90L&registration_months=6%2C5&decisions=approved&khmt=in&khmt_periods=2026-6%2C2026-5&completion=done",
      expect.any(Object)
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer signed-token");
    expect((init.headers as Headers).get("Content-Type")).toBeNull();
  });
});
