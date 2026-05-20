import { describe, expect, it } from "vitest";
import { filterKRSummaries } from "./components/CompactKRView";
import type { KRSummary } from "./types/dashboard";

const rows: KRSummary[] = [
  {
    workshop_kr_code: "O3.KR2",
    kr_name: "Tham gia chương trình STOP",
    target_value: "200",
    dashboard_column: "V",
    team_statuses: { TBCH: "OK" },
  },
  {
    workshop_kr_code: "O5.KR12",
    kr_name: "Sáng kiến được công nhận",
    target_value: "8",
    dashboard_column: "AO",
    team_statuses: { TBCH: "GOOD" },
  },
];

describe("compact KR filtering", () => {
  it("filters by objective", () => {
    expect(filterKRSummaries(rows, "O5", "")).toHaveLength(1);
    expect(filterKRSummaries(rows, "O5", "")[0].workshop_kr_code).toBe("O5.KR12");
  });

  it("searches by code or name", () => {
    expect(filterKRSummaries(rows, "all", "stop")[0].workshop_kr_code).toBe("O3.KR2");
    expect(filterKRSummaries(rows, "all", "KR12")[0].workshop_kr_code).toBe("O5.KR12");
  });
});
