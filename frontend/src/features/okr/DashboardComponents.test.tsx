import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChartBlocks } from "./components/ChartBlocks";
import { EmptyStateBanner } from "./components/EmptyStateBanner";
import { KRDrillDownPanel } from "./components/KRDrillDownPanel";
import { MonthlyHistoryHeatmap } from "./components/MonthlyHistoryHeatmap";
import { ObjectiveDashboard } from "./components/ObjectiveDashboard";
import { ObjectiveSection } from "./components/ObjectiveSection";
import { PeriodSelector } from "./components/PeriodSelector";
import { TechnicalPanel } from "./components/TechnicalPanel";
import { VisualBlockRenderer } from "./components/VisualBlockRenderer";
import { vn } from "./i18n";
import { resolveTechnicalRole } from "./roleResolver";
import { OKRWorkspace } from "./OKRWorkspace";
import type { ChartBlockData, KRSummary } from "./types/dashboard";

function block(key: ChartBlockData["block_type"], chartType: ChartBlockData["chart_type"], data: Array<number | null> = [1]): ChartBlockData {
  return {
    block_type: key,
    title: key,
    chart_type: chartType,
    kr_code: "O1.KR1",
    labels: ["TBCH"],
    datasets: [{ label: "Actual", data }],
    source_reference: "data!A1:B2",
    mapping_status: "confirmed",
    warnings: [],
    items: [{ team: "TBCH", actual: data[0], total: 10, participation_rate: data[0], participation_target: 0.5 }],
  };
}

describe("OKR dashboard components", () => {
  it("renders 12-month history and displays null as dash", () => {
    const html = renderToStaticMarkup(
      <MonthlyHistoryHeatmap
        allocations={[{ team: "TBCH", a1: 1, a2: 0 }]}
        history={[
          {
            team: "TBCH",
            team_name: "TBCH",
            months: Array.from({ length: 12 }, (_, index) => ({
              month: index + 1,
              year: 2026,
              assessment: index === 0 ? "HT tốt" : null,
              source: index === 0 ? "snapshot" : null,
            })),
          },
        ]}
        summary={{ A1: 1, A2: 0 }}
      />,
    );

    expect(html).toContain(">T12<");
    expect(html).toContain(">-<");
    expect(html).toContain("HT tốt");
    expect(html).toContain("Phân bổ Đội/Tổ trưởng");
    expect(html).toContain("A1 x1");
  });

  it("renders required chart blocks and keeps null visible as dash", () => {
    const html = renderToStaticMarkup(
      <ChartBlocks
        blocks={{
          stop_by_team: block("stop_by_team", "bar", [null]),
          stop_by_month: block("stop_by_month", "line"),
          training: block("training", "bar"),
          competency: block("competency", "progress_grid"),
          vhdn_running: block("vhdn_running", "cards", [0]),
          vhdn_sports: block("vhdn_sports", "cards"),
        }}
      />,
    );

    expect(html).toContain("stop_by_team");
    expect(html).toContain("stop_by_month");
    expect(html).toContain("training");
    expect(html).toContain("competency");
    expect(html).toContain("vhdn_running");
    expect(html).toContain("vhdn_sports");
    expect(html).toContain("<strong>-</strong>");
    expect(html).toContain(">0 / 10<");
  });

  it("renders drill-down statuses without numeric metric", () => {
    const row: KRSummary = {
      workshop_kr_code: "O6.KR4",
      kr_name: "GapoWork",
      target_value: "1",
      dashboard_column: "AV",
      team_statuses: { TBCH: "OK" },
      numeric_metric: null,
    };

    const html = renderToStaticMarkup(<KRDrillDownPanel row={row} onClose={() => undefined} />);

    expect(html).toContain("O6.KR4");
    expect(html).toContain("Chỉ có trạng thái");
  });

  it("hides import and export dashboard actions for FI coordinator", () => {
    const adminHtml = renderToStaticMarkup(<OKRWorkspace role="Admin" />);
    const fiHtml = renderToStaticMarkup(<OKRWorkspace role="FI_Coordinator" />);

    expect(adminHtml).toContain("Import snapshot lịch sử");
    expect(adminHtml).toContain("Xuất PNG toàn dashboard");
    expect(adminHtml).toContain("Xuất Excel");
    expect(fiHtml).not.toContain("Import snapshot lịch sử");
    expect(fiHtml).toContain("Xuất PNG toàn dashboard");
    expect(fiHtml).not.toContain("Xuất Excel");
  });

  it("renders objective sections in backend order and keeps fallback fields visible", () => {
    const html = renderToStaticMarkup(
      <ObjectiveDashboard
        sections={[
          { objective_code: "O3", title: "An toàn", status: "completed", conclusion: "Đạt", visuals: [] },
          { objective_code: "O1", title: "Sự cố", status: "no_data", conclusion: null, visuals: [] },
        ]}
      />,
    );

    expect(html.indexOf("O3")).toBeLessThan(html.indexOf("O1"));
    expect(html).toContain("An toàn");
    expect(html).toContain("Chưa có dữ liệu");
  });

  it("renders empty period banner and technical panel by role", () => {
    const banner = renderToStaticMarkup(
      <EmptyStateBanner currentLabel="T5/2026" latestDataLabel="T4/2026" onJumpToLatest={() => undefined} />,
    );
    const businessPanel = renderToStaticMarkup(
      <TechnicalPanel
        metadata={{ warnings: [{ warning_type: "EMPTY_CHART_DATA", severity: "LOW", reason: "raw" }], source_references: {} }}
        role="Business_User"
      />,
    );
    const adminPanel = renderToStaticMarkup(
      <TechnicalPanel metadata={{ warnings: [], source_references: {} }} role="Admin_User" />,
    );
    const forceOpenAdminPanel = renderToStaticMarkup(
      <TechnicalPanel
        forceExpanded
        metadata={{ warnings: [{ warning_type: "EMPTY_CHART_DATA", severity: "LOW", reason: "raw" }], source_references: {} }}
        role="Admin_User"
      />,
    );

    expect(banner).toContain("Chưa có dữ liệu dashboard cho T5/2026. Kỳ gần nhất có dữ liệu là T4/2026.");
    expect(banner).toContain("Chuyển sang T4/2026");
    expect(businessPanel).not.toContain("EMPTY_CHART_DATA");
    expect(adminPanel).toContain("Mở chi tiết");
    expect(forceOpenAdminPanel).toContain("Chưa có dữ liệu biểu đồ cho kỳ này");
    expect(forceOpenAdminPanel).toContain("EMPTY_CHART_DATA");
  });

  it("translates known business tokens and resolves technical roles", () => {
    expect(vn("EMPTY_CHART_DATA")).toBe("Chưa có dữ liệu biểu đồ cho kỳ này");
    expect(vn("UNKNOWN")).toBe("UNKNOWN");
    expect(resolveTechnicalRole(["Team_Account"])).toBe("Business_User");
    expect(resolveTechnicalRole(["Admin"])).toBe("Admin_User");
    expect(resolveTechnicalRole(["Admin", "Team_Account"])).toBe("Mixed_Role_User");
  });

  it("renders visual block states and specialized bar-line chart", () => {
    const barLine = renderToStaticMarkup(
      <VisualBlockRenderer
        block={{
          id: "o2",
          kind: "bar_line_chart",
          title: "O2 chart",
          data_state: "ready",
          payload: {
            labels: ["T1", "T2"],
            datasets: [
              { label: "Kết quả", data: [1, 2], chart_type: "bar" },
              { label: "Mục tiêu", data: [2, 2], chart_type: "line", axis: "right", value_format: "percent" },
            ],
            axis_labels: {
              x: "Tháng",
              left_y: "Số lượng",
              right_y: "Tỷ lệ (%)",
            },
            summary_items: [{ label: "Tỷ lệ", value: 0.5, format: "percent" }],
          },
        }}
      />,
    );
    const noPlan = renderToStaticMarkup(
      <VisualBlockRenderer block={{ id: "empty", kind: "bar_chart", title: "Empty", data_state: "no_plan", empty_message: "Không có KH trong tháng" }} />,
    );

    expect(barLine).toContain("bar-line-chart");
    expect(barLine).toContain("Kết quả");
    expect(barLine).toContain("Tháng");
    expect(barLine).toContain("Số lượng");
    expect(barLine).toContain("Tỷ lệ (%)");
    expect(barLine).toContain("50.0%");
    expect(noPlan).toContain("Không có KH trong tháng");
  });

  it("renders compact metric tables with imported Excel notes", () => {
    const metricTable = renderToStaticMarkup(
      <VisualBlockRenderer
        block={{
          id: "o2-table",
          kind: "metric_table",
          title: "KR2",
          data_state: "ready",
          payload: {
            columns: [
              { key: "team_name", label: "Đội/Tổ" },
              { key: "actual", label: "HM hoàn thành" },
              { key: "rate", label: "Tỷ lệ", format: "percent" },
            ],
            rows: [{ team: "TBCH", team_name: "Đội thiết bị chấp hành", actual: 750, rate: 0.988 }],
            summary_items: [{ label: "T4 tỷ lệ", value: 0.976, format: "percent" }],
            notes: ["* Đội TBĐ", "25 mục không thực hiện do điều kiện khách quan"],
          },
        }}
      />,
    );

    expect(metricTable).toContain("metric-table");
    expect(metricTable).toContain("Đội thiết bị chấp hành");
    expect(metricTable).toContain("98.8%");
    expect(metricTable).toContain("Ghi chú từ dashboard Excel");
    expect(metricTable).toContain("25 mục không thực hiện do điều kiện khách quan");
  });

  it("renders all objective visual rows without truncating historical KR data", () => {
    const statusGrid = renderToStaticMarkup(
      <VisualBlockRenderer
        block={{
          id: "status",
          kind: "status_grid",
          title: "O1",
          data_state: "ready",
          payload: {
            items: Array.from({ length: 10 }, (_, index) => ({
              workshop_kr_code: `O1.KR${index + 1}`,
              kr_name: `KR ${index + 1}`,
              team_statuses: { TBCH: "OK" },
            })),
          },
        }}
      />,
    );
    const narrative = renderToStaticMarkup(
      <VisualBlockRenderer
        block={{
          id: "narrative",
          kind: "narrative_card",
          title: "O5",
          data_state: "ready",
          payload: {
            items: Array.from({ length: 7 }, (_, index) => ({
              label: `Mục ${index + 1}`,
              value: index + 1,
            })),
          },
        }}
      />,
    );

    expect(statusGrid).toContain("O1.KR10");
    expect(narrative).toContain("Mục 7");
  });

  it("renders objective section conclusion, empty fallback and period selector safely", () => {
    const conclusion = renderToStaticMarkup(
      <ObjectiveSection
        section={{ objective_code: "O4", title: "Cải tiến", status: "completed", conclusion: "Kết luận kỳ", visuals: [] }}
      />,
    );
    const noPlan = renderToStaticMarkup(
      <ObjectiveSection section={{ objective_code: "O6", title: "VHDN", status: "no_plan", conclusion: null, visuals: [] }} />,
    );
    const selector = renderToStaticMarkup(
      <PeriodSelector value={{ month: 4, year: 2026 }} latestDataPeriod={{ month: 4, year: 2026 }} onChange={() => undefined} />,
    );

    expect(conclusion).toContain("Kết luận kỳ");
    expect(noPlan).toContain("Không có KH trong tháng");
    expect(selector).toContain("T4/2026");
  });
});
